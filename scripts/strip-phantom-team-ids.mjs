#!/usr/bin/env node
// #315 — remove the nine team ids that name nobody (Trey, 2026-10-16: "remove the
// nine ids from the team lists, after a backup"). DRY RUN BY DEFAULT.
//
//   node scripts/strip-phantom-team-ids.mjs            show the plan
//   node scripts/strip-phantom-team-ids.mjs --write    back up, then write on the ETag
//
// SCOPE: LIVE jobs only. The same ids sit inside soft-deleted jobs too; those are
// tombstones nobody reads, and #473 is moving the old ones to the archive, so
// rewriting them is churn. Counted below so the scope is visible.
//
// THE IDS ARE NAMED, NOT DERIVED. "Not in people.json" is computed and printed as
// a cross-check, and the run refuses if the two lists disagree — a person deleted
// by mistake must not have their assignments stripped by this script.
//
// STAMPS: every job this changes gets a fresh `lastModifiedAt` (stampArray, the
// server's own function). Without it, caching clients keep the old team, and the
// next save from one of them carries the ghost back with the stored stamp — which
// the stale-copy check reads as current.
//
// BACKUP: the whole file as read goes to orgs/<org>/backups/tasks.pre-315.<ts>.json
// before tasks.json is touched. tasks.json is also a versioned object.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { stampArray } from "../netlify/functions/_utils/timestamps.js";

const WRITE = process.argv.includes("--write");
const ORG = "MTX2026TRAQS";
const PHANTOMS = ["tpi9loya1", "th45typcc", "tir7gjhzd", "t2c27wd69", "tnm1ne1vn",
  "t8gvuawtq", "tpq9lmtlv", "tnz13rojb", "tk2u8yz49"];
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = `orgs/${ORG}/tasks.json`;
const read = async (Key) => {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key }));
  const body = await res.Body.transformToString();
  return { data: JSON.parse(body), etag: res.ETag, versionId: res.VersionId, bytes: body.length, body };
};

const cur = await read(KEY);
const people = (await read(`orgs/${ORG}/people.json`)).data;
console.log(`read ${KEY}\n  version ${cur.versionId}\n  ${cur.bytes.toLocaleString()} bytes\n`);

// ── 1. CROSS-CHECK the named list against what resolves to nobody ──────────
const known = new Set(people.map(p => String(p.id)));
const unresolved = new Set();
const walkAll = (n) => { if (!n) return; for (const m of n.team || []) if (!known.has(String(m))) unresolved.add(String(m)); (n.subs || []).forEach(walkAll); };
(cur.data || []).forEach(walkAll);
const named = new Set(PHANTOMS);
const extra = [...unresolved].filter(id => !named.has(id));
const notFound = PHANTOMS.filter(id => known.has(id));
console.log("1. CROSS-CHECK");
console.log(`   ids in tasks.json that resolve to nobody: ${unresolved.size}`);
console.log(`   named in this script:                     ${PHANTOMS.length}`);
if (extra.length) console.log(`   UNNAMED unresolved ids (left alone): ${extra.join(", ")}`);
if (notFound.length) { console.error(`\nREFUSING: ${notFound.join(", ")} now resolve(s) to a person.`); process.exit(3); }

// ── 2. WHAT IT TOUCHES ─────────────────────────────────────────────────────
const LEVEL = ["job", "panel", "op", "sub-op"];
const hits = [];
let deadHits = 0;
const survey = (n, lvl, path, job) => {
  if (!n) return;
  const here = [...path, n.title || n.id];
  const ghosts = (n.team || []).filter(m => named.has(String(m)));
  if (ghosts.length) hits.push({ job, level: LEVEL[Math.min(lvl, 3)], path: here.join(" / "),
    ghosts: ghosts.length, real: (n.team || []).length - ghosts.length });
  (n.subs || []).forEach(c => survey(c, lvl + 1, here, job));
};
for (const j of cur.data || []) {
  if (!j) continue;
  if (j.deletedAt) { const w = (n) => { if (!n) return; deadHits += (n.team || []).filter(m => named.has(String(m))).length; (n.subs || []).forEach(w); }; w(j); continue; }
  survey(j, 0, [], j);
}
const jobs = [...new Set(hits.map(h => h.job))];
const emptied = hits.filter(h => h.real === 0);
console.log(`\n2. WHAT IT TOUCHES (live jobs)`);
console.log(`   nodes carrying a phantom: ${hits.length}, in ${jobs.length} live job(s)`);
console.log(`   ids removed:              ${hits.reduce((s, h) => s + h.ghosts, 0)}`);
console.log(`   nodes left with a real assignee: ${hits.length - emptied.length}`);
console.log(`   nodes left with NO assignee:     ${emptied.length}  <- these become unassigned`);
for (const j of jobs) {
  const mine = hits.filter(h => h.job === j);
  const e = mine.filter(h => h.real === 0).length;
  console.log(`     ${String(j.id).padEnd(10)} ${(j.jobNumber ? j.jobNumber + " · " : "") + (j.title || "")}`.padEnd(48)
    + `${String(mine.length).padStart(3)} nodes, ${String(e).padStart(3)} left unassigned`);
}
console.log(`   LEFT ALONE inside soft-deleted jobs: ${deadHits} occurrence(s)`);

// ── 3. THE PLAN ────────────────────────────────────────────────────────────
const strip = (n) => {
  if (!n || typeof n !== "object") return n;
  let next = n;
  if (Array.isArray(n.team) && n.team.some(m => named.has(String(m)))) next = { ...n, team: n.team.filter(m => !named.has(String(m))) };
  if (Array.isArray(n.subs)) {
    const subs = n.subs.map(strip);
    if (subs.some((s, i) => s !== n.subs[i])) { if (next === n) next = { ...n }; next.subs = subs; }
  }
  return next;
};
const stripped = (cur.data || []).map(j => (j && !j.deletedAt) ? strip(j) : j);
const nextTasks = stampArray(stripped, cur.data);
const restamped = nextTasks.filter((j, i) => j?.lastModifiedAt !== cur.data[i]?.lastModifiedAt).length;
console.log(`\n3. THE PLAN`);
console.log(`   jobs rewritten and re-stamped: ${restamped} (expected ${jobs.length})`);

// ── 4. SAFETY: remove the ids and the stamps from both sides; the rest must match.
const norm = (v, top) => {
  if (Array.isArray(v)) return v.map(x => norm(x, false));
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (k === "lastModifiedAt") continue;
      o[k] = k === "team" && Array.isArray(v[k]) ? v[k].filter(m => !named.has(String(m))) : norm(v[k], false);
    }
    return o;
  }
  return v;
};
const same = JSON.stringify(norm(cur.data)) === JSON.stringify(norm(nextTasks));
let left = 0; const count = (n) => { if (!n) return; left += (n.team || []).filter(m => named.has(String(m))).length; (n.subs || []).forEach(count); };
nextTasks.filter(j => j && !j.deletedAt).forEach(count);
const deadStampsMoved = nextTasks.some((j, i) => j?.deletedAt && j.lastModifiedAt !== cur.data[i]?.lastModifiedAt);
console.log(`\n4. SAFETY`);
console.log(`   everything except the nine ids and the stamps is identical: ${same ? "yes" : "NO"}`);
console.log(`   phantoms left on live nodes: ${left}`);
console.log(`   a soft-deleted job re-stamped: ${deadStampsMoved ? "YES" : "no"}`);
if (!same || left || deadStampsMoved || restamped !== jobs.length) { console.error("\nREFUSING."); process.exit(3); }

if (!WRITE) { console.log("\nDRY RUN — nothing was written. Re-run with --write."); process.exit(0); }
if (!hits.length) { console.log("\nNothing to remove. Not writing."); process.exit(0); }

console.log("\n5. WRITING");
const backupKey = `orgs/${ORG}/backups/tasks.pre-315.${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: backupKey, Body: cur.body, ContentType: "application/json", IfNoneMatch: "*" }));
const back = await read(backupKey);
if (back.body !== cur.body) { console.error("   REFUSED: backup read-back differs. tasks.json NOT written."); process.exit(2); }
console.log(`   backup written and read back: ${backupKey}`);
try {
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, Body: JSON.stringify(nextTasks), ContentType: "application/json", IfMatch: cur.etag }));
} catch (e) {
  if (e.$metadata?.httpStatusCode === 412 || String(e.name).includes("PreconditionFailed")) { console.error("   REFUSED: tasks.json changed since it was read."); process.exit(2); }
  throw e;
}
const after = await read(KEY);
let after315 = 0; const c2 = (n) => { if (!n) return; after315 += (n.team || []).filter(m => named.has(String(m))).length; (n.subs || []).forEach(c2); };
after.data.filter(j => j && !j.deletedAt).forEach(c2);
console.log(`   tasks.json written: version ${after.versionId}; phantoms on live nodes ${after315}`);
console.log(`\n   To undo: restore tasks.json version ${cur.versionId}, or copy ${backupKey} back.`);
