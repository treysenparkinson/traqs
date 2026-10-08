#!/usr/bin/env node
// #446 — the status data cure. DRY RUN BY DEFAULT.
//
//   node scripts/migrate-status-normalise.mjs            show the plan, write nothing
//   node scripts/migrate-status-normalise.mjs --write    execute, guarded
//
// WHY THIS EXISTS. `statusOpts` is a user-editable list and the stored statuses
// drifted off it. 11 jobs say `finished` where the list offers only `Finished`;
// 2 say `Procurement` where the list is misspelled `Procurment`; and the list's
// `Boxed up ` carries a trailing space. A status that is not in the list cannot
// be shown in the dropdown or selected away from, and every
// `status === "Finished"` in the product is blind to the eleven.
//
// THE RULES, ruled 2026-10-07:
//   finished      -> Finished        (11 job records move)
//   Procurment    -> Procurement     (the LIST moves; the 2 jobs are RIGHT)
//   "Boxed up "   -> "Boxed up"      (the list AND the job that matches it,
//                                     which is ONE operation, not two)
//
// THE BAR IS 2026-06-03's. Version ids captured and printed before anything is
// written; the write is CONDITIONAL on the ETag read at plan time, so a save by
// anyone between the read and the write makes it refuse rather than clobber.
//
// TWO OBJECTS, AND S3 HAS NO CROSS-OBJECT TRANSACTION. `settings.json` holds the
// list, `tasks.json` holds the records, and nothing can write both atomically.
// Settings goes FIRST, deliberately: that order immediately makes the 2
// `Procurement` jobs valid and transiently orphans ONE record (the `Boxed up `
// job) until the second write lands. Tasks-first would leave more records
// orphaned in the window. The script is idempotent, so a failure between the two
// is repaired by running it again.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = process.argv.find(a => a.startsWith("--org="))?.slice(6) || "MTX2026TRAQS";
const WRITE = process.argv.includes("--write");
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });

const K_TASKS = `orgs/${ORG}/tasks.json`;
const K_SETTINGS = `orgs/${ORG}/settings.json`;

async function readWithMeta(Key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key }));
  const body = await res.Body.transformToString();
  return { data: JSON.parse(body), etag: res.ETag, versionId: res.VersionId, bytes: body.length };
}

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const tasks = await readWithMeta(K_TASKS);
const settings = await readWithMeta(K_SETTINGS);

console.log(`#446 STATUS NORMALISE — ORG ${ORG}`);
console.log(WRITE ? "MODE: WRITE (guarded)\n" : "MODE: DRY RUN — nothing will be written\n");

console.log("1. WHAT WAS READ, AND THE VERSIONS TO ROLL BACK TO");
for (const [name, o, k] of [["tasks.json", tasks, K_TASKS], ["settings.json", settings, K_SETTINGS]]) {
  console.log(`   ${name.padEnd(14)} ${String(o.bytes).padStart(8)} B`);
  console.log(`     versionId ${o.versionId}`);
  console.log(`     etag      ${o.etag}`);
}
console.log(`   ROLLBACK: aws s3api get-object --bucket ${env.S3_BUCKET} --key <key> --version-id <id> out.json`);

// ── THE PLAN ─────────────────────────────────────────────────────────────
const opts = Array.isArray(settings.data.statusOpts) ? settings.data.statusOpts : [];
const listPlan = [];
const nextOpts = opts.map(o => {
  const name = String(o?.name ?? "");
  let to = null;
  if (name === "Procurment") to = "Procurement";          // the list is the typo
  else if (name !== name.trim()) to = name.trim();        // "Boxed up "
  if (to != null && to !== name) { listPlan.push({ from: name, to }); return { ...o, name: to }; }
  return o;
});

// A job whose status matches a list entry EXACTLY must move with that entry, or
// the edit orphans it. That is the coupling, derived rather than hardcoded.
const coupled = new Map(listPlan.map(p => [p.from, p.to]));
const known = new Map(nextOpts.map(o => [norm(o?.name), String(o?.name ?? "")]));

const jobPlan = [];
const live = (tasks.data || []).filter(j => j && !j.deletedAt);
const nextTasks = (tasks.data || []).map(j => {
  if (!j || j.deletedAt) return j;
  const cur = String(j.status ?? "");
  let to = null;
  if (coupled.has(cur)) to = coupled.get(cur);                      // moves with its list entry
  else if (cur && !known.has(norm(cur))) to = null;                 // orphan with no list match — leave, report
  else if (cur && known.get(norm(cur)) !== cur) to = known.get(norm(cur));  // same status, different spelling
  if (to != null && to !== cur) { jobPlan.push({ id: j.id, title: j.title, from: cur, to, why: coupled.has(cur) ? "coupled with its list entry" : "spelling" }); return { ...j, status: to }; }
  return j;
});

// Anything below job level, and anything still orphaned after the plan.
const deeper = [];
for (const j of live) for (const p of j.subs || []) {
  if (p && !p.deletedAt && p.status && !known.has(norm(p.status))) deeper.push(`panel ${p.title || p.id} = ${JSON.stringify(p.status)}`);
  for (const o of p?.subs || []) if (o && !o.deletedAt && o.status && !known.has(norm(o.status))) deeper.push(`op ${o.title || o.id} = ${JSON.stringify(o.status)}`);
}
const stillOrphan = nextTasks.filter(j => j && !j.deletedAt && j.status && !known.has(norm(j.status)))
  .map(j => `${j.title || j.id} = ${JSON.stringify(j.status)}`);

console.log("\n2. THE LIST — statusOpts");
console.log(`   ${opts.length} entries; ${listPlan.length} change`);
for (const p of listPlan) console.log(`     ${JSON.stringify(p.from).padEnd(16)} ->  ${JSON.stringify(p.to)}`);
if (!listPlan.length) console.log("     (none)");

console.log("\n3. THE RECORDS — jobs");
console.log(`   ${live.length} live jobs; ${jobPlan.length} change`);
const byMove = {};
for (const p of jobPlan) (byMove[`${p.from} -> ${p.to}`] ??= []).push(p);
for (const [move, rows] of Object.entries(byMove)) {
  console.log(`     ${move}   (${rows.length}, ${rows[0].why})`);
  for (const r of rows) console.log(`       ${String(r.id).padEnd(14)} ${String(r.title || "").slice(0, 46)}`);
}
if (!jobPlan.length) console.log("     (none)");

console.log("\n4. THE COUPLING, stated as one operation");
if (coupled.size) {
  for (const [from, to] of coupled) {
    const hit = jobPlan.filter(p => p.from === from);
    console.log(`   list ${JSON.stringify(from)} -> ${JSON.stringify(to)}  +  ${hit.length} record(s) matching it exactly`);
    console.log(`     -> trimming the list without these would ORPHAN them; they move together.`);
  }
} else console.log("   (no list entry moves, so nothing is coupled)");

console.log("\n5. WHAT IS NOT TOUCHED");
console.log(`   panels/ops carrying a status not in the list: ${deeper.length}`);
for (const d of deeper.slice(0, 8)) console.log(`     ${d}`);
console.log(`   jobs STILL orphaned after the plan: ${stillOrphan.length}`);
for (const d of stillOrphan.slice(0, 8)) console.log(`     ${d}`);
console.log(`   (an orphan with no list entry of the same spelling is NOT guessed at —`);
console.log(`    renaming it would be inventing intent, so it is reported instead)`);

console.log("\n6. SUMMARY");
console.log(`   settings.json: ${listPlan.length} list entr${listPlan.length === 1 ? "y" : "ies"}`);
console.log(`   tasks.json:    ${jobPlan.length} job record${jobPlan.length === 1 ? "" : "s"}`);
console.log(`   total objects written: ${(listPlan.length ? 1 : 0) + (jobPlan.length ? 1 : 0)}`);

if (!WRITE) {
  console.log("\nDRY RUN — nothing was written. Re-run with --write to execute.");
  process.exit(0);
}

// ── THE GUARDED WRITE ────────────────────────────────────────────────────
// Conditional on the ETag read above. If anyone saved in between, S3 answers
// 412 and this refuses rather than overwriting their work.
const putIfMatch = async (Key, value, etag) => {
  await s3.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET, Key, Body: JSON.stringify(value),
    ContentType: "application/json", IfMatch: etag,
  }));
};
console.log("\n7. WRITING — settings first, then tasks (see the header for why)");
try {
  if (listPlan.length) { await putIfMatch(K_SETTINGS, { ...settings.data, statusOpts: nextOpts }, settings.etag); console.log("   settings.json written"); }
  if (jobPlan.length) { await putIfMatch(K_TASKS, nextTasks, tasks.etag); console.log("   tasks.json written"); }
} catch (e) {
  if (String(e.name) === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412) {
    console.error("\n   REFUSED: the object changed since it was read. Nothing further written.");
    console.error("   Re-run the dry run and look at the plan again before retrying.");
    process.exit(2);
  }
  throw e;
}

const after = await readWithMeta(K_TASKS);
const afterOpts = (await readWithMeta(K_SETTINGS)).data.statusOpts || [];
const afterKnown = new Set(afterOpts.map(o => norm(o?.name)));
const orphansAfter = (after.data || []).filter(j => j && !j.deletedAt && j.status && !afterKnown.has(norm(j.status)));
console.log(`\n8. VERIFIED: jobs whose status is not in the list: ${orphansAfter.length}`);
for (const j of orphansAfter) console.log(`     ${j.title || j.id} = ${JSON.stringify(j.status)}`);
