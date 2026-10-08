#!/usr/bin/env node
// THE FINISH-REQUEST CLUSTER. Root cause 2d collapsed three representations to
// `finishRequests[]`; #460 found the approval card reading a fifth hours source
// and #463 found neither `pendingFinish` nor `finishRequests` pinned server-side.
// This measures what is actually left.
//
//   1. how many representations survive in the DATA
//   2. which surfaces read which, in the CODE (web and iOS)
//   3. whether a request raised on iOS and approved on the web agree
//
//   node scripts/measure-finish-requests.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { pendingFinishOf, pendingEntriesOf } from "../src/finishRequests.js";

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

const nodes = [];
const walk = (ns, job, lvl, anc) => (ns || []).forEach(n => {
  if (!n) return;
  const dead = anc || !!n.deletedAt;
  if (!dead) nodes.push({ n, job, lvl });
  walk(n.subs, job, lvl + 1, dead);
});
all.filter(j => j && !j.deletedAt).forEach(j => walk([j], j, 0, false));
console.log(`${nodes.length} live nodes\n`);

// ── 1. THE REPRESENTATIONS, IN THE DATA ───────────────────────────────────
const REPS = {
  "finishRequests[] (authoritative)": n => Array.isArray(n.finishRequests) && n.finishRequests.length > 0,
  "pendingFinish === true (mirror)":  n => n.pendingFinish === true,
  "pendingFinish key present":        n => "pendingFinish" in n,
  "finishRequest (deprecated ptr)":   n => n.finishRequest != null,
  "pendingSession":                   n => n.pendingSession != null,
  "finishedAt":                       n => n.finishedAt != null,
};
console.log("1. REPRESENTATIONS PRESENT IN THE DATA");
for (const [label, f] of Object.entries(REPS))
  console.log(`   ${String(nodes.filter(({ n }) => f(n)).length).padStart(4)}  ${label}`);

// The combinations that actually occur — the thing the header table counted.
const combo = new Map();
for (const { n } of nodes) {
  const has = [
    (n.finishRequests || []).some(r => r?.status === "pending") ? "pendingEntry" : null,
    n.pendingFinish === true ? "mirror" : null,
    n.finishRequest != null ? "ptr" : null,
    n.pendingSession != null ? "session" : null,
  ].filter(Boolean);
  const resolved = (n.finishRequests || []).some(r => r && r.status !== "pending");
  const k = has.length || resolved ? `${has.join("+") || "(none)"}${resolved ? " | resolved entries" : ""}` : null;
  if (k) combo.set(k, (combo.get(k) || 0) + 1);
}
console.log(`\n   COMBINATIONS THAT OCCUR (the shape the header's 9/1/1 table counted):`);
if (!combo.size) console.log(`     none — no node carries any finish-request state at all`);
for (const [k, v] of [...combo.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`     ${String(v).padStart(4)}  ${k}`);

// Does the reconciliation rule ever DISAGREE with the raw mirror?
const disagree = nodes.filter(({ n }) => pendingFinishOf(n) !== (n.pendingFinish === true));
console.log(`\n   pendingFinishOf() vs the raw mirror: ${disagree.length} node(s) disagree`);
disagree.slice(0, 10).forEach(({ n, job }) => console.log(
  `     ${job.title} / ${n.title}: rule=${pendingFinishOf(n)} mirror=${n.pendingFinish === true} `
  + `entries=${(n.finishRequests || []).length} pending=${pendingEntriesOf(n).length}`));

// Entry shape — what a request records, and whether every entry has it.
const entries = nodes.flatMap(({ n, job }) => (n.finishRequests || []).map(r => ({ r, n, job })));
console.log(`\n   ${entries.length} finishRequests entries in total`);
if (entries.length) {
  const keys = new Map();
  for (const { r } of entries) for (const k of Object.keys(r || {})) keys.set(k, (keys.get(k) || 0) + 1);
  console.log(`   key coverage across entries:`);
  for (const [k, v] of [...keys.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(v).padStart(4)}/${entries.length}  ${k}${v < entries.length ? "   <- NOT ON EVERY ENTRY" : ""}`);
  const byStatus = {};
  for (const { r } of entries) byStatus[String(r?.status)] = (byStatus[String(r?.status)] || 0) + 1;
  console.log(`   by status: ${JSON.stringify(byStatus)}`);
  // Who resolved, and does the entry say?
  const resolved = entries.filter(({ r }) => r && r.status !== "pending");
  const noWho = resolved.filter(({ r }) => r.resolvedBy == null && r.byResolved == null && r.decidedBy == null);
  console.log(`   resolved entries that do NOT record who resolved them: ${noWho.length} of ${resolved.length}`);
  const noWhen = resolved.filter(({ r }) => r.resolvedAt == null && r.decidedAt == null);
  console.log(`   ...and that do NOT record when: ${noWhen.length} of ${resolved.length}`);
}

// ── 2. WHICH SURFACES READ WHICH, IN THE CODE ─────────────────────────────
console.log(`\n2. WHICH SURFACES READ WHICH`);
const root = new URL("..", import.meta.url).pathname.replace(/^\//, "");
const files = [];
const scan = (dir, depth = 0) => {
  if (depth > 4) return;
  for (const f of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", ".netlify", "build", "Pods", ".gradle"].includes(f)) continue;
    const p = `${dir}/${f}`;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) scan(p, depth + 1);
    else if (/\.(js|jsx|mjs|swift|kt)$/.test(f)) files.push(p);
  }
};
scan(root.replace(/\/$/, ""));
const PAT = {
  "finishRequests[]": /finishRequests/,
  "pendingFinish":    /pendingFinish(?!Of)/,
  "pendingFinishOf":  /pendingFinishOf/,
  "finishRequest(ptr)": /finishRequest\b(?!s)/,
  "pendingSession":   /pendingSession/,
};
const rows = [];
for (const p of files) {
  let src; try { src = readFileSync(p, "utf8"); } catch { continue; }
  const hit = {};
  let any = false;
  for (const [k, re] of Object.entries(PAT)) { hit[k] = re.test(src); if (hit[k]) any = true; }
  if (any) rows.push({ p: p.replace(root, "").replace(/^\//, ""), hit });
}
const cols = Object.keys(PAT);
console.log(`   ${"file".padEnd(46)}${cols.map(c => c.slice(0, 15).padEnd(17)).join("")}`);
for (const r of rows.sort((a, b) => a.p.localeCompare(b.p)))
  console.log(`   ${r.p.slice(-45).padEnd(46)}${cols.map(c => (r.hit[c] ? "yes" : "-").padEnd(17)).join("")}`);

// The one that matters: a surface reading the MIRROR without the rule.
const mirrorOnly = rows.filter(r => r.hit["pendingFinish"] && !r.hit["pendingFinishOf"]);
console.log(`\n   READS THE MIRROR WITHOUT THE RECONCILIATION RULE: ${mirrorOnly.length}`);
mirrorOnly.forEach(r => console.log(`     ${r.p}`));
