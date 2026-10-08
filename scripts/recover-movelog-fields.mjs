#!/usr/bin/env node
// RECOVERY, part two: the moveLog fields the 2026-10-08 00:29:17Z write stripped.
// DRY RUN BY DEFAULT.
//
//   node scripts/recover-movelog-fields.mjs            show the plan
//   node scripts/recover-movelog-fields.mjs --write    execute, guarded on ETag
//
// The same iOS save that flattened 39 job statuses also re-encoded every
// moveLog entry through Swift's `MoveLogEntry`, which models a subset. All 279
// entries kept `date`, `movedBy`, `reason` and the day-level dates and LOST
// `fromStartHour`, `toStartHour`, `fromEndHour`, `toEndHour`, `fromTeam` and
// `toTeam` — the record of WHO a move reassigned and at what hour.
//
// RESTORED ENTRY BY ENTRY, NOT ARRAY BY ARRAY. A node that gained a move since
// the incident must keep it, so the good version's entries are matched to the
// current ones and only the MISSING FIELDS are filled back in. An entry the good
// version does not have is left exactly as it is.
//
// A current entry is matched to a good one when their day-level identity agrees
// (date, reason, movedBy, fromStart/toStart/fromEnd/toEnd). Those are the fields
// the flatten PRESERVED, so they are the only safe key — and if two entries on a
// node share all of them, neither is touched rather than guessing which is which.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const ORG = "MTX2026TRAQS";
const GOOD = "_G1jj8FEpnGatFFaEEfQHIMnXVy0bsgB";    // 2026-10-07T22:58:16Z
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = `orgs/${ORG}/tasks.json`;

const readMeta = async (VersionId) => {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, ...(VersionId ? { VersionId } : {}) }));
  const body = await res.Body.transformToString();
  return { data: JSON.parse(body), etag: res.ETag, versionId: res.VersionId, bytes: body.length };
};
// The fields the flatten preserved — the only ones safe to match on.
const idOf = (e) => JSON.stringify([e?.date ?? null, e?.reason ?? null, e?.movedBy ?? null,
  e?.fromStart ?? null, e?.toStart ?? null, e?.fromEnd ?? null, e?.toEnd ?? null]);
const LOST = ["fromStartHour", "toStartHour", "fromEndHour", "toEndHour", "fromTeam", "toTeam",
  "fromHpd", "toHpd", "fromDepartments", "toDepartments", "sessionId"];

const good = await readMeta(GOOD);
const cur = await readMeta();

console.log(`MOVELOG FIELD RECOVERY — ORG ${ORG}`);
console.log(WRITE ? "MODE: WRITE (guarded on ETag)\n" : "MODE: DRY RUN — nothing will be written\n");
console.log(`   restoring FROM  ${GOOD}  (${good.bytes} B)`);
console.log(`   applying ONTO   ${cur.versionId}  (${cur.bytes} B)\n`);

const goodLogs = new Map();
const walkGood = (n, path) => { if (!n || n.deletedAt) return;
  if (Array.isArray(n.moveLog)) goodLogs.set(path + String(n.id), n.moveLog);
  for (const c of n.subs || []) walkGood(c, path); };
for (const j of good.data || []) { walkGood(j, ""); for (const p of j?.subs || []) { walkGood(p, ""); for (const o of p?.subs || []) walkGood(o, ""); } }

let nodesTouched = 0, entriesFilled = 0, fieldsFilled = 0, ambiguous = 0, unmatched = 0, keptNew = 0;
const perField = {};
const fix = (n) => {
  if (!n || n.deletedAt || !Array.isArray(n.moveLog)) return n;
  const g = goodLogs.get(String(n.id));
  if (!g) return n;

  // BY POSITION WHEN THE ARRAYS LINE UP, which they do: the flatten re-encoded
  // each entry in place, so order was preserved and only fields were lost. This
  // is the strategy that resolves REPEATED moves — two identical drags on one op
  // produce two entries with the same date, reason, mover and dates, and an
  // identity-keyed match cannot tell them apart. Position can.
  //
  // Only used when the lengths match AND every pair at the same index agrees on
  // the preserved fields, so a node that gained a move since the incident falls
  // through to the identity match rather than being filled from the wrong row.
  const aligned = g.length === n.moveLog.length && n.moveLog.every((e, i) => idOf(e) === idOf(g[i]));
  if (aligned) {
    let changedP = false;
    const nextP = n.moveLog.map((e, i) => {
      const add = {};
      for (const f of LOST) if (!(f in e) && f in g[i]) { add[f] = g[i][f]; perField[f] = (perField[f] || 0) + 1; fieldsFilled++; }
      if (!Object.keys(add).length) return e;
      changedP = true; entriesFilled++;
      return { ...e, ...add };
    });
    if (!changedP) return n;
    nodesTouched++;
    return { ...n, moveLog: nextP };
  }

  // Entries on the GOOD side, indexed by their preserved identity. An identity
  // shared by two entries is dropped from the index: ambiguous, so untouched.
  const byId = new Map(); const dupes = new Set();
  for (const e of g) { const k = idOf(e); if (byId.has(k)) dupes.add(k); else byId.set(k, e); }
  for (const k of dupes) byId.delete(k);
  let changed = false;
  const next = n.moveLog.map(e => {
    const k = idOf(e);
    if (dupes.has(k)) { ambiguous++; return e; }
    const src = byId.get(k);
    if (!src) { unmatched++; keptNew++; return e; }
    const add = {};
    for (const f of LOST) if (!(f in e) && f in src) { add[f] = src[f]; perField[f] = (perField[f] || 0) + 1; fieldsFilled++; }
    if (!Object.keys(add).length) return e;
    changed = true; entriesFilled++;
    return { ...e, ...add };
  });
  if (!changed) return n;
  nodesTouched++;
  return { ...n, moveLog: next };
};
const nextTasks = (cur.data || []).map(j => {
  if (!j || j.deletedAt) return j;
  const fj = fix(j);
  return { ...fj, subs: (fj.subs || []).map(p => {
    if (!p || p.deletedAt) return p;
    const fp = fix(p);
    return { ...fp, subs: (fp.subs || []).map(o => fix(o)) };
  }) };
});

console.log("1. THE PLAN");
console.log(`   nodes whose moveLog gains fields: ${nodesTouched}`);
console.log(`   entries filled:                   ${entriesFilled}`);
console.log(`   individual fields restored:       ${fieldsFilled}`);
for (const [f, c] of Object.entries(perField).sort((a, b) => b[1] - a[1])) console.log(`      ${String(c).padStart(4)}  ${f}`);
console.log(`   entries with no match in the good version (left alone): ${unmatched}`);
console.log(`   entries whose identity is ambiguous (left alone):       ${ambiguous}`);

// Nothing but moveLog may move.
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null"
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
const strip = (n) => { if (!n || typeof n !== "object") return n;
  const { moveLog: _m, subs, ...rest } = n;
  return { ...rest, subs: Array.isArray(subs) ? subs.map(strip) : subs }; };
let other = 0;
for (let i = 0; i < (cur.data || []).length; i++) if (canon(strip(cur.data[i])) !== canon(strip(nextTasks[i]))) other++;
console.log(`   top-level records changing anything OTHER than moveLog: ${other}`);

const countHours = (d) => { let n = 0; const w = (x) => { if (!x || x.deletedAt) return;
  for (const e of x.moveLog || []) if ("fromStartHour" in e) n++;
  for (const c of x.subs || []) w(c); };
  for (const j of d || []) w(j); return n; };
console.log(`\n2. ENTRIES CARRYING HOUR DETAIL`);
console.log(`   good version: ${countHours(good.data)}`);
console.log(`   now:          ${countHours(cur.data)}`);
console.log(`   after:        ${countHours(nextTasks)}`);

if (!WRITE) { console.log("\nDRY RUN — nothing was written. Re-run with --write."); process.exit(0); }
if (other > 0) { console.error("\nREFUSING: the plan would change something other than moveLog."); process.exit(3); }

console.log("\n3. WRITING");
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
console.log(`\n4. VERIFIED FROM S3`);
console.log(`   entries carrying hour detail: ${countHours(after.data)}`);
const c = {}; for (const j of (after.data || []).filter(x => x && !x.deletedAt)) c[String(j.status)] = (c[String(j.status)] || 0) + 1;
console.log(`   live jobs ${Object.values(c).reduce((a, b) => a + b, 0)}, distinct statuses ${Object.keys(c).length}, Not Started ${c["Not Started"] ?? 0}`);
