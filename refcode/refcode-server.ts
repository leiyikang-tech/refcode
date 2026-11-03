/**
 * refcode-server — remote-first, multi-user storage for the refcode corpus AND
 * the mechanisms knowledge base, in ONE Bun/TS service.
 *
 * **Sharded storage** (scales 50–100× — thousands of projects, 1TB+).
 *
 * The corpus is split per project: every slug gets its own SQLite WAL shard
 * under `shards/<slug>.db` holding that project's `ref_symbols`, `ref_body_fts`
 * and `ref_docs`/`ref_docs_fts`. A small **catalog DB** (`catalog.db`) holds the
 * `ref_projects` and `push_log` tables (one row per project + per-push ledger),
 * so listing/health stay milliseconds even with 10,000 projects.
 *
 * HTTP contract is unchanged from the single-file build — clients (refcode_sync.py)
 * keep working:
 *   - POST /projects/<slug>/push : NDJSON (project/symbol/window/end) → writes the
 *     slug's shard in ONE transaction, updates catalog + push_log. Returns
 *     {ok,slug,nsym,nwin,nfiles,sha}.
 *   - GET  /projects/<slug>/manifest : counts ACTUAL rows in that shard (+ last_push).
 *   - GET  /projects : list from catalog (fast; counts are maintained on push).
 *   - GET  /query?text=&k=&project= : symbol arm + docs arm + body BM25. With
 *     `?project=` opens just that shard; without it, fans out across shards in
 *     parallel (concurrency = min(available shards, SHARD_CONCURRENCY)).
 *   - GET  /def?name=&project= : exact symbol lookup in a shard (or all shards).
 *   - /health : counts from catalog + shard files.
 *
 * Why shards: a single 17.8GB SQLite file (trigram FTS is ~3–5× the raw corpus)
 * slows to unusable as projects multiply (158 → 8000–16000). Per-project shards
 * give horizontal scale: updates touch only one shard (WAL isolation), queries
 * open only the shards they need, cold shards can be archived independently, and
 * the catalog stays small. trigram tokenizer is preserved (needed for CJK +
 * sub-string matching).
 *
 * Run:  bun refcode-server.ts [--port 8788] [--corpus-db <path>]
 *                                  [--mech-db <path>]
 *   CORPUS_DB         catalog db (default ~/.refcode/remote/catalog.db)
 *   REFCODE_SHARDS    dir holding per-project shards (default <CORPUS_DB dir>/shards)
 *   SHARD_CONCURRENCY parallel shards opened for a global query (default 4)
 */
import { Database } from "bun:sqlite";
import { Buffer } from "node:buffer";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const argv = process.argv.slice(2);
const PORT = Number(process.env.REFCODE_PORT ?? argv[argv.indexOf("--port") + 1] ?? 8788);
const home = Bun.env.HOME || Bun.env.USERPROFILE || ".";
const CORPUS_DB =
  process.env.REFCODE_DB ??
  argv[argv.indexOf("--corpus-db") + 1] ??
  home + "/.refcode/remote/catalog.db";
const SHARDS_DIR =
  process.env.REFCODE_SHARDS ??
  ((db: string) => {
    const i = db.lastIndexOf("/");
    const base = i >= 0 ? db.slice(0, i) : ".";
    return base + "/shards";
  })(CORPUS_DB);
const SHARD_CONCURRENCY = Math.max(1, Number(process.env.SHARD_CONCURRENCY ?? 4));

// S3: push integrity alarm floors — abnormally low class/method coverage means
// the extractor likely missed class/method symbols.
const CLASS_RATIO_FLOOR = 0.005;
const METHOD_RATIO_FLOOR = 0.02;
const MECH_DB =
  process.env.MECH_DB ??
  argv[argv.indexOf("--mech-db") + 1] ??
  home + "/.refcode/mechanisms.db";

mkdirSync(SHARDS_DIR, { recursive: true });

// --------------------------------------------------------------------------- #
// Catalog schema — ref_projects + push_log only (small, meta per project).
// --------------------------------------------------------------------------- #
const CATALOG_SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS ref_projects (
  slug             TEXT PRIMARY KEY,
  url              TEXT,
  sha              TEXT,
  licence          TEXT,
  use_policy       TEXT,
  domain           TEXT,
  languages        TEXT,
  ask_for          TEXT,
  dependency_names TEXT,
  status           TEXT DEFAULT 'live',
  quality_grade    TEXT,
  local_path       TEXT,
  bytes            INTEGER,
  files            INTEGER,
  symbols          INTEGER,
  windows          INTEGER,
  indexed_at       TEXT,
  refreshed_at     TEXT,
  owner            TEXT
);

CREATE TABLE IF NOT EXISTS push_log (
  project             TEXT PRIMARY KEY,
  sha                 TEXT,
  symbols             INTEGER,
  windows             INTEGER,
  files               INTEGER,
  owner               TEXT,
  pushed_at           TEXT,
  by_client           TEXT,
  extraction_warning  TEXT
);
`;

// Per-shard heavy schema: symbols + trigram FTS + docs, indexed under
// shards/<slug>.db. Mirrors refcode.py's SCHEMA exactly (standalone FTS5,
// trigram preserved) so query/DELETE semantics are unchanged — the sharding
// itself is what delivers the 50–100× scale, not a rewrite of the tokenizer.
const SHARD_SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS ref_symbols (
  project        TEXT NOT NULL,
  node_id        TEXT NOT NULL,
  kind           TEXT,
  name           TEXT,
  qualified_name TEXT,
  file_path      TEXT,
  language       TEXT,
  start_line     INTEGER,
  end_line       INTEGER,
  signature      TEXT,
  docstring      TEXT,
  owner          TEXT,
  PRIMARY KEY (project, node_id)
);
CREATE INDEX IF NOT EXISTS idx_refsym_name ON ref_symbols(name);
CREATE INDEX IF NOT EXISTS idx_refsym_proj ON ref_symbols(project);
CREATE INDEX IF NOT EXISTS idx_refsym_qual ON ref_symbols(qualified_name);

CREATE VIRTUAL TABLE IF NOT EXISTS ref_body_fts USING fts5(
  project   UNINDEXED,
  file_path,
  language  UNINDEXED,
  win       UNINDEXED,
  line0     UNINDEXED,
  body,
  owner     UNINDEXED,
  tokenize = 'trigram'
);

CREATE TABLE IF NOT EXISTS ref_docs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT,
  kind      TEXT,
  title     TEXT,
  body      TEXT,
  created_at TEXT,
  owner     TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS ref_docs_fts USING fts5(
  id        UNINDEXED,
  slug      UNINDEXED,
  kind      UNINDEXED,
  title,
  body,
  owner     UNINDEXED,
  tokenize = 'trigram'
);
`;

// --------------------------------------------------------------------------- #
// Mechanisms schema (mirrors mechanisms.py) — for the /recommend etc endpoints.
// --------------------------------------------------------------------------- //
const MECH_SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS mechanisms (
  id TEXT PRIMARY KEY, name TEXT, domain TEXT, domain_name TEXT,
  definition TEXT, scenes TEXT, pros TEXT, cons TEXT, maturity REAL
);
CREATE TABLE IF NOT EXISTS implementations (
  mechanism_id TEXT, slug TEXT, module TEXT, sym TEXT NOT NULL DEFAULT '',
  line INTEGER, impl_note TEXT, refcode_db TEXT,
  UNIQUE(mechanism_id, slug, module, sym)
);
CREATE TABLE IF NOT EXISTS project_instances (
  mechanism_id TEXT, project_name TEXT, domain TEXT,
  why_worth TEXT, analysis_path TEXT, source_type TEXT,
  UNIQUE(mechanism_id, project_name)
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY, description TEXT, domain TEXT, keywords TEXT
);
`;

// --------------------------------------------------------------------------- //
// Ranking (mirrors mechanisms.py: _STOP/_SYNONYMS/_norm_cjk/_score_mechanism)
// --------------------------------------------------------------------------- //
const STOP = new Set([
  "agent", "agents", "llm", "ai", "智能体", "多", "的", "间", "做", "进行",
  "使用", "基于", "一个", "方法", "可以", "如何", "怎么", "两个", "之间",
  "这个", "这些", "那么", "还有", "以及",
]);
const SYNONYMS: Record<string, string> = {
  "通讯": "通信", "通信": "通信", "通讯机制": "通信",
  "上下文": "语境", "语境": "语境",
  "记忆": "记忆", "回忆": "记忆",
  "工具": "工具", "调用": "调用",
  "推理": "推理", "思考": "推理",
  "协作": "协作", "合作": "协作", "协同": "协作",
  "安全": "安全", "凭证": "认证",
};
const CJK_STOP = new Set(["智能", "优化", "实现", "能力", "多智", "两个"]);

function normCjk(words: Set<string>): Set<string> {
  return new Set([...words].map((w) => SYNONYMS[w] ?? w));
}
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().match(/[a-zA-Z0-9]+/g) ?? []) {
    if (t.length >= 2 && !STOP.has(t)) out.add(t);
  }
  return out;
}
function cjkWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const run of text.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      const w = run.slice(i, i + 2);
      if (!STOP.has(w) && !CJK_STOP.has(w)) out.add(w);
    }
  }
  return out;
}
interface MechRow {
  id: string; name: string; domain: string; domain_name: string;
  definition: string; scenes: string; maturity: number;
}
function scoreMechanism(m: MechRow, sceneText: string): number {
  const sceneAscii = tokenize(sceneText);
  const sceneCjk = normCjk(cjkWords(sceneText));
  const mechAscii = tokenize(`${m.name} ${m.definition} ${m.scenes}`);
  const mechCjk = normCjk(cjkWords(`${m.name} ${m.definition} ${m.scenes}`));
  const interA = [...sceneAscii].filter((t) => mechAscii.has(t)).length;
  const unionA = new Set([...sceneAscii, ...mechAscii]).size;
  const interC = [...sceneCjk].filter((t) => mechCjk.has(t)).length;
  const unionC = new Set([...sceneCjk, ...mechCjk]).size;
  const fitA = unionA > 0 ? interA / unionA : 0;
  const fitC = unionC > 0 ? interC / unionC : 0;
  const hasCjk = sceneCjk.size > 0;
  const fit = hasCjk ? fitC * 0.65 + fitA * 0.35 : fitA;
  if (fit <= 0) return 0;
  const maturity = Number(m.maturity ?? 0);
  return Math.round((fit * 0.85 + maturity * 0.15) * 10000) / 10000;
}

// --------------------------------------------------------------------------- //
// DB setup — catalog + per-shard on demand.
// --------------------------------------------------------------------------- //
const corpus = new Database(CORPUS_DB);
corpus.exec("PRAGMA journal_mode=WAL");
corpus.exec("PRAGMA busy_timeout=10000");
corpus.exec("PRAGMA foreign_keys=ON");
// Big catalog reads (list/health) hit fewer pages; a modest cache helps.
corpus.exec("PRAGMA cache_size=-65536");
corpus.exec(CATALOG_SCHEMA);
// S3: back-fill the extraction_warning column for catalogs created before it existed.
try {
  corpus.exec("ALTER TABLE push_log ADD COLUMN extraction_warning TEXT");
} catch { /* column already exists (or table created fresh with it) */ }

let mech: Database | null = null;
try {
  mech = new Database(MECH_DB);
  mech.exec("PRAGMA journal_mode=WAL");
  mech.exec("PRAGMA busy_timeout=10000");
  mech.exec(MECH_SCHEMA);
} catch (e) {
  console.warn(`mechanisms db unavailable (${MECH_DB}): ${String(e)}; /recommend etc disabled`);
  mech = null;
}

// --------------------------------------------------------------------------- //
// Shard helpers.
// --------------------------------------------------------------------------- //
/** Canonical path for a slug's shard file. Slug is URL-safe alpha-numeric + _-. */
function shardPath(slug: string): string {
  return `${SHARDS_DIR}/${slug}.db`;
}
/** Open a shard, creating tables if missing. Returns null if file absent. */
function openShard(slug: string): Database | null {
  const path = shardPath(slug);
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  // Even a readonly conn benefits from a bigger page cache + mmap for the FTS.
  db.exec("PRAGMA cache_size=-65536");
  db.exec("PRAGMA mmap_size=268435456"); // 256MB mmap
  return db;
}
/** List slugs that already have a shard file on disk. */
function shardSlugs(): string[] {
  let out: string[] = [];
  try {
    out = readdirSync(SHARDS_DIR)
      .filter((f) => f.endsWith(".db"))
      .map((f) => f.slice(0, -3));
  } catch { /* ignore */ }
  return out;
}
/** Create (or reopen rw) the shard for writing — used only by push. */
function getShardWriter(slug: string): Database {
  const path = shardPath(slug);
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=10000");
  // The heavy write path (big project push) runs few & huge transactions;
  // keep the page cache modest but mmap for reads.
  db.exec("PRAGMA cache_size=-32768");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec(SHARD_SCHEMA);
  return db;
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function now(): string {
  return new Date().toISOString();
}

// --------------------------------------------------------------------------- //
// Corpus: project push (the core write path) — writes the slug's shard.
// --------------------------------------------------------------------------- //
// Body is newline-delimited JSON. Line kinds (first field "t"):
//   {t:"project", slug,url,sha,licence,use_policy,domain,languages,ask_for,
//            dependency_names,bytes,files,symbols,windows}
//   {t:"symbol", project,node_id,kind,name,qualified_name,file_path,language,
//              start_line,end_line,signature,docstring}
//   {t:"window", project,file_path,language,win,line0,body}
//   {t:"end",    project,sha,symbols,windows,files,client}
async function pushProject(req: Request, slug: string, owner: string): Promise<Response> {
  const u = new URL(req.url);
  const client = u.searchParams.get("client") ?? "unknown";
  try {
    const body = req.body;
    if (!body) return json({ error: "empty body" }, 400);

    const reader = (req.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total > 4 * 1024 * 1024 * 1024) {
        await reader.cancel();
        return json({ error: "body too large (>4GB); push in per-project batches" }, 413);
      }
    }
    const encoding = req.headers.get("content-encoding") ?? "";
    const rawBytes = Buffer.concat(chunks);
    let text: string;
    if (encoding.includes("gzip")) {
      text = gunzipSync(rawBytes).toString("utf-8");
    } else {
      text = new TextDecoder().decode(rawBytes);
    }

    const stats = txFromText(slug, owner, client, text);
    return json({ ok: true, slug, ...stats }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

// Executes the push transaction & catalog update.
function txFromText(
  slug: string, owner: string, client: string, text: string,
): { nsym: number; nwin: number; nfiles: number; sha: string; windows: number; extraction_warning: string } {
  const shard = getShardWriter(slug);

  const insSym = shard.query(
    `INSERT OR REPLACE INTO ref_symbols
       (project,node_id,kind,name,qualified_name,file_path,language,
        start_line,end_line,signature,docstring,owner)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insWin = shard.query(
    `INSERT INTO ref_body_fts
       (project,file_path,language,win,line0,body,owner)
     VALUES (?,?,?,?,?,?,?)`,
  );

  let nsym = 0, nwin = 0, nfiles = 0, sha = "";
  const state: { proj: Record<string, unknown> | null } = { proj: null };
  const tx = shard.transaction(() => {
    shard.query("DELETE FROM ref_symbols WHERE project=?").run(slug);
    shard.query("DELETE FROM ref_body_fts WHERE project=?").run(slug);

    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(t);
      } catch {
        continue; // tolerate a malformed line; skip it
      }
      switch (rec.t) {
        case "project":
          state.proj = rec;
          break;
        case "symbol":
          insSym.run(
            rec.project ?? slug, rec.node_id, rec.kind ?? "", rec.name ?? "",
            rec.qualified_name ?? "", rec.file_path ?? "", rec.language ?? "",
            rec.start_line ?? 0, rec.end_line ?? 0, rec.signature ?? "",
            rec.docstring ?? "", owner,
          );
          nsym++;
          break;
        case "window":
          insWin.run(
            rec.project ?? slug, rec.file_path ?? "", rec.language ?? "",
            rec.win ?? 0, rec.line0 ?? 0, rec.body ?? "", owner,
          );
          nwin++;
          break;
        case "end":
          sha = String(rec.sha ?? "");
          nfiles = Number(rec.files ?? 0);
          break;
      }
    }
    return null;
  });
  tx();

  // Manifest stats: prefer the end-line counts; fall back to counted rows.
  const symCount = nsym > 0 ? nsym : (state.proj?.symbols as number) ?? 0;
  const winCount = nwin > 0 ? nwin : (state.proj?.windows as number) ?? 0;
  const fileCount = nfiles > 0 ? nfiles : (state.proj?.files as number) ?? 0;

  // Update push_log (catalog) and insert-or-replace the project row (catalog).
  const cInsProj = corpus.query(
    `INSERT OR REPLACE INTO ref_projects
       (slug,url,sha,licence,use_policy,domain,languages,ask_for,
        dependency_names,status,local_path,bytes,files,symbols,windows,
        indexed_at,owner)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const cInsLog = corpus.query(
    `INSERT OR REPLACE INTO push_log
       (project,sha,symbols,windows,files,owner,pushed_at,by_client,extraction_warning)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  // S3: after this replacement push lands, measure class/method coverage. A low
  // ratio usually means the extractor dropped class/method symbols again.
  shard.close();
  const extraction_warning = computeExtractionWarning(slug);
  const catTx = corpus.transaction(() => {
    cInsProj.run(
      (state.proj?.slug as string) ?? slug, (state.proj?.url as string) ?? "",
      sha || ((state.proj?.sha as string) ?? ""), (state.proj?.licence as string) ?? "",
      (state.proj?.use_policy as string) ?? "", (state.proj?.domain as string) ?? "",
      (state.proj?.languages as string) ?? "", (state.proj?.ask_for as string) ?? "",
      (state.proj?.dependency_names as string) ?? "", "live", "",
      (state.proj?.bytes as number) ?? 0, fileCount, symCount, winCount, now(), owner,
    );
    cInsLog.run(slug, sha, symCount, winCount, fileCount, owner, now(), client, extraction_warning);
    return null;
  });
  catTx();
  return { nsym, nwin, nfiles, sha, windows: winCount, extraction_warning };
}

// S3: compute the class/method ratio alarm for a project's ref_symbols shard.
// Returns "" when coverage is healthy (or there is no data to evaluate).
function computeExtractionWarning(slug: string): string {
  const shard = openShard(slug);
  if (!shard) return "";
  try {
    const rows = shard.query(
      "SELECT kind, COUNT(*) AS n FROM ref_symbols WHERE project=? GROUP BY kind",
    ).all(slug) as Array<{ kind: string; n: number }>;
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    if (total === 0) return ""; // no data — not an anomaly
    const kindCount = new Map<string, number>();
    for (const r of rows) kindCount.set(r.kind, Number(r.n));
    const classN = kindCount.get("class") ?? 0;
    const methodN = kindCount.get("method") ?? 0;
    const classRatio = classN / total;
    const methodRatio = methodN / total;
    if (classRatio < CLASS_RATIO_FLOOR || methodRatio < METHOD_RATIO_FLOOR) {
      return `abnormally low class/method ratio (class=${(classRatio * 100).toFixed(2)}%, method=${(methodRatio * 100).toFixed(2)}%); tree-sitter may have failed on parameter-property syntax`;
    }
    return "";
  } finally {
    shard.close();
  }
}

// GET /projects/<slug>/manifest — verify a push landed before local cleanup.
// Reports ACTUAL counted rows from the shard so a client can truly verify sync.
function projectManifest(slug: string): Response {
  const p = corpus.query(
    "SELECT slug,url,sha,domain,status,files,symbols,windows,indexed_at FROM ref_projects WHERE slug=?",
  ).get(slug) as Record<string, unknown> | null;
  if (!p) return json({ error: `project '${slug}' not found` }, 404);

  let symActual = Number(p.symbols ?? 0);
  let winActual = Number(p.windows ?? 0);
  const shard = openShard(slug);
  if (shard) {
    symActual = (shard.query(
      "SELECT COUNT(*) c FROM ref_symbols WHERE project=?",
    ).get(slug) as { c: number }).c;
    winActual = (shard.query(
      "SELECT COUNT(*) c FROM ref_body_fts WHERE project=?",
    ).get(slug) as { c: number }).c;
    shard.close();
  }
  const log = corpus.query(
    "SELECT sha,symbols,windows,files,pushed_at,by_client,extraction_warning FROM push_log WHERE project=?",
  ).get(slug) as Record<string, unknown> | null;
  return json({
    project: { ...p, symbols: symActual, windows: winActual },
    last_push: log,
  });
}

function listProjects(): Response {
  // Catalog-only: counts are maintained on push, so no per-project COUNT scans.
  const rows = corpus.query(
    `SELECT slug,domain,languages,files,symbols,windows,indexed_at,
            symbols AS sym_actual
     FROM ref_projects ORDER BY slug`,
  ).all();
  return json(rows);
}

// --------------------------------------------------------------------------- //
// S1: GET /projects/<slug>/quality — symbol-extraction health for one shard.
// --------------------------------------------------------------------------- //
function projectQuality(slug: string): Response {
  const p = corpus.query(
    "SELECT symbols, indexed_at FROM ref_projects WHERE slug=?",
  ).get(slug) as { symbols?: number; indexed_at?: string } | null;
  if (!p) return json({ error: `project '${slug}' not found` }, 404);

  const manifest_symbols = Number(p.symbols ?? 0);
  let defable_symbols = 0;
  const by_kind: Record<string, number> = {};
  const core_files: Array<{ file: string; symbols: number }> = [];

  const shard = openShard(slug);
  if (shard) {
    try {
      const kinds = shard.query(
        "SELECT kind, COUNT(*) AS n FROM ref_symbols WHERE project=? GROUP BY kind",
      ).all(slug) as Array<{ kind: string; n: number }>;
      for (const r of kinds) by_kind[r.kind] = Number(r.n);
      defable_symbols = Object.keys(by_kind).reduce((s, k) => s + by_kind[k], 0);
      for (const r of shard.query(
        "SELECT file_path AS f, COUNT(*) AS n FROM ref_symbols WHERE project=? AND file_path LIKE '%/core/%' GROUP BY file_path ORDER BY n ASC LIMIT 20",
      ).all(slug) as Array<{ f: string; n: number }>) {
        core_files.push({ file: r.f, symbols: Number(r.n) });
      }
    } finally {
      shard.close();
    }
  }

  const class_ratio = defable_symbols > 0 ? (by_kind["class"] ?? 0) / defable_symbols : 0;
  const method_ratio = defable_symbols > 0 ? (by_kind["method"] ?? 0) / defable_symbols : 0;

  // stale: indexed_at older than 7 days.
  let stale = false;
  if (p.indexed_at) {
    const t = Date.parse(p.indexed_at);
    if (Number.isFinite(t)) stale = Date.now() - t > 7 * 24 * 60 * 60 * 1000;
  }

  return json({
    slug,
    manifest_symbols,
    defable_symbols,
    by_kind,
    class_ratio: Math.round(class_ratio * 10000) / 10000,
    method_ratio: Math.round(method_ratio * 10000) / 10000,
    core_files,
    stale,
  });
}

// --------------------------------------------------------------------------- //
// S5: GET /projects/<slug>/symbols — paginated listing to verify existence.
// --------------------------------------------------------------------------- //
function projectSymbols(u: URL, slug: string): Response {
  const p = corpus.query("SELECT slug FROM ref_projects WHERE slug=?").get(slug);
  if (!p) return json({ error: `project '${slug}' not found` }, 404);

  const kind = u.searchParams.get("kind") ?? "";
  let limit = Number(u.searchParams.get("limit") ?? 100);
  let offset = Number(u.searchParams.get("offset") ?? 0);
  if (!Number.isFinite(limit)) limit = 100;
  if (!Number.isFinite(offset)) offset = 0;
  limit = Math.max(1, Math.min(500, Math.trunc(limit)));
  offset = Math.max(0, Math.trunc(offset));

  const shard = openShard(slug);
  if (!shard) {
    return json({ slug, count: 0, total: 0, symbols: [] });
  }
  try {
    let where = "project=? ";
    const params: unknown[] = [slug];
    if (kind) { where += "AND kind=? "; params.push(kind); }
    const total = (shard.query(
      `SELECT COUNT(*) c FROM ref_symbols WHERE ${where}`,
    ).get(...params) as { c: number }).c;
    const rows = shard.query(
      `SELECT name,kind,file_path,qualified_name,start_line,end_line
       FROM ref_symbols WHERE ${where}
       ORDER BY file_path, start_line LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);
    return json({ slug, count: rows.length, total, symbols: rows });
  } finally {
    shard.close();
  }
}

// --------------------------------------------------------------------------- //
// Corpus: query (symbol arm + docs arm + body BM25) — shard-scoped.
// --------------------------------------------------------------------------- //
function queryText(text: string): string {
  const toks = text.match(/[A-Za-z0-9_]+/g) ?? [];
  const ascii = toks.slice(0, 24).map((t) => `"${t}"`).join(" OR ");
  const cjk = (text.match(/[\u4e00-\u9fff]+/g) ?? []).slice(0, 24)
    .map((c) => `"${c}"`).join(" ");
  return [ascii, cjk].filter(Boolean).join(" OR ");
}

/** Run the three query arms against ONE open shard, appended into `hits`. */
function queryShard(
  shard: Database, q: string, k: number, mq: string,
  hits: Array<Record<string, unknown>>, projFilter: string,
): void {
  const firstTok = (q.match(/[A-Za-z0-9_]+/g) ?? [q])[0];
  if (firstTok) {
    const like = `%${firstTok}%`;
    let sql =
      "SELECT project,file_path,kind,name,node_id,signature,start_line,end_line FROM ref_symbols WHERE (name=? OR name LIKE ?) ";
    const params: unknown[] = [firstTok, like];
    if (projFilter) { sql += "AND project=? "; params.push(projFilter); }
    sql += "ORDER BY (name=?) DESC, length(name) LIMIT ?";
    params.push(firstTok, k);
    for (const r of shard.query(sql).all(...params)) {
      hits.push({ arm: "symbol", ...r, score: 1000.0 });
    }
  }

  // docs arm (design/mechanism level) — ref_docs_fts is external-content.
  if (mq) {
    try {
      let sql =
        "SELECT ref_docs.id,slug,kind,title,body,bm25(ref_docs_fts) AS s FROM ref_docs_fts JOIN ref_docs ON ref_docs.id=ref_docs_fts.id WHERE ref_docs_fts MATCH ? ";
      const params: unknown[] = [mq];
      if (projFilter) { sql += "AND slug=? "; params.push(projFilter); }
      sql += "ORDER BY s LIMIT ?";
      params.push(k);
      for (const r of shard.query(sql).all(...params)) {
        hits.push({
          arm: "doc", project: r.slug, file: "ref_docs", line: 0,
          kind: r.kind ?? "note", name: r.title ?? r.slug,
          snippet: (r.body as string).slice(0, 240).replace(/\n/g, " "),
          score: 100.0,
        });
      }
    } catch {
      /* docs FTS unavailable — skip */
    }
  }

  // body BM25 arm — contentless ref_body_fts.
  const highHits = hits.filter((h) => h.arm !== "body").length;
  if (highHits < k && mq) {
    try {
      let sql =
        "SELECT project,file_path,language,win,line0,body,bm25(ref_body_fts) AS s FROM ref_body_fts WHERE ref_body_fts MATCH ? ";
      const params: unknown[] = [mq];
      if (projFilter) { sql += "AND project=? "; params.push(projFilter); }
      sql += "ORDER BY s LIMIT ?";
      params.push(k);
      for (const r of shard.query(sql).all(...params)) {
        hits.push({
          arm: "body", ...r,
          snippet: (r.body as string).slice(0, 240).replace(/\n/g, " "),
        });
      }
    } catch {
      /* body FTS unavailable — skip */
    }
  }
}

function rankHits(hits: Array<Record<string, unknown>>, k: number) {
  const rankOrder: Record<string, number> = { doc: 0, symbol: 1, body: 2 };
  hits.sort((a, b) => {
    const ra = rankOrder[a.arm as string] ?? 3;
    const rb = rankOrder[b.arm as string] ?? 3;
    if (ra !== rb) return ra - rb;
    return Number(a.score) - Number(b.score);
  });
  return hits.slice(0, k);
}

async function doQuery(u: URL): Promise<Response> {
  const q = u.searchParams.get("text") ?? "";
  const k = Math.max(1, Math.min(50, Number(u.searchParams.get("k") ?? 10)));
  const projFilter = u.searchParams.get("project") ?? "";
  const mq = queryText(q);

  if (projFilter) {
    // Single-shard query — cheap & fast.
    const hits: Array<Record<string, unknown>> = [];
    const shard = openShard(projFilter);
    if (shard) {
      queryShard(shard, q, k, mq, hits, projFilter);
      shard.close();
    }
    return json({ text: q, top: rankHits(hits, k) });
  }

  // Global query — fan out across shards in parallel, bounded by SHARD_CONCURRENCY.
  const slugs = shardSlugs();
  const results = await runPool(slugs, SHARD_CONCURRENCY, async (slug) => {
    const hits: Array<Record<string, unknown>> = [];
    const shard = openShard(slug);
    if (shard) {
      try { queryShard(shard, q, k, mq, hits, projFilter); }
      finally { shard.close(); }
    }
    return hits;
  });
  const all: Array<Record<string, unknown>> = [];
  for (const r of results) all.push(...r);
  return json({ text: q, top: rankHits(all, k) });
}

/** Run `fn` over `items` on a bounded-size worker pool, returning results in order. */
async function runPool<T, R>(
  items: T[], concurrency: number, fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try { out[i] = await fn(items[i]); }
        catch { /* skip failing item */ }
      }
    },
  );
  await Promise.all(workers);
  return out;
}

function doDef(u: URL): Response {
  const name = u.searchParams.get("name") ?? "";
  const projFilter = u.searchParams.get("project") ?? "";
  if (!name) return json({ error: "missing ?name=" }, 400);
  const match = u.searchParams.get("match") ?? "exact";
  if (!["exact", "qualified", "prefix"].includes(match)) {
    return json({ error: "match must be exact|qualified|prefix" }, 400);
  }
  let limit = Number(u.searchParams.get("limit") ?? 50);
  if (!Number.isFinite(limit)) limit = 50;
  limit = Math.max(1, Math.min(50, Math.trunc(limit)));

  const out: Array<Record<string, unknown>> = [];
  const base =
    "SELECT project,file_path,kind,name,qualified_name,signature,start_line,end_line,docstring " +
    "FROM ref_symbols WHERE ";
  const one = (shard: Database) => {
    let sql: string;
    let params: unknown[];
    if (match === "exact") {
      sql = base + "name=? ";
      params = [name];
    } else if (match === "qualified") {
      sql = base + "(qualified_name=? OR qualified_name LIKE '%.' || ?) ";
      params = [name, name];
    } else {
      sql = base + "name LIKE ? || '%' ";
      params = [name];
    }
    if (projFilter) { sql += "AND project=? "; params.push(projFilter); }
    sql += "ORDER BY project LIMIT ?";
    params.push(limit);
    for (const r of shard.query(sql).all(...params)) out.push(r);
  };
  if (projFilter) {
    const shard = openShard(projFilter);
    if (shard) { one(shard); shard.close(); }
  } else {
    for (const slug of shardSlugs()) {
      const shard = openShard(slug);
      if (!shard) continue;
      try { one(shard); } finally { shard.close(); }
    }
  }
  return json(out);
}

// --------------------------------------------------------------------------- //
// Mechanisms endpoints (mirror mechanisms-server.ts)
// --------------------------------------------------------------------------- //
function mechList(u: URL): Response {
  if (!mech) return json({ error: "mechanisms db unavailable" }, 503);
  const dom = u.searchParams.get("domain") ?? "";
  let sql =
    `SELECT m.id,m.name,m.domain,m.domain_name,m.maturity,
            (SELECT COUNT(*) FROM implementations i WHERE i.mechanism_id=m.id) AS impls,
            (SELECT COUNT(*) FROM project_instances p WHERE p.mechanism_id=m.id) AS projects
     FROM mechanisms m`;
  const params: unknown[] = [];
  if (dom) { sql += " WHERE m.domain=?"; params.push(dom); }
  return json(mech.query(sql).all(...params));
}
function mechShow(id: string): Response {
  if (!mech) return json({ error: "mechanisms db unavailable" }, 503);
  const m = mech.query("SELECT * FROM mechanisms WHERE id=? OR name=?").get(id, id);
  if (!m) return json({ error: `no mechanism '${id}'` }, 404);
  const impls = mech.query(
    "SELECT slug,module,sym,line,impl_note FROM implementations WHERE mechanism_id=? ORDER BY slug",
  ).all(id);
  const insts = mech.query(
    "SELECT project_name,why_worth,analysis_path FROM project_instances WHERE mechanism_id=? ORDER BY project_name",
  ).all(id);
  return json({ ...m, implementations: impls, real_world_projects: insts });
}
function mechRecommend(u: URL): Response {
  if (!mech) return json({ error: "mechanisms db unavailable" }, 503);
  const scene = u.searchParams.get("scene") ?? "";
  const k = Math.max(1, Math.min(50, Number(u.searchParams.get("k") ?? 10)));
  if (!scene.trim()) return json({ error: "missing ?scene=" }, 400);
  const rows = mech.query(
    "SELECT id,name,domain,domain_name,definition,scenes,maturity FROM mechanisms",
  ).all() as MechRow[];
  const scored: Array<{ score: number; m: MechRow; impls: number; projects: number }> = [];
  const implCache = new Map<string, number>();
  const projCache = new Map<string, number>();
  for (const m of rows) {
    const s = scoreMechanism(m, scene);
    if (s > 0) {
      if (!implCache.has(m.id)) {
        implCache.set(m.id, (mech.query(
          "SELECT COUNT(*) c FROM implementations WHERE mechanism_id=?",
        ).get(m.id) as { c: number }).c);
        projCache.set(m.id, (mech.query(
          "SELECT COUNT(*) c FROM project_instances WHERE mechanism_id=?",
        ).get(m.id) as { c: number }).c);
      }
      scored.push({ score: s, m, impls: implCache.get(m.id)!, projects: projCache.get(m.id)! });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return json({
    scene,
    top: scored.slice(0, k).map(({ score, m, impls, projects }) => ({
      score, id: m.id, name: m.name, domain: m.domain,
      domain_name: m.domain_name, maturity: m.maturity, impls, projects,
    })),
  });
}
function mechScenes(): Response {
  if (!mech) return json({ error: "mechanisms db unavailable" }, 503);
  return json(mech.query("SELECT * FROM scenes ORDER BY id").all());
}
async function mechIngest(req: Request): Promise<Response> {
  if (!mech) return json({ error: "mechanisms db unavailable" }, 503);
  try {
    const b = (await req.json()) as {
      project_name?: string; paradigm_id?: string; why_worth?: string;
      analysis_path?: string; source_type?: string;
    };
    if (!b.project_name?.trim() || !b.paradigm_id?.trim()) {
      return json({ error: "body needs project_name + paradigm_id" }, 400);
    }
    const tx = mech.transaction(() => {
      const mechs = mech.query("SELECT id FROM mechanisms WHERE domain=?").all(b.paradigm_id);
      let fused = 0;
      for (const m of mechs) {
        const res = mech.query(
          `INSERT INTO project_instances
             (mechanism_id,project_name,domain,why_worth,analysis_path,source_type)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(mechanism_id,project_name) DO UPDATE SET
             why_worth=excluded.why_worth, analysis_path=excluded.analysis_path,
             source_type=excluded.source_type`,
        ).run(m.id, b.project_name.trim(), b.paradigm_id, b.why_worth ?? "",
              b.analysis_path ?? "", b.source_type ?? "");
        fused += Number(res.changes);
      }
      return { fused, mechanisms: mechs.length };
    });
    const res = tx();
    return json({ ok: true, ...res, project_name: b.project_name.trim() }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
async function mechAddScene(req: Request): Promise<Response> {
  if (!mech) return json({ error: "mechanisms db unavailable" }, 503);
  try {
    const b = (await req.json()) as {
      id?: string; description?: string; domain?: string; keywords?: string;
    };
    if (!b.id?.trim() || !b.description?.trim()) {
      return json({ error: "body needs id + description" }, 400);
    }
    mech.query(
      "INSERT OR IGNORE INTO scenes (id,description,domain,keywords) VALUES (?,?,?,?)",
    ).run(b.id.trim(), b.description.trim(), b.domain ?? "", b.keywords ?? "");
    return json({ ok: true, id: b.id.trim() }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function mechAddMechanism(req: Request): Promise<Response> {
  if (!mech) return json({ error: "mechanisms db unavailable" }, 503);
  try {
    const b = (await req.json()) as {
      id?: string; name?: string; domain?: string; domain_name?: string;
      definition?: string; scenes?: string[] | string; pros?: string[] | string;
      cons?: string[] | string; maturity?: number;
    };
    if (!b.id?.trim()) return json({ error: "body needs id" }, 400);
    const arr = (x?: string[] | string): string =>
      x === undefined ? "[]" : (Array.isArray(x) ? JSON.stringify(x) : x);
    mech.query(
      `INSERT INTO mechanisms
         (id,name,domain,domain_name,definition,scenes,pros,cons,maturity)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, domain=excluded.domain,
         domain_name=excluded.domain_name, definition=excluded.definition,
         scenes=excluded.scenes, pros=excluded.pros, cons=excluded.cons,
         maturity=excluded.maturity`,
    ).run(
      b.id.trim(), b.name ?? b.id.trim(), b.domain ?? "", b.domain_name ?? "",
      b.definition ?? "", arr(b.scenes), arr(b.pros), arr(b.cons),
      b.maturity ?? 0,
    );
    return json({ ok: true, id: b.id.trim() }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

// --------------------------------------------------------------------------- //
// Router
// --------------------------------------------------------------------------- //
const server = Bun.serve({
  port: PORT,
  hostname: process.env.REFCODE_HOSTNAME ?? "0.0.0.0",
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const p = u.pathname;
    const owner = u.searchParams.get("owner") ?? "public";

    if (req.method === "GET" && p === "/health") {
      const mechCount = mech ? (mech.query("SELECT COUNT(*) c FROM mechanisms").get() as { c: number }).c : 0;
      const nProj = (corpus.query("SELECT COUNT(*) c FROM ref_projects").get() as { c: number }).c;
      const nShards = shardSlugs().length;
      return json({
        ok: true,
        catalog_db: CORPUS_DB,
        shards_dir: SHARDS_DIR,
        mechanisms_db: MECH_DB,
        projects: nProj,
        shard_files: nShards,
        mechanisms: mechCount,
      });
    }

    // corpus
    if (req.method === "POST" && p.startsWith("/projects/") && p.endsWith("/push")) {
      const slug = decodeURIComponent(p.slice("/projects/".length, p.length - "/push".length));
      if (slug) return pushProject(req, slug, owner);
    }
    if (req.method === "GET" && p.startsWith("/projects/") && p.endsWith("/manifest")) {
      const slug = decodeURIComponent(p.slice("/projects/".length, p.length - "/manifest".length));
      if (slug) return projectManifest(slug);
    }
    if (req.method === "GET" && p.startsWith("/projects/") && p.endsWith("/quality")) {
      const slug = decodeURIComponent(p.slice("/projects/".length, p.length - "/quality".length));
      if (slug) return projectQuality(slug);
    }
    if (req.method === "GET" && p.startsWith("/projects/") && p.endsWith("/symbols")) {
      const slug = decodeURIComponent(p.slice("/projects/".length, p.length - "/symbols".length));
      if (slug) return projectSymbols(u, slug);
    }
    if (req.method === "GET" && p === "/projects") return listProjects();
    if (req.method === "GET" && p === "/query") return doQuery(u);
    if (req.method === "GET" && p === "/def") return doDef(u);

    // mechanisms
    if (req.method === "GET" && p === "/mechanisms") return mechList(u);
    if (req.method === "GET" && p === "/scenes") return mechScenes();
    if (req.method === "GET" && p === "/recommend") return mechRecommend(u);
    if (req.method === "GET" && p.startsWith("/mechanisms/")) {
      const id = decodeURIComponent(p.slice("/mechanisms/".length));
      if (id) return mechShow(id);
    }
    if (req.method === "POST" && p === "/ingest") return mechIngest(req);
    if (req.method === "POST" && p === "/scene") return mechAddScene(req);
    if (req.method === "POST" && p === "/mechanisms") return mechAddMechanism(req);

    return json({
      error: "not found",
      routes: [
        "GET /health", "POST /projects/<slug>/push", "GET /projects/<slug>/manifest",
        "GET /projects/<slug>/quality", "GET /projects/<slug>/symbols",
        "GET /projects", "GET /query?text=&k=&project=", "GET /def?name=&project=",
        "GET /mechanisms", "GET /mechanisms/<id>", "GET /recommend?scene=&k=",
        "GET /scenes", "POST /ingest", "POST /scene", "POST /mechanisms",
      ],
    }, 404);
  },
});

console.log(
  `refcode-server on http://localhost:${server.port}\n  catalog: ${CORPUS_DB}\n  shards: ${SHARDS_DIR}\n  mechanisms: ${MECH_DB}`,
);

function dbAll(db: Database, sql: string, params: unknown[]) {
  return db.query(sql).all(...params);
}