#!/usr/bin/env node
// Sweep, delete-job cascade. `delTask` removes a node from the tree and filters
// `deps` at every level. The question is not whether that works — it is what
// ELSE in the org still points at the id once the node is gone, and whether the
// one guard on the path (`blockedByActiveClock`) can fire when it should not.
//
// Measured against live Matrix data, not reasoned about.
//
//   node scripts/measure-delete-cascade.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync("C:/Users/treysen/traqs-func/.env", "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const td = await get(`orgs/${ORG}/tasks.json`);
const tasks = (Array.isArray(td) ? td : td.tasks || []).filter(j => j && !j.deletedAt);
const people = await get(`orgs/${ORG}/people.json`).then(d => Array.isArray(d) ? d : d.people || []).catch(() => []);
// Job sessions are NOT on the person — they are their own S3 object, and they
// are not a /sync entity. Reading them off `person.jobSessions` returns zero
// and looks like "nothing is orphaned", which is a false negative.
const prod = await get(`orgs/${ORG}/productionhours.json`)
  .then(d => Array.isArray(d) ? d : (d.sessions || d.productionHours || d.records || []))
  .catch(() => []);
console.log(`productionhours.json records: ${prod.length}`);
if (prod[0]) console.log(`  a record's keys: ${Object.keys(prod[0]).join(", ")}`);

// Every live id in the tree, at every level, as a string — because that is how
// a reference elsewhere will be compared.
const live = new Set();
const byId = new Map();
const walk = (ns, lvl, jobId) => (ns || []).forEach(n => {
  if (n?.id == null) return;
  live.add(String(n.id));
  byId.set(String(n.id), { node: n, lvl, jobId });
  walk(n.subs, lvl + 1, lvl === 0 ? String(n.id) : jobId);
});
walk(tasks, 0, null);
console.log(`live ids in the tree: ${live.size}  (${tasks.length} jobs)`);

// ── 1. ID TYPES. `delTask` compares `n.id !== id` and `d !== id` raw. ────────
const types = {};
for (const [, v] of byId) types[typeof v.node.id] = (types[typeof v.node.id] || 0) + 1;
console.log(`\n1. NODE ID TYPES (delTask compares raw, with !==)`);
console.log(`   ${JSON.stringify(types)}`);
let depTypes = {}, depCount = 0;
for (const [, v] of byId) for (const d of v.node.deps || []) { depTypes[typeof d] = (depTypes[typeof d] || 0) + 1; depCount++; }
console.log(`   dep entry types: ${JSON.stringify(depTypes)}  (${depCount} dep edges)`);

// ── 2. DANGLING DEPS. A dep pointing at an id that is not in the tree. ──────
const dangling = [];
for (const [id, v] of byId)
  for (const d of v.node.deps || [])
    if (!live.has(String(d))) dangling.push({ from: v.node.title || id, dep: d });
console.log(`\n2. DANGLING DEPS (dep -> an id no longer in the tree)`);
console.log(`   ${dangling.length}`);
dangling.slice(0, 10).forEach(d => console.log(`     "${d.from}" -> ${JSON.stringify(d.dep)}`));

// ── 3. WHAT ELSE POINTS AT A NODE ID, outside the tree. ────────────────────
console.log(`\n3. REFERENCES OUTSIDE THE TREE`);
const orphan = { sessions: [], activeClock: [], reservoir: [] };
let sessTotal = 0;
const nameOf = (pid) => people.find(p => String(p.id) === String(pid))?.name || `#${pid}`;
for (const s of prod) {
  sessTotal++;
  for (const k of ["jobId", "opId", "panelId"]) {
    const val = s?.[k];
    if (val != null && !live.has(String(val)))
      orphan.sessions.push({ person: nameOf(s.personId), key: k, id: val,
        when: `${s.date || ""} ${s.jobTitle || ""}/${s.opTitle || ""}`.trim() });
  }
}
for (const p of people) {
  const jc = p.activeJobClock;
  if (jc) {
    for (const k of ["jobId", "opId"]) if (jc[k] != null && !live.has(String(jc[k])))
      orphan.activeClock.push({ person: p.name, key: k, id: jc[k] });
    if (jc.reservoirOpId != null && !live.has(String(jc.reservoirOpId)))
      orphan.reservoir.push({ person: p.name, id: jc.reservoirOpId });
  }
}
console.log(`   time-clock sessions scanned: ${sessTotal}`);
console.log(`   sessions pointing at a DEAD id: ${orphan.sessions.length}`);
orphan.sessions.slice(0, 12).forEach(o => console.log(`     ${o.person}  ${o.key}=${JSON.stringify(o.id)}  ${o.when}`));
console.log(`   activeJobClock pointing at a DEAD id: ${orphan.activeClock.length}`);
orphan.activeClock.forEach(o => console.log(`     ${o.person}  ${o.key}=${JSON.stringify(o.id)}`));
console.log(`   reservoirOpId dead: ${orphan.reservoir.length}`);

// How much of the production record is this, and does it still READ? The
// session denormalises jobTitle/panelTitle/opTitle, so the row may survive the
// delete as text even when every id on it points at nothing.
const deadRec = prod.filter(s => ["jobId", "opId", "panelId"]
  .some(k => s?.[k] != null && !live.has(String(s[k]))));
const hrs = (a) => a.reduce((t, s) => t + (Number(s.hours) || 0), 0);
console.log(`   records with at least one dead id: ${deadRec.length} of ${prod.length}`
  + `  (${(deadRec.length / prod.length * 100).toFixed(1)}%)`);
console.log(`   hours on those records: ${hrs(deadRec).toFixed(2)} of ${hrs(prod).toFixed(2)}`);
console.log(`   ...of those, still carrying a jobTitle: `
  + `${deadRec.filter(s => s.jobTitle).length}  opTitle: ${deadRec.filter(s => s.opTitle).length}`);
const distinct = new Set(orphan.sessions.map(o => String(o.id)));
console.log(`   distinct dead ids referenced: ${distinct.size}`);
const byPerson = {};
for (const s of deadRec) { const n = nameOf(s.personId); byPerson[n] = (byPerson[n] || 0) + (Number(s.hours) || 0); }
console.log(`   whose hours: ${Object.entries(byPerson).map(([k, v]) => `${k} ${v.toFixed(1)}h`).join(", ")}`);

// ── 4. THE GUARD'S ASYMMETRY. delTask calls blockedByActiveClock(jobId) with
//      no opId, and THAT branch does not check `clockIn`. So an activeJobClock
//      that exists without a clockIn blocks a delete while claiming someone is
//      "logged into this job".
console.log(`\n4. blockedByActiveClock — the jobId branch does not check clockIn`);
const withJc = people.filter(p => p.activeJobClock);
const noClockIn = withJc.filter(p => !p.activeJobClock.clockIn);
console.log(`   people with a non-null activeJobClock: ${withJc.length}`);
console.log(`   ...of those, with NO clockIn (would falsely block): ${noClockIn.length}`);
noClockIn.forEach(p => console.log(`     ${p.name}: ${JSON.stringify(p.activeJobClock).slice(0, 160)}`));
const noJobId = withJc.filter(p => p.activeJobClock.jobId == null);
console.log(`   ...with no jobId at all (guard cannot match, delete proceeds): ${noJobId.length}`);
noJobId.forEach(p => console.log(`     ${p.name}: keys=${Object.keys(p.activeJobClock).join(",")}`));

// ── 5. THE CASCADE'S REACH. If a JOB is deleted, how many live sessions
//      currently reference ops inside it? That is the record that is orphaned.
console.log(`\n5. WHAT ONE JOB DELETE WOULD ORPHAN TODAY (live sessions per job)`);
const perJob = new Map();
for (const s of prod) {
  const ref = s?.opId ?? s?.jobId;
  if (ref == null) continue;
  const hit = byId.get(String(ref));
  const j = hit ? (hit.lvl === 0 ? String(hit.node.id) : hit.jobId) : null;
  if (j) perJob.set(j, (perJob.get(j) || 0) + 1);
}
const ranked = [...perJob.entries()].sort((a, b) => b[1] - a[1]);
console.log(`   jobs with at least one session attached: ${ranked.length} of ${tasks.length}`);
ranked.slice(0, 8).forEach(([j, n]) => console.log(`     ${n.toString().padStart(4)}  ${byId.get(j)?.node.title || j}`));
const totalAttached = ranked.reduce((s, [, n]) => s + n, 0);
console.log(`   total sessions that a delete could orphan: ${totalAttached}`);
