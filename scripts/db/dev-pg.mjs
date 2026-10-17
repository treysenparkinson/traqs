#!/usr/bin/env node
// `npm run dev:pg`: the dev server on a local Postgres (Postgres migration plan, step 7).
//
//   npm run dev:pg              start (first run: create, migrate, seed from the newest snapshot)
//   npm run dev:pg -- --reseed  wipe the local data and seed again from the snapshot
//   npm run dev:pg -- --db-only create / migrate / seed the database, then exit (no dev server)
//
// A persistent cluster in db/local-data (git-ignored) on port 54329, database `traqs`, migrated
// on every start. Then `npm run dev` with STORAGE_BACKEND=postgres pointing at it, so every write
// lands in the local database: production S3 is never written (the dev guard still refuses), and
// a resize you confirm survives a reload. Ctrl+C stops both.

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { startCluster, urlFor } from "./pg-cluster.mjs";
import { migrate } from "../../db/migrate.mjs";
import { createPgStore } from "../../netlify/functions/_utils/store/pg.js";
import { importSnapshot, readSnapshot, latestSnapshot } from "../../tools/db/migrate-from-s3.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIR = path.join(ROOT, "db", "local-data");
const PORT = 54329;
const DB = "traqs";

if (process.argv.includes("--reseed") && existsSync(DIR)) { rmSync(DIR, { recursive: true, force: true }); console.log("dev:pg: local data wiped"); }
const fresh = !existsSync(path.join(DIR, "PG_VERSION"));
const cluster = await startCluster({ dir: DIR, port: PORT, persistent: true, init: fresh });
console.log(`dev:pg: Postgres 17 on :${PORT} (${fresh ? "new" : "existing"} data in db/local-data)`);

const admin = await cluster.client("postgres");
if (!(await admin.query("select 1 from pg_database where datname = $1", [DB])).rows.length) await admin.query(`create database ${DB}`);
await admin.end();
const c = await cluster.client(DB);
const applied = await migrate(c);
if (applied.length) console.log(`dev:pg: migrations applied: ${applied.join(", ")}`);
const orgs = (await c.query("select count(*)::int n from store_versions")).rows[0].n;
await c.end();

const url = urlFor(PORT, DB);
if (orgs === 0) {
  const from = latestSnapshot();
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  pool.on("error", () => {});
  const r = await importSnapshot(createPgStore({ pool, actor: () => ({ source: "dev:pg seed" }) }), readSnapshot(from), { log: (m) => console.log(`dev:pg: ${m}`) });
  await pool.end();
  if (r.mismatched.length) { console.error(`dev:pg: seed mismatch: ${r.mismatched.join(", ")}`); await cluster.stop(); process.exit(1); }
  console.log(`dev:pg: seeded from ${path.relative(ROOT, from)}`);
}

if (process.argv.includes("--db-only")) {
  console.log(`dev:pg: database ready at ${url.replace(/:[^:@/]+@/, ":***@")} (--db-only: not starting the dev server)`);
  await cluster.stop();
  process.exit(0);
}

const env = { ...process.env, STORAGE_BACKEND: "postgres", TRAQS_DATABASE_URL: url, STORAGE_BINARIES: "postgres" };
const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
let stopping = false;
const stop = async (code) => { if (stopping) return; stopping = true; try { child.kill(); } catch { /* gone */ } await cluster.stop().catch(() => {}); process.exit(code ?? 0); };
child.on("exit", (code) => stop(code));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
