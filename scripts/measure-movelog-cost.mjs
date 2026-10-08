#!/usr/bin/env node
// #493. WHAT THE moveLog COSTS AT REST, AND WHAT IT COSTS IF EVERY MOVE LOGS.
//
// #492 ruled that the scheduler, the AI path, `updTask`'s cascade and the
// wizard's override must each log one entry per op. That multiplies a field
// nothing trims. Before building it, the question is whether the result needs a
// cap or a rollup now rather than later — and that is arithmetic, not opinion.
//
//   node scripts/measure-movelog-cost.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = `orgs/${ORG}/tasks.json`;
const raw = await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY }))).Body.transformToString();
const data = JSON.parse(raw);

const all = [];
const walk = (ns, dead) => (ns || []).forEach(n => {
  if (!n) return;
  const d = dead || !!n.deletedAt;
  all.push({ n, dead: d });
  walk(n.subs, d);
});
(data || []).forEach(j => walk([j], false));

const entries = [];
for (const { n, dead } of all) for (const e of n.moveLog || []) entries.push({ e, dead });
const bytesOf = (x) => JSON.stringify(x).length;
const logBytes = all.reduce((s, { n }) => s + ((n.moveLog || []).length ? bytesOf(n.moveLog) : 0), 0);
const liveLogBytes = all.filter(x => !x.dead).reduce((s, { n }) => s + ((n.moveLog || []).length ? bytesOf(n.moveLog) : 0), 0);

console.log(`tasks.json: ${raw.length.toLocaleString()} bytes`);
console.log(`\n1. WHAT IT WEIGHS TODAY`);
console.log(`   entries, all nodes:        ${entries.length}  (${entries.filter(x => !x.dead).length} on live nodes)`);
console.log(`   moveLog bytes:             ${logBytes.toLocaleString()}  (${(logBytes / raw.length * 100).toFixed(1)}% of the file)`);
console.log(`   ...on live nodes only:     ${liveLogBytes.toLocaleString()}`);
const sizes = entries.map(({ e }) => bytesOf(e)).sort((a, b) => a - b);
console.log(`   bytes per entry:           min ${sizes[0]}, median ${sizes[sizes.length >> 1]}, max ${sizes[sizes.length - 1]}, mean ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}`);
// The full-detail entries are the expensive ones — #458's hour and team fields.
const full = entries.filter(({ e }) => "fromStartHour" in e);
console.log(`   entries carrying hour/team detail: ${full.length} of ${entries.length}`
  + `${full.length ? `, median ${full.map(({ e }) => bytesOf(e)).sort((a, b) => a - b)[full.length >> 1]} bytes` : ""}`);

console.log(`\n2. IS ANYTHING TRIMMING IT?`);
const srcs = ["../src/dragMove.js", "../src/TRAQS.jsx", "../netlify/functions/tasks.js", "../netlify/functions/_utils/move-log-guard.js"];
let trimmer = false;
for (const f of srcs) {
  const t = readFileSync(new URL(f, import.meta.url), "utf8");
  for (const re of [/moveLog\.slice\(/g, /moveLog:\s*\[[^\]]*\]\.slice/g, /MAX_MOVE_LOG/g, /moveLog\.length\s*>\s*\d+/g]) {
    const m = t.match(re);
    if (m) { trimmer = true; console.log(`   ${f.split("/").pop()}: ${m.length}× ${re}`); }
  }
}
if (!trimmer) console.log(`   NO CAP, NO TRIM, NO ROLLUP anywhere. The array grows until the node dies.`);

console.log(`\n3. THE RATE, FROM THE ENTRIES' OWN DATES`);
const byMonth = {};
for (const { e } of entries) { const m = String(e.date || "").slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) byMonth[m] = (byMonth[m] || 0) + 1; }
const months = Object.keys(byMonth).sort();
months.forEach(m => console.log(`   ${m}  ${String(byMonth[m]).padStart(4)}`));
const spanM = months.length || 1;
const logged = entries.length;
console.log(`   ${logged} entries over ${spanM} months → ${(logged / spanM).toFixed(0)}/month LOGGED`);

// ── 4. THE PROJECTION, AND WHY THE OBVIOUS ONE IS WRONG ────────────────────
//
// The tempting sum is "88 logged/month ÷ 13.9% coverage = 634/month". IT IS NOT
// VALID, and the reason matters more than the number: #492's 13.9% is the share
// of units whose NET position changed that also gained an entry. An entry is
// written per MOVE; the history comparison sees only net displacement, so a unit
// dragged ten times and a unit dragged once both count as one. Dividing a
// per-move rate by a per-unit coverage mixes two different denominators.
//
// So the projection is built from what each writer would actually emit.
const perMonthLogged = logged / spanM;
console.log(`\n4. THE PROJECTION — BUILT FROM THE WRITERS, NOT FROM COVERAGE`);
console.log(`   the obvious sum, 88/month ÷ 13.9% coverage, is INVALID: coverage is`);
console.log(`   measured per UNIT-that-moved and entries are written per MOVE. A unit`);
console.log(`   dragged ten times counts once in that 13.9%.`);
console.log(`   today, logged:            ${perMonthLogged.toFixed(0)}/month — and badly distributed:`);
console.log(`     ${months.map(m => `${m.slice(5)}:${byMonth[m]}`).join("  ")}`);
console.log(`     October alone is ${byMonth[months[months.length - 1]]} of ${logged}, so the mean is not a rate.`);

// The scheduler is the volume question. Trey's figure: ~a dozen runs over the
// board's life, ~20 ops placed per run.
const RUNS = 12, OPS_PER_RUN = 20;
const schedEntries = RUNS * OPS_PER_RUN;
console.log(`\n   WHAT THE NEW WRITERS ADD, at one entry per op per run:`);
console.log(`     scheduler: ~${RUNS} runs × ~${OPS_PER_RUN} ops = ${schedEntries} entries over ${spanM} months = ${(schedEntries / spanM).toFixed(0)}/month`);
console.log(`     the AI path, updTask's cascade and the override: small and bursty,`);
console.log(`     and none of them is a thing anyone does many times a day.`);
const projected = perMonthLogged + schedEntries / spanM;
console.log(`   so a COMPLETE log writes roughly ${projected.toFixed(0)}/month — about ${(projected / perMonthLogged).toFixed(1)}× today, not 7×.`);

const meanB = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
console.log(`\n5. A YEAR OUT, at ${meanB} bytes an entry`);
for (const [label, rate] of [["today's writers only", perMonthLogged], ["every move logs", projected]]) {
  const ye = rate * 12, yb = ye * meanB;
  console.log(`   ${label.padEnd(22)} +${Math.round(ye).toLocaleString()} entries, +${(yb / 1024).toFixed(0)} KB`
    + `  → moveLog ${(((logBytes + yb) / (raw.length + yb)) * 100).toFixed(0)}% of a ${((raw.length + yb) / 1024).toFixed(0)} KB file`);
}
console.log(`   THE UNCERTAINTY IS THE RUN COUNT, and it is not measurable from the data:`);
console.log(`   nothing records that a scheduler run happened. At 4× the assumed runs it is`);
console.log(`   ${(((perMonthLogged + 4 * schedEntries / spanM) * 12 * meanB) / 1024).toFixed(0)} KB/year instead of ${((projected * 12 * meanB) / 1024).toFixed(0)}.`);

console.log(`\n6. THE runId's OWN COST`);
console.log(`   a uuid-ish id as "runId":"t1a2b3c4d" is ~22 bytes on every entry`);
console.log(`   only the scheduler's entries need one — ${schedEntries} of them, ${(schedEntries * 22 / 1024).toFixed(1)} KB over ${spanM} months`);
console.log(`   a drag writes one op and needs none, so it is ~${(22 / meanB * 100).toFixed(0)}% on top of the entries that carry it, not all of them.`);

console.log(`\n7. THE OTHER WEIGHT ALREADY IN THE FILE, for scale`);
const deadJobs = (data || []).filter(j => j && j.deletedAt);
console.log(`   soft-deleted jobs (#473): ${(JSON.stringify(deadJobs).length / 1024).toFixed(0)} KB, ${(JSON.stringify(deadJobs).length / raw.length * 100).toFixed(1)}% of the file`);
console.log(`   moveLog today:            ${(logBytes / 1024).toFixed(0)} KB, ${(logBytes / raw.length * 100).toFixed(1)}%`);
