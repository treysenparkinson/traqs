#!/usr/bin/env node
// Load an S3 JSON snapshot into a Postgres database, then prove it (Postgres migration plan, step 7).
//
//   node tools/db/migrate-from-s3.mjs --to postgres://...127.0.0.1:54329/traqs [--from db/snapshots/<day>]
//
// Every JSON file is written through the same store the functions use (writeJson), so the import
// takes exactly the path a handler write would. Afterwards every key is read back and compared
// byte for byte (JSON.stringify) with the snapshot. Refuses a non-local database unless
// --allow-remote is given: phase 3 decides how production is loaded, not this script's default.
// Prints counts and keys only.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createPgStore } from "../../netlify/functions/_utils/store/pg.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function latestSnapshot() {
  const root = path.join(ROOT, "db", "snapshots");
  const day = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
  if (!day) throw new Error("no snapshot in db/snapshots/ (run tools/db/pull-snapshot.mjs)");
  return path.join(root, day);
}

export function readSnapshot(dir) {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".json") && f !== "MANIFEST.json") files.push(p); } };
  walk(dir);
  return files.map((p) => {
    const text = readFileSync(p, "utf8");
    return { key: path.relative(dir, p).split(path.sep).join("/"), value: text.trim() === "" ? null : JSON.parse(text) };
  });
}

/** Import every doc through the store, then verify each reads back identically. */
export async function importSnapshot(store, docs, { log = () => {} } = {}) {
  for (const d of docs) await store.writeJson(d.key, d.value);
  const mismatched = [];
  for (const d of docs) if (JSON.stringify(await store.readJson(d.key)) !== JSON.stringify(d.value)) mismatched.push(d.key);
  log(`imported ${docs.length} files; ${docs.length - mismatched.length} read back identical`);
  return { imported: docs.length, mismatched };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const to = arg("--to");
  const from = arg("--from") ? path.resolve(arg("--from")) : latestSnapshot();
  if (!to) { console.error("usage: migrate-from-s3.mjs --to <postgres url> [--from <snapshot dir>] [--allow-remote]"); process.exit(2); }
  const host = new URL(to).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && !process.argv.includes("--allow-remote")) {
    console.error(`refusing non-local database ${host}: pass --allow-remote deliberately (phase 3)`); process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: to, max: 4 });
  pool.on("error", () => {});
  const store = createPgStore({ pool, actor: () => ({ source: "migrate-from-s3", email: "", personId: null }) });
  const docs = readSnapshot(from);
  console.log(`snapshot ${path.relative(ROOT, from)}: ${docs.length} files`);
  const r = await importSnapshot(store, docs, { log: (m) => console.log(m) });
  await pool.end();
  if (r.mismatched.length) { console.error(`MISMATCH: ${r.mismatched.join(", ")}`); process.exit(1); }
  console.log("OK: every file reads back identical");
}
