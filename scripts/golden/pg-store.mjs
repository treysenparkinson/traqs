// The golden harness's Postgres backend (Postgres migration plan, step 6).
//
// makePgStore(seed) gives each scenario a fresh, migrated database (a clone of the template),
// loads the seed through the store itself (writeJson / writeBinary, exactly as handlers write),
// and returns the store. close() drops the database. One cluster per process: the build's (via
// TRAQS_TEST_PG_URL) or, run on its own, one started on first use.

import pg from "pg";
import { createPgStore } from "../../netlify/functions/_utils/store/pg.js";
import { startCluster } from "../db/pg-cluster.mjs";
import { buildTemplate, TEMPLATE_DB } from "../db/test-db.mjs";

let base = process.env.TRAQS_TEST_PG_URL || null;
let starting = null;
async function clusterUrl() {
  if (base) return base;
  starting ??= (async () => { const c = await startCluster(); await buildTemplate(c); process.on("exit", () => {}); globalThis.__goldenCluster = c; return c.url; })();
  base = await starting;
  return base;
}
let n = 0;

export async function makePgStore(seed) {
  const url = await clusterUrl();
  const name = `g_${process.pid}_${++n}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  for (let i = 0; ; i++) {
    try { await admin.query(`create database ${name} template ${TEMPLATE_DB}`); break; }
    catch (e) { if (i >= 60 || !/being accessed by other users/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
  const pool = new pg.Pool({ connectionString: url.replace(/\/[^/]*$/, `/${name}`), max: 3 });
  pool.on("error", () => {});
  const store = createPgStore({ pool });
  for (const [key, value] of Object.entries(seed)) {
    if (value && value.__binary) await store.writeBinary(key, Buffer.from(value.__binary, "base64"), value.contentType);
    else await store.writeJson(key, value);
  }
  store.close = async () => {
    await pool.end().catch(() => {});
    await admin.query(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.end().catch(() => {});
  };
  return store;
}

// Stop a self-started cluster when the replay is done (replay.mjs exits explicitly).
process.on("beforeExit", async () => { if (globalThis.__goldenCluster) { const c = globalThis.__goldenCluster; globalThis.__goldenCluster = null; await c.stop(); } });
