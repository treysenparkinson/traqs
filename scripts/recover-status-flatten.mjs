#!/usr/bin/env node
// RECOVERY for the 2026-10-08 00:29:17Z status flatten (#447 firing in
// production), plus #446's two list entries. DRY RUN BY DEFAULT.
//
//   node scripts/recover-status-flatten.mjs            show the plan, write nothing
//   node scripts/recover-status-flatten.mjs --write    execute, guarded on ETag
//
// WHAT HAPPENED. One iOS save — Max uploading a photo to panel 401944-03 (5) E —
// re-encoded the whole `[Job]` array through a model that types `status` as a
// five-case enum. 39 jobs whose status was outside those five decoded as
// `.notStarted` and were written back that way. The same write stripped the
// hour and team fields from all 279 moveLog entries, because Swift's MoveLogEntry
// models a subset too.
//
// WHY NOT A FILE ROLLBACK. The same write carried a REAL attachment upload.
// Restoring the whole object to the good version would delete Max's photo. So
// this restores FIELD BY FIELD, keyed by id, onto the current file.
//
// SCOPE, deliberately narrow: the 39 job statuses, and #446's two list entries.
// The moveLog damage is reported but NOT restored here — it was found while
// confirming the cascade, it is beyond what was approved, and widening a
// production write without saying so first is how the next incident starts.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const ORG = "MTX2026TRAQS";
const GOOD = "_G1jj8FEpnGatFFaEEfQHIMnXVy0bsgB";    // 2026-10-07T22:58:16Z
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const K_TASKS = `orgs/${ORG}/tasks.json`, K_SETTINGS = `orgs/${ORG}/settings.json`;

const readMeta = async (Key, VersionId) => {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key, ...(VersionId ? { VersionId } : {}) }));
  const body = await res.Body.transformToString();
  return { data: JSON.parse(body), etag: res.ETag, versionId: res.VersionId, bytes: body.length };
};
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const good = await readMeta(K_TASKS, GOOD);
const cur = await readMeta(K_TASKS);
const set = await readMeta(K_SETTINGS);

console.log(`RECOVERY — ORG ${ORG}`);
console.log(WRITE ? "MODE: WRITE (guarded on ETag)\n" : "MODE: DRY RUN — nothing will be written\n");
console.log("1. VERSIONS");
console.log(`   restoring FROM  ${GOOD}  (2026-10-07T22:58:16Z, ${good.bytes} B)`);
console.log(`   applying ONTO   ${cur.versionId}  (${cur.bytes} B)`);
console.log(`   settings.json   ${set.versionId}  (${set.bytes} B)`);
console.log(`   rollback: aws s3api get-object --bucket ${env.S3_BUCKET} --key <key> --version-id <id> out.json`);

// ── the 39 statuses ──────────────────────────────────────────────────────
const goodJobs = new Map((good.data || []).filter(j => j && !j.deletedAt).map(j => [String(j.id), j]));
const plan = [];
const nextTasks = (cur.data || []).map(j => {
  if (!j || j.deletedAt) return j;
  const g = goodJobs.get(String(j.id));
  if (!g) return j;                                   // created after the incident
  if (String(g.status) === String(j.status)) return j;
  plan.push({ id: j.id, title: j.title, from: String(j.status), to: String(g.status) });
  return { ...j, status: g.status };
});

console.log(`\n2. THE ${plan.length} JOB STATUSES TO RESTORE`);
console.log(`   ${"job".padEnd(40)} ${"now".padEnd(16)} ->  restored`);
for (const p of plan) console.log(`   ${String(p.title || p.id).slice(0, 38).padEnd(40)} ${JSON.stringify(p.from).padEnd(16)} ->  ${JSON.stringify(p.to)}`);

// Sanity: nothing else may move. Compare canonically so key order is not noise.
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null"
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
let otherChanges = 0;
for (let i = 0; i < (cur.data || []).length; i++) {
  const a = cur.data[i], b = nextTasks[i];
  if (!a || !b) continue;
  const sa = { ...a, status: undefined }, sb = { ...b, status: undefined };
  if (canon(sa) !== canon(sb)) otherChanges++;
}
console.log(`   fields other than status that this plan would change: ${otherChanges}`);

// ── #446's two list entries ──────────────────────────────────────────────
const opts = Array.isArray(set.data.statusOpts) ? set.data.statusOpts : [];
const listPlan = [];
const nextOpts = opts.map(o => {
  const name = String(o?.name ?? "");
  let to = null;
  if (name === "Procurment") to = "Procurement";
  else if (name !== name.trim()) to = name.trim();
  if (to != null && to !== name) { listPlan.push({ from: name, to }); return { ...o, name: to }; }
  return o;
});
console.log(`\n3. #446 — THE LIST (${listPlan.length} of ${opts.length} entries)`);
for (const p of listPlan) console.log(`   ${JSON.stringify(p.from).padEnd(16)} ->  ${JSON.stringify(p.to)}`);

// ── the coupling, after the restore ──────────────────────────────────────
const known = new Map(nextOpts.map(o => [norm(o?.name), String(o?.name ?? "")]));
const orphanAfter = nextTasks.filter(j => j && !j.deletedAt && j.status && !known.has(norm(j.status)));
const spellAfter = nextTasks.filter(j => j && !j.deletedAt && j.status && known.has(norm(j.status)) && known.get(norm(j.status)) !== String(j.status));
console.log(`\n4. AFTER BOTH WRITES`);
console.log(`   jobs whose status is not in the list at all: ${orphanAfter.length}`);
for (const j of orphanAfter.slice(0, 6)) console.log(`     ${j.title || j.id} = ${JSON.stringify(j.status)}`);
console.log(`   jobs matching a list entry in a DIFFERENT spelling: ${spellAfter.length}`);
for (const j of spellAfter.slice(0, 14)) console.log(`     ${String(j.title || j.id).slice(0, 34).padEnd(36)} ${JSON.stringify(String(j.status))}  vs list ${JSON.stringify(known.get(norm(j.status)))}`);
console.log(`   (these are #446's RECORD half, which the flatten destroyed and this`);
console.log(`    restore brings back. Merging them is a SEPARATE decision — not done`);
console.log(`    here, because restoring and then immediately rewriting the same`);
console.log(`    records in one pass hides which write did what.)`);

const counts = (arr) => { const c = {}; for (const j of (arr || []).filter(x => x && !x.deletedAt)) c[String(j.status)] = (c[String(j.status)] || 0) + 1; return c; };
const after = counts(nextTasks);
console.log(`\n5. EXPECTED END STATE`);
console.log(`   live jobs: ${(nextTasks || []).filter(j => j && !j.deletedAt).length}`);
console.log(`   distinct statuses: ${Object.keys(after).length}`);
console.log(`   Not Started: ${after["Not Started"] ?? 0}`);

if (!WRITE) { console.log("\nDRY RUN — nothing was written. Re-run with --write."); process.exit(0); }

const putIfMatch = (Key, value, etag) => s3.send(new PutObjectCommand({
  Bucket: env.S3_BUCKET, Key, Body: JSON.stringify(value), ContentType: "application/json", IfMatch: etag }));
console.log("\n6. WRITING");
try {
  if (plan.length) { await putIfMatch(K_TASKS, nextTasks, cur.etag); console.log(`   tasks.json written (${plan.length} statuses restored)`); }
  if (listPlan.length) { await putIfMatch(K_SETTINGS, { ...set.data, statusOpts: nextOpts }, set.etag); console.log(`   settings.json written (${listPlan.length} list entries)`); }
} catch (e) {
  if (e.$metadata?.httpStatusCode === 412 || String(e.name).includes("PreconditionFailed")) {
    console.error("\n   REFUSED: the object changed since it was read. Nothing further written.");
    process.exit(2);
  }
  throw e;
}
const v = counts((await readMeta(K_TASKS)).data);
console.log(`\n7. VERIFIED FROM S3`);
console.log(`   live jobs: ${Object.values(v).reduce((a, b) => a + b, 0)}`);
console.log(`   distinct statuses: ${Object.keys(v).length}`);
console.log(`   Not Started: ${v["Not Started"] ?? 0}`);
