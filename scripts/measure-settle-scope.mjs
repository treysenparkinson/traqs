#!/usr/bin/env node
// #415. Does the unscoped settle still move anything?
//
// `reflowJob` settles EVERY phase of a job; `enforceNoOverlap(list, touchedIds)`
// — the mechanism on every other commit path — settles only what moved. The
// scope was logged as the sharper half of #404. But #404 C narrowed WHO TAKES
// PART (`takesPart`: not tombstoned, not Finished, not wholly behind us) and
// #404 B deleted the overlap push entirely, so the question is whether anything
// is left for the scope to be wrong about.
//
// This reproduces `reflowPhaseOps`' queue rule against the live board and counts
// the ops it would move, per job, if an edit settled that job today.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = process.argv[2] || "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const tasks = (await get(`orgs/${ORG}/tasks.json`)).filter(j => j && !j.deletedAt);
const TD = new Date().toISOString().slice(0, 10);

const isDated = (n) => !!(n && n.start && n.end);
const isAssigned = (n) => Array.isArray(n?.team) && n.team.length > 0;
// `takesPart`, reproduced: live, not Finished, not wholly behind us.
const takesPart = (n) => {
  if (!n || n.deletedAt) return false;
  if (String(n.status || "").trim().toLowerCase() === "finished") return false;
  if (n.end && n.end < TD) return false;
  return true;
};

let phasesConsidered = 0, phasesWithQueue = 0, opsMoved = 0;
const movers = [];
for (const job of tasks) {
  for (const pn of job.subs || []) {
    if (!pn || pn.deletedAt) continue;
    phasesConsidered++;
    const dated = (pn.subs || []).filter(o => o && isDated(o) && takesPart(o));
    if (dated.length < 2) continue;      // reflowPhaseOps returns null here
    phasesWithQueue++;
    // The queue: ops in start order; an UNASSIGNED op cannot begin before the
    // last placed end. Assigned ops are obstacles that never move (#404 B).
    const order = [...dated].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    let placedEnd = null;
    for (const op of order) {
      if (isAssigned(op)) { if (!placedEnd || op.end > placedEnd) placedEnd = op.end; continue; }
      if (placedEnd && op.start <= placedEnd) {
        opsMoved++;
        movers.push(`${(job.title || job.id).slice(0, 24).padEnd(26)} / ${(pn.title || pn.id).slice(0, 16).padEnd(18)} / ${(op.title || op.id).slice(0, 20)}`);
      }
      if (!placedEnd || op.end > placedEnd) placedEnd = op.end;
    }
  }
}

console.log(`ORG ${ORG}  today ${TD}`);
console.log(`${tasks.length} live jobs, ${phasesConsidered} phases\n`);
console.log("1. WHAT THE SETTLE WOULD DO TODAY");
console.log(`   phases with 2+ eligible dated ops (the only ones it can touch): ${phasesWithQueue}`);
console.log(`   ops it would MOVE:                                             ${opsMoved}`);
for (const m of movers.slice(0, 12)) console.log(`     ${m}`);

console.log("\n2. WHY THE POPULATION IS SO SMALL");
let total = 0, tombstoned = 0, finished = 0, past = 0, undated = 0, eligible = 0;
for (const job of tasks) for (const pn of job.subs || []) for (const op of pn.subs || []) {
  total++;
  if (!op || op.deletedAt) { tombstoned++; continue; }
  if (String(op.status || "").trim().toLowerCase() === "finished") { finished++; continue; }
  if (!isDated(op)) { undated++; continue; }
  if (op.end < TD) { past++; continue; }
  eligible++;
}
console.log(`   ops in the tree:            ${total}`);
console.log(`   tombstoned:                 ${tombstoned}`);
console.log(`   Finished (takesPart says no): ${finished}`);
console.log(`   undated:                    ${undated}`);
console.log(`   wholly in the past:         ${past}`);
console.log(`   ELIGIBLE to be settled:     ${eligible}`);

console.log("\n3. HOW MANY PHASES COULD EVER HAVE A QUEUE");
const byPhase = {};
for (const job of tasks) for (const pn of job.subs || []) {
  if (!pn || pn.deletedAt) continue;
  const n = (pn.subs || []).filter(o => o && isDated(o) && takesPart(o)).length;
  byPhase[n] = (byPhase[n] || 0) + 1;
}
console.log(`   eligible ops per phase: ${JSON.stringify(byPhase)}`);
console.log(`   (a phase needs 2+ before reflowPhaseOps does anything at all)`);

console.log("\n4. IS THE ZERO STRUCTURAL, OR ONE EDIT AWAY?");
// The queue only ever moves an UNASSIGNED op that starts on or before the last
// placed end. So the reachable population is: phases with 2+ eligible ops, at
// least one of them unassigned.
let unassignedEligible = 0, phasesWithUnassigned = 0, phasesAllAssigned = 0;
for (const job of tasks) for (const pn of job.subs || []) {
  if (!pn || pn.deletedAt) continue;
  const dated = (pn.subs || []).filter(o => o && isDated(o) && takesPart(o));
  if (dated.length < 2) continue;
  const un = dated.filter(o => !isAssigned(o));
  unassignedEligible += un.length;
  if (un.length) phasesWithUnassigned++; else phasesAllAssigned++;
}
console.log(`   of the 7 phases with a queue:`);
console.log(`     every op assigned (nothing CAN move):     ${phasesAllAssigned}`);
console.log(`     at least one unassigned (something could): ${phasesWithUnassigned}`);
console.log(`   unassigned eligible ops across those phases: ${unassignedEligible}`);
console.log(`   -> with ${phasesAllAssigned} of 7 fully assigned, the zero is mostly STRUCTURAL:`);
console.log(`      #404 B made assigned ops obstacles that never move, so a board`);
console.log(`      where the live work is assigned has nothing for the settle to do.`);
