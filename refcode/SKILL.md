---
name: refcode
description: Extract, classify, register and query reference code across many open-source projects, so an agent can cite real peer implementations (file:line) instead of re-deriving them. Turns a folder or a git URL into searchable "retrieval documents" (tree-sitter symbols + BM25 body windows) in one self-contained SQLite DB (FTS5). Use when building/porting a subsystem and you need how a peer project solved it; when adding reference-code retrieval to an analysis workflow (e.g. repo-map Op3); or when you want a reusable, shareable corpus of pinned projects. Triggers - refcode, reference code, 参考代码, 找实现, how did X implement Y, cite file:line, corpus of projects, index an open-source project for retrieval.
---

# refcode — reference-code retrieval across projects

The portable core of XERJ's "repo → retrieval documents" pipeline, with no server
and no daemon: **one SQLite file**. It exists so a coding or analysis agent can
answer *"how did project X implement Y?"* with a real `file:line`, the way XERJ's
own contributors do (`xerj search` / `xerj def`).

## The six capabilities

| verb | what it does | XERJ origin |
|---|---|---|
| **extract** | one source file → one doc `{language, symbols[], defs, body}`; tree-sitter AST, per-language `TAGS_QUERY` where the grammar ships one, else a generic definition-node heuristic | `xerj-autoindex/src/extract/code.rs` |
| **classify** | project → `{languages, domain, dependency_names}` (domain from lockfile deps + name/keyword hints; **heuristic**, never claimed as ground truth) | `xerj-hub/src/{catalogue,router}.rs` |
| **register** | a project → a pinned corpus row `url + 40-hex sha + licence + use_policy`; the tiny, shareable manifest (no source) | `tools/xerj-code/hub/*.json` |
| **query** | **docs arm first** (design/mechanism docs, see below) **+** exact symbol lookup **+** BM25 over body windows (FTS5) | `xccode::run_code_query` (`passage.rs`, `fields.rs`) |
| **docs** | add/list design & mechanism-level docs (repo-map Op2/Op3/Op4 artifacts, work-log analyses) into `ref_docs`, searchable by the `query` docs-arm | — (new; `ref_docs` mirrors `analysis.db`'s `analysis_docs`) |
| **mechanisms** | mechanism-level knowledge system (own `mechanisms.db`): curated abstract mechanisms (A1-A29 domains) with definition/scenes/pros/cons + **real code implementation anchors** (module + symbol + file:line from the refcode corpus) + **fused real-world project instances** (every analyzed project from `analysis.db`, bridged by paradigm domain, carrying mechanism summary + work-log doc path) + **scene → ranked mechanism recommendation** | — (new; independent of the code index) |

**Docs arm** — `ref_docs` holds the content that answers *"what mechanisms / how
does it work / what's the design"* questions the code index cannot: repo-map
functional profiles, atomic-capability & competitive analyses, mechanism
analyses, ecosystem landscapes. `query` searches it **first** (ranked above code
hits), so a design-level query surfaces the analysis doc rather than a bare
symbol. Because trigram FTS needs ≥3-char queries and misses 2-char CJK words
(通讯/机制/协作), the docs arm falls back to a `LIKE` substring scan over the
(small) `ref_docs` table for high recall.

**Mechanisms** — `refcode mechanisms` answers *"AI 之间通讯都有哪些机制 / 按场景
该用哪个"* with abstract mechanisms that carry real code. Each mechanism is a
curated design entity (definition + applicable scenes + pros/cons + maturity),
and `SLUG_ATTACHMENTS` pins each to real refcode-corpus projects (with
module-hint filters) so `show <id>` lists concrete `module + symbol + file:line`
anchors — not just a doc. `build` also **fuses every analyzed project** from
`analysis.db` (repo-map Op2/Op3/Op4 output, ~1288 projects) into
`project_instances`, bridged to mechanisms by paradigm domain — so `show <id>`
lists the real-world projects behind each mechanism (name + mechanism summary +
work-log doc path), and `recommend` reports `projects=` support count.
`recommend "<场景>"` ranks mechanisms by stopword-filtered term fit (fit
dominates; maturity only boosts among mechanisms that actually match, so
popular-but-irrelevant ones don't surface).

## Install / runtime

Grammars live in the skill's own venv (compiled wheels, no runtime download):

```bash
/root/.agents/skills/refcode/.venv/bin/python --version   # 3.12
/root/.agents/skills/refcode/.venv/bin/pip freeze | grep tree-sitter
```

`./refcode` (bash launcher) auto-selects `.venv/bin/python`, falling back to
`python3`. 25 language grammars installed: python, rust, javascript, typescript, go,
java, c, cpp, ruby, php, c_sharp, bash, scala, haskell, kotlin, swift, lua,
elixir, json, yaml, toml, html, css, sql, markdown (see `requirements.txt`).

> If a grammar host is unreachable, grammars are **per-language PyPI wheels**
> (`tree-sitter-<lang>`), not the runtime-downloading `tree-sitter-language-pack`.

## Usage

```bash
R=/root/.agents/skills/refcode/refcode

# 1) index a local folder OR a git URL (shallow clone, optional pinned sha)
$R index xerj-hub /path/to/xerj/engine/crates/xerj-hub --licence Apache-2.0
$R index tantivy https://github.com/quickwit-oss/tantivy --sha 3a55bc98... --licence MIT

# 2) query: symbols first, then BM25 body windows, each with file:line
$R query "how is the BM25 score computed" -k 5
$R def route_ranked                      # exact symbol lookup
$R query "..." --project qdrant --json   # scoped / machine-readable
# Chinese body queries work natively (ref_body_fts is tokenized with trigram):
$R query "如何实现向量检索" -k 5
$R query "会话记忆的持久化方案" --project everos

# 3) register corpora from a manifest (XERJ corpus.json-compatible)
$R corpus add --from seed/corpora.json
$R corpus list
$R corpus export > corpora.json          # the shareable artifact

# 4) which corpora answer a target repo? (reads its lockfiles)
$R route /path/to/target/repo

# 5) freshness + portability
$R refresh --dry-run                     # git ls-remote -> STALE/fresh per pin
$R stats
$R verify report.md                      # check every [slug] path:line peer-anchor resolves
$R dump --out refcode.dump.sql           # full-content SQL text export (large: ~90MB/21 corpora)

# 6) design / mechanism-level docs (searched by `query` before code hits)
$R docs list
$R docs add a2a --kind mechanism-analysis --title "A2A 通讯机制" --file path/to/analysis.md
$R query "A2A 互操作通信" -k 5            # -> [doc:a2a] hits, design-level answer

# 7) mechanism-level knowledge system (own mechanisms.db, independent of code index)
$R mechanisms build                         # seed curated mechanisms + scenes + anchor code impls + fuse analysis.db projects
$R mechanisms list                          # all mechanisms (domain, maturity, impl count)
$R mechanisms list | grep A8                # -> all agent-collaboration/communication mechanisms
$R mechanisms show a2a-protocol             # definition + scenes + code anchors + fused real-world projects (with doc paths)
$R mechanisms recommend "做多agent协作" -k 5   # scene -> ranked mechanisms (fit-dominant, projects= support count)
$R mechanisms recommend "agent间安全传上下文" -k 5
$R mechanisms scene list                    # curated scenes; scene add <id> --desc --domain --keywords
```

## Where the database lives

- Default: `$REFCODE_DB`, else `~/.refcode/refcode.db` (a single SQLite file; WAL).
  Override per call with `--db`.
- For the shared analysis home, point it at
  `/root/.sisyphus/db/refcode.db` (sibling of repo-map's `analysis.db`).
- Clone cache: `$REFCODE_REPOS`, else `~/.refcode/repos/<slug>`.
- **`mechanisms` uses its own DB**: `$MECH_DB`, else `~/.refcode/mechanisms.db`
  (tiny — 27 mechanisms + 155 impl anchors + 1262 fused project instances + 13
  scenes). Override per call with `--mech-db`. `build` reads the refcode corpus
  read-only for code anchors and **`analysis.db` read-only for fusion**
  (`$ANALYSIS_DB`, default `/root/.sisyphus/db/analysis.db`); the mechanisms DB
  itself is independent and cheap to rebuild.

**`mechanisms-server` (HTTP service)** — a Bun service (`mechanisms-server.ts`)
that exposes the mechanisms DB as a network API so any agent/process can query
and, crucially, **ingest new analyses concurrently** (distributed "everyone
contributes" sharing):

```bash
bun /root/.agents/skills/refcode/mechanisms-server.ts --port 8799
# or detached: systemd-run --unit=mech-server --collect --setenv=MECH_PORT=8799 \
#   /root/.bun/bin/bun /root/.agents/skills/refcode/mechanisms-server.ts
```

| method | path | what it does |
|---|---|---|
| `GET` | `/health` | liveness + mechanism count |
| `GET` | `/mechanisms[?domain=A8]` | list (domain, maturity, impl/project counts) |
| `GET` | `/mechanisms/<id>` | one mechanism: definition + code anchors + fused real projects |
| `GET` | `/recommend?scene=<text>&k=<n>` | scene → ranked mechanisms (same ranking as CLI) |
| `GET` | `/scenes` | list curated scenes |
| `POST` | `/ingest` | fuse one analyzed project into every same-domain mechanism (body: `project_name`, `paradigm_id`, `why_worth?`, `analysis_path?`, `source_type?`) |
| `POST` | `/scene` | add a curated scene (body: `id`, `description`, `domain?`, `keywords?`) |

Concurrency: SQLite WAL (multi-reader + single-writer, `busy_timeout`), and each
`/ingest` is a **transactional UPSERT keyed by `UNIQUE(mechanism_id,
project_name)`** — so N workers submitting the same analysis dedupe idempotently,
and different workers can each add their own project analyses to the shared base.
Port/DB overrides: `MECH_PORT`, `MECH_DB`.

**Bun + array-binding gotcha** (found & fixed here): `bun:sqlite` does **not**
bind an array of values to multiple `?` placeholders — it silently produces
NULLs / zero rows, and array binding also fails *inside `db.transaction()`*.
Always use positional args (`.get(a, b)`, `.run(a, b, c)`) for multi-placeholder
queries, especially inside transactions. The service uses positional binding
everywhere for this reason.

**Can it live on GitHub?** Yes — but share the *definition*, not the index. This
is exactly XERJ's corpus-hub rule:

- ✅ commit `seed/corpora.json` / `corpus export` (a few KB: url + 40-hex sha +
  licence + use_policy). Anyone rebuilds byte-identical indices with
  `corpus add` + `index`.
- ✅ publish the built index as a **release asset** (`gh release upload <tag>
  refcode.db`) — ready to query, never in git history.
- ❌ do not commit the live WAL `.db` — binary, churns, merges badly.
- ⚠️ `dump` is a **full-content** text export (measured ~90MB for a 21-corpus
  build), so it is *not* a git artifact either — use it for inspection/backup.

## Indexing semantics — re-indexing is idempotent full rebuild, not incremental

Re-running `refcode index <slug> <path>` on an **already-indexed** slug is a
**full, idempotent rebuild** — NOT an incremental update. This is the refresh
path when a project's source changes:

- `_index_one` `DELETE`s the slug's old `ref_symbols` + `ref_body_fts` rows, then
  re-walks the local dir / re-clones at the pin and re-extracts **everything**.
- The `ref_projects` row is updated via `ON CONFLICT(slug) DO UPDATE` — `symbols`,
  `windows`, `files`, `local_path`, `indexed_at` and `status='live'` all refresh.
- **To refresh an updated codebase:** just re-run `refcode index <slug> <path>`
  (or re-run the repo-map Op5 step, which does exactly this). No separate
  incremental mechanism exists; the rebuild is cheap (566 files ≈ seconds).
- **`domain` survives re-index:** `_index_one` keeps `prev["domain"]` when set
  (so a `corpus add` correction is NOT clobbered). ⚠️ But the **JSON returned**
  by `index` reports the *heuristic* `info["domain"]`, not the stored one — the
  displayed domain may differ from what is actually persisted. Trust the DB, not
  the returned JSON.
- **`refresh` is NOT a rebuild.** `cmd_refresh` only works on rows with a git
  `url`; it `git ls-remote`s the pin, marks `STALE`/`fresh`, and bumps
  `refreshed_at`. It never re-extracts and it **skips local-dir projects**
  (`url IS NULL`). Use `index` to refresh local corpora; use `refresh` only to
  report staleness of pinned remote corpora.

## Honest limits

- **Symbol extraction quality varies by grammar.** 11 languages ship a proper
  `TAGS_QUERY` (python, rust, javascript, go, java, c, cpp, ruby, php, c_sharp,
  lua); the rest use a generic definition-node heuristic (function/class/struct/
  enum/trait/…). Body retrieval works regardless of symbol quality.
- **`classify` domain is a heuristic**, and `dependency_names` is only as good as
  the lockfiles present at the indexed root — a crate indexed from inside a
  workspace (no lockfile) yields no deps. Register deps explicitly via `corpus add`.
- **Not a code graph.** No call/reference edges (that is `codegraph`). refcode is
  the *retrieval* layer: symbols + BM25 passages.
- **Chinese body search works** — `ref_body_fts` is tokenized with FTS5
  `trigram` (SQLite>=3.34), which slices CJK into 3-char grams, so a pure-Chinese
  `query "会话记忆"` matches body windows natively. ASCII terms <3 chars (e.g.
  `go`, `BM25`) still match via trigram's automatic `%`-prefix expansion. Caveats:
  single/double-CJK-character queries (<3 chars) may return nothing, and trigram
  indexes are larger than unicode61. The **docs arm** mitigates this for
  design-level queries with a `LIKE` fallback over `ref_docs`.
- **The docs arm is recall-oriented.** It surfaces the *most* relevant analysis
  doc(s), but does not rank across a strict relevance cutoff — a broad query
  like "多智能体" returns many mechanism analyses (each is a legitimate design
  answer). Narrow with `--project` or more specific terms; use `--json` to read
  full scores.
- **`mechanisms` anchors are corpus-constrained.** Code anchors come from the
  refcode corpus via curated `SLUG_ATTACHMENTS`; a mechanism whose best
  implementation isn't in the corpus (e.g. the A2A spec's Python stubs) shows
  anchors from whatever project *does* implement it (ag2's `a2a/` module).
  Mechanisms with no in-corpus impl (`fipa-acl`, `mcts-reasoning`) show 0 impls
  until a matching project is indexed.
- **`mechanisms` fusion is domain-bridged, not per-mechanism-matched.** Every
  analyzed project in `analysis.db` is attached to *all* curated mechanisms in
  its paradigm (domain) — so a domain-A8 project like G-Memory (a memory
  mechanism) appears under all 12 A8 collaboration mechanisms, not just the
  memory ones. `show <id>` lists it among the "real-world projects" of every
  same-domain mechanism; the `projects=` count is a **domain-support** signal,
  not a per-mechanism precision. Narrow by reading each project's `why_worth`
  summary (shown in `show`) to see which mechanism it really instantiates.
- **`mechanisms recommend` fit is vocabulary-based, not semantic.** It ranks by
  stopword-filtered token overlap, so it answers *"which mechanism touches these
  terms"* — it will not match a scene phrased with synonyms absent from the
  mechanism definitions. Reword the scene or add a scene entry with the missing
  keyword (`scene add`) to improve recall. `impls=0` + low maturity can push a
  genuinely-fitted mechanism below well-fit-but-popular ones; the fit-dominant
  gate prevents irrelevant-but-popular mechanisms from surfacing at all.
- **Licence discipline is metadata, not enforcement.** `use_policy`
  (`adapt-with-attribution` / `approach-only` / `mixed`) is recorded for the agent
  to respect; refcode never copies code anywhere.

## Wiring into repo-map

repo-map's Op3 research agents must cite real implementations. Add **Op3.5**:
`refcode route <target-repo>` → pull the matching corpora → `refcode query "…"`
→ hand the agent `file:line` evidence. The Q6 gate (`depth_check.py`) then checks
every cross-project mechanism claim resolves to a real `ref_symbols` anchor.
