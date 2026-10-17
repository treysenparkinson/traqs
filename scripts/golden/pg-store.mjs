// The golden harness's Postgres backend (Postgres migration plan, step 6).
//
// makePgStore(seed) gives each scenario a store over a database in exactly the state a fresh
// clone of the migrated template would be in after loading `seed` through the store itself
// (writeJson / writeBinary, as handlers write). close() ends the scenario's pool. One cluster per
// process: the build's (via TRAQS_TEST_PG_URL) or, run on its own, one started on first use.
//
// Speed: a clone + seed + drop per scenario cost ~1.8 s under build load (clone ~1 s, drop
// ~0.4 s, seed ~0.35 s; the scenario itself ~0.1 s), so the Postgres replay was ~100 s of the
// build. Now each replay process clones the template ONCE and, between scenarios, resets that
// database in place: every table in `public` emptied and refilled from a snapshot schema, every
// sequence set back to its snapshot value, with triggers off (session_replication_role =
// replica) so the copy is verbatim — change_log and store_versions included, so ETags and the
// audit trail start exactly where a fresh clone's would. Two snapshots:
//   golden_migrated — the template as cloned (what a scenario with its own `seed:` starts from;
//                     its seed is then written through the store, the slow way, as before)
//   golden_seeded   — after the default fixture org (fixture-org.mjs orgSeed()) was written
//                     through the store once; every scenario whose seed is byte-identical to the
//                     default restores this instead of re-seeding row by row.
// Pool connections are kept between scenarios as well (scenarioPool): each new one is a new
// server process. The snapshots live outside `public`, which is all the store (pg.js meta())
// reads. Row order on disk can differ from a fresh clone's; nothing sees it, because the codecs
// order every list by its position column. Anything in `public` the reset can't copy (a
// materialized view, a partitioned or foreign table) fails loudly instead of leaking state.
// scripts/golden-reset-test.mjs proves the reset state equals a fresh clone's, table by table.
//
// GOLDEN_PG_FRESH=1 restores the old path (a new clone per scenario, seeded the slow way).

import pg from "pg";
import { createPgStore } from "../../netlify/functions/_utils/store/pg.js";
import { startCluster } from "../db/pg-cluster.mjs";
import { buildTemplate, TEMPLATE_DB } from "../db/test-db.mjs";
import { orgSeed } from "./fixture-org.mjs";

const FRESH = process.env.GOLDEN_PG_FRESH === "1";

let base = process.env.TRAQS_TEST_PG_URL || null;
let starting = null;
async function clusterUrl() {
  if (base) return base;
  starting ??= (async () => { const c = await startCluster(); await buildTemplate(c); globalThis.__goldenCluster = c; return c.url; })();
  base = await starting;
  return base;
}
const dbUrl = (url, name) => url.replace(/\/[^/]*$/, `/${name}`);
const adminClient = async () => { const c = new pg.Client({ connectionString: await clusterUrl() }); await c.connect(); return c; };

// A template can't be cloned while another session is connected to it; replay processes run in
// parallel, so retry briefly rather than fail on that race.
async function cloneTemplate(admin, name) {
  for (let i = 0; ; i++) {
    try { await admin.query(`create database ${name} template ${TEMPLATE_DB}`); return; }
    catch (e) { if (i >= 60 || !/being accessed by other users/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
}

async function seedThroughStore(store, seed) {
  for (const [key, value] of Object.entries(seed)) {
    if (value && value.__binary) await store.writeBinary(key, Buffer.from(value.__binary, "base64"), value.contentType);
    else await store.writeJson(key, value);
  }
}

// ── the old path: a fresh clone per scenario ────────────────────────────────

let n = 0;
async function makeFreshPgStore(seed) {
  const url = await clusterUrl();
  const name = `g_${process.pid}_${++n}`;
  const admin = await adminClient();
  await cloneTemplate(admin, name);
  const pool = new pg.Pool({ connectionString: dbUrl(url, name), max: 3 });
  pool.on("error", () => {});
  const store = createPgStore({ pool });
  await seedThroughStore(store, seed);
  store.close = async () => {
    await pool.end().catch(() => {});
    await admin.query(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.end().catch(() => {});
  };
  return store;
}

// ── snapshot / restore ─────────────────────────────────────────────────────

const qi = (ident) => `"${ident.replace(/"/g, '""')}"`;
const qs = (s) => `'${s.replace(/'/g, "''")}'`;

// Every table (with its non-generated columns) and sequence in `public`.
async function shapeOf(client) {
  const rels = (await client.query(`select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind not in ('i', 'I', 'v', 'c') order by c.relname`)).rows;
  const odd = rels.filter((r) => !["r", "S"].includes(r.relkind));
  if (odd.length) throw new Error(`golden pg-store: can't reset ${odd.map((r) => `${r.relname} (relkind ${r.relkind})`).join(", ")}; extend snapshot()/restore()`);
  const tables = rels.filter((r) => r.relkind === "r").map((r) => r.relname);
  const cols = (await client.query(`select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by c.relname, a.attnum`)).rows;
  const colsOf = new Map(tables.map((t) => [t, []]));
  for (const r of cols) colsOf.get(r.relname).push(r.attname);
  return { tables, colsOf, sequences: rels.filter((r) => r.relkind === "S").map((r) => r.relname) };
}

// Copy every table of `public` into `schema` and remember every sequence's position.
async function snapshot(client, shape, schema) {
  await client.query([`drop schema if exists ${schema} cascade`, `create schema ${schema}`,
    ...shape.tables.map((t) => `create table ${schema}.${qi(t)} as select ${shape.colsOf.get(t).map(qi).join(", ")} from public.${qi(t)}`)].join(";\n"));
  const seqs = shape.sequences.length
    ? (await client.query(shape.sequences.map((s) => `select ${qs(s)} as name, last_value::text as last_value, is_called from public.${qi(s)}`).join(" union all "))).rows
    : [];
  return { schema, seqs };
}

// One round trip, one transaction.
async function restore(client, shape, snap) {
  const sql = [
    "begin",
    "set local session_replication_role = replica",
    // DELETE, not TRUNCATE: truncating ~50 tables makes new files for each (~300 ms on Windows),
    // a delete of these few rows is ~3 ms. Replica mode skips the FK triggers, so order is free.
    ...shape.tables.map((t) => `delete from public.${qi(t)}`),
    ...shape.tables.map((t) => { const c = shape.colsOf.get(t).map(qi).join(", "); return `insert into public.${qi(t)} (${c}) overriding system value select ${c} from ${snap.schema}.${qi(t)}`; }),
    ...snap.seqs.map((s) => `select setval(${qs(`public.${qi(s.name)}`)}, ${s.last_value}, ${s.is_called})`),
    "commit",
  ].join(";\n");
  try { await client.query(sql); }
  catch (e) { await client.query("rollback").catch(() => {}); throw e; }
}

// The seed as an exact string, or null when it holds anything JSON can't carry faithfully
// (undefined, -0, NaN, Dates, Buffers, ...): those always take the slow path.
function seedKey(seed) {
  let ok = true;
  const s = JSON.stringify(seed, function (k, x) {
    const raw = this[k];
    if (raw === undefined || typeof raw === "function" || typeof raw === "symbol" || typeof raw === "bigint") { ok = false; return null; }
    if (typeof raw === "number" && (!Number.isFinite(raw) || Object.is(raw, -0))) ok = false;
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) ok = false;
    return x;
  });
  return ok ? s : null;
}
let defaultKey;

// ── the reset path: one database per process ────────────────────────────────

let proc = null;
function processDb() {
  // A failed setup is not cached: the next scenario tries again, as each did on the old path.
  proc ??= (async () => {
    const url = await clusterUrl();
    const name = `g_${process.pid}`;
    const admin = await adminClient();
    try {
      await admin.query(`drop database if exists ${name} with (force)`);
      await cloneTemplate(admin, name);
    } finally { await admin.end().catch(() => {}); }
    const client = new pg.Client({ connectionString: dbUrl(url, name) });
    await client.connect();
    const shape = await shapeOf(client);
    const migrated = await snapshot(client, shape, "golden_migrated");
    return { url: dbUrl(url, name), name, client, shape, migrated, seeded: null, pool: null };
  })().catch((e) => { proc = null; throw e; });
  return proc;
}

export async function makePgStore(seed) {
  if (FRESH) return makeFreshPgStore(seed);
  const d = await processDb();
  defaultKey ??= seedKey(orgSeed());
  const isDefault = defaultKey !== null && seedKey(seed) === defaultKey;
  await restore(d.client, d.shape, isDefault && d.seeded ? d.seeded : d.migrated);
  const pool = scenarioPool(d);
  const store = createPgStore({ pool });
  if (!isDefault || !d.seeded) {
    await seedThroughStore(store, seed);
    if (isDefault) d.seeded = await snapshot(d.client, d.shape, "golden_seeded");
  }
  store.close = () => pool.end();
  return store;
}

// The scenario's view of the process's pool. Connections are kept between scenarios, but a
// scenario's pool still behaves like its own: end() waits for every connection it checked out
// to come back, and once ended, connect() refuses, as an ended pg.Pool does, so nothing late
// from one scenario can reach the next one's data.
function scenarioPool(d) {
  if (!d.pool) { d.pool = new pg.Pool({ connectionString: d.url, max: 3 }); d.pool.on("error", () => {}); }
  let ended = null, out = 0, drained = () => {};
  const back = () => { if (--out === 0) drained(); };
  return {
    async connect() {
      if (ended) throw new Error("Cannot use a pool after calling end on the pool");
      out++;
      let client;
      try { client = await d.pool.connect(); } catch (e) { back(); throw e; }
      const release = client.release;      // pg-pool sets a fresh one on every checkout
      let returned = false;
      client.release = (err) => { const r = release.call(client, err); if (!returned) { returned = true; back(); } return r; };
      return client;
    },
    end() {
      ended ??= out === 0 ? Promise.resolve() : new Promise((resolve) => { drained = resolve; });
      return ended;
    },
  };
}

// Drop the process's database and stop a self-started cluster. replay.mjs calls this before it
// exits (process.exit skips beforeExit).
export async function closePgStores() {
  const d = proc ? await proc.catch(() => null) : null;
  proc = null;
  if (d) {
    await d.pool?.end().catch(() => {});
    await d.client.end().catch(() => {});
    const admin = await adminClient().catch(() => null);
    await admin?.query(`drop database if exists ${d.name} with (force)`).catch(() => {});
    await admin?.end().catch(() => {});
  }
  const c = globalThis.__goldenCluster;
  globalThis.__goldenCluster = null;
  if (c) await c.stop().catch(() => {});
}

// Test-only (golden-reset-test): the reset path's database.
export async function __goldenDbForTests() { const d = await processDb(); return { url: d.url, name: d.name }; }
