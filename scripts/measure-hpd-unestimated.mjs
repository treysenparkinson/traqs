#!/usr/bin/env node
// #301 / #447 residual — IS ANYONE STILL SAVING FROM A STALE iOS BUILD?
//
// The rule-event log can't say (#301, read 2026-10-13): its hpd detector fires only
// on a node whose STORED hpd is absent, and the log has recorded nothing since
// 2026-10-06. This reads tasks.json directly instead. READ-ONLY: GETs and a version
// listing, nothing written.
//
//   1. NOW — how many units carry no hpd, 0, or exactly 7.5. If none carry no hpd,
//      the logger's detector cannot fire, whoever saves.
//   2. HISTORY — every stored version since 88e1ce6 (2026-09-30), diffed against the
//      one before it. Two signatures, each a whole-array save from a narrowing build:
//        • hpd absent → 7.5 on a node   (a build older than 88e1ce6, #301)
//        • a status iOS's old enum couldn't hold → "Not Started"   (older than #447)
//      A version showing either is a stale build saving, with the time it did.
//
//   node scripts/measure-hpd-unestimated.mjs [--org MTX2026TRAQS] [--since 2026-09-30]
import { S3Client, GetObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ORG = val("--org", "MTX2026TRAQS");
const SINCE = new Date(val("--since", "2026-09-30T18:54:25Z"));   // 88e1ce6
const KEY = `orgs/${ORG}/tasks.json`;

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (VersionId) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, ...(VersionId ? { VersionId } : {}) }))).Body.transformToString());

const FIVE = new Set(["Not Started", "Pending", "In Progress", "On Hold", "Finished"]);
const nodes = (td) => {
  const out = new Map();
  for (const j of (Array.isArray(td) ? td : td?.tasks || [])) {
    if (!j || j.id == null) continue;
    out.set(String(j.id), { n: j, level: "job" });
    for (const p of j.subs || []) {
      if (!p || p.id == null) continue;
      out.set(String(p.id), { n: p, level: "panel" });
      for (const o of p.subs || []) if (o && o.id != null) out.set(String(o.id), { n: o, level: "op" });
    }
  }
  return out;
};

// ── 1. NOW ──
const now = nodes(await get());
const tally = { absent: 0, zero: 0, sevenFive: 0, other: 0 };
for (const { n } of now.values()) {
  if (n.deletedAt) continue;
  if (n.hpd === undefined || n.hpd === null) tally.absent++;
  else if (n.hpd === 0) tally.zero++;
  else if (n.hpd === 7.5) tally.sevenFive++;
  else tally.other++;
}
console.log(`1. NOW — ${KEY}, live nodes by hpd`);
console.log(`   no hpd ${tally.absent} · 0 ${tally.zero} · 7.5 ${tally.sevenFive} · other ${tally.other}`);
console.log(tally.absent === 0
  ? "   No node lacks hpd, so the rule-event detector (stored hpd absent → 7.5) CANNOT fire."
  : `   ${tally.absent} node(s) lack hpd, so a stale build saving now WOULD trip the detector.`);

// ── 2. HISTORY ──
const versions = [];
let KeyMarker, VersionIdMarker;
do {
  const r = await s3.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: KEY, KeyMarker, VersionIdMarker }));
  for (const v of r.Versions || []) if (v.Key === KEY && v.LastModified >= SINCE) versions.push(v);
  KeyMarker = r.IsTruncated ? r.NextKeyMarker : undefined;
  VersionIdMarker = r.IsTruncated ? r.NextVersionIdMarker : undefined;
} while (KeyMarker);
versions.sort((a, b) => a.LastModified - b.LastModified);
console.log(`\n2. HISTORY — ${versions.length} stored versions since ${SINCE.toISOString()}`);

let prev = null, hpdHits = 0, statusHits = 0;
for (const v of versions) {
  const cur = nodes(await get(v.VersionId));
  if (prev) {
    const toSevenFive = [], flattened = [];
    for (const [id, { n, level }] of cur) {
      const was = prev.get(id)?.n;
      if (!was) continue;
      if ((was.hpd === undefined || was.hpd === null) && n.hpd === 7.5) toSevenFive.push(`${level}:${id}`);
      if (was.status && !FIVE.has(was.status) && n.status === "Not Started") flattened.push(`${level}:${id} (${was.status})`);
    }
    if (toSevenFive.length) {
      hpdHits++;
      console.log(`   ${v.LastModified.toISOString()}  hpd absent→7.5 on ${toSevenFive.length}: ${toSevenFive.slice(0, 6).join(", ")}${toSevenFive.length > 6 ? " …" : ""}`);
    }
    // One or two can be a person choosing "Not Started"; a stale build does it to every
    // unmodelled status in the org at once, so require several in one save.
    if (flattened.length >= 3) {
      statusHits++;
      console.log(`   ${v.LastModified.toISOString()}  ${flattened.length} unmodelled statuses → "Not Started": ${flattened.slice(0, 4).join(", ")}${flattened.length > 4 ? " …" : ""}`);
    }
  }
  prev = cur;
}
console.log(`\n   versions with an hpd absent→7.5 write:           ${hpdHits}`);
console.log(`   versions flattening ≥3 statuses to "Not Started": ${statusHits}`);
