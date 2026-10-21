# refcode — reference-code & mechanism knowledge base

Two portable agent skills for coding / analysis agents, built for **OpenCode / OH-MY-OPENCODE**
(but the CLI tools are standalone and run anywhere with Python 3.10+ / Bun).

```
refcode/
├── README.md                 ← you are here
├── .gitignore
├── refcode/                  ← the refcode skill (code + mechanism knowledge)
│   ├── SKILL.md              ← agent-facing usage doc
│   ├── refcode.py            ← code-index CLI (extract/index/query/def) — pure stdlib
│   ├── mechanisms.py         ← mechanism knowledge CLI (build/list/show/recommend) — pure stdlib
│   ├── mechanisms-server.ts  ← Bun HTTP service over mechanisms.db (cross-platform)
│   ├── mechanisms.db         ← SEED knowledge base (27 mechs + 155 code anchors + 1262 fused projects + 13 scenes)
│   ├── refcode-server.ts     ← Bun HTTP service: remote code-corpus store + retrieval (multi-user, WAL)
│   ├── refcode_sync.py       ← remote-first sync client: push/verify/clear/flush (no local 15GB FTS)
│   ├── refcode-sync.py       ← thin wrapper so `python3 refcode-sync.py` keeps working
│   ├── refcode               ← bash launcher (prefers local .venv, falls back to python3)
│   ├── references/refcode.sql
│   └── seed/corpora.json
└── repo-map/                 ← the repo-map skill (full OSS project analysis pipeline)
    ├── SKILL.md              ← agent-facing usage doc
    ├── install.sh            ← templated installer (substitutes {{PLACEHOLDER}} paths)
    ├── COMMANDS-EXTRACTED.md
    ├── commands/             ← slash-command docs
    ├── harness/              ← gates.py, citation_check.py, depth_check.py, … (deterministic QA)
    └── references/           ← op1-op5 pipeline, taxonomy, analysis DB schemas
```

---

## What's inside

### `refcode` skill — three independent capabilities

1. **Reference-code retrieval** (`refcode.py`): index open-source projects into a
   searchable SQLite corpus (`ref_symbols` + `ref_body_fts`), so an agent can
   answer *"how did project X implement Y?"* with a real `file:line`. Commands:
   `index <slug> <path> --licence`, `def <symbol>`, `query <text> -k --project --json`.

2. **Mechanism knowledge system** (`mechanisms.py` + `mechanisms-server.ts`):
   a **mechanism-level** knowledge base that answers *"AI 之间通讯都有哪些机制 / 按场景怎么选"* —
   curated abstract mechanisms (27, across the A1–A29 agent/LLM paradigm taxonomy),
   each with definition/scenes/pros/cons/maturity, **real code implementation anchors**
   (module + symbol + file:line), and **fused real-world project instances** (1,262 analyzed
   projects from repo-map's analysis.db, bridged by domain, each with an inline mechanism
   summary). Plus **scene → ranked recommendation** (`recommend "做多agent协作"`).

   - CLI: `mechanisms build|list|show <id>|recommend "<scene>" -k N|impl|scene`
   - HTTP service: `mechanisms-server.ts` exposes query + concurrent `POST /ingest`.

3. **Remote-first sync** (`refcode_sync.py` + `refcode-server.ts`): push the code
   corpus to a **remote server** and clear the local 15GB FTS index (the disk saver).
   Local `sync push <slug> <path>` extracts **derived data only** (symbols + window text,
   gzipped) from source — it never builds the giant local trigram index — streams it to
   `refcode-server.ts`, which rebuilds the FTS remotely and answers `/query` + `/def`.
   On a remote outage the push falls back to a **metadata-only queue** (no window text;
   re-extracts from source on `flush`). Multi-user concurrent via SQLite WAL.

   - CLI: `sync push <slug> <path> --licence` | `sync verify <slug>` | `sync clear <slug>` |
     `sync flush` | `sync status`
   - Server: `refcode-server.ts` (Bun, cross-platform) — see **Option C** below.

### `repo-map` skill — full OSS project analysis pipeline

A 5-operation pipeline for dissecting an unfamiliar repo (init-deep → project profile →
comparative research → gap & opportunity → knowledge persistence), with a deterministic
QA harness (`gates.py g1..g6`, citation check, depth check, convergence, wikidata grounding)
that gatekeeps outputs. Installs via `repo-map/install.sh`, which substitutes
`{{PLACEHOLDER}}` path tokens at install time so the GitHub clone stays portable.

---

## Install — refcode skill

The refcode CLI is **pure Python standard library** (no third-party deps). Optional:
tree-sitter grammars in a local `.venv` improve code extraction (the `refcode` launcher
uses `.venv` if present, else falls back to `python3`).

### Option A — install into the OpenCode skill registry (Linux/macOS)

```bash
# 1. clone
git clone https://github.com/leiyikang-tech/refcode.git ~/refcode-src
# 2. copy the skill dir into your registry
mkdir -p ~/.agents/skills
cp -r ~/refcode-src/refcode ~/.agents/skills/refcode
# 3. optional: create a venv for tree-sitter grammars (better code extraction)
cd ~/.agents/skills/refcode
python3 -m venv .venv && . .venv/bin/activate
pip install tree-sitter tree-sitter-python tree-sitter-javascript tree-sitter-typescript \
  tree-sitter-go tree-sitter-rust tree-sitter-kotlin tree-sitter-ruby tree-sitter-cpp \
  tree-sitter-java tree-sitter-c tree-sitter-c-sharp tree-sitter-json tree-sitter-yaml
deactivate
# 4. run it
./refcode mechanisms list | head          # CLI works
```

### Option B — mechanisms HTTP service (recommended, cross-platform)

The service needs only **Bun** and the tiny `mechanisms.db` seed — NOT the 15GB code
corpus. It runs identically on Linux/macOS/Windows.

```bash
# 1. install Bun (Windows: powershell -c "irm bun.sh/install.ps1 | iex"; others: curl -fsSL https://bun.sh/install | bash)
# 2. place mechanisms.db where the service expects it, or set MECH_DB
mkdir -p ~/.refcode && cp refcode/mechanisms.db ~/.refcode/mechanisms.db
#    (Windows: %USERPROFILE%\.refcode\mechanisms.db — the default is cross-platform)
# 3. start the service
bun refcode/mechanisms-server.ts --port 8799
```

Verify:

```bash
curl http://localhost:8799/health
# {"ok":true,"db":".../mechanisms.db","mechanisms":27}

curl "http://localhost:8799/recommend?scene=%E5%81%9A%E5%A4%9Aagent%E5%8D%8F%E4%BD%9C&k=3"
# ranked mechanisms for "做多agent协作"

curl http://localhost:8799/mechanisms/a2a-protocol
# definition + code anchors + fused real projects

# distributed ingest: fuse an analyzed project into every same-domain mechanism
curl -X POST http://localhost:8799/ingest -H "Content-Type: application/json" \
  -d '{"project_name":"my-proj","paradigm_id":"A8","why_worth":"...","analysis_path":"...","source_type":"repo-map"}'
```

Endpoints:

| method | path | what it does |
|---|---|---|
| `GET` | `/health` | liveness + mechanism count |
| `GET` | `/mechanisms[?domain=A8]` | list |
| `GET` | `/mechanisms/<id>` | one mechanism: definition + code anchors + fused projects |
| `GET` | `/recommend?scene=<text>&k=<n>` | scene → ranked mechanisms |
| `GET` | `/scenes` | list scenes |
| `POST` | `/ingest` | fuse one project into every same-domain mechanism (idempotent UPSERT) |
| `POST` | `/scene` | add a scene |

Concurrency: SQLite WAL (multi-reader + single-writer) + transactional UPSERT keyed by
`UNIQUE(mechanism_id, project_name)` — N workers sharing analyses dedupe idempotently.

### Register the service as a Windows auto-start service (optional)

```powershell
# via nssm (https://nssm.cc) — auto-start on boot
nssm install refcode-mech "C:\Users\<you>\.bun\bin\bun.exe" "C:\path\to\mechanisms-server.ts --port 8799"
nssm start refcode-mech
# or simpler: a .bat in the Startup folder
#   start "" /b bun C:\path\to\mechanisms-server.ts --port 8799
```

### Rebuild the mechanism DB from scratch (optional — needs the big sources)

`build` re-anchors code (reads the refcode corpus read-only) and re-fuses project
instances (reads repo-map's `analysis.db`). Set env overrides to point at your copies:

```bash
export REFCODE_DB=/path/to/refcode.db        # code corpus (large)
export ANALYSIS_DB=/path/to/analysis.db      # repo-map analysis db (~2.6M)
export MECH_DB=/path/to/mechanisms.db        # target
./refcode mechanisms build
```

### Option C — remote code-corpus server + sync client (the disk saver)

If disk is tight, run a **remote `refcode-server.ts`** and let clients push derived data
to it instead of building a local 15GB FTS index. The server holds the corpus; a local
`sync push` extracts symbols + window text from source (gzipped), streams it over HTTP,
then the client can **clear its local index + source** after verification.

```bash
# on the server host (Linux/macOS/Windows, needs Bun):
bun refcode/refcode-server.ts --port 8788
#   default DB: ~/.refcode/remote/refcode.db  (Windows: %USERPROFILE%\.refcode\remote\refcode.db)
#   listens on 0.0.0.0 by default (set REFCODE_HOSTNAME to restrict)

# on any client, push a project from its source (no local FTS built):
export REFCODE_HOST=http://<server>:8788
python3 refcode_sync.py push <slug> <path> --licence MIT   # extract + gzip + stream + verify
python3 refcode_sync.py verify <slug>                      # confirm syms/windows/files match
python3 refcode_sync.py clear <slug>                       # delete local source + local rows (remote intact)
# after pushing everything, remove the big local index:
rm ~/.refcode/refcode.db                                   # the local 15GB FTS — no longer needed
```

Server endpoints:

| method | path | what it does |
|---|---|---|
| `GET` | `/projects` | list indexed projects (slug, files, sym/window counts) |
| `GET` | `/projects/<slug>/manifest` | per-project sha + symbol/window/file counts (verify) |
| `POST` | `/projects/<slug>/push` | one-transaction upsert + per-project FTS rebuild from window text |
| `GET` | `/query?text=...&k=...` | search symbols + body windows |
| `GET` | `/def?symbol=...` | exact symbol definition (file + line + signature) |
| `*` | mechanisms endpoints | the same mechanism DB endpoints as Option B (same port) |

Failure model: on a remote outage `push` writes a **metadata-only** pending entry
(`~/.refcode/pending_sync.db` — slug/sha/path, **no window text**); `sync flush`
re-pushes from source once the remote is back. Concurrency: SQLite WAL + busy_timeout;
N clients pushing the same slug converge to last-write-wins, crash-safe (a project is
fully replaced or unchanged).

---

## Install — repo-map skill

repo-map ships as a **portable template**: machine-specific paths appear as
`{{PLACEHOLDER}}` tokens and are substituted at install time.

```bash
bash repo-map/install.sh \
  [SKILL_DIR=$HOME/.agents/skills] \
  [REPO_MAP_HOME=$HOME/.sisyphus/repo-map] \
  [ANALYSIS_DB=$HOME/.sisyphus/db/analysis.db] \
  [REPOS_DIR=$HOME/.sisyphus/repos] \
  [KNOWLEDGE_REPO_URL=...] [KNOWLEDGE_REPO_DIR=...]
```

This materializes a working copy into the skill registry with real paths, leaving the
GitHub clone pristine. See `repo-map/SKILL.md` for the 5-operation pipeline and
`repo-map/harness/README.md` for the QA gates.

---

## Notes on the seed `mechanisms.db`

The committed `refcode/mechanisms.db` (~800K) is a **ready-to-query seed**: 27 curated
mechanisms across the A1–A29 taxonomy, 155 real code-anchor implementations, 1,262 fused
real-world project instances (with inline mechanism summaries), and 13 curated scenes. It
is fully self-contained for `list`/`show`/`recommend`/`ingest` — no code corpus needed.
The `why_worth` summaries are distilled from public repos/papers via repo-map analysis;
the `analysis_path` fields reference optional local work-log docs (not committed).

The `analysis_path` defaults in the code (e.g. `ANALYSIS_DB=/root/.sisyphus/db/analysis.db`)
are **machine-specific examples** — override via the corresponding env var on your host.