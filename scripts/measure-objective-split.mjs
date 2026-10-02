#!/usr/bin/env node
// What does changing the even-load measure from BARS to HOURS actually do? (#345)
//
// THE TRAP THIS SCRIPT EXISTS TO AVOID. The obvious comparison — strip the
// teams off a job's ops, re-pick under each metric, diff the splits — answers a
// question nobody asked. Manual assignment is a state the scheduler RESPECTS
// (ruling 2, 2026-10-02): candidatesFor puts an existing team first, so for any
// op that already has somebody on it the objective is never consulted at all.
// Stripping the team measures a counterfactual that the scheduler would never
// reach, and it produces a dramatic, entirely fictional before/after.
//
// So this reports three things in order:
//   1. how many of the job's ops the objective can even SPEAK to;
//   2. the two metrics side by side for the real candidate pool, with the
//      preference order each produces — that is the actual behavioural delta;
//   3. a replay of the genuinely unassigned ops only, if there are any.
//
//   node scripts/measure-objective-split.mjs [--org MTX2026TRAQS] [--job TORUS]

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { candidatesFor, hoursLoadOf } from "../src/placement.js";
import { occupyingUnits } from "../src/overlapRules.js";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ORG = val("--org", "MTX2026TRAQS");
const JOBQ = val("--job", null);

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const td = await get(`orgs/${ORG}/tasks.json`);
const pd = await get(`orgs/${ORG}/people.json`);
const tasks = Array.isArray(td) ? td : (td.tasks || td.records || []);
const people = Array.isArray(pd) ? pd : (pd.people || pd.records || []);

let job;
if (JOBQ) job = tasks.find(j => String(j.id) === JOBQ || String(j.title || "").toLowerCase().includes(JOBQ.toLowerCase()));
else job = tasks.filter(j => (j.subs || []).some(p => (p.subs || []).length))
  .sort((a, b) => String(b.lastModifiedAt || "").localeCompare(String(a.lastModifiedAt || "")))[0];
if (!job) { console.log("No job matched."); process.exit(0); }

const crew = people.filter(p => (p.userRole === "user" || p.userRole === "admin") && !p.noAutoSchedule);
const nameOf = (id) => (people.find(p => String(p.id) === String(id)) || {}).name || `#${id}`;
const HPD = 7.5;
const hoursOf = (o) => Number(o.hpd) || HPD;

const entries = [];
for (const panel of (job.subs || [])) {
  const inner = (panel.subs || []);
  for (const o of (inner.length ? inner : [panel])) entries.push({ op: o, panel });
}
const assigned = entries.filter(e => (e.op.team || []).length);
const free = entries.filter(e => !(e.op.team || []).length);

console.log(`JOB  ${job.title || job.id}   ${entries.length} ops, ${entries.reduce((a, e) => a + hoursOf(e.op), 0).toFixed(0)}h`);
console.log(`\n1. CAN THE OBJECTIVE SPEAK TO THIS JOB AT ALL?`);
console.log(`   already assigned (objective NOT consulted): ${assigned.length}`);
console.log(`   unassigned (objective decides):             ${free.length}`);
if (!free.length) {
  console.log(`   => Every op carries a team, so changing the metric changes NOTHING here.`);
  console.log(`      The split you see on this job is manual assignment, not the objective.`);
}

// ── the two metrics, on the real candidate pool ────────────────────────────
const pool = new Map();
for (const { op, panel } of entries) for (const c of candidatesFor({ ...op, team: [] }, crew, { panel, job })) pool.set(String(c.id), c);
const ctx = { today: null, cfg: {}, isWorkDay: () => true };
const units = occupyingUnits(tasks, ctx).filter(u => String(u.job?.id) !== String(job.id));
const byHours = hoursLoadOf(units);
const byBars = (() => {                       // the OLD measure, reproduced exactly
  const m = new Map();
  for (const j of tasks) {
    if (String(j.id) === String(job.id)) continue;
    for (const pnl of (j.subs || [])) {
      if (pnl.status !== "Finished") for (const id of (pnl.team || [])) m.set(String(id), (m.get(String(id)) || 0) + 1);
      for (const o of (pnl.subs || [])) if (o.status !== "Finished") for (const id of (o.team || [])) m.set(String(id), (m.get(String(id)) || 0) + 1);
    }
  }
  return (id) => m.get(String(id)) || 0;
})();

console.log(`\n2. THE TWO METRICS, for the ${pool.size} people this job's departments allow`);
console.log("   PERSON         BARS (old)      HOURS (new)   h PER BAR");
const rows = [...pool.values()].map(c => ({ id: c.id, bars: byBars(c.id), hours: byHours(c.id) }));
for (const r of [...rows].sort((a, b) => b.hours - a.hours)) {
  console.log(`   ${nameOf(r.id).padEnd(13)} ${String(r.bars).padStart(6)}   ${r.hours.toFixed(0).padStart(13)}h   ${(r.bars ? r.hours / r.bars : 0).toFixed(1).padStart(9)}`);
}
const ordBars = [...rows].sort((a, b) => a.bars - b.bars || String(nameOf(a.id)).localeCompare(nameOf(b.id))).map(r => nameOf(r.id));
const ordHours = [...rows].sort((a, b) => a.hours - b.hours || String(nameOf(a.id)).localeCompare(nameOf(b.id))).map(r => nameOf(r.id));
console.log(`\n   preference order, lightest first`);
console.log(`     BEFORE (bars):  ${ordBars.join(" < ")}`);
console.log(`     AFTER  (hours): ${ordHours.join(" < ")}`);
const moved = ordBars.filter((n, i) => ordHours[i] !== n).length;
console.log(`   ${moved} of ${ordBars.length} positions change. First pick: ${ordBars[0]} -> ${ordHours[0]}${ordBars[0] === ordHours[0] ? "  (unchanged)" : ""}`);
// Hours per bar is the spread that the old metric was blind to.
// Only people who actually carry hours. Somebody whose every bar is undated,
// past or deleted scores 0h against a non-zero bar count — which is itself the
// point being made, but it turns the ratio into Infinity and says nothing.
const hpb = rows.filter(r => r.bars > 0 && r.hours > 0).map(r => r.hours / r.bars);
if (hpb.length > 1) {
  const hi = Math.max(...hpb), lo = Math.min(...hpb);
  console.log(`   hours-per-bar across the pool: ${lo.toFixed(1)} to ${hi.toFixed(1)} (${(hi / lo).toFixed(1)}x)`);
  console.log(`   => that ratio is exactly what counting bars could not see.`);
}

// ── replay, unassigned ops only ────────────────────────────────────────────
if (free.length) {
  const replay = (metric) => {
    const add = new Map(), bars = new Map();
    const now = (pid) => metric === "hours"
      ? byHours(pid) + (add.get(String(pid)) || 0)
      : byBars(pid) + (bars.get(String(pid)) || 0);
    for (const { op, panel } of free) {
      const cands = candidatesFor(op, crew, { panel, job });
      if (!cands.length) continue;
      const pick = [...cands].sort((a, b) => now(a.id) - now(b.id) || String(nameOf(a.id)).localeCompare(nameOf(b.id)))[0];
      add.set(String(pick.id), (add.get(String(pick.id)) || 0) + hoursOf(op));
      bars.set(String(pick.id), (bars.get(String(pick.id)) || 0) + 1);
    }
    return add;
  };
  const show = (t, m) => {
    const r = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const hs = r.map(x => x[1]);
    console.log(`\n   ${t}`);
    for (const [id, h] of r) console.log(`     ${nameOf(id).padEnd(13)} ${h.toFixed(0).padStart(5)}h`);
    if (hs.length > 1) console.log(`     spread ${Math.max(...hs).toFixed(0)}h / ${Math.min(...hs).toFixed(0)}h = ${(Math.max(...hs) / Math.min(...hs)).toFixed(2)}:1`);
  };
  console.log(`\n3. REPLAY of the ${free.length} unassigned ops (dates not re-searched)`);
  show("BEFORE — bars:", replay("bars"));
  show("AFTER  — hours:", replay("hours"));
} else {
  console.log(`\n3. REPLAY — nothing to replay: no unassigned ops on this job.`);
}
