#!/usr/bin/env node
// #461 + #462 — remove the two scratch fields that were fixed at the SOURCE but
// left behind in the stored tree. DRY RUN BY DEFAULT.
//
//   node scripts/cleanup-scratch-residue.mjs            show the plan
//   node scripts/cleanup-scratch-residue.mjs --write    execute, guarded on ETag
//
// #461 `placedSubs` — replan scratch on 18 LIVE panels (16,417 bytes); a
//      further 230 sit under soft-deleted jobs (90,745). Nothing reads it:
//      `resultSubs` rebuilds it fresh every run. `newSubs` no longer writes it.
// #462 `_rescheduleStartDate` — the schedule modal's local date input, on
//      4 live jobs, 48 bytes. `stripDerived` now drops leading-underscore keys,
//      so no new write carries it.
//
// Both are inert, so this is a size and hygiene write, not a correctness one.
// That is exactly why the refusal below is strict: a write with nothing to gain
// should be incapable of costing anything. The plan must differ from what is
// stored in NOTHING BUT the removal of those two keys, proved by deep-comparing
// both sides with the keys stripped, and the write is guarded on the ETag.
//
// `_cc_<uuid>` keys are custom-column VALUES and real data (#462). They begin
// with an underscore and are not touched here — only the one exact key name is.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

// SCOPE. By default this touches LIVE nodes only — a node is live when neither
// it nor any ancestor carries `deletedAt`. That is deliberate and it is the
// scope that was authorised: 18 panels and 4 jobs.
//
// The same two keys sit on 230 more panels and 1 more job underneath 49
// SOFT-DELETED jobs, worth 90,757 further bytes. Removing them is no less safe
// — the keys are equally inert there — but it is a different decision, because
// those 49 jobs are 415,265 bytes, 60.5% of the file, and if they are going to
// be purged then cleaning scratch out of them first is wasted work. `--include-
// deleted` does the wider pass; nothing here decides the retention question.
const WRITE = process.argv.includes("--write");
const WIDE = process.argv.includes("--include-deleted");
const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = `orgs/${ORG}/tasks.json`;
const DROP = ["placedSubs", "_rescheduleStartDate"];

const readMeta = async () => {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY }));
  const body = await res.Body.transformToString();
  return { data: JSON.parse(body), etag: res.ETag, versionId: res.VersionId, bytes: body.length };
};

const cur = await readMeta();
console.log(`read ${KEY}`);
console.log(`  version ${cur.versionId}`);
console.log(`  ${cur.bytes.toLocaleString()} bytes\n`);

// ── 1. WHAT IS THERE, named, before anything is built ──────────────────────
const found = { placedSubs: [], _rescheduleStartDate: [] };
const skipped = { placedSubs: 0, _rescheduleStartDate: 0 };
let skippedBytes = 0;
const LEVEL = ["job", "panel", "op"];
const survey = (nodes, lvl, path, anc) => (nodes || []).forEach((n) => {
  if (!n || typeof n !== "object") return;
  const dead = anc || !!n.deletedAt;
  const here = [...path, n.title || n.id];
  for (const k of DROP) if (k in n) {
    const bytes = JSON.stringify(n[k]).length;
    if (dead && !WIDE) { skipped[k]++; skippedBytes += bytes; continue; }
    found[k].push({ level: LEVEL[Math.min(lvl, 2)], path: here.join(" / "), bytes, dead,
      detail: k === "placedSubs" ? `${Array.isArray(n[k]) ? n[k].length : "?"} entries` : JSON.stringify(n[k]) });
  }
  survey(n.subs, lvl + 1, here, dead);
});
survey(cur.data, 0, [], false);

console.log(`1. WHAT IS STORED  (scope: ${WIDE ? "live AND soft-deleted" : "LIVE NODES ONLY"})`);
for (const k of DROP) {
  const f = found[k];
  const bytes = f.reduce((s, x) => s + x.bytes, 0);
  console.log(`\n   ${k} — ${f.length} node(s), ${bytes.toLocaleString()} bytes`);
  f.forEach(x => console.log(`     [${x.level}]${x.dead ? " (deleted)" : ""} ${x.path}  (${x.detail})`));
}
if (!WIDE && (skipped.placedSubs || skipped._rescheduleStartDate))
  console.log(`\n   LEFT ALONE, under soft-deleted jobs: `
    + `${skipped.placedSubs} placedSubs + ${skipped._rescheduleStartDate} _rescheduleStartDate, `
    + `${skippedBytes.toLocaleString()} bytes. Re-run with --include-deleted to take them too.`);

// ── 2. BUILD THE PLAN ──────────────────────────────────────────────────────
let removals = 0;
const clean = (nodes, anc) => (nodes || []).map((n) => {
  if (!n || typeof n !== "object") return n;
  const dead = anc || !!n.deletedAt;
  let next = n;
  if (WIDE || !dead) {
    for (const k of DROP) if (k in next) {
      const { [k]: _gone, ...rest } = next;
      next = rest; removals++;
    }
  }
  if (Array.isArray(n.subs)) {
    const subs = clean(n.subs, dead);
    if (subs.some((s, i) => s !== n.subs[i])) { if (next === n) next = { ...n }; next.subs = subs; }
  }
  return next;
});
const nextTasks = clean(cur.data, false);
const nextBytes = JSON.stringify(nextTasks).length;

console.log(`\n2. THE PLAN`);
console.log(`   keys removed: ${removals}`);
console.log(`   ${cur.bytes.toLocaleString()} -> ${nextBytes.toLocaleString()} bytes`
  + `  (${(cur.bytes - nextBytes).toLocaleString()} saved, `
  + `${((cur.bytes - nextBytes) / cur.bytes * 100).toFixed(1)}% of the file)`);

// ── 3. THE REFUSAL. Strip the two keys from BOTH sides and require the rest to
//      be identical, so the plan is incapable of changing anything else.
const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) { if (DROP.includes(k)) continue; o[k] = strip(v[k]); }
    return o;
  }
  return v;
};
const same = JSON.stringify(strip(cur.data)) === JSON.stringify(strip(nextTasks));
console.log(`\n3. SAFETY`);
console.log(`   everything except the two keys is byte-identical: ${same ? "yes" : "NO"}`);
// Counted separately for live and soft-deleted, so the scope is visible rather
// than asserted: a live-only run must take every live one and no deleted one.
const stillThere = (d, want) => { let n = 0; const w = (x, anc) => { if (!x || typeof x !== "object") return;
  const dead = anc || !!x.deletedAt;
  if (dead === want) for (const k of DROP) if (k in x) n++;
  (x.subs || []).forEach(c => w(c, dead)); };
  (d || []).forEach(x => w(x, false)); return n; };
console.log(`   on live nodes      now ${stillThere(cur.data, false)}  ->  after ${stillThere(nextTasks, false)}`);
console.log(`   under deleted jobs now ${stillThere(cur.data, true)}  ->  after ${stillThere(nextTasks, true)}`);
if (!WIDE && stillThere(nextTasks, false) !== 0) {
  console.error("\nREFUSING: a live-scope run left a live occurrence behind."); process.exit(3);
}
if (!WIDE && stillThere(nextTasks, true) !== stillThere(cur.data, true)) {
  console.error("\nREFUSING: a live-scope run touched something under a deleted job."); process.exit(3);
}
const live = (d) => (d || []).filter(j => j && !j.deletedAt).length;
console.log(`   live jobs ${live(cur.data)} -> ${live(nextTasks)}`);

if (!same) { console.error("\nREFUSING: the plan would change something other than the two keys."); process.exit(3); }
if (!WRITE) { console.log("\nDRY RUN — nothing was written. Re-run with --write."); process.exit(0); }
if (removals === 0) { console.log("\nNothing to remove. Not writing."); process.exit(0); }

console.log("\n4. WRITING");
try {
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY,
    Body: JSON.stringify(nextTasks), ContentType: "application/json", IfMatch: cur.etag }));
  console.log("   tasks.json written");
} catch (e) {
  if (e.$metadata?.httpStatusCode === 412 || String(e.name).includes("PreconditionFailed")) {
    console.error("   REFUSED: the object changed since it was read. Nothing written.");
    process.exit(2);
  }
  throw e;
}

const after = await readMeta();
console.log(`\n5. VERIFIED FROM S3`);
console.log(`   version ${after.versionId}`);
console.log(`   ${after.bytes.toLocaleString()} bytes (was ${cur.bytes.toLocaleString()})`);
console.log(`   occurrences — live ${stillThere(after.data, false)}, under deleted jobs ${stillThere(after.data, true)}`);
console.log(`   live jobs: ${live(after.data)}`);
const ml = (d) => { let n = 0; const w = (x) => { if (!x) return; n += (x.moveLog || []).length; (x.subs || []).forEach(w); }; (d || []).forEach(w); return n; };
console.log(`   moveLog entries: ${ml(after.data)} (was ${ml(cur.data)})`);
