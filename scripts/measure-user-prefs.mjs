#!/usr/bin/env node
// #431. What the per-user blob holds today, and what a second browser does to it.
//
// WRITTEN AGAINST THE DEFECT, KEPT AS THE PROOF IT IS GONE. user-settings.js
// used to REPLACE THE BLOB WHOLESALE — `writeJson(key, stampObject(settings,
// existing))`, no merge, no ETag, no conditional put — while the client fetched
// it ONCE, on `[orgCode]` (not in sync.js, not on Ably, not in IndexedDB). So a
// tab held its load-time copy of every key for as long as it stayed open, and
// writing ANY key wrote back ALL of them. #441 made the endpoint merge and the
// client send only what changed; section 4 is the answer to "is it chattier
// now", which is the cost that replaced the bug.

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

console.log("\n3. THE COLLISION THAT #441 REMOVED, spelled out");
console.log(`   BEFORE: the blob was replaced wholesale and read once per session,`);
console.log(`   so the stale window was THE LIFETIME OF THE OLDER TAB, not a debounce.`);
console.log(`   Tab A and tab B both load the blob at 09:00.`);
console.log(`   15:00  you widen a column in A  -> A writes all ${Object.keys(keyCount).length} keys from A's state`);
console.log(`   16:00  you switch theme in B    -> B writes all ${Object.keys(keyCount).length} keys from B's 09:00 state`);
console.log(`   -> the column width is silently back to what it was at 09:00.`);
console.log(`   Nothing errors, nothing logs, and the write that lost the edit was`);
console.log(`   about a completely unrelated preference.`);
console.log(`   AFTER: the client sends only the keys it changed and the server`);
console.log(`   merges them, so an unrelated write cannot revert anything.`);

// ── 4. WRITES PER SESSION, before and after #441/#431 ────────────────────
// The operational question: does merging make the endpoint chattier? Simulated
// against the real `changedPrefs`, over session shapes taken from what the
// effect's dependencies actually are.
const { changedPrefs } = await import("../src/prefsDelta.js");
const base = {
  themeMode: "dark", customTheme: { accent: "#3b82f6" }, colOrder: ["a", "b", "c"],
  colLabels: {}, groupColPref: {}, userPrefs: { timeZone: "", dateFormat: "us" },
  hiddenCols: [], colWidths: [120, 120, 120],
  grouping: [], jobSort: "date", colSort: { id: null, dir: "asc" },
  gSort: "date", jobsView: "open", showCompleted: true, adminFilter: "live",
};
const OLD_KEYS = ["themeMode", "customTheme", "colOrder", "colLabels", "groupColPref", "userPrefs", "hiddenCols", "colWidths"];
const sessions = {
  "quiet (open, look, leave)": [],
  "theme toggle": [{ themeMode: "light" }],
  "lay out the jobs list": [{ colWidths: [240, 120, 120] }, { colOrder: ["b", "a", "c"] }, { hiddenCols: ["c"] }],
  "sort and filter about": [{ jobSort: "client" }, { colSort: { id: "title", dir: "asc" } }, { gSort: "project" }, { jobsView: "all" }],
  "a full day": [{ themeMode: "light" }, { colWidths: [240, 120, 120] }, { jobSort: "client" },
    { showCompleted: false }, { grouping: ["client"] }, { adminFilter: "today" }, { colOrder: ["b", "a", "c"] }],
};
console.log("\n4. WRITES PER SESSION");
console.log("   session                       writes  patch B   old-wholesale B   newly-synced");
for (const [name, steps] of Object.entries(sessions)) {
  let cur = { ...base }, last = null, writes = 0, bytes = 0, oldBytes = 0, oldWrites = 0, newly = 0;
  // First write of a session is full (the baseline starts null), exactly as before.
  for (const step of steps) {
    cur = { ...cur, ...step };
    const patch = changedPrefs(cur, last);
    if (patch) { writes++; bytes += JSON.stringify(patch).length; last = cur; }
    // What the OLD build did: only the 8 original keys existed, and the whole
    // bundle went every time one of them changed.
    const touchedOld = Object.keys(step).some(k => OLD_KEYS.includes(k));
    if (touchedOld) { oldWrites++; oldBytes += JSON.stringify(Object.fromEntries(OLD_KEYS.map(k => [k, cur[k]]))).length; }
    if (!touchedOld) newly++;
  }
  console.log(`   ${name.padEnd(28)} ${String(writes).padStart(3)}/${String(oldWrites).padEnd(3)} ${String(bytes).padStart(7)}  ${String(oldBytes).padStart(13)}   ${newly}`);
}
console.log("   (writes shown as after/before; 'newly-synced' = changes that used");
console.log("    to touch localStorage only and now reach the server)");
