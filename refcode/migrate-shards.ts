/**
 * migrate-shards — one-time migration from the legacy single-file corpus DB
 * (`remote/refcode.db`) into the sharded layout: `catalog.db` (ref_projects +
 * push_log) + `shards/<slug>.db` (each project's ref_symbols + ref_body_fts +
 * ref_docs/ref_docs_fts).
 *
 * Idempotent: re-running only fills shards that don't already have files /
 * rows. Safe to run against a live but quiesced server (best: stop the server,
 * migrate, restart).
 *
 * Run: bun migrate-shards.ts [--src <legacy.db>] [--catalog <catalog.db>]
 *                                  [--shards <shards-dir>]
 *   catalog/shards defaults mirror refcode-server.ts env (REFCODE_DB /
 *   REFCODE_SHARDS). SRC defaults to ~/.refcode/remote/refcode.db (the legacy
 *   single file). The legacy file is left untouched; remove it after verifying.
 *
 * Uses bun:sqlite (Database). Pure stdlib, no deps.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const home = Bun.env.HOME || Bun.env.USERPROFILE || ".";
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return fallback;
}
const SRC = arg("--src", `${home}/.refcode/remote/refcode.db`);
const CATALOG =
  process.env.REFCODE_DB ?? arg("--catalog", `${home}/.refcode/remote/catalog.db`);
const SHARDS_DIR =
  process.env.REFCODE_SHARDS ??
  arg("--shards", `${home}/.refcode/remote/shards`);

mkdirSync(SHARDS_DIR, { recursive: true });

// Mirror of refcode-server.ts SHARD_SCHEMA + CATALOG_SCHEMA.
const SHARD_SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ref_symbols (
  project TEXT NOT NULL, node_id TEXT NOT NULL, kind TEXT, name TEXT,
  qualified_name TEXT, file_path TEXT, language TEXT,
  start_line INTEGER, end_line INTEGER, signature TEXT, docstring TEXT,
  owner TEXT, PRIMARY KEY (project, node_id)
);
CREATE INDEX IF NOT EXISTS idx_refsym_name ON ref_symbols(name);
CREATE INDEX IF NOT EXISTS idx_refsym_proj ON ref_symbols(project);
CREATE INDEX IF NOT EXISTS idx_refsym_qual ON ref_symbols(qualified_name);
CREATE VIRTUAL TABLE IF NOT EXISTS ref_body_fts USING fts5(
  project UNINDEXED, file_path, language UNINDEXED, win UNINDEXED, line0 UNINDEXED,
  body, owner UNINDEXED, tokenize = 'trigram'
);
CREATE TABLE IF NOT EXISTS ref_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, kind TEXT, title TEXT,
  body TEXT, created_at TEXT, owner TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS ref_docs_fts USING fts5(
  id UNINDEXED, slug UNINDEXED, kind UNINDEXED, title, body, owner UNINDEXED,
  tokenize = 'trigram'
);
`;
const CATALOG_SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ref_projects (
  slug TEXT PRIMARY KEY, url TEXT, sha TEXT, licence TEXT, use_policy TEXT,
  domain TEXT, languages TEXT, ask_for TEXT, dependency_names TEXT,
  status TEXT DEFAULT 'live', quality_grade TEXT, local_path TEXT,
  bytes INTEGER, files INTEGER, symbols INTEGER, windows INTEGER,
  indexed_at TEXT, refreshed_at TEXT, owner TEXT
);
CREATE TABLE IF NOT EXISTS push_log (
  project TEXT PRIMARY KEY, sha TEXT, symbols INTEGER, windows INTEGER,
  files INTEGER, owner TEXT, pushed_at TEXT, by_client TEXT
);
`;

console.log(`migrating:\n  src    : ${SRC}\n  catalog: ${CATALOG}\n  shards : ${SHARDS_DIR}`);

const src = new Database(SRC, { readonly: true });
const cat = new Database(CATALOG);
cat.exec("PRAGMA journal_mode=WAL");
cat.exec(CATALOG_SCHEMA);

// ---- Catalog: projects -----------------------------------------------------
const projCols =
  "slug,url,sha,licence,use_policy,domain,languages,ask_for,dependency_names,status,quality_grade,local_path,bytes,files,symbols,windows,indexed_at,refreshed_at,owner";
const insProj = cat.query(
  `INSERT OR REPLACE INTO ref_projects (${projCols}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`,
);
const projects = src.query("SELECT * FROM ref_projects").all() as Array<Record<string, unknown>>;
let moved = 0;
for (const p of projects) {
  insProj.run(
    p.slug, p.url, p.sha, p.licence, p.use_policy, p.domain, p.languages,
    p.ask_for, p.dependency_names, p.status, p.quality_grade, p.local_path,
    p.bytes, p.files, p.symbols, p.windows, p.indexed_at, p.refreshed_at, p.owner,
  );
  moved++;
}
console.log(`catalog: ${moved} project rows`);

// ---- Catalog: push_log -----------------------------------------------------
const insLog = cat.query(
  "INSERT OR REPLACE INTO push_log (project,sha,symbols,windows,files,owner,pushed_at,by_client) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
);
const logs = src.query("SELECT * FROM push_log").all() as Array<Record<string, unknown>>;
for (const l of logs) {
  insLog.run(l.project, l.sha, l.symbols, l.windows, l.files, l.owner, l.pushed_at, l.by_client);
}
console.log(`catalog: ${logs.length} push_log rows`);
cat.close();

// ---- Shards: per project ---------------------------------------------------
type Row = Record<string, unknown>;
const symGets = src.query("SELECT * FROM ref_symbols WHERE project = ?");
const winGets = src.query("SELECT * FROM ref_body_fts WHERE project = ?");
const docGets = src.query("SELECT * FROM ref_docs WHERE slug = ?");

let symTotal = 0, winTotal = 0, docTotal = 0;
for (const p of projects) {
  const slug = p.slug as string;
  const path = `${SHARDS_DIR}/${slug}.db`;
  if (existsSync(path)) {
    console.log(`  skip ${slug} (shard exists)`);
    continue;
  }
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=10000");
  db.exec(SHARD_SCHEMA);
  const insS = db.query(
    "INSERT OR REPLACE INTO ref_symbols (project,node_id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,docstring,owner) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
  );
  const insW = db.query(
    "INSERT INTO ref_body_fts (project,file_path,language,win,line0,body,owner) VALUES (?1,?2,?3,?4,?5,?6,?7)",
  );
  const insDoc = db.query(
    "INSERT INTO ref_docs (slug,kind,title,body,created_at,owner) VALUES (?1,?2,?3,?4,?5,?6)",
  );
  const insDocFts = db.query(
    "INSERT INTO ref_docs_fts (id,slug,kind,title,body,owner) VALUES (?1,?2,?3,?4,?5,?6)",
  );
  const syms = symGets.all(slug) as Row[];
  const wins = winGets.all(slug) as Row[];
  const docs = docGets.all(slug) as Row[];
  db.transaction(() => {
    for (const s of syms) {
      insS.run(s.project, s.node_id, s.kind, s.name, s.qualified_name, s.file_path,
        s.language, s.start_line, s.end_line, s.signature, s.docstring, s.owner);
      symTotal++;
    }
    for (const w of wins) {
      insW.run(w.project, w.file_path, w.language, w.win, w.line0, w.body, w.owner);
      winTotal++;
    }
    for (const d of docs) {
      insDoc.run(d.slug, d.kind, d.title, d.body, d.created_at, d.owner);
      insDocFts.run(d.id, d.slug, d.kind, d.title, d.body, d.owner);
      docTotal++;
    }
  })();
  db.close();
  console.log(`  shard ${slug}: ${syms.length}s / ${wins.length}w / ${docs.length}d`);
}

src.close();
console.log(`done: ${projects.length} shards, ${symTotal} symbols, ${winTotal} windows, ${docTotal} docs`);
console.log(`legacy file left at ${SRC} — remove once you've verified the sharded server.`);