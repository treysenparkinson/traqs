#!/usr/bin/env node
// #490. What the 2026-06-26 narrowing write actually cost, four months on.
//
// #489 found an iOS save re-encoding the whole tree and dropping every key its
// model did not carry. The question now is not what it removed — that is known —
// but whether any of it came BACK. Two fields are worth asking about because
// both are visible: the hour-of-day on 25 ops, and the colour on 317 nodes.
//
// Measured by id against the version immediately before the write, so "re-set
// since" and "still bare" are distinguished rather than assumed. Nodes now under
// a deleted job are counted separately: losing a colour on a job somebody later
// deleted is not damage anybody can see.
//
//   node scripts/measure-june-strip-damage.mjs

import { S3Client, ListObjectVersionsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = "orgs/MTX2026TRAQS/tasks.json";
const STRIP = "aj3j8N_Zjkk0__fEz_9bs5Bd.EsIerqa";   // 2026-06-26T22:56:09Z

let versions = [], kt, kv;
do {
  const r = await s3.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: KEY, KeyMarker: kt, VersionIdMarker: kv }));
  (r.Versions || []).filter(v => v.Key === KEY).forEach(v => versions.push({ id: v.VersionId, at: v.LastModified }));
  kt = r.NextKeyMarker; kv = r.NextVersionIdMarker;
  if (!r.IsTruncated) break;
} while (true);
versions.sort((a, b) => new Date(a.at) - new Date(b.at));
const si = versions.findIndex(v => v.id === STRIP);
if (si < 1) { console.error("the strip version was not found in the history"); process.exit(2); }

const get = async (v) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, ...(v ? { VersionId: v } : {}) }))).Body.transformToString());
const GOOD = versions[si - 1];
console.log(`the version before the strip: ${GOOD.at.toISOString()}  (${GOOD.id})`);
console.log(`the strip:                    ${versions[si].at.toISOString()}\n`);

const before = await get(GOOD.id);
const now = await get(null);

// Index both, tracking whether a node sits under a deleted ancestor NOW.
const index = (d) => {
  const m = new Map();
  const w = (ns, deadAbove, jobTitle) => (ns || []).forEach(n => {
    if (!n) return;
    const dead = deadAbove || !!n.deletedAt;
    m.set(String(n.id), { n, dead, job: jobTitle });
    w(n.subs, dead, jobTitle);
  });
  (d || []).forEach(j => w([j], false, j.title));
  return m;
};
const B = index(before), N = index(now);

const report = (label, had, has) => {
  const lost = [...B.entries()].filter(([, v]) => had(v.n));
  console.log(`\n═══ ${label} ═══`);
  console.log(`  carried it before the strip: ${lost.length}`);
  let gone = 0, back = 0, deleted = 0, vanished = 0;
  const bare = [];
  for (const [id, v] of lost) {
    const cur = N.get(id);
    if (!cur) { vanished++; continue; }
    if (cur.dead) { deleted++; continue; }
    if (has(cur.n)) back++;
    else { gone++; bare.push({ job: cur.job, title: cur.n.title, was: had(v.n) }); }
  }
  console.log(`  STILL BARE on a live node:   ${gone}`);
  console.log(`  re-set since:                ${back}`);
  console.log(`  now under a deleted job:     ${deleted}`);
  console.log(`  no longer in the tree:       ${vanished}`);
  return bare;
};

const bareHours = report("HOUR OF DAY (startHour / endHour)",
  (n) => n.startHour != null || n.endHour != null,
  (n) => n.startHour != null || n.endHour != null);
bareHours.slice(0, 30).forEach(b => console.log(`      ${String(b.job).slice(0, 26).padEnd(28)} ${b.title}`));

const bareColour = report("COLOUR",
  (n) => !!n.color,
  (n) => !!n.color);
console.log(`  a sample of the live ones still without one:`);
bareColour.slice(0, 12).forEach(b => console.log(`      ${String(b.job).slice(0, 26).padEnd(28)} ${b.title}`));

// The board today, for context: how many live nodes have a colour at all?
let liveNodes = 0, liveColoured = 0, liveHours = 0;
for (const [, v] of N) { if (v.dead) continue; liveNodes++; if (v.n.color) liveColoured++; if (v.n.startHour != null) liveHours++; }
console.log(`\n═══ THE BOARD TODAY ═══`);
console.log(`  live nodes: ${liveNodes}`);
console.log(`  with a colour: ${liveColoured} (${(liveColoured / liveNodes * 100).toFixed(1)}%)`);
console.log(`  with a startHour: ${liveHours} (${(liveHours / liveNodes * 100).toFixed(1)}%)`);

// And what the other two strips' fields look like now, for completeness.
let rd = 0, dm = 0;
for (const [, v] of N) { if (v.dead) continue; if (v.n.requiredDepartment) rd++; if (v.n.depsMode) dm++; }
console.log(`  with a requiredDepartment (the legacy single name): ${rd}`);
console.log(`  with a depsMode: ${dm}`);

// ── IS THE OLD HOUR STILL THE RIGHT HOUR? ───────────────────────────────────
// An hour only means something against the dates it was set for. If an op has
// been moved since June, the June hour describes a placement that no longer
// exists and restoring it would be inventing data, not recovering it.
console.log(`\n═══ ARE THE 16 STILL WHERE THEY WERE? ═══`);
let same = 0, moved = 0;
for (const [id, v] of B) {
  if (v.n.startHour == null && v.n.endHour == null) continue;
  const cur = N.get(id);
  if (!cur || cur.dead) continue;
  if (cur.n.startHour != null || cur.n.endHour != null) continue;   // re-set
  const unchanged = v.n.start === cur.n.start && v.n.end === cur.n.end;
  if (unchanged) same++; else moved++;
  console.log(`  ${unchanged ? "SAME DATES " : "MOVED SINCE"}  ${String(cur.job).slice(0,24).padEnd(26)} ${String(cur.n.title).padEnd(10)}`
    + ` hours were ${v.n.startHour}→${v.n.endHour};  dates ${v.n.start}..${v.n.end}  now ${cur.n.start}..${cur.n.end}`
    + `  moveLog entries since: ${(cur.n.moveLog || []).length - (v.n.moveLog || []).length}`);
}
console.log(`\n  ${same} still on their June dates (the hour would still describe them)`);
console.log(`  ${moved} have moved since (the June hour describes a placement that no longer exists)`);
