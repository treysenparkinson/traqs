#!/usr/bin/env node
// Sweep. THREE PATHS COPY A NODE, AND NO TWO AGREE ON WHAT "WORK DONE" MEANS.
//
//   duplicateJob  (src/jobDetail.js)   — DROPs ten, remaps deps, resets status
//   applySplit    (src/dragMove.js)    — strips four by destructuring, zeroes
//                                        loggedHours, clears deps, fresh moveLog
//   template save/load (TRAQS.jsx)     — clears five SCHEDULE fields and keeps
//                                        every work field there is
//
// This measures what each one would actually carry on Matrix's live board, so
// the gaps are counts rather than a reading of the code.
//
//   node scripts/measure-copy-paths.mjs

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

// What each path removes, read off the source.
const DUP = new Set(["loggedHours", "actualHours", "finishRequest", "finishRequests", "attachments",
  "signOffs", "engineering", "apprChain", "apprComments", "apprLog", "deletedAt"]);
const SPLIT = new Set(["actualHours", "pendingFinish", "pendingSession", "finishRequest",
  "loggedHours", "deps", "moveLog"]);            // last three handled by explicit overwrite
const TPL = new Set(["start", "end", "team", "status", "qty"]);

// The fields that record something that HAPPENED. A copy carrying one of these
// is claiming the copy has a history it does not have.
const WORK = ["loggedHours", "actualHours", "finishRequests", "finishRequest", "attachments",
  "signOffs", "engineering", "apprLog", "apprChain", "apprComments", "moveLog",
  "pendingFinish", "pendingSession", "finishedAt", "placedSubs"];

const ops = [], panels = [], jobs = [];
const walk = (ns, lvl) => (ns || []).forEach(n => {
  if (!n || n.deletedAt) return;
  (lvl === 0 ? jobs : lvl === 1 ? panels : ops).push(n);
  walk(n.subs, lvl + 1);
});
walk(tasks, 0);
console.log(`${jobs.length} jobs, ${panels.length} panels, ${ops.length} ops\n`);

// A field "present" means it is set to something that is not empty/false.
const has = (n, k) => {
  const v = n[k];
  if (v == null || v === false || v === "" || v === 0) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

console.log("WORK-RECORD FIELDS ON LIVE OPS, and which copy path would carry each");
console.log("field".padEnd(18) + "ops".padStart(5) + "  duplicate   split      template");
for (const k of WORK) {
  const n = ops.filter(o => has(o, k)).length;
  if (!n) continue;
  const d = DUP.has(k) ? "drops" : "CARRIES";
  const s = SPLIT.has(k) ? "drops" : "CARRIES";
  const t = TPL.has(k) ? "drops" : "CARRIES";
  console.log(k.padEnd(18) + String(n).padStart(5) + "  " + d.padEnd(11) + s.padEnd(11) + t);
}

// The split is gated on hpd > 1 and status !== Finished (the context item), so
// that is the population actually at risk, not every op.
const splittable = ops.filter(o => (o.hpd || 0) > 1 && o.status !== "Finished");
console.log(`\nSPLITTABLE OPS (hpd > 1 and not Finished — the context item's own gate): ${splittable.length} of ${ops.length}`);
for (const k of WORK) {
  if (SPLIT.has(k)) continue;
  const n = splittable.filter(o => has(o, k)).length;
  if (n) console.log(`  ${n} would hand the new half a copied "${k}"`);
}

// The plural/singular pair that decides whether a finish request looks OPEN.
const plural = ops.filter(o => Array.isArray(o.finishRequests) && o.finishRequests.length);
const stillPending = plural.filter(o => o.finishRequests.some(r => r?.status === "pending"));
console.log(`\nfinishRequests: ${plural.length} ops carry a list; ${stillPending.length} have an entry still "pending"`);
console.log(`  (pendingFinishOf rule 1 — "a pending entry exists → OPEN" — needs no mirror,`);
console.log(`   so a split copying the list reopens the request on the half nobody requested.)`);
stillPending.slice(0, 6).forEach(o => console.log(`    ${o.title}  hpd=${o.hpd} status=${o.status} entries=${o.finishRequests.length}`));

// And the mirror, measured by VALUE not key presence — the distinction that
// turns 23 into 0.
const mirrorKey = ops.filter(o => "pendingFinish" in o).length;
const mirrorTrue = ops.filter(o => o.pendingFinish === true).length;
console.log(`\npendingFinish: ${mirrorKey} ops carry the KEY, ${mirrorTrue} carry the VALUE true.`);
console.log(`  A scan that counts keys reports ${mirrorKey} and is wrong by ${mirrorKey - mirrorTrue}.`);
