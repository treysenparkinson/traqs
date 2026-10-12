#!/usr/bin/env node
// #356. WORK INSIDE A DELETED JOB STILL LOOKS LIVE TO ALMOST EVERYTHING.
//
// A delete here is a TOMBSTONE: `deletedAt` on the job, children untouched. So
// an op two levels down keeps its dates, its team and its unfinished status,
// and any traversal that does not check its ANCESTORS treats it as real work.
//
// Measured in two halves, because a population is not a site (R4): what the
// data holds, and how many traversals would see it.
//
//   node scripts/measure-deleted-job-reach.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const tasks = await get(`orgs/${ORG}/tasks.json`);
const settings = await get(`orgs/${ORG}/settings.json`);
const finished = new Set(["Finished"]);

let jobs = 0, deadJobs = 0, panels = 0, deadPanels = 0, ops = 0;
const buckets = { liveAll: [], deadSelf: [], deadAncestor: [] };
for (const job of tasks || []) {
  if (!job) continue;
  jobs++; if (job.deletedAt) deadJobs++;
  for (const panel of job.subs || []) {
    if (!panel) continue;
    panels++; if (panel.deletedAt) deadPanels++;
    for (const op of panel.subs || []) {
      if (!op) continue;
      ops++;
      const rec = { op, job, panel };
      if (op.deletedAt) buckets.deadSelf.push(rec);
      else if (job.deletedAt || panel.deletedAt) buckets.deadAncestor.push(rec);
      else buckets.liveAll.push(rec);
    }
  }
}
console.log(`tasks.json: ${jobs} jobs (${deadJobs} deleted), ${panels} panels (${deadPanels} deleted), ${ops} ops\n`);

console.log("1. OPS WHOSE ANCESTOR IS DELETED BUT WHICH ARE NOT THEMSELVES MARKED");
console.log(`   ops with a deleted job or panel above them: ${buckets.deadAncestor.length}`);
console.log(`   ops tombstoned in their own right:          ${buckets.deadSelf.length}`);
console.log(`   ops with nothing deleted anywhere above:    ${buckets.liveAll.length}`);

console.log("\n2. HOW MANY OF THOSE LOOK LIKE REAL, SCHEDULED, UNFINISHED WORK");
// The shape that gets drawn, counted, scheduled against and notified about.
const looksLive = buckets.deadAncestor.filter(r =>
  r.op.start && r.op.end && !finished.has(String(r.op.status)) );
const teamed = looksLive.filter(r => (r.op.team || []).length);
console.log(`   dated (start+end) and not Finished:   ${looksLive.length}`);
console.log(`   ...and carrying a team:               ${teamed.length}`);
const future = teamed.filter(r => r.op.end >= new Date().toISOString().slice(0, 10));
console.log(`   ...and ending today or later:         ${future.length}`);
const hoursIn = looksLive.reduce((s, r) => s + (Number(r.op.hpd) || 0), 0);
console.log(`   hpd carried by the dated+unfinished:  ${hoursIn.toFixed(2)}`);
const people = new Set();
for (const r of teamed) for (const p of r.op.team || []) people.add(String(p));
console.log(`   distinct people named on them:        ${people.size}`);

console.log("\n   the ones that end today or later — these are on somebody's board:");
for (const r of future.slice(0, 20))
  console.log(`     "${String(r.op.title || "").slice(0, 28).padEnd(28)}" ${r.op.start}→${r.op.end} hpd ${String(r.op.hpd ?? "—").padStart(5)}  in deleted job "${String(r.job.title || "").slice(0, 30)}"`);

console.log("\n3. HOW MANY TRAVERSALS WOULD SEE THEM — the sites, not the population");
// A traversal is a loop over job.subs or panel.subs. The question is whether it
// checks deletedAt on the node it is standing on, let alone its ancestors.
const files = execSync('git ls-files src netlify', { encoding: "utf8" }).split(/\r?\n/).filter(f => /\.(js|jsx)$/.test(f));
let loops = 0, guardsSelf = 0, guardsAncestor = 0;
const unguarded = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/\.subs\s*\|\|\s*\[\]|\bof\s+\w+\.subs\b|\.subs\.(map|forEach|filter|flatMap|some|every|reduce)\b/.test(line)) return;
    loops++;
    const window = lines.slice(Math.max(0, i - 3), i + 6).join("\n");
    const self = /deletedAt/.test(window);
    const anc = /filterLive|liveTree|isLiveNode|ancestorDeleted|jobOf\(.*deletedAt|parentDeleted/.test(window);
    if (anc) guardsAncestor++; else if (self) guardsSelf++; else unguarded.push(`${f}:${i + 1}  ${line.trim().slice(0, 96)}`);
  });
}
console.log(`   loops over .subs found:                       ${loops}`);
console.log(`   with a deletedAt check within 3 lines:        ${guardsSelf}`);
console.log(`   with an ancestor-aware helper nearby:         ${guardsAncestor}`);
console.log(`   with NEITHER:                                 ${unguarded.length}`);
for (const u of unguarded.slice(0, 25)) console.log(`     ${u}`);
if (unguarded.length > 25) console.log(`     … and ${unguarded.length - 25} more`);

// ── 4. DOES A DELETED JOB SHOW UP AS WORK? ───────────────────────────────
//
// The question that matters is not how many loops exist, it is whether any
// surface a person looks at counts these. One does, and it is not a regex
// guess: `TRAQS.jsx:18435` builds `allOps` as
//   tasks.flatMap(j => (j.subs || [])).flatMap(p => (p.subs || []))
// with NO deletedAt filter at any level, and `:18657` turns it into the Stats
// page's per-person count of unfinished operations:
//   allOps.filter(op => (op.team || []).includes(p.id) && op.status !== "Finished")
console.log("\n4. THE STATS PAGE'S PER-PERSON OPERATION COUNT, AS IT COMPUTES IT");
const peopleList = await get(`orgs/${ORG}/people.json`);
const nameOf = (id) => peopleList.find(p => String(p.id) === String(id))?.name || `?${id}`;
const allOps = (tasks || []).flatMap(j => (j?.subs || [])).flatMap(p => (p?.subs || []));
const liveOps = (tasks || []).filter(j => j && !j.deletedAt)
  .flatMap(j => (j.subs || []).filter(p => p && !p.deletedAt)).flatMap(p => (p.subs || []).filter(o => o && !o.deletedAt));
const countFor = (list, pid) => list.filter(op => op && (op.team || []).some(x => String(x) === String(pid)) && op.status !== "Finished").length;
console.log(`   allOps as the page builds it: ${allOps.length}   |   ancestor-filtered: ${liveOps.length}`);
console.log(`   ${"person".padEnd(10)} ${"shown".padStart(6)} ${"real".padStart(6)} ${"inflated by".padStart(12)}`);
let shownT = 0, realT = 0;
for (const p of peopleList) {
  if (!p || p.deletedAt) continue;
  const shown = countFor(allOps, p.id), real = countFor(liveOps, p.id);
  if (!shown && !real) continue;
  shownT += shown; realT += real;
  console.log(`   ${String(p.name).padEnd(10)} ${String(shown).padStart(6)} ${String(real).padStart(6)} ${String(shown - real).padStart(12)}${shown && real === 0 ? "   <- ALL OF IT" : ""}`);
}
console.log(`   ${"TOTAL".padEnd(10)} ${String(shownT).padStart(6)} ${String(realT).padStart(6)} ${String(shownT - realT).padStart(12)}`);
console.log(`   => the Stats page overstates unfinished operations by ${(100 * (shownT - realT) / Math.max(1, shownT)).toFixed(0)}%`);
