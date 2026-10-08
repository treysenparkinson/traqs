#!/usr/bin/env node
// Sweep, the duplicate path. `duplicateJob` (src/jobDetail.js) resets status,
// mints fresh ids, remaps deps and DROPS ten fields that record work done. The
// question this answers is what it does NOT drop, and whether those fields are
// actually present on Matrix's board — a field that is never set is a theory,
// a field on 18 panels is a defect.
//
//   node scripts/measure-duplicate-carry.mjs

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

// The ten it drops, from src/jobDetail.js.
const DROP = new Set(["loggedHours", "actualHours", "finishRequest", "finishRequests", "attachments",
  "signOffs", "engineering", "apprChain", "apprComments", "apprLog", "deletedAt"]);

// Every key that exists anywhere in the tree, with where it lives and how often.
const seen = new Map();   // key -> { jobs, panels, ops }
const LEVEL = ["jobs", "panels", "ops"];
const walk = (ns, lvl) => (ns || []).forEach(n => {
  if (!n || n.deletedAt) return;
  for (const k of Object.keys(n)) {
    if (!seen.has(k)) seen.set(k, { jobs: 0, panels: 0, ops: 0 });
    seen.get(k)[LEVEL[Math.min(lvl, 2)]]++;
  }
  walk(n.subs, lvl + 1);
});
walk(tasks, 0);

console.log(`${tasks.length} live jobs\n`);
console.log("KEYS A DUPLICATE CARRIES OVER (not in DROP, not structural)");
console.log("key".padEnd(26) + "jobs".padStart(6) + "panels".padStart(8) + "ops".padStart(6));
const STRUCTURAL = new Set(["id", "subs", "title", "status", "deps"]);
const carried = [...seen.entries()]
  .filter(([k]) => !DROP.has(k) && !STRUCTURAL.has(k))
  .sort((a, b) => (b[1].jobs + b[1].panels + b[1].ops) - (a[1].jobs + a[1].panels + a[1].ops));
for (const [k, c] of carried)
  console.log(k.padEnd(26) + String(c.jobs).padStart(6) + String(c.panels).padStart(8) + String(c.ops).padStart(6));

console.log("\nTHE ONES THAT RECORD SOMETHING THAT HAPPENED TO THE ORIGINAL");
for (const k of ["moveLog", "placedSubs", "pendingFinish", "completedAt", "finishedAt", "createdAt", "producedHours"]) {
  const c = seen.get(k);
  console.log(`  ${k.padEnd(20)} ${c ? `jobs ${c.jobs}, panels ${c.panels}, ops ${c.ops}` : "— absent from the board"}`);
}

// moveLog volume: how much false history would one duplicate inherit?
let logs = 0, entries = 0, worst = { title: "", n: 0 };
const ml = (ns) => (ns || []).forEach(n => {
  if (!n || n.deletedAt) return;
  if (Array.isArray(n.moveLog) && n.moveLog.length) { logs++; entries += n.moveLog.length;
    if (n.moveLog.length > worst.n) worst = { title: n.title || n.id, n: n.moveLog.length }; }
  ml(n.subs);
});
ml(tasks);
console.log(`\nmoveLog: ${logs} nodes carry one, ${entries} entries total; largest single node ${worst.n} ("${worst.title}")`);

// Per JOB — because you duplicate a job, not a node.
const perJob = tasks.map(j => {
  let e = 0, p = 0;
  const w = (ns) => (ns || []).forEach(n => { if (!n || n.deletedAt) return;
    e += (n.moveLog || []).length; if (Array.isArray(n.placedSubs)) p++; w(n.subs); });
  w([j]);
  return { title: j.title, entries: e, placed: p, pending: !!j.pendingFinish };
}).sort((a, b) => b.entries - a.entries);
console.log(`\nIF YOU DUPLICATED EACH JOB TODAY, the copy would be born carrying:`);
perJob.filter(j => j.entries || j.placed).slice(0, 12).forEach(j =>
  console.log(`  ${String(j.entries).padStart(4)} moveLog entries, ${j.placed} placedSubs   ${j.title}`));
const anyCarry = perJob.filter(j => j.entries || j.placed).length;
console.log(`  ${anyCarry} of ${tasks.length} jobs would carry at least one`);

// deps that leave the job: remap leaves these pointing at the ORIGINAL target.
const jobOf = new Map();
tasks.forEach(j => { const w = (ns) => (ns || []).forEach(n => { if (!n) return; jobOf.set(String(n.id), String(j.id)); w(n.subs); }); w([j]); });
let inside = 0, crossing = 0;
for (const [id, jid] of jobOf) {
  const node = (() => { let f = null; const w = (ns) => (ns || []).forEach(n => { if (!n) return; if (String(n.id) === id) f = n; w(n.subs); }); w(tasks); return f; })();
  for (const d of node?.deps || []) (jobOf.get(String(d)) === jid ? inside++ : crossing++);
}
console.log(`\ndeps: ${inside} inside one job (remapped onto the copy), ${crossing} crossing jobs (left pointing at the original)`);
