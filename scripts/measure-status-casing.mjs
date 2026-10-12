#!/usr/bin/env node
// #317. ONE STATUS STORED TWO WAYS SPLITS EVERY `===` THAT TESTS IT.
//
// The entry: Matrix carries both `Finished` and `finished`, found while
// censusing bar states. Measured here across the WHOLE tree rather than the
// drawn bars, because a comparison that splits is wrong wherever it runs —
// and then the comparisons themselves are counted, since a population of bad
// values is only a defect where something compares them (R4).
//
//   node scripts/measure-status-casing.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const tasks = await get(`orgs/${ORG}/tasks.json`);

const nodes = [];
const walk = (n, level, job, panel) => {
  if (!n) return;
  nodes.push({ n, level, job, panel, dead: !!n.deletedAt });
  for (const c of n.subs || []) walk(c, level === "job" ? "panel" : "op", job || n, level === "job" ? c : panel);
};
for (const j of tasks || []) walk(j, "job", j, null);

console.log(`tasks.json: ${nodes.length} nodes (${nodes.filter(x => !x.dead).length} live)\n`);

console.log("1. EVERY DISTINCT status VALUE, EXACTLY AS STORED");
const seen = new Map();
for (const x of nodes) {
  if (x.n.status == null) continue;
  const v = String(x.n.status);
  if (!seen.has(v)) seen.set(v, { n: 0, levels: new Set(), live: 0 });
  const r = seen.get(v); r.n++; r.levels.add(x.level); if (!x.dead) r.live++;
}
for (const [v, r] of [...seen].sort((a, b) => b[1].n - a[1].n))
  console.log(`   ${JSON.stringify(v).padEnd(26)} ${String(r.n).padStart(4)}  (${r.live} live)  on ${[...r.levels].join("+")}`);
console.log(`   nodes with no status at all: ${nodes.filter(x => x.n.status == null).length}`);

console.log("\n2. WHICH OF THEM ARE THE SAME STATUS TWICE");
const byLower = new Map();
for (const [v, r] of seen) {
  const k = v.trim().toLowerCase();
  if (!byLower.has(k)) byLower.set(k, []);
  byLower.get(k).push([v, r]);
}
const split = [...byLower].filter(([, vs]) => vs.length > 1);
console.log(`   statuses stored under more than one spelling: ${split.length}`);
for (const [k, vs] of split)
  console.log(`     "${k}" → ${vs.map(([v, r]) => `${JSON.stringify(v)} ×${r.n}`).join(", ")}`);
const splitNodes = split.reduce((s, [, vs]) => s + vs.reduce((t, [, r]) => t + r.n, 0), 0);
console.log(`   nodes carrying one of those spellings: ${splitNodes}`);
// Whitespace is the other way one value becomes two and it reads identical.
const padded = [...seen].filter(([v]) => v !== v.trim());
console.log(`   values with leading/trailing whitespace: ${padded.length}${padded.length ? ` — ${padded.map(([v]) => JSON.stringify(v)).join(", ")}` : ""}`);

console.log("\n3. WHAT THE UI CAN ACTUALLY DISPLAY");
// THE LIST IS THE ORG'S, NOT THE CODE'S, and reading the wrong one is how this
// measurement first reported seven phantom orphans. `settings.statusOpts` is
// user-editable and Matrix has seventeen entries in it; the hardcoded default
// in TRAQS.jsx has five and is only the starting point for a NEW org. A stored
// value outside the ORG's list has no chip, no colour, and cannot be selected
// away from — that is the real test, and it is per-org.
const settings = await get(`orgs/${ORG}/settings.json`);
const known = (settings?.statusOpts || []).map(o => o?.name).filter(Boolean);
console.log(`   statuses in the ORG's statusOpts: ${known.length}`);
const kset = new Set(known);
const orphan = [...seen].filter(([v]) => !kset.has(v));
console.log(`   STORED VALUES THE ORG'S LIST DOES NOT CONTAIN: ${orphan.length}`);
for (const [v, r] of orphan) console.log(`     ${JSON.stringify(v)} ×${r.n} (${r.live} live)`);
// The other half of the same drift: a list entry whose spelling no node uses,
// which is how `Procurment` and `Boxed up ` were found in #446.
const unusedOpt = known.filter(k => !seen.has(k));
console.log(`   list entries no node uses (harmless, but where misspellings hide): ${unusedOpt.length}`);
if (unusedOpt.length) console.log(`     ${unusedOpt.map(s => JSON.stringify(s)).join(", ")}`);
const paddedOpt = known.filter(k => k !== k.trim());
console.log(`   list entries with stray whitespace: ${paddedOpt.length}${paddedOpt.length ? ` — ${paddedOpt.map(s => JSON.stringify(s)).join(", ")}` : ""}`);

console.log("\n4. WHERE A SPLIT WOULD ACTUALLY BITE — the comparisons, not the values");
// R4: a population is not a site. These are the sites.
const files = execSync('git ls-files src netlify', { encoding: "utf8" }).split(/\r?\n/).filter(f => /\.(js|jsx)$/.test(f));
let strict = 0, lowered = 0, helper = 0;
const hits = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/status/i.test(line)) return;
    if (/\.status\s*(===|!==|==|!=)\s*["'`]/.test(line) || /["'`]\s*(===|!==)\s*\w*\.?status\b/.test(line)) {
      if (/toLowerCase\(\)/.test(line)) { lowered++; return; }
      strict++; hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    }
    if (/isClosedStatus|normaliseStatus|normalizeStatus|sameStatus/.test(line)) helper++;
  });
}
console.log(`   case-SENSITIVE comparisons against a status literal: ${strict}`);
console.log(`   comparisons that lower-case first:                   ${lowered}`);
console.log(`   references to a shared status helper:                ${helper}`);
for (const h of hits.slice(0, 30)) console.log(`     ${h}`);
if (hits.length > 30) console.log(`     … and ${hits.length - 30} more`);
