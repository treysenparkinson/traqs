#!/usr/bin/env node
// #384, targeted. Lists people.json's versions by METADATA ONLY (fast), then
// loads just the handful bracketing a given instant. The full bisect is far too
// slow to run over every version once the bucket has thousands.
//
//   node scripts/measure-pin-window.mjs [ISO instant] [span] [ORG]

import { S3Client, ListObjectVersionsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const AT = new Date(process.argv[2] || "2026-08-12T21:26:28Z");
const SPAN = Number(process.argv[3] || 6);
const ORG = process.argv[4] || "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = `orgs/${ORG}/people.json`;

const all = [];
let keyMarker, verMarker, truncated = true, pages = 0;
while (truncated) {
  const page = await s3.send(new ListObjectVersionsCommand({
    Bucket: env.S3_BUCKET, Prefix: KEY, KeyMarker: keyMarker, VersionIdMarker: verMarker }));
  for (const v of page.Versions || []) if (v.Key === KEY) all.push(v);
  truncated = !!page.IsTruncated;
  keyMarker = page.NextKeyMarker; verMarker = page.NextVersionIdMarker;
  pages++;
}
all.sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
const first = all[0]?.LastModified, last = all[all.length - 1]?.LastModified;
console.log(`${KEY}`);
console.log(`${all.length} versions over ${pages} pages`);
console.log(`oldest retained: ${first?.toISOString?.().slice(0, 19)}`);
console.log(`newest:          ${last?.toISOString?.().slice(0, 19)}`);

if (AT < first) {
  console.log(`\nTHE REQUESTED INSTANT (${AT.toISOString().slice(0, 19)}) PREDATES THE OLDEST`);
  console.log(`RETAINED VERSION. S3 versioning cannot answer this one — the write is`);
  console.log(`beyond the retention window, so the forensic route used for #349 is`);
  console.log(`closed and the question has to be answered from the CODE instead.`);
  process.exit(0);
}

let i = all.findIndex(v => new Date(v.LastModified) >= AT);
if (i < 0) i = all.length - 1;
const lo = Math.max(0, i - SPAN), hi = Math.min(all.length, i + SPAN);
const load = async (v) => {
  const body = await (await s3.send(new GetObjectCommand({
    Bucket: env.S3_BUCKET, Key: KEY, VersionId: v.VersionId }))).Body.transformToString();
  try { return JSON.parse(body); } catch { return null; }
};
const live = (a) => (Array.isArray(a) ? a : []).filter(p => p && !p.deletedAt);

console.log(`\nVERSIONS AROUND ${AT.toISOString().slice(0, 19)}\n`);
let prev = null;
for (const v of all.slice(lo, hi)) {
  const d = await load(v);
  const L = live(d);
  const withPin = L.filter(p => p.pin);
  const when = v.LastModified.toISOString().slice(0, 19);
  console.log(`${when}  live ${String(L.length).padStart(3)}  pins ${String(withPin.length).padStart(2)}  ${String(v.Size).padStart(6)} B`);
  if (prev) {
    const bMap = new Map(live(prev).map(p => [String(p.id), p]));
    const aMap = new Map(L.map(p => [String(p.id), p]));
    for (const [id, b] of bMap) {
      const a = aMap.get(id);
      if (b.pin && (!a || !a.pin)) console.log(`      LOST PIN: ${b.name || id}${a ? "" : "  (id no longer present)"}`);
    }
    const goneIds = [...bMap.keys()].filter(k => !aMap.has(k));
    const newIds = [...aMap.keys()].filter(k => !bMap.has(k));
    if (goneIds.length) console.log(`      ids gone:  ${goneIds.join(" ")}`);
    if (newIds.length) console.log(`      ids added: ${newIds.join(" ")}`);
  }
  prev = d;
}
