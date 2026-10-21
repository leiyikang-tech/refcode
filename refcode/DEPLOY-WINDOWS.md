# 部署到 Windows 主机（远程 refcode 服务）

> 目标：把 **refcode 代码检索 + 机制知识库** 作为远程服务跑在一台 Windows 主机上，
> 让 Linux/macOS/其他机器通过 HTTP 访问，从而 **清空本地 15GB 语料库、省本地盘**。

本指南假定远程服务 **最终跑在 Windows**。两种访问方都能用它：
- **B1. 服务端在 Windows，Windows 自己持有数据**（推荐，见"数据拉取"）
- **B2. 服务端在 Windows，数据从 Linux 中转**（先在本机建好，再拷到 Windows）

---

## 一、需要的文件（都在 GitHub 仓库 `leiyikang-tech/refcode`）

从 <https://github.com/leiyikang-tech/refcode> 下载 ZIP 或 `git clone`，只需这几个文件：

```
refcode/
├── refcode-server.ts      ← 远程服务程序（Bun 运行，跨平台）
├── refcode_sync.py        ← 同步客户端（纯 Python，Windows 可用）
├── refcode-sync.py        ← 薄包装，让 `python3 refcode-sync.py` 可用
├── mechanisms.py          ← 机制知识库 CLI（可选，纯 Python）
├── mechanisms-server.ts   ← 机制 HTTP 服务（可选，如只想要机制库）
└── mechanisms.db          ← 机制库种子（800K，可选）
```

`refcode-server.ts` 是**唯一必须的服务端**——它同时挂载代码语料库 + 机制库，一个端口搞定。

---

## 二、安装 Bun（运行服务端）

Bun 是运行 `refcode-server.ts` 的运行时（类似 Node.js）。Windows 用 PowerShell 一行装：

```powershell
# 1. 安装（默认装到 %USERPROFILE%\.bun）
powershell -c "irm bun.sh/install.ps1 | iex"

# 2. 指定安装目录（可选，省 C 盘 / 统一部署）
$env:BUN_INSTALL = "D:\tools\bun"
[Environment]::SetEnvironmentVariable("BUN_INSTALL", "D:\tools\bun", "User")
powershell -c "irm bun.sh/install.ps1 | iex"   # 装到 D:\tools\bun

# 3. 加入 PATH（若安装脚本没加）
#    系统环境变量里加：%BUN_INSTALL%\bin  （或 D:\tools\bun\bin）
```

验证：

```powershell
bun --version   # 应输出如 1.x.x
```

---

## 三、放数据文件

服务端需要两个数据库文件，位置可用环境变量指定（推荐统一放到 `D:\refcode`）：

```
D:\refcode\
├── refcode-server.ts          ← 从 GitHub 拷贝
├── mechanisms.db              ← 从 GitHub 拷贝（机制库种子，800K）
└── data\                      ← 语料库目录（服务端自动建）
    └── refcode.db             ← 代码语料库（服务端自动建，会变大）
```

启动前设置环境变量（PowerShell，持久化到"用户"级）：

```powershell
# 服务端进程用户级环境变量
[Environment]::SetEnvironmentVariable("REFCODE_DB", "D:\refcode\data\refcode.db", "User")
[Environment]::SetEnvironmentVariable("MECH_DB", "D:\refcode\mechanisms.db", "User")
[Environment]::SetEnvironmentVariable("REFCODE_PORT", "8788", "User")
```

> 不设也行的默认值：`REFCODE_DB` → `%USERPROFILE%\.refcode\remote\refcode.db`，
> `MECH_DB` → `%USERPROFILE%\.refcode\mechanisms.db`，`PORT` → `8788`。
> 服务默认监听 `0.0.0.0`（局域网可访问）；想限制用 `REFCODE_HOSTNAME`。

---

## 四、启动服务（前台验证）

```powershell
cd D:\refcode
bun refcode-server.ts --port 8788
# 输出：
#   refcode-server on http://localhost:8788
#   corpus: D:\refcode\data\refcode.db
#   mechanisms: D:\refcode\mechanisms.db
```

另开一个 PowerShell 验证：

```powershell
curl http://localhost:8788/health
# {"ok":true,"corpus_db":"...","mechanisms_db":"...","projects":N}
```

---

## 五、注册为 Windows 服务（开机自启）

用 **nssm**（简单可靠）或 **任务计划程序**。

### 方式一：nssm（推荐）

```powershell
# 1. 下载 nssm: https://nssm.cc/download ，解压得到 nssm.exe
# 2. 注册服务（管理员 PowerShell）
nssm install refcode "C:\Users\<you>\.bun\bin\bun.exe" "D:\refcode\refcode-server.ts --port 8788"
nssm set refcode AppDirectory D:\refcode
nssm set refcode AppEnvironmentExtra REFCODE_DB=D:\refcode\data\refcode.db MECH_DB=D:\refcode\mechanisms.db
nssm start refcode
```

### 方式二：任务计划程序（免第三方工具）

```powershell
# 管理员 PowerShell：开机时以最高权限后台运行
$action  = New-ScheduledTaskAction -Execute "C:\Users\<you>\.bun\bin\bun.exe" `
          -Argument "D:\refcode\refcode-server.ts --port 8788" -WorkingDirectory "D:\refcode"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "refcode-server" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

验证自启：`Restart-Service refcode`（nssm）或手动启动任务后 `curl http://localhost:8788/health`。

---

## 六、把数据弄到 Windows（关键一步）

**核心事实**：`refcode-server.ts` 服务端在每次 push 时，**按窗口文本重建该项目的 FTS 索引**——它需要的是客户端推送过来的**派生数据**（符号 + 窗口文本，gzip），不需要源码、不需要 tree-sitter、不需要 15GB 本地库。

所以"数据拉取"有两种方式，二选一：

### 方式 A（推荐）：Windows 用 `refcode_sync` 客户端，从源码重推

在 **Linux（源码所在机）** 上，用 `refcode_sync.py` 把每个项目推到 **Windows 服务**：

```bash
# Linux 上
export REFCODE_HOST=http://<WINDOWS_IP>:8788     # Windows 主机的局域网 IP
python3 refcode_sync.py push a2a /path/to/a2a --licence MIT
python3 refcode_sync.py push ag2  /path/to/ag2  --licence Apache-2.0
# ... 其余项目
python3 refcode_sync.py verify <slug>            # 确认推送成功
```

- 客户端只提取派生数据并压缩传输，**不在 Linux 上建 15GB 索引**
- 推送完验证后，Linux 上的源码可删（远程已重建索引）
- Windows 服务端自动在 `REFCODE_DB` 位置建好 FTS，可检索

### 方式 B：直接把建好的语料库文件拷到 Windows

如果已经在别处建好了 `refcode.db`（含 FTS 索引），可以**整文件拷贝**到 Windows 的 `REFCODE_DB` 路径：

```powershell
# 把 refcode.db 拷到 D:\refcode\data\refcode.db（停止服务后再拷）
# 重启服务，直接可用，无需重推
```

> 方式 B 快但**要搬大文件**（10G+）；方式 A 慢一点但**传输量小得多**（窗口文本 gzip 后约 1.3G），且不需要迁 FTS 索引。

### 客户端在 Windows 上直接跑（可选）

如果 Windows 上有源码（比如 Git 克隆的项目），也可以在 Windows 本机直接 push：

```powershell
# Windows 上需要 Python 3.10+（refcode_sync.py 是纯标准库，无第三方依赖）
$env:REFCODE_HOST = "http://localhost:8788"
python D:\refcode\refcode_sync.py push myproj D:\src\myproj --licence MIT
```

---

## 七、验证服务可用（从任意机器）

```powershell
# 从另一台机器访问（用 Windows 的局域网 IP）
curl "http://<WINDOWS_IP>:8788/query?text=Task&k=5"        # 代码检索
curl "http://<WINDOWS_IP>:8788/def?name=Messenger"          # 符号定义
curl "http://<WINDOWS_IP>:8788/projects"                    # 已索引项目
curl "http://<WINDOWS_IP>:8788/recommend?scene=做多agent协作&k=3"   # 机制推荐（如果挂了机制库）
```

---

## 八、故障与多用户

- **多客户端并发**：SQLite WAL + busy_timeout，N 个客户端同时 push 同一 slug 收敛为 last-write-wins，事务崩溃安全（项目要么整体替换、要么不变）。
- **客户端离线备援**：push 时远程不可达 → 客户端写 `pending_sync.db`（仅元数据，无窗口文本）→ 恢复后 `flush` 从源码重推。
- **常见问题**：
  - 大项目（>10 万行）推送慢，客户端超时设 `REFCODE_PUSH_TIMEOUT=600`（默认 600s）。
  - Windows 防火墙需放行 8788 端口（`netsh advfirewall firewall add rule name="refcode" dir=in action=allow protocol=TCP localport=8788`）。

---

## 九、清空 Linux 本地 15GB 语料库（确认远程可用后）

确认 Windows 服务检索一切正常后，Linux 上可以删：

```bash
rm /root/.sisyphus/db/refcode.db      # 15GB 本地 FTS 索引，已由远程替代
```

机制库 `~/.refcode/mechanisms.db`（800K）小于 1GB，**保留**；除非你想连它也清，那就在 Windows 用 `mechanisms.db` 种子重建。