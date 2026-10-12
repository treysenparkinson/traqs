#!/usr/bin/env node
// #295. WRITE EVERY PERMISSION KEY ONTO EVERY ADMIN RECORD. DRY RUN BY DEFAULT.
//
//   node scripts/backfill-admin-perms.mjs            show the six records and the plan
//   node scripts/backfill-admin-perms.mjs --write    execute, guarded on ETag
//
// WHY THIS EXISTS AT ALL. `GRANTED_WHEN_ABSENT` let a newly-added key default
// to granted so that shipping it did not strip rights from records written
// before it. Its own comment said to empty the set "once every live record
// carries the keys" — and nothing ever made a record carry a key it was missing,
// because `togglePerm` wrote one key at a time onto whatever object was there.
// So the set never emptied and two toggles were decorative for their whole life.
//
// This is the step that was missing. After it, the set goes to zero in the same
// release, and `fullPerms` on the web keeps records complete from here on.
//
// VALUES ARE TREY'S, NOT DERIVED. A backfill that guessed would be inventing
// permissions; these were decided per person:
//   Kevin   — both new keys
//   Jon     — both new keys
//   Noah    — manageTimeclock only (corrects the clock, does not confirm)
//   Chelsea — neither
// Everything else keeps the value the record already carries, and an admin whose
// `adminPerms` is null is UNRESTRICTED and is left alone: writing a map onto one
// would be a demotion, not a backfill.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { PERM_KEYS } from "../netlify/functions/_utils/can.js";

const WRITE = process.argv.includes("--write");
const ORG = "MTX2026TRAQS";
const KEY = `orgs/${ORG}/people.json`;
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });

// The decisions. A name not listed gets false for both new keys.
const NEW_KEY_VALUES = {
  Kevin:   { manageTimeclock: true,  confirmTimesheet: true },
  Jon:     { manageTimeclock: true,  confirmTimesheet: true },
  Noah:    { manageTimeclock: true,  confirmTimesheet: false },
  Chelsea: { manageTimeclock: false, confirmTimesheet: false },
};

const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY }));
const body = await res.Body.transformToString();
const people = JSON.parse(body);
const etag = res.ETag;

console.log(`ADMIN PERMISSION BACKFILL — ORG ${ORG}`);
console.log(WRITE ? "MODE: WRITE (guarded on ETag)\n" : "MODE: DRY RUN — nothing will be written\n");

const live = people.filter(p => p && !p.deletedAt);
const admins = live.filter(p => p.userRole === "admin");
console.log(`live people ${live.length}, admins ${admins.length}, keys ${PERM_KEYS.length}\n`);

console.log("1. THE SIX RECORDS, AS THEY ARE NOW");
for (const p of admins) {
  const ap = p.adminPerms;
  if (ap == null) { console.log(`   ${String(p.name).padEnd(9)} adminPerms = null  → UNRESTRICTED, left alone`); continue; }
  const have = PERM_KEYS.filter(k => k in ap);
  const missing = PERM_KEYS.filter(k => !(k in ap));
  console.log(`   ${String(p.name).padEnd(9)} ${have.length}/${PERM_KEYS.length} keys present` +
    `   true: ${PERM_KEYS.filter(k => ap[k] === true).join(", ") || "(none)"}`);
  console.log(`   ${"".padEnd(9)} missing: ${missing.join(", ") || "(none)"}`);
}

console.log("\n2. THE PLAN");
let changed = 0;
const next = people.map((p) => {
  if (!p || p.deletedAt || p.userRole !== "admin") return p;
  if (p.adminPerms == null) return p;                 // unrestricted — never demote
  const decided = NEW_KEY_VALUES[p.name] || {};
  const out = {};
  for (const k of PERM_KEYS) {
    out[k] = k in decided ? decided[k] === true : p.adminPerms[k] === true;
  }
  const diff = PERM_KEYS.filter(k => out[k] !== (p.adminPerms[k] === true) || !(k in p.adminPerms));
  if (diff.length) {
    changed++;
    console.log(`   ${String(p.name).padEnd(9)} ${diff.map(k => `${k}=${out[k]}`).join(", ")}`);
  }
  return { ...p, adminPerms: out };
});
if (!changed) console.log("   (no record needs changing)");

console.log("\n3. NOTHING ELSE MAY MOVE");
// A permission backfill that touched anything else would be the 2026-06-03
// shape: the fix is narrow, so the proof that it is narrow has to be explicit.
const canon = (v) => JSON.stringify(v, Object.keys(v ?? {}).sort());
let other = 0;
for (let i = 0; i < people.length; i++) {
  const { adminPerms: _a, ...restA } = people[i] ?? {};
  const { adminPerms: _b, ...restB } = next[i] ?? {};
  if (canon(restA) !== canon(restB)) other++;
}
console.log(`   records changing anything other than adminPerms: ${other}`);
console.log(`   record count before ${people.length}, after ${next.length}`);
console.log(`   admins left unrestricted (adminPerms null): ${admins.filter(p => p.adminPerms == null).map(p => p.name).join(", ") || "(none)"}`);

console.log("\n4. AFTER — what each admin would be able to do with the clock");
for (const p of next.filter(x => x && x.userRole === "admin" && !x.deletedAt)) {
  const ap = p.adminPerms;
  const mt = ap == null ? "YES (unrestricted)" : ap.manageTimeclock ? "yes" : "no ";
  const ct = ap == null ? "YES (unrestricted)" : ap.confirmTimesheet ? "yes" : "no ";
  console.log(`   ${String(p.name).padEnd(9)} correct the clock: ${String(mt).padEnd(18)} confirm a timesheet: ${ct}`);
}

if (!WRITE) { console.log("\nDRY RUN — nothing was written. Re-run with --write."); process.exit(0); }
if (other > 0) { console.error("\nREFUSING: the plan would change something other than adminPerms."); process.exit(3); }
if (next.length !== people.length) { console.error("\nREFUSING: the record count changed."); process.exit(3); }

console.log("\n5. WRITING");
try {
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY,
    Body: JSON.stringify(next), ContentType: "application/json", IfMatch: etag }));
  console.log("   people.json written");
} catch (e) {
  console.error(`   REFUSED: ${e.name} — people.json changed since it was read. Re-run.`);
  process.exit(4);
}
