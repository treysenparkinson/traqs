#!/usr/bin/env node
// #431. What the per-user blob holds today, and what a second browser does to it.
//
// user-settings.js REPLACES THE BLOB WHOLESALE — `writeJson(key,
// stampObject(settings, existing))`, no merge, no ETag, no conditional put. And
// the client fetches it ONCE, on `[orgCode]`: it is not in sync.js, not on Ably,
// not in IndexedDB. So a tab holds its load-time copy of every key for as long
// as it stays open, and writing ANY key writes back ALL of them.

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = process.argv[2] || "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });

const list = await s3.send(new ListObjectsV2Command({
  Bucket: env.S3_BUCKET, Prefix: `orgs/${ORG}/user-settings/` }));
const objs = (list.Contents || []).filter(o => o.Key.endsWith(".json"));

console.log(`ORG ${ORG}: ${objs.length} user-settings blobs\n`);
console.log("1. WHAT EACH ACCOUNT HAS STORED");
const keyCount = {};
let totalBytes = 0;
for (const o of objs) {
  const body = await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: o.Key }))).Body.transformToString();
  let data; try { data = JSON.parse(body); } catch { data = {}; }
  const keys = Object.keys(data).filter(k => k !== "lastModifiedAt");
  for (const k of keys) keyCount[k] = (keyCount[k] || 0) + 1;
  totalBytes += body.length;
  const who = o.Key.split("/").pop().replace(/\.json$/, "");
  console.log(`   ${who.padEnd(34)} ${String(body.length).padStart(7)} B  ${keys.length} keys  last ${(data.lastModifiedAt || "-").slice(0, 19)}`);
}
console.log(`   ${"".padEnd(34)} ${String(totalBytes).padStart(7)} B total`);

console.log("\n2. WHICH KEYS ARE IN USE, AND HOW BIG THEY GET");
for (const [k, n] of Object.entries(keyCount).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(20)} on ${n} of ${objs.length} accounts`);
}

console.log("\n3. THE COLLISION, spelled out");
console.log(`   The blob is replaced wholesale and read once per session, so the`);
console.log(`   stale window is THE LIFETIME OF THE OLDER TAB, not a debounce.`);
console.log(`   Tab A and tab B both load the blob at 09:00.`);
console.log(`   15:00  you widen a column in A  -> A writes all ${Object.keys(keyCount).length} keys from A's state`);
console.log(`   16:00  you switch theme in B    -> B writes all ${Object.keys(keyCount).length} keys from B's 09:00 state`);
console.log(`   -> the column width is silently back to what it was at 09:00.`);
console.log(`   Nothing errors, nothing logs, and the write that lost the edit was`);
console.log(`   about a completely unrelated preference.`);
