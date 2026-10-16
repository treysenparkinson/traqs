#!/usr/bin/env node
// #473 — move jobs soft-deleted more than 30 days ago out of tasks.json and into
// tasks-archive.json. ARCHIVE, NOT DROP (Trey, 2026-10-16). DRY RUN BY DEFAULT.
//
//   node scripts/archive-deleted-jobs.mjs            show the plan
//   node scripts/archive-deleted-jobs.mjs --write --expect=N   execute, guarded on ETag and count
//
// WHAT STAYS BEHIND: A STUB TOMBSTONE. Each archived job leaves
// `{ id, title, jobNumber, deletedAt, lastModifiedAt, archivedAt }` in tasks.json.
// Removing the record outright would turn off two protections that key on the
// stored tombstone being present:
//   - NO RESURRECTION. `applyExplicitWrite` (timestamps.js:216) and
//     `reconcileDeletions` (:167) refuse a stale client's live copy of a job only
//     because they find its tombstone. With the record gone, the same upsert is
//     appended as a NEW live job (:218-222) — every deleted job a stale device
//     still held would come back.
//   - EVICTION. /sync delivers tombstones so caching clients delete the row. A
//     device that has not synced since the delete still needs one to arrive.
// The stub keeps the stored `lastModifiedAt`, so no client re-downloads anything.
//
// THE ARCHIVE is `orgs/<org>/tasks-archive.json`: an array of
// `{ archivedAt, fromVersionId, job }`, appended to, never rewritten. It is
// written FIRST and read back before tasks.json is touched, so a failure between
// the two leaves a job in both places (harmless, deduped by id on re-run), never
// in neither. tasks.json is also a versioned object; the version read is printed.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const ORG = "MTX2026TRAQS";
const DAYS = 30;
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = `orgs/${ORG}/tasks.json`;
const ARCHIVE = `orgs/${ORG}/tasks-archive.json`;

const read = async (key, { missingOk = false } = {}) => {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const body = await res.Body.transformToString();
    return { data: JSON.parse(body), etag: res.ETag, versionId: res.VersionId, bytes: body.length };
  } catch (e) {
    if (missingOk && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
};

const now = Date.now();
const cutoff = now - DAYS * 86400000;
const archivedAt = new Date(now).toISOString();

const cur = await read(KEY);
const arc = await read(ARCHIVE, { missingOk: true });
const [people, prod, messages] = await Promise.all([
  read(`orgs/${ORG}/people.json`), read(`orgs/${ORG}/productionhours.json`), read(`orgs/${ORG}/messages.json`),
]);
console.log(`read ${KEY}`);
console.log(`  version ${cur.versionId}`);
console.log(`  ${cur.bytes.toLocaleString()} bytes`);
console.log(`read ${ARCHIVE}: ${arc ? `${arc.data.length} entries, version ${arc.versionId}` : "does not exist yet"}`);
console.log(`cutoff: deleted before ${new Date(cutoff).toISOString()} (${DAYS} days)\n`);

const tasks = cur.data;
if (!Array.isArray(tasks)) { console.error("REFUSING: tasks.json is not an array."); process.exit(3); }
const isStub = (j) => j && j.archivedAt && !Array.isArray(j.subs);
const bytesOf = (v) => JSON.stringify(v).length;

// ── 1. WHAT IS STORED ──────────────────────────────────────────────────────
const live = tasks.filter(j => j && !j.deletedAt);
const deleted = tasks.filter(j => j && j.deletedAt && !isStub(j));
const stubs = tasks.filter(isStub);
const due = deleted.filter(j => Date.parse(j.deletedAt) < cutoff);
const recent = deleted.filter(j => !(Date.parse(j.deletedAt) < cutoff));
const bad = deleted.filter(j => Number.isNaN(Date.parse(j.deletedAt)));
let nestedTombstones = 0;
const walk = (n) => { for (const c of (n?.subs || [])) { if (c?.deletedAt) nestedTombstones++; walk(c); } };
live.forEach(walk);

console.log("1. WHAT IS STORED");
console.log(`   top-level jobs:            ${tasks.length}`);
console.log(`   live:                      ${live.length}  (${live.reduce((s, j) => s + bytesOf(j), 0).toLocaleString()} bytes)`);
console.log(`   soft-deleted:              ${deleted.length}  (${deleted.reduce((s, j) => s + bytesOf(j), 0).toLocaleString()} bytes)`);
console.log(`     deleted > ${DAYS} days ago:   ${due.length}  <- TO ARCHIVE`);
console.log(`     deleted within ${DAYS} days:  ${recent.length}  (stay)`);
console.log(`   stubs from earlier runs:   ${stubs.length}`);
console.log(`   tombstoned panels/ops inside live jobs: ${nestedTombstones} (out of scope; not touched)`);
if (bad.length) { console.error(`\nREFUSING: ${bad.length} deleted job(s) have an unparseable deletedAt.`); process.exit(3); }

console.log(`\n   TO ARCHIVE, oldest first:`);
for (const j of [...due].sort((a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt))) {
  const age = Math.floor((now - Date.parse(j.deletedAt)) / 86400000);
  console.log(`     ${String(j.id).padEnd(11)} ${String(j.deletedAt).slice(0, 10)}  ${String(age).padStart(3)}d  `
    + `${bytesOf(j).toLocaleString().padStart(7)} B  ${j.jobNumber ? j.jobNumber + " · " : ""}${j.title || "(untitled)"}`);
}
if (recent.length) {
  const soonest = recent.map(j => Date.parse(j.deletedAt)).sort((a, b) => a - b)[0];
  console.log(`\n   STAYING (deleted within ${DAYS} days): ${recent.length}; the next becomes due `
    + `${new Date(soonest + DAYS * 86400000).toISOString().slice(0, 10)}`);
}

// ── 2. WHAT STILL POINTS AT THEM ───────────────────────────────────────────
const dueIds = new Set(due.map(j => String(j.id)));
const nodeIds = new Set();
for (const j of due) { nodeIds.add(String(j.id)); (function w(n) { for (const c of n.subs || []) { if (c?.id != null) nodeIds.add(String(c.id)); w(c); } })(j); }
const clocks = (people.data || []).filter(p => p && !p.deletedAt && p.activeJobClock
  && dueIds.has(String(p.activeJobClock.jobId)));
const prodRows = (prod.data || []).filter(r => r && !r.deletedAt && dueIds.has(String(r.jobId)));
const openRows = prodRows.filter(r => !r.clockOut);
const threadIds = (m) => { const k = String(m?.threadKey || ""); const i = k.indexOf(":"); return i < 0 ? null : k.slice(i + 1); };
const msgs = (messages.data || []).filter(m => m && !m.deletedAt && /^(job|panel|op):/.test(m.threadKey || "")
  && nodeIds.has(threadIds(m)));
console.log(`\n2. WHAT STILL POINTS AT THEM`);
console.log(`   active job clocks on one of them:   ${clocks.length}${clocks.length ? "  " + clocks.map(p => p.name).join(", ") : ""}`);
console.log(`   production-hours rows (by jobId):   ${prodRows.length}, ${prodRows.reduce((s, r) => s + (Number(r.hours) || 0), 0).toFixed(2)}h `
  + `— matched by id, unaffected; ${openRows.length} open`);
console.log(`   live messages in their job/panel/op threads: ${msgs.length} `
  + `(already hidden by GET /messages, which reads live jobs only)`);
if (clocks.length || openRows.length) {
  console.error("\nREFUSING: someone is clocked into a job this would archive."); process.exit(3);
}

// ── 3. THE PLAN ────────────────────────────────────────────────────────────
const stubOf = (j) => {
  const s = { id: j.id };
  if (j.title != null) s.title = j.title;
  if (j.jobNumber != null) s.jobNumber = j.jobNumber;
  s.deletedAt = j.deletedAt;
  if (j.lastModifiedAt != null) s.lastModifiedAt = j.lastModifiedAt;
  s.archivedAt = archivedAt;
  return s;
};
const nextTasks = tasks.map(j => (j && dueIds.has(String(j.id)) && !isStub(j)) ? stubOf(j) : j);
const already = new Set((arc?.data || []).map(e => String(e?.job?.id)));
const add = due.filter(j => !already.has(String(j.id)))
  .map(job => ({ archivedAt, fromVersionId: cur.versionId, job }));
const nextArchive = [...(arc?.data || []), ...add];
const nextBytes = bytesOf(nextTasks);

console.log(`\n3. THE PLAN`);
console.log(`   tasks.json: ${cur.bytes.toLocaleString()} -> ${nextBytes.toLocaleString()} bytes `
  + `(${((cur.bytes - nextBytes) / cur.bytes * 100).toFixed(1)}% smaller); ${due.length} job(s) become stubs `
  + `(${due.reduce((s, j) => s + bytesOf(stubOf(j)), 0).toLocaleString()} bytes of stub)`);
console.log(`   archive:    ${(arc?.data || []).length} -> ${nextArchive.length} entries, ${bytesOf(nextArchive).toLocaleString()} bytes`
  + (due.length - add.length ? ` (${due.length - add.length} already archived by an earlier run; not duplicated)` : ""));

// ── 4. SAFETY ──────────────────────────────────────────────────────────────
// Every live job byte-identical and in the same position; every archived job
// byte-identical in the archive; nothing else in the file changed.
const fail = [];
if (nextTasks.length !== tasks.length) fail.push("job count changed");
tasks.forEach((j, i) => {
  const isDue = j && dueIds.has(String(j.id));
  if (!isDue && nextTasks[i] !== j) fail.push(`position ${i} changed and was not due`);
  if (isDue && (nextTasks[i].id !== j.id || nextTasks[i].deletedAt !== j.deletedAt
    || nextTasks[i].lastModifiedAt !== j.lastModifiedAt)) fail.push(`stub ${j.id} lost its tombstone fields`);
});
const archivedById = new Map(nextArchive.map(e => [String(e.job.id), e.job]));
for (const j of due) if (bytesOf(archivedById.get(String(j.id))) !== bytesOf(j)) fail.push(`archive copy of ${j.id} differs`);
const liveAfter = nextTasks.filter(j => j && !j.deletedAt);
if (bytesOf(liveAfter) !== bytesOf(live)) fail.push("live jobs changed");
console.log(`\n4. SAFETY`);
console.log(`   live jobs ${live.length} -> ${liveAfter.length}, byte-identical: ${bytesOf(liveAfter) === bytesOf(live) ? "yes" : "NO"}`);
console.log(`   every archived job byte-identical in the archive: ${fail.some(f => f.startsWith("archive")) ? "NO" : "yes"}`);
console.log(`   every stub keeps id, deletedAt and lastModifiedAt: ${fail.some(f => f.startsWith("stub")) ? "NO" : "yes"}`);
if (fail.length) { console.error(`\nREFUSING:\n  ${fail.join("\n  ")}`); process.exit(3); }

// --expect=N: refuse unless exactly N are due — the count that was reviewed. The cutoff is
// "30 days before now", so a job can cross it between the dry run and the write.
const EXPECT = process.argv.find(a => a.startsWith("--expect="));
if (EXPECT && Number(EXPECT.slice(9)) !== due.length) {
  console.error(`\nREFUSING: ${due.length} are due, --expect said ${EXPECT.slice(9)}. Re-run the dry run.`); process.exit(3);
}
if (!WRITE) { console.log("\nDRY RUN — nothing was written. Re-run with --write."); process.exit(0); }
if (!due.length) { console.log("\nNothing is due. Not writing."); process.exit(0); }

// ── 5. WRITE: archive first, read it back, then tasks.json on its ETag ──────
const put = async (Key, Body, cond) => {
  try {
    await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key, Body, ContentType: "application/json", ...cond }));
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 412 || String(e.name).includes("PreconditionFailed")) {
      console.error(`   REFUSED: ${Key} changed since it was read.`); process.exit(2);
    }
    throw e;
  }
};
console.log("\n5. WRITING");
await put(ARCHIVE, JSON.stringify(nextArchive), arc ? { IfMatch: arc.etag } : { IfNoneMatch: "*" });
const arcBack = await read(ARCHIVE);
const backIds = new Set(arcBack.data.map(e => String(e.job.id)));
if (!due.every(j => backIds.has(String(j.id)))) { console.error("   REFUSED: archive read-back is missing a job. tasks.json NOT written."); process.exit(2); }
console.log(`   archive written and read back: ${arcBack.data.length} entries, version ${arcBack.versionId}`);
await put(KEY, JSON.stringify(nextTasks), { IfMatch: cur.etag });
const after = await read(KEY);
console.log(`   tasks.json written: version ${after.versionId}, ${after.bytes.toLocaleString()} bytes (was ${cur.bytes.toLocaleString()})`);
console.log(`   live jobs ${after.data.filter(j => j && !j.deletedAt).length}; stubs ${after.data.filter(isStub).length}`);
console.log(`\n   To undo: restore tasks.json version ${cur.versionId}.`);
