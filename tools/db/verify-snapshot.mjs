#!/usr/bin/env node
// Proves the migration on production's real data (Postgres migration plan, step 4, D2).
//
//   node tools/db/verify-snapshot.mjs [db/snapshots/<day>]     (default: the newest snapshot)
//
// For every JSON file in the snapshot: pure decode/encode round-trip, then write -> read through
// the real Postgres store on a throwaway cluster. Then a profile of references, which settles the
// schema's "(FK?)" relations: how many point at something that exists. Prints counts and ids
// only — never names, emails, PINs or hours — so the output is safe to paste.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { decodeKey, encodeKey, codecFor } from "../../netlify/functions/_utils/store/codecs.js";
import { createPgStore } from "../../netlify/functions/_utils/store/pg.js";
import { openTestDb } from "../../scripts/db/test-db.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const snapRoot = path.join(ROOT, "db", "snapshots");
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(snapRoot, readdirSync(snapRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop());
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".json") && f !== "MANIFEST.json") files.push(p); } };
walk(dir);
const keyOf = (p) => path.relative(dir, p).split(path.sep).join("/");

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().filter((key) => x[key] !== undefined).map((key) => [key, x[key]])) : x));
// EXACT equality (key order included: handlers compare with JSON.stringify). Reports the path
// only, never values, which may be personal data.
const firstDiffPath = (a, b, at = "$") => {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (!Array.isArray(a) && canon(Object.keys(a).sort()) === canon(Object.keys(b).sort()) && Object.keys(a).join() !== Object.keys(b).join()) return `${at} (key order)`;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiffPath(a[k], b[k], `${at}.${k}`); if (d) return d; }
  }
  return at;
};

console.log(`snapshot ${path.relative(ROOT, dir)}: ${files.length} JSON files`);
const docs = files.map((p) => {
  const text = readFileSync(p, "utf8");
  let value; try { value = text.trim() === "" ? null : JSON.parse(text); } catch { value = { __unparseable: true }; }
  return { key: keyOf(p), value, bytes: text.length };
});

let failures = 0;
const report = { relational: [], raw: [], declined: [] };
for (const d of docs) {
  const r = decodeKey(d.key, d.value);
  if (r.raw) { report.raw.push(d.key); continue; }
  if (r.declined) { report.declined.push(`${d.key}: ${r.declined}`); continue; }
  const diff = firstDiffPath(d.value, encodeKey(d.key, r.tables));
  if (diff) { failures++; console.log(`  FAIL  pure ${d.key} differs at ${diff}`); }
  report.relational.push({ key: d.key, rows: Object.fromEntries(Object.entries(r.tables).map(([t, rows]) => [t, rows.length]).filter(([, n]) => n)) });
}
console.log(`  pure: ${report.relational.length} relational, ${report.raw.length} raw by design, ${report.declined.length} declined, ${failures} failed`);
for (const x of report.raw) console.log(`    raw       ${x}`);
for (const x of report.declined) console.log(`    DECLINED  ${x}`);

// ── through Postgres ───────────────────────────────────────────────────────
const db = await openTestDb();
const pool = new pg.Pool({ connectionString: db.url, max: 4 });
const store = createPgStore({ pool });
const totals = {};
try {
  for (const d of docs) {
    try { await store.writeJson(d.key, d.value); }
    catch (e) { failures++; console.log(`  FAIL  db write ${d.key}: ${e.message.split("\n")[0]}`); continue; }
    const diff = firstDiffPath(d.value, await store.readJson(d.key));
    if (diff) { failures++; console.log(`  FAIL  db read ${d.key} differs at ${diff}`); }
  }
  const counts = await db.client.query(`select relname as t, n_live_tup::int as n from pg_stat_user_tables order by relname`);
  for (const r of counts.rows) totals[r.t] = r.n;
  const exact = async (t) => (await db.client.query(`select count(*)::int n from ${t}`)).rows[0].n;
  console.log("  rows per table:");
  for (const t of Object.keys(totals).sort()) { const n = await exact(t); if (n) console.log(`    ${t.padEnd(28)} ${n}`); }

  // ── reference profile: settles the (FK?) relations ───────────────────────
  const q = async (label, sql) => { const r = (await db.client.query(sql)).rows[0]; console.log(`    ${label.padEnd(58)} ${r.dangling} of ${r.total} dangling${r.dangling ? `  e.g. ${r.example}` : ""}`); return r; };
  console.log("  references (dangling = points at nothing in the same org):");
  const prof = {};
  prof.team = await q("node_team.person_id -> live-or-tombstoned people", `select count(*)::int total, count(*) filter (where p.id is null)::int dangling, min(t.org_code || ':' || (t.person_id::text)) filter (where p.id is null) example
    from node_team t left join people p on p.org_code = t.org_code and p.id = trim(both '"' from t.person_id::text)`);
  prof.client = await q("nodes.client_id -> clients", `select count(*)::int total, count(*) filter (where c.id is null)::int dangling, min(n.org_code || ':' || n.client_id) filter (where c.id is null) example
    from nodes n left join clients c on c.org_code = n.org_code and c.id = n.client_id where n.client_id is not null and n.client_id <> ''`);
  prof.pm = await q("nodes.project_manager_id -> people", `select count(*)::int total, count(*) filter (where p.id is null)::int dangling, min(n.org_code || ':' || n.project_manager_id) filter (where p.id is null) example
    from nodes n left join people p on p.org_code = n.org_code and p.id = n.project_manager_id where n.project_manager_id is not null and n.project_manager_id <> ''`);
  prof.deps = await q("node_deps.dep_id -> a node (sentinel __pending__ excluded)", `select count(*)::int total, count(*) filter (where x.id is null)::int dangling, min(d.org_code || ':' || (d.dep_id::text)) filter (where x.id is null) example
    from node_deps d left join nodes x on x.org_code = d.org_code and x.id = trim(both '"' from d.dep_id::text) where d.dep_id::text <> '"__pending__"'`);
  prof.reqId = await q("person_time_off.req_id -> time_off_requests", `select count(*)::int total, count(*) filter (where r.id is null)::int dangling, min(t.org_code || ':' || t.req_id) filter (where r.id is null) example
    from person_time_off t left join time_off_requests r on r.org_code = t.org_code and r.id = t.req_id where t.req_id is not null`);
  prof.members = await q("chat_group_members.member_id -> people", `select count(*)::int total, count(*) filter (where p.id is null)::int dangling, min(m.org_code || ':' || (m.member_id::text)) filter (where p.id is null) example
    from chat_group_members m left join people p on p.org_code = m.org_code and p.id = trim(both '"' from m.member_id::text)`);
  prof.punch = await q("time_punches.person_id -> people", `select count(*)::int total, count(*) filter (where p.id is null)::int dangling, min(t.org_code || ':' || (t.person_id::text)) filter (where p.id is null) example
    from time_punches t left join people p on p.org_code = t.org_code and p.id = trim(both '"' from t.person_id::text)`);
  prof.prodOp = await q("production_sessions.op_id -> nodes", `select count(*)::int total, count(*) filter (where n.id is null)::int dangling, min(s.org_code || ':' || s.op_id) filter (where n.id is null) example
    from production_sessions s left join nodes n on n.org_code = s.org_code and n.id = s.op_id where s.op_id is not null`);
  prof.msgAuthor = await q("messages.author_id -> people", `select count(*)::int total, count(*) filter (where p.id is null)::int dangling, min(m.org_code || ':' || m.author_id) filter (where p.id is null) example
    from messages m left join people p on p.org_code = m.org_code and p.id = m.author_id where m.author_id is not null`);
  const audit = (await db.client.query("select count(*)::int n from change_log")).rows[0].n;
  console.log(`  change_log rows written by the import: ${audit}`);
} finally {
  await pool.end();
  await db.close();
}

console.log(failures ? `\nFAILED: ${failures} file(s) did not round-trip` : `\nOK: every file round-trips (pure and through Postgres)`);
process.exit(failures ? 1 : 0);
