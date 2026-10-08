#!/usr/bin/env node
// #466 — the copies ALREADY MADE. `copyForDuplicate` stops new ones inheriting
// history; it does nothing for jobs duplicated before it, and #465 pins what
// they carry from their second save onward. So the population is fixed and the
// only open question is its size: a cleanup pass, or an entry.
//
//   node scripts/measure-inherited-history.mjs
//
// HOW A COPY IS IDENTIFIED. Not by the " (copy)" title, which anybody can rename
// away, and not by the missing job number, which a brand-new job also has. The
// evidence is that `duplicateJob` byte-copied the moveLog: two DISTINCT nodes
// holding the identical array is a copy, because two independent sequences of
// drags do not produce the same timestamps, reasons and hour pairs. A prefix
// match is the same thing after the copy was moved again.

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
const all = Array.isArray(td) ? td : td.tasks || [];
const liveJobs = all.filter(j => j && !j.deletedAt);

// Every live node, with the job it belongs to.
const nodes = [];
const walk = (ns, job, lvl, anc) => (ns || []).forEach(n => {
  if (!n) return;
  const dead = anc || !!n.deletedAt;
  if (!dead) nodes.push({ n, job, lvl });
  walk(n.subs, job, lvl + 1, dead);
});
liveJobs.forEach(j => walk([j], j, 0, false));
console.log(`${liveJobs.length} live jobs, ${nodes.length} live nodes\n`);

// ── 1. THE TITLE MARKER, as a weak signal stated as weak ───────────────────
const titled = nodes.filter(({ n }) => /\(copy\)/i.test(String(n.title || "")));
console.log(`1. NODES STILL TITLED "(copy)"   ${titled.length}`);
titled.forEach(({ n, lvl }) => console.log(`     [${["job", "panel", "op"][Math.min(lvl, 2)]}] ${n.title}`));
console.log(`   A weak signal: a rename removes it and a new job never had a job number either.`);

// ── 2. THE EVIDENCE: identical moveLog arrays on distinct nodes ────────────
const withLog = nodes.filter(({ n }) => Array.isArray(n.moveLog) && n.moveLog.length);
console.log(`\n2. NODES CARRYING A moveLog   ${withLog.length}  (${withLog.reduce((s, x) => s + x.n.moveLog.length, 0)} entries)`);

const keyOf = (log, upto) => JSON.stringify(log.slice(0, upto));
const groups = new Map();                       // full-array key -> nodes
for (const x of withLog) {
  const k = keyOf(x.n.moveLog, x.n.moveLog.length);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(x);
}
const shared = [...groups.values()].filter(g => g.length > 1);
console.log(`\n   IDENTICAL FULL ARRAYS ON DISTINCT NODES: ${shared.length} group(s)`);
let sharedNodes = 0, sharedEntries = 0;
for (const g of shared) {
  sharedNodes += g.length; sharedEntries += g[0].n.moveLog.length * (g.length - 1);
  console.log(`     ${g.length} nodes share ${g[0].n.moveLog.length} entries:`);
  g.forEach(({ n, job }) => console.log(`       ${String(job.title).slice(0, 22).padEnd(24)} ${n.title}`));
}

// A PREFIX match catches a copy that was dragged again afterwards.
const prefixHits = [];
for (let i = 0; i < withLog.length; i++) for (let j = 0; j < withLog.length; j++) {
  if (i === j) continue;
  const a = withLog[i].n.moveLog, b = withLog[j].n.moveLog;
  if (a.length >= b.length || b.length === 0) continue;
  if (keyOf(b, a.length) === keyOf(a, a.length))
    prefixHits.push({ short: withLog[i], long: withLog[j], n: a.length });
}
console.log(`\n   ONE LOG IS A PREFIX OF ANOTHER (copied, then moved again): ${prefixHits.length}`);
prefixHits.slice(0, 10).forEach(h => console.log(
  `     "${h.short.n.title}" (${h.short.n.moveLog.length}) is the opening of "${h.long.n.title}" (${h.long.n.moveLog.length})`));

// ── 3. ENTRIES THAT PREDATE THE NODE, where createdAt exists ──────────────
const dated = nodes.filter(({ n }) => n.createdAt && Array.isArray(n.moveLog) && n.moveLog.length);
console.log(`\n3. NODES WITH BOTH createdAt AND A moveLog   ${dated.length}`);
let predate = 0;
for (const { n } of dated) {
  const bad = n.moveLog.filter(e => e?.date && String(e.date) < String(n.createdAt).slice(0, 10));
  if (bad.length) { predate++; console.log(`     ${n.title}: ${bad.length} entries dated before createdAt ${String(n.createdAt).slice(0, 10)}`); }
}
if (!predate) console.log(`   none — no node can be convicted this way, because createdAt is on ${nodes.filter(x => x.n.createdAt).length} nodes only.`);

// ── 4. THE OTHER TWO PATHS ────────────────────────────────────────────────
const splits = nodes.filter(({ n }) => n.splitFrom);
const splitDirty = splits.filter(({ n }) =>
  (Array.isArray(n.finishRequests) && n.finishRequests.length)
  || (Array.isArray(n.attachments) && n.attachments.length)
  || (Array.isArray(n.signOffs) && n.signOffs.length) || n.finishedAt);
console.log(`\n4. SPLIT HALVES  ${splits.length}  — carrying something #468 would now drop: ${splitDirty.length}`);
splitDirty.forEach(({ n }) => console.log(`     ${n.title}  fr=${(n.finishRequests || []).length} att=${(n.attachments || []).length} signOffs=${(n.signOffs || []).length} finishedAt=${!!n.finishedAt}`));
const noDeps = splits.filter(({ n }) => !(n.deps || []).length);
console.log(`   split halves with no deps (the cleared-deps loss, unrecoverable either way): ${noDeps.length} of ${splits.length}`);
console.log(`   TEMPLATE-ORIGIN CONTAMINATION IS NOT MEASURABLE FROM HERE — templates live in`);
console.log(`   localStorage per browser, so nothing in S3 says which ops came from one.`);

// ── 5. THE SIZE OF THE DECISION ───────────────────────────────────────────
console.log(`\n5. WHAT A CLEANUP WOULD BE`);
const suspectNodes = new Set([...shared.flatMap(g => g.slice(1)), ...prefixHits.map(h => h.long)].map(x => x.n));
console.log(`   nodes with moveLog evidence of being a copy: ${suspectNodes.size}`);
const bytes = [...suspectNodes].reduce((s, n) => s + JSON.stringify(n.moveLog).length, 0);
console.log(`   bytes of inherited history: ${bytes.toLocaleString()}`);
console.log(`   titled "(copy)" and carrying a moveLog: ${titled.filter(({ n }) => (n.moveLog || []).length).length}`);
