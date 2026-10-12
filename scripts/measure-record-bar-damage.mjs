#!/usr/bin/env node
// #17. DID A RECORD BAR EVER GET DRAGGED, AND DID IT WRITE WORKED HOURS INTO hpd?
//
// The entry says cross-row record bars are draggable in the day view and write
// worked hours into `hpd`. The refusal that stops it (`kind: "record"` in
// dragMove.js) shipped with root cause 7B, d9d2386, 2026-09-30. Cross-row bars
// themselves shipped 401d528, 2026-09-21. So if the defect was ever reachable,
// the window is NINE DAYS and the damage is still in the tree.
//
// WHAT A DRAG LEAVES BEHIND. Every committed drag writes a moveLog entry
// carrying fromHpd/toHpd and fromStartHour/toStartHour, and a resize carries
// `reason: "Resized in schedule"`. So the question is answerable from the
// record rather than inferred from the current values.
//
//   node scripts/measure-record-bar-damage.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = "MTX2026TRAQS";
const WINDOW = { from: "2026-09-21", to: "2026-09-30" };   // cross-row bars -> the record refusal
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const tasks = await get(`orgs/${ORG}/tasks.json`);
const prod = await get(`orgs/${ORG}/productionhours.json`);

// Walk every node, carrying its job/panel for reporting.
const nodes = [];
for (const job of tasks || []) {
  if (!job || job.deletedAt) continue;
  nodes.push({ n: job, level: "job", job });
  for (const panel of job.subs || []) {
    if (!panel || panel.deletedAt) continue;
    nodes.push({ n: panel, level: "panel", job, panel });
    for (const op of panel.subs || []) {
      if (!op || op.deletedAt) continue;
      nodes.push({ n: op, level: "op", job, panel });
    }
  }
}
console.log(`tasks.json: ${nodes.length} live nodes (${nodes.filter(x => x.level === "op").length} ops)`);
console.log(`productionhours.json: ${(prod || []).filter(r => r && !r.deletedAt).length} live session rows\n`);

console.log("1. EVERY MOVELOG ENTRY IN THE EXPOSURE WINDOW");
console.log(`   ${WINDOW.from} (cross-row bars shipped) → ${WINDOW.to} (the record refusal shipped)`);
const inWindow = [];
for (const x of nodes)
  for (const e of x.n.moveLog || [])
    if (e?.date >= WINDOW.from && e?.date <= WINDOW.to) inWindow.push({ ...x, e });
console.log(`   moveLog entries in the window: ${inWindow.length}`);
const hpdChanged = inWindow.filter(x => x.e.fromHpd != null && x.e.toHpd != null && Number(x.e.fromHpd) !== Number(x.e.toHpd));
console.log(`   ...of which CHANGED hpd: ${hpdChanged.length}`);
const resizes = inWindow.filter(x => /resiz/i.test(String(x.e.reason || "")));
console.log(`   ...of which were resizes: ${resizes.length}`);

console.log("\n2. ANY hpd CHANGE ANYWHERE IN THE LOG, WINDOW OR NOT");
// Scoping only to the window would miss the thing worth knowing: whether hpd is
// ever rewritten by a drag at all. A population of zero is the cleanest answer
// there is, and it is only trustworthy if the search was not narrowed first.
const allHpd = [];
for (const x of nodes)
  for (const e of x.n.moveLog || [])
    if (e?.fromHpd != null && e?.toHpd != null && Number(e.fromHpd) !== Number(e.toHpd)) allHpd.push({ ...x, e });
console.log(`   moveLog entries that changed hpd, all time: ${allHpd.length}`);
for (const x of allHpd.slice(0, 20))
  console.log(`     ${x.e.date}  ${x.level} "${String(x.n.title || "").slice(0, 34)}"  hpd ${x.e.fromHpd} → ${x.e.toHpd}  by ${x.e.movedBy || "?"}  ${x.e.reason || "(move)"}`);

console.log("\n3. DOES ANY OP'S hpd EQUAL A WORKED FIGURE FOR THAT OP?");
// The signature the entry describes: planned hours overwritten by hours
// someone actually worked. Worked totals come from the session rows, which are
// the record of record — not from loggedHours, which is documented-unreliable.
const workedByOp = new Map();
for (const r of prod || []) {
  if (!r || r.deletedAt || r.opId == null) continue;
  const k = String(r.opId);
  workedByOp.set(k, Math.round(((workedByOp.get(k) || 0) + (Number(r.hours) || 0)) * 100) / 100);
}
console.log(`   ops with any worked hours: ${workedByOp.size}`);
const near = (a, b) => Math.abs(a - b) < 0.011;
const matches = [];
for (const x of nodes) {
  if (x.level !== "op") continue;
  const w = workedByOp.get(String(x.n.id));
  if (w == null || !w) continue;
  const hpd = Number(x.n.hpd);
  if (!hpd) continue;
  if (near(hpd, w)) matches.push({ x, w, hpd });
}
console.log(`   ops whose hpd equals their worked total (±0.01): ${matches.length}`);
for (const m of matches.slice(0, 20))
  console.log(`     "${String(m.x.n.title || "").slice(0, 40)}"  hpd ${m.hpd}  worked ${m.w}  job "${String(m.x.job.title || "").slice(0, 28)}"`);
if (matches.length)
  console.log(`   NOTE: equality is not proof. An op planned for the hours it then took`);
  console.log(`   matches too, and that is the normal case, not the defect.`);

console.log("\n4. WAS THE GESTURE EVEN REACHABLE?");
console.log("   Checked in the tree, not inferred: dragMove.js refuses any member");
console.log("   carrying isRecord with { kind: \"record\" }, the day view passes");
console.log("   isRecord: !!bar.crossRow on the move grab, and handleTeamDayBarDrag's");
console.log("   mouse-up returns before setTasks when refuseDragMove returns a refusal.");
console.log("   Resize handles are suppressed separately (`!bar.crossRow`), and that");
console.log("   guard dates to 401d528 — the commit that introduced cross-row bars.");
console.log("   So a RESIZE was never reachable on a record bar, and a MOVE writes");
console.log("   start/startHour, not hpd. Only a resize writes hpd.");
