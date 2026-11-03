# Knowledge & Key-Technology Classification Taxonomy (确定性知识/关键技术分类体系)

**Status:** v1.0 seeded — Determined, extensible
**Seed source:** work-log 领域目录体系 (31 top-level domains) + analysis.db 151 topics + research-kb multi-axis precedent

Read this **before** Op3 (comparative research) and **before** Op4 (gap/opportunity).
It is the **deterministic** lens that routes every new project to the right
search plan and the right gap/opportunity aggregation bin — replacing the
per-project "guess what to search" with a fixed, repeatable classification.

---

## 0. Why this taxonomy exists (the contract)

Without it, each new project asks "what should I compare / what gap does it
fill" from scratch. With it, every project is **classified up-front** into a
fixed set of orthogonal dimensions, so:

- **Op3 dispatch is deterministic** — the paradigm category tells you *which*
  competitors to sweep, *whether* papers matter, *whether* a domain survey is
  warranted. No more "I think it's an agent framework".
- **Op4 aggregation is coherent** — gaps/opportunities are binned by paradigm,
  so the same paradigm's concurrent/prior projects accumulate into *one*
  evolving picture instead of scattering across 31 loose directories.
- **It is extensible, not closed** — a category is added only when it earns a
  genuine NEW underlying mechanism (see §4 registration rules), never for a
  new product name.

---

## 1. The classification is MULTI-AXIS, not a single tree

Work-log's 31 directories look like one tree but actually mix FOUR orthogonal
dimensions. This taxonomy separates them — that separation is what makes
search precision improve. Classify every project against axes A / B / C; keep
D for accounting.

| Axis | What it answers | Purpose | Who consumes it |
|------|-----------------|---------|-----------------|
| **A. Technology Paradigm** | *What underlying mechanism does it embody?* | Op3 dispatch + Op4 aggregation bin | Op3 / Op4 |
| **B. Project Nature** | *Platform vs capability vs domain-knowledge?* | Op3 research-path split | Op3 |
| **C. Capability** | *What reusable atomic capabilities does it prove?* | Op3.5 atomic-capability register + reuse | Op3 / Op4 (opportunity) |
| **D. Storage Source** | *Which work-log dir holds it?* (accounting, NOT a domain) | Op5 persistence + dedup | Op5 |

**Critical rule:** D (work-log directory) is a *storage bucket*, NOT a domain.
`深度研究`, `AI功能分析`, `AI协作分析`, `demo` are ANALYSIS MODES (a B/C
concern), and `agentos`, `hermes-harness`, `skillsos`, `cangjie-skill` are
PRODUCT PACKAGE MIRRORS — none of them belong in the A axis. This is the exact
conflation the work-log tree suffers, and the first thing this taxonomy fixes.

---

## Axis A — Technology Paradigm Registry (the core of the taxonomy)

The **A axis is the spine**. Each paradigm is the aggregation bin for Op3
(dispatcher) and Op4 (gap/opportunity store). Seeded from work-log's *real*
low-level domains; each row carries: definition · judge-keywords (from Op1
evidence) · work-log residence · search dispatch.

| # | Paradigm | Definition (bottom-layer mechanism) | Judge keywords (evidence) | work-log residence | Op3 dispatch |
|---|----------|-------------------------------------|---------------------------|--------------------|--------------|
| A1 | Agent 框架与编排 | Core loop: agent runtime, tool calling, orchestration, harness/self-improvement, multi-agent | agent runtime, harness, orchestration, workflow engine, self-evolve, router | 智能体框架, agentos, hermes-harness, skillsos | **竞品为主** + 论文(自进化/编排) |
| A2 | 检索增强 / RAG | Retrieve-then-generate: chunking, embedding, vector store, hybrid/graph retrieval, rerank | RAG, vector DB, embedding, retrieval, graphrag, rerank | 数据和知识清洗, 本体工程/rag, cangjie-skill | **竞品+论文** |
| A3 | 记忆与进化 | Persistent cross-session state: episodic/semantic memory, memory consolidation, self-evolution | memory, episodic, MemOS, consolidation, self-evolve, embedding memory | 记忆和进化 | **论文为主** + 竞品 |
| A4 | 本体与知识图谱 | Explicit semantics: ontology, knowledge graph, RDF/SPARQL, SHACL, semantic web, taxonomies | ontology, knowledge graph, RDF, SPARQL, semantic web, SHACL, taxonomy | 本体工程 | **竞品+标准** |
| A5 | 推理与推理优化 | Model reasoning: reasoning traces, inference optimization, distillation, quantization, hallucination control | reasoning, CoT, hallucination, distillation, quantization, ICL, inference-opt | 推理优化, coding/幻觉 | **论文主导** |
| A6 | NL2SQL / 数据智能体 | Natural language → structured query/data pipeline, data agent | text2sql, NL2SQL, data agent, dataframe agent, semantic layer | text2sql, data | **竞品+评测基准** |
| A7 | 安全与合规 | Security: agent security, prompt injection, infra guard, standards/regulatory | security, guardrail, injection, compliance, TC260, EU-US, ISO | 安全, 智能体框架/企业一站式AI/参考规范 | **标准/合规为主** + 竞品 |
| A8 | 协作与多智能体 (human-AI) | Multi-agent + human collaboration, shared context, anthropic-collab | collaboration, shared state, multi-agent, team ops, 多人项目 | AI协作分析 | **竞品为主** |
| A9 | 评估与评测 | Measuring capability: evals, benchmarks, scoring, quality gates | eval, benchmark, scoring, metric, evaluation | agentos/评估工程, 评测基准 | **竞品+基准综述** |
| A10 | 工具与执行层 | Deterministic tooling: devops, code execution, media/file tools, browser, RPA | devops, RPA, browser-automation, media, file/hand | tools, devops, aiapp, office | **竞品为主** |
| A11 | 深度研究 / 科学知识 | Autonomous research, scientific workflow, literature/paper tooling, AI4S | research, literature review, paper, AI4S, scientific | 深度研究 | **论文+领域综述** |
| A12 | 前端 / UI 呈现 | Rendering/interaction of agent output: canvases, presentation, visualization, app shells | canvas, presentation, UI, pptx, visualization | 前端框架, office, demo/需求到原型 | **竞品为主** |
| A13 | 空间智能 / 3D 重建 | Learnable monocular reconstruction: streaming causal-window transformer predicts camera pose + dense point maps, online pose composition, optional loop-closure graph optimization. Covers SfM, SLAM, MVS, Gaussian splatting, NeRF, depth prediction. | 3D reconstruction, SLAM, SfM, point cloud, camera pose, dense mapping, monocular, streaming, NeRF, gaussian splatting, depth, odometry, loop closure | 空间智能/3D重建, 视觉SLAM | **竞品+论文** (能力/关键技术类) |
| A14 | 生成式视频 / Diffusion Forcing | Diffusion-based video generation; Diffusion Forcing (DF) assigns each token an independent noise level + causal-block attention to denoise arbitrarily-long autoregressive video. Covers T2V/I2V/video-extension, DF long-video, shot-aware video captioning. | diffusion, video generation, Diffusion Forcing, autoregressive video, T2V, I2V, flow matching, teaCache, long-video, video captioning | 视频生成, 生成式视频 | **竞品+论文** (能力+平台综合) |
| A18 | 运行时复用 / 检查点-恢复虚拟化 | Embeddable-language-runtime suspension + whole-heap serialization: pause a running program at a safepoint (even mid-loop), serialize the entire heap + call stack to bytes (base/delta), resume later in the same or a new process with identical output. Distinct from A17 (OS build) and A10 (generic tools): the mechanism is engine-level checkpoint/restore of runtime state. | checkpoint-restore, heap snapshot, suspend/resume, durable execution, snapshot/delta, state serialization, CRIU-style in-engine | 运行时复用, 操作系统, 浏览器 | **竞品为主** (平台/架构类) |
| A28 | 时序基础模型 / 时间序列预测 | Causal patch-based time-series forecasting transformer: per-patch causal normalization + asinh, Decoupled Horizon Forecasting (DHF) two-stream `[Enc;Dec]` decode with block-anchored masks, monotone non-crossing quantile head, advancing-refine frame denormalization, clampsym test-time augmentation. Foundation-TS inference (zero-shot / pretrained checkpoint). | time-series forecasting, foundation model, DHF, patch, quantile, causal normalize, autoregressive, inference-only, zero-shot | 时序预测 | **竞品+论文** (能力+平台综合) |
| A30 | 机密计算 / TEE 沙箱运行时 |
| A31 | LLM 网关 / Provider 抽象层 | Unified multi-provider LLM API gateway: provider-abstraction + request/response transformation, centralized governance (auth, rate-limit, budget, spend), routing/fallback/retry/cooldown, observability callbacks, virtual keys, SSO/JWT. Distinct from agent frameworks (A1) and inference servers (A5). | LLM gateway, provider abstraction, AI proxy, unified API, OpenAI-compatible gateway, virtual key, spend tracking, routing, fallback, rate-limit gateway | 参考规范/LLM网关 | **竞品为主** (平台/架构类) | Library OS / syscall-enforcement sandbox for confidential computing: `#![no_std]` lib OS intercepts guest syscall instructions via ELF syscall→trampoline rewriting (no ptrace/seccomp), routes them through a zero-copy generic Platform abstraction (Platform as `&'static` generic param, shim handoff as the only `dyn` boundary) to pluggable host providers (SEV-SNP kernel, Hyper-V VTL1, TrustZone/OP-TEE, linux/windows userland). Backends abort on panic (SEV terminate / panic_to_vtl0), never resume. | library OS, syscall interception, syscall rewriter, TEE, confidential computing, SEV-SNP, VTL1, TrustZone, OP-TEE, enclave, sandbox | 机密计算, TEE, 沙箱, 系统安全 | **竞品+论文+标准** (能力+平台综合) |
| A33 | 硬件 / 指令级模拟 (SoC 仿真) | Instruction-level hardware emulation of a microcontroller/SoC: CPU ISA interpreter (Xtensa/RISC-V) with an interpreter-oracle JIT that must stay bit-identical to the interpreter, peripheral/MMIO register models dispatched from a single register table, full-system machine (scheduler, boards, loaders, network stack), guest-safety (DMA/image parser faults become hardware errors, never panics). Runs UNMODIFIED firmware. Distinct from A18 (runtime checkpoint-restore) and A10 (generic tools): the mechanism is ISA-exact foreign-hardware emulation with a correctness oracle. Registered 2026-10-25 from esp32sim (mikroverk) — hardware SoC emulation; A32 is audio, so this took the next free id. | emulator, instruction-level simulation, SoC emulation, JIT, MMIO register model, ESP32, Xtensa, RISC-V, hardware-in-the-loop, interpreter oracle | 操作系统, 浏览器, 运行时复用 | **竞品为主** (平台/架构类) |
| A100 | 网络监控 / 应用防火墙 / 数据包检测 | Raw packet capture + process attribution + heuristic traffic classification + detection (DGA/beaconing/anomaly/mining/integrity) + OS-firewall enforcement, with a realtime visualization UI. The mechanism is OS/kernel-level: ctypes→libpcap capture loop, hand-written (no Scapy) Ethernet/IPv4/IPv6/TCP/UDP/DNS/TLS-SNI parser, psutil net_connections→pid mapping, registrable-domain suffix classification, opt-in detectors, cross-OS firewall backends (WFP/pf/iptables). Distinct from A30 (confidential-computing TEE sandbox) and A7 (LLM/AI security): it is network-traffic monitoring + per-app firewall. Registered 2026-10-25 from Snitch (aixisstudio) — first network-monitoring project; next free id after A33. | packet capture, libpcap, app firewall, network monitor, traffic classification, DGA, beaconing, process attribution, TLS-SNI, nfqueue, firewall | 网络安全监控, 应用防火墙, 数据包检测, 网络监控 | **竞品为主** (综合性) |
| A101 | 跨设备输入/屏幕共享网格 | Cross-device KVM + screen-share + clipboard mesh: custom TLS wire protocol (TCP 47800 + UDP discovery 47801), 6-digit SAS-code pairing via commit/challenge (hash-preimage, constant-time compare), BLE-GATT-over-TCP-loopback tunnel as a bootstrap transport (raw ATT + GATT server over BlueZ D-Bus, multi-threaded), optional upgrade to Wi-Fi Direct/hotspot, OS-level HID injection with a numbered "Rule N" input-safety state machine (1500ms deadman, own-injection echo suppression, held-key release swallow), screen mirroring + virtual-display/EDID gen, hybrid-logical-clock clipboard sync, phone hub (calls/messages/photos/files). Registered 2026-10-25 from TwinDesk (inukaasith) — first cross-device-mesh project; next free id after A100. | KVM, input sharing, screen share, remote control, device mesh, clipboard sync, BLE GATT tunnel, Wi-Fi Direct, SAS pairing, virtual display, screen mirroring | 跨设备,输入共享,屏幕共享,设备网格,远程控制 | **竞品为主** (综合性, 能力+平台) |
| A102 | 搜索趋势 / 关键词情报 | Multi-signal fusion for emergent-term surge detection + demand sizing: fuse independent signals (social posts, HF trending, GitHub breakouts, sitemaps, Search Console, Reddit asks, seller/payment links, revenue) → extract candidate names → surge-vs-baseline scoring (`lift = recent/(expected+1)`) → judge name-or-common-word → size real search demand against a benchmark AND against the term's own search curve (normalized 0-100 Trends series, curve-shape classification into rising/holding/fading/flat, benchmark back-calibration reversing `term_volume/30 * bench_level/term_level`). Distinct from A11 (deep research / literature) — the mechanism is market/keyword trend discovery from live search+social+commerce signals, not paper/literature analysis; produces prioritize/watch/skip rankings for SEO. Registered 2026-10-26 from new-term-radar (zhuyansen) — first search-trend/keyword-intelligence project; next free id after A101. | keyword research, surge detection, trend detection, SEO, signal fusion, search volume, emerging term, DataForSEO, lead scoring, curve-shape | 深度研究, 数据和知识清洗 | **竞品+领域综述** (综合性, 能力+平台) |

### A-axis usage protocol (Op3/Op4, deterministic)

1. From Op1/Op2 **evidence**, assign a project to **1 primary + 0..2 secondary**
   A-paradigms (keywords from the table, not the README).
2. The **primary** paradigm dictates the dominant Op3 search path (its `Op3
   dispatch` column) and the **Op4 gap/opportunity aggregation bin** (the
   `project_gaps.domain` / `project_opportunities.domain`).
3. Secondary paradigms add *convergence signals* for Op4 opportunities (≥3
   independent analyses on that paradigm → promote).
4. A project may cross paradigms (e.g. GraphRAG = A2+A4) — that's an *opportunity
   seed*, not an error. Always record the primary bin.

---

## Axis B — Project Nature (from existing Op3.1, now deterministic)

Classify from evidence, then map to the mandatory dispatch:

| Nature | Evidence | Op3 research actions |
|--------|----------|----------------------|
| 平台 / 架构类 | framework/runtime/platform/full-stack skeleton, layered modules | high-similarity **competitor** deep-dive |
| 能力 / 关键技术类 | algorithms, DSP, low-level libs, single sharp mechanism | competitive **+ deep paper search** |
| 综合性 (capability+platform) | both | both **+ 7-layer landscape benchmark** |
| 领域知识高价值 | domain-heavy, data/ontology rich, benchmarks | **+ single-topic knowledge survey** |

`Axes B + A-primary` together fully determine the Op3 plan. B says *how deep*;
A says *in which bin*.

---

## Axis C — Capability (atomic ability register)

The reusable-atomic-capability cross-index (precedent: research-kb `by-capability`,
988 capabilities). When Op3.5 promotes a verified capability, tag it here.

Capability tag = `{verb}-{object}-{mechanism}` (e.g. `retrieve-hybrid-community-detection`,
`embed-memory-consolidation`). Register in the capability index (see `capabilities.md`).

---

## Axis D — Work-log storage bucket (accounting only)

Where Op5 persists. Maps A-primary → default work-log dir. **D is a bucket, not a
domain** — same bucket may hold multiple A-paradigms' files.

---

## 4. Extensibility — the registration rules (WHAT earns a new category)

A keeper taxonomy must grow only on genuine signal, or search precision rots.

### Add a NEW A-paradigm when (all three):
1. **New bottom-layer mechanism** observed (a distinct API/algo/protocol/kernel,
   not a new product name or a re-label of an existing paradigm).
2. **Evidence-backed** (≥1 Op1/Op2 code-path or doc anchor; marker doc in work-log).
3. **Non-overlapping** with existing A1–A12 (fails the "is it really not A2/A4?"
   test → fold into the existing bin, don't fork).

### Do NOT add for:
- A new **product** (addressing the same paradigm) → keep in the pod's bin.
- A new **work-log directory** (Axes D) → directories can be added freely for
  storage; that is NOT an A-axis change.
- A new **analysis-mode folder** (深度研究/AI功能分析/...) → those are B/C, not A.

### The two-step extension flow
```
Propose → 1) locate nearest existing paradigm  →  if fits, absorb (record link)
         → 2) if genuinely orthogonal + evidenced → open new paradigm, update
             this registry + analysis.db + work-log reference
```

---

## 5. Where this taxonomy lives (single source of truth + mirrors)

| Surface | Role |
|---------|------|
| **this file** (`references/taxonomy/KNOWLEDGE-TAXONOMY.md`) | authoritative registry |
| `references/taxonomy/capabilities.md` | Axis C atomic-capability index (grows per project) |
| analysis.db `project_gaps.domain` / `project_opportunities.domain` | Op4 bins = A-paradigm id (A1–A12) |
| work-log A-paradigm residence dirs | persistent human-readable docs (Axis D) |

Update this registry **before** Op3/Op4 run on a project exhibiting a possibly-new
paradigm; the classification decision is deterministic and precedes search.

---

## 6. Status & seed provenance

- v1.0 seeded from: work-log 31 top-level domains (office canonical, 585 md),
  analysis.db 151 topics, research-kb multi-axis precedent (by-domain /
  by-capability / gap-analysis / maturity).
- Confirmed dimension-split: `深度研究`/`AI功能分析`/`AI协作分析`/`demo` are
  **analysis modes (B/C)**; `agentos`/`hermes-harness`/`skillsos`/`cangjie-skill`
  are **product mirrors (D)**; `channel`/`data`/`信息源` are **catch-alls (D)**.
- Next: backfill each A-paradigm's Op4 bin from existing analysis.db rows, and
  seed `capabilities.md` from existing work-log competitive analyses.