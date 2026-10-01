#!/usr/bin/env node
// Bring every op's three finish-request representations into agreement (#174).
//
// finishRequests[] is authoritative; pendingFinish is a mirror; the singular finishRequest is
// no longer written. This reconciles what is already stored, by exactly the rule
// pendingFinishOf() applies at read time — the same function, so a migration and a render
// cannot disagree about which requests are open.
//
//   1. a pending entry exists                      → open
//   2. pendingFinish true, list EMPTY              → open, and an entry is synthesised,
//                                                    because the flag is the only witness to
//                                                    a real request and dropping it loses one
//   3. pendingFinish true, every entry resolved     → closed, mirror cleared
//
// Plus: a singular pointer that dangles or points at a resolved entry is residue and goes.
// One still pointing at a live pending entry is left alone — records carrying it are read by
// code that has not moved over yet.
//
// On Matrix today this is a NO-OP: 0 open requests, 0 dangling pointers, 0 mirrors to flip.
// It is written and run anyway, because the only moment a three-way migration is free is
// while all three are empty, and a migration that has never run on real data is not a
// migration — it is an untested script that will be trusted at the worst possible time.
//
//   node scripts/normalize-finish-requests.mjs                 # dry run, the default
//   node scripts/normalize-finish-requests.mjs --apply
//   node scripts/normalize-finish-requests.mjs --org OTHERORG
//
// Idempotent: normalizeFinishState returns null when nothing needs changing, so a second run
// writes nothing at all.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { normalizeFinishState, normalizeReason, pendingFinishOf, pendingEntriesOf } from "../src/finishRequests.js";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes("--apply");
const ORG = val("--org", "MTX2026TRAQS");

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = `orgs/${ORG}/tasks.json`;

const tasks = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY }))).Body.transformToString());
console.log(`org ${ORG}: ${tasks.length} jobs`);
console.log(APPLY ? "MODE: APPLY — tasks.json will be written\n" : "MODE: dry run — nothing will be written\n");

const changes = [];
const walk = (node, level, path) => {
  const next = normalizeFinishState(node);
  let out = node;
  if (next) {
    changes.push({ level, path, id: String(node.id), why: normalizeReason(node), next });
    out = { ...node, ...next };
  }
  if (Array.isArray(node.subs)) {
    const subs = node.subs.map((c) => walk(c, level === "job" ? "panel" : "op", `${path} / ${c.title || c.id}`));
    if (subs.some((c, i) => c !== node.subs[i])) out = { ...out, subs };
  }
  return out;
};
const next = tasks.map((j) => walk(j, "job", j.title || String(j.id)));

// Census first, so a no-op run still tells you the state it found rather than just "0".
let ops = 0, withData = 0, open = 0, pendingEntries = 0, singular = 0;
for (const job of tasks) for (const panel of (job.subs || [])) for (const op of (panel.subs || [])) {
  ops++;
  const list = op.finishRequests || [];
  if (list.length || op.pendingFinish !== undefined || op.finishRequest) withData++;
  if (pendingFinishOf(op)) open++;
  pendingEntries += pendingEntriesOf(op).length;
  if (op.finishRequest) singular++;
}
console.log(`${ops} ops; ${withData} carry finish-request data; ${open} open by the rule; ${pendingEntries} pending entries; ${singular} still carry the singular pointer`);

if (!changes.length) {
  console.log("\nNothing to normalise — all three representations already agree.");
  console.log("That is the expected result today, and the reason to run it today.");
  process.exit(0);
}
console.log(`\n${changes.length} nodes to normalise:\n`);
for (const c of changes.slice(0, 40))
  console.log(`  ${c.level.padEnd(5)} ${c.path.slice(0, 58).padEnd(58)}  ${c.why.join("; ")}`);
if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`);

if (!APPLY) { console.log("\nDry run. Re-run with --apply to write."); process.exit(0); }

if (!Array.isArray(next) || next.length !== tasks.length) { console.error("refusing: shape changed"); process.exit(1); }
await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, Body: JSON.stringify(next), ContentType: "application/json" }));
console.log(`\nWROTE ${KEY} — ${changes.length} nodes normalised.`);
console.log("S3 versioning is on; the previous version is one restore away.");
