#!/usr/bin/env node
// #437. Where did the three "Pending" nodes come from, and who reads the status?
//
// The tray is the only writer of "Pending" in the product, and it wrote it
// WITHOUT a moveLog entry (that is #414, which came later). So a tray-placed
// node has dates and no moveLog covering the placement; a hand-set one can have
// anything. Neither is proof on its own, so both signals are printed rather than
// collapsed into a verdict.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = process.argv[2] || "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const td = await get(`orgs/${ORG}/tasks.json`);
const tasks = (Array.isArray(td) ? td : td.tasks || []).filter(j => j && !j.deletedAt);
const settings = await get(`orgs/${ORG}/settings.json`).catch(() => ({}));
const statusOpts = (settings.statusOpts || []).map(o => o.name);

console.log(`ORG ${ORG}`);
console.log(`statusOpts (${statusOpts.length}): ${JSON.stringify(statusOpts)}`);
console.log(`has "Pending": ${statusOpts.includes("Pending")}\n`);

console.log("1. THE NODES CARRYING \"Pending\"");
let n = 0;
for (const j of tasks) for (const p of j.subs || []) {
  const kids = [["panel", p], ...(p.subs || []).map(o => ["op", o])];
  for (const [lvl, node] of kids) {
    if (node.deletedAt || node.status !== "Pending") continue;
    n++;
    const log = node.moveLog || [];
    console.log(`   ${j.title || j.id} / ${lvl} ${node.title || node.id}`);
    console.log(`     dates: ${node.start || "(none)"} -> ${node.end || "(none)"}   team: ${JSON.stringify(node.team || [])}`);
    console.log(`     moveLog entries: ${log.length}${log.length ? `  (reasons: ${[...new Set(log.map(e => e.reason || "-"))].join(" | ")})` : ""}`);
    console.log(`     any entry recording a status change: ${log.some(e => "toStatus" in e)}`);
    console.log(`     loggedHours: ${node.loggedHours ?? 0}   lastModifiedAt: ${node.lastModifiedAt || "-"}`);
  }
}
if (!n) console.log("   (none)");

console.log("\n2. WHAT A STATUS CHANGE WOULD MOVE — the readers, by population");
const flat = [];
for (const j of tasks) for (const p of j.subs || []) {
  const ops = (p.subs || []).filter(o => o && !o.deletedAt);
  if (ops.length) flat.push(...ops.map(o => ({ node: o, panel: p }))); else flat.push({ node: p, panel: null });
}
const dated = flat.filter(x => x.node.start && x.node.end);
const TD = new Date().toISOString().slice(0, 10);
const past = dated.filter(x => TD > x.node.start && !(x.node.loggedHours > 0));
console.log(`   schedulable units: ${flat.length}, dated: ${dated.length}`);
console.log(`   dated, started date passed, nothing logged: ${past.length}`);
console.log(`   -> these are the ones the health dot's "Not Started" short-circuit sends`);
console.log(`      straight to CRITICAL. A "Pending" node skips that branch entirely.`);
const byStatus = {};
for (const x of flat) { const s = x.node.status || "(none)"; byStatus[s] = (byStatus[s] || 0) + 1; }
console.log(`   statuses in use: ${JSON.stringify(byStatus)}`);
const unknown = Object.keys(byStatus).filter(s => s !== "(none)" && statusOpts.length && !statusOpts.includes(s));
console.log(`   statuses NOT in the org's own list: ${JSON.stringify(unknown)}`);
