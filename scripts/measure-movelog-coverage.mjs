#!/usr/bin/env node
// #492. IS THE moveLog AN AUDIT TRAIL, OR JUST THE DRAG PATH'S DIARY?
//
// #490 found 12 ops whose dates changed by up to two months with no new moveLog
// entry. That is a different complaint from "the log is thin": if a material
// part of the board has moved without a record, then everything built on the log
// is protecting an incomplete one — #465's append-only guard included.
//
// TWO QUESTIONS, AND ONLY ONE OF THEM IS PROVABLE FROM THE DATA:
//
//   PROVABLE — an op that HAS a moveLog whose last entry's `toStart` is not
//   where the op now is. The log's own last word disagrees with the record it
//   describes. That is a gap, with no innocent reading.
//
//   NOT PROVABLE — an op with dates and no moveLog at all. That is exactly what
//   an op placed at creation and never moved looks like, so the count is an
//   upper bound on silent movement and is reported as one, not as damage.
//
// Leaf ops only for the strict test. A panel's and a job's dates are ROLLED UP
// from their children by `rollUpJobDates`, so their moveLog is not expected to
// describe them and counting them would manufacture a finding.
//
//   node scripts/measure-movelog-coverage.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const td = await get(`orgs/${ORG}/tasks.json`);
const jobs = (Array.isArray(td) ? td : td.tasks || []).filter(j => j && !j.deletedAt);

const ops = [], panels = [];
for (const j of jobs) for (const p of j.subs || []) {
  if (!p || p.deletedAt) continue;
  const kids = (p.subs || []).filter(o => o && !o.deletedAt);
  if (kids.length) { panels.push({ n: p, j }); kids.forEach(o => ops.push({ n: o, p, j })); }
  else ops.push({ n: p, p: null, j });            // a panel with no ops IS the leaf
}
console.log(`${jobs.length} live jobs, ${panels.length} parent panels, ${ops.length} leaf units\n`);

const dated = ops.filter(({ n }) => n.start && n.end);
const withLog = dated.filter(({ n }) => (n.moveLog || []).length);
const noLog = dated.filter(({ n }) => !(n.moveLog || []).length);

console.log("1. COVERAGE");
console.log(`   leaf units with dates:        ${dated.length} of ${ops.length}`);
console.log(`   ...carrying a moveLog:        ${withLog.length} (${(withLog.length / dated.length * 100).toFixed(1)}%)`);
console.log(`   ...carrying none:             ${noLog.length} (${(noLog.length / dated.length * 100).toFixed(1)}%)`);
console.log(`   UPPER BOUND ONLY — an op placed at creation and never moved looks`);
console.log(`   identical to one moved silently. This number cannot tell them apart.`);

// ── 2. THE PROVABLE TEST ────────────────────────────────────────────────────
// The last entry that actually states a destination. Some entries are resizes
// and carry only an end, so the newest entry with a `toStart` is the one whose
// claim about position can be checked.
const lastWithToStart = (log) => {
  for (let i = log.length - 1; i >= 0; i--) if (log[i] && log[i].toStart) return log[i];
  return null;
};
let agree = 0, disagree = 0, noClaim = 0;
const bad = [];
for (const u of withLog) {
  const e = lastWithToStart(u.n.moveLog);
  if (!e) { noClaim++; continue; }
  if (e.toStart === u.n.start) agree++;
  else { disagree++; bad.push({ u, e }); }
}
console.log(`\n2. WHERE THE LOG'S LAST WORD CAN BE CHECKED`);
console.log(`   last entry states a destination:  ${agree + disagree} of ${withLog.length}`);
console.log(`   ...and it MATCHES where the op is: ${agree}`);
console.log(`   ...and it DOES NOT:                ${disagree}  <- the log is stale here`);
console.log(`   entries that state no destination: ${noClaim}`);
bad.slice(0, 20).forEach(({ u, e }) => console.log(
  `     ${String(u.j.title).slice(0, 22).padEnd(24)} ${String(u.n.title).slice(0, 16).padEnd(18)}`
  + ` log says ${e.toStart}  op is at ${u.n.start}   (${u.n.moveLog.length} entries, last dated ${e.date || "—"})`));

// ── 3. HOW FAR OUT, and in which direction ─────────────────────────────────
if (disagree) {
  const days = bad.map(({ u, e }) => Math.round((Date.parse(u.n.start) - Date.parse(e.toStart)) / 86400000)).filter(Number.isFinite);
  days.sort((a, b) => a - b);
  console.log(`\n3. THE SIZE OF THE DISAGREEMENT`);
  console.log(`   days between the log's last destination and the op's actual start:`);
  console.log(`     min ${days[0]}, median ${days[days.length >> 1]}, max ${days[days.length - 1]}`);
  console.log(`   moved LATER than the log says: ${days.filter(d => d > 0).length}; EARLIER: ${days.filter(d => d < 0).length}`);
}

// ── 4. THE TOTAL RECORD ────────────────────────────────────────────────────
const entries = ops.reduce((s, { n }) => s + (n.moveLog || []).length, 0);
const reasons = {};
for (const { n } of ops) for (const e of n.moveLog || []) reasons[String(e.reason || "(none)")] = (reasons[String(e.reason || "(none)")] || 0) + 1;
console.log(`\n4. WHAT THE LOG DOES CONTAIN`);
console.log(`   ${entries} entries on leaf units`);
for (const [r, c] of Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10))
  console.log(`     ${String(c).padStart(4)}  ${r}`);

// ── 5. TURNING THE UPPER BOUND INTO EVIDENCE ───────────────────────────────
// "No moveLog" is consistent with "never moved", so the 91.5% proves nothing on
// its own. The version history settles it: take a version four months old and
// count the ops whose DATES CHANGED while their moveLog DID NOT GROW. That is
// movement with no record, with no innocent reading.
import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";
const KEY = `orgs/${ORG}/tasks.json`;
let vs = [], kt2, kv2;
do { const r = await s3.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: KEY, KeyMarker: kt2, VersionIdMarker: kv2 }));
  (r.Versions || []).filter(v => v.Key === KEY).forEach(v => vs.push({ id: v.VersionId, at: v.LastModified }));
  kt2 = r.NextKeyMarker; kv2 = r.NextVersionIdMarker; if (!r.IsTruncated) break; } while (true);
vs.sort((a, b) => new Date(a.at) - new Date(b.at));
const old = vs.find(v => new Date(v.at) >= new Date("2026-06-27T00:00:00Z"));
const then = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, VersionId: old.id }))).Body.transformToString());
const idx = (d) => { const m = new Map(); const w = (ns) => (ns || []).forEach(n => { if (!n) return; m.set(String(n.id), n); w(n.subs); }); (d || []).forEach(w2 => w([w2])); return m; };
const TH = idx(then);

let bothExist = 0, movedSilently = 0, movedLogged = 0, stayed = 0;
const silent = [];
for (const u of ops) {
  const was = TH.get(String(u.n.id));
  if (!was) continue;
  bothExist++;
  const dMoved = (was.start || null) !== (u.n.start || null) || (was.end || null) !== (u.n.end || null);
  const grew = (u.n.moveLog || []).length > (was.moveLog || []).length;
  if (!dMoved) { stayed++; continue; }
  if (grew) movedLogged++;
  else { movedSilently++; if (silent.length < 12) silent.push({ u, was }); }
}
console.log(`\n5. OVER FOUR MONTHS (${old.at.toISOString().slice(0, 10)} → today), for the ${bothExist} leaf units present in both`);
console.log(`   dates unchanged:            ${stayed}`);
console.log(`   MOVED, and the log grew:    ${movedLogged}`);
console.log(`   MOVED, and it did NOT:      ${movedSilently}  <- movement with no record`);
console.log(`   so of ${movedSilently + movedLogged} units that moved, ${(movedSilently / (movedSilently + movedLogged) * 100).toFixed(1)}% left no trace`);
silent.forEach(({ u, was }) => console.log(
  `     ${String(u.j.title).slice(0, 22).padEnd(24)} ${String(u.n.title).slice(0, 16).padEnd(18)} ${was.start} → ${u.n.start}   (moveLog ${(was.moveLog || []).length} → ${(u.n.moveLog || []).length})`));
