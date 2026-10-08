#!/usr/bin/env node
// #481. The seven capabilities the Edit Job wizard has and Job Details does not.
// Measured on Matrix's live board, because the decision — move it, keep it in a
// wizard, or delete it — turns on whether anybody uses it.
//
//   node scripts/measure-wizard-only.mjs

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
const jobs = all.filter(j => j && !j.deletedAt);

const panels = [], ops = [];
for (const j of jobs) for (const p of j.subs || []) {
  if (!p || p.deletedAt) continue;
  panels.push({ p, j });
  for (const o of p.subs || []) { if (o && !o.deletedAt) ops.push({ o, p, j }); }
}
console.log(`${jobs.length} live jobs, ${panels.length} panels, ${ops.length} ops\n`);
const pct = (n, d) => d ? `${(n / d * 100).toFixed(1)}%` : "—";

const row = (n, label, d, note = "") =>
  console.log(`  ${String(n).padStart(4)} / ${String(d).padEnd(4)} ${pct(n, d).padStart(6)}   ${label}${note ? `\n         ${note}` : ""}`);

console.log("1. DEPENDENCIES  (deps + depsMode, the per-panel control)");
{
  const withDeps = ops.filter(({ o }) => (o.deps || []).length);
  const edges = ops.reduce((s, { o }) => s + (o.deps || []).length, 0);
  row(withDeps.length, "ops that declare a dependency", ops.length);
  console.log(`         ${edges} dep edges in total, across ${new Set(withDeps.map(x => x.j.title)).size} job(s): ${[...new Set(withDeps.map(x => x.j.title))].join(", ") || "none"}`);
  const modes = {};
  for (const { p } of panels) { const m = p.depsMode ?? "(unset)"; modes[m] = (modes[m] || 0) + 1; }
  console.log(`         depsMode across panels: ${JSON.stringify(modes)}`);
}

console.log("\n2. TEMPLATE LOAD");
console.log(`       —          templates live in localStorage (tq_templates_<org>), per browser.`);
console.log(`                  NOT measurable from S3. The usage question cannot be answered here,`);
console.log(`                  only by asking whoever has them. Stated rather than guessed.`);

console.log("\n3. qty  (sub-op quantity)");
{
  const withQty = [...ops, ...panels.map(x => ({ o: x.p }))].filter(({ o }) => o.qty != null && o.qty !== "" && o.qty !== 1);
  row(withQty.length, "nodes with a qty that is set and not 1", ops.length + panels.length);
  const vals = {};
  for (const { o } of [...ops, ...panels.map(x => ({ o: x.p }))]) { const k = String(o.qty ?? "(absent)"); vals[k] = (vals[k] || 0) + 1; }
  console.log(`         values seen: ${JSON.stringify(vals)}`);
}

console.log("\n4. requiredDepartments  (per op)");
{
  const withReq = ops.filter(({ o }) => (o.requiredDepartments || []).length || o.requiredDepartment);
  row(withReq.length, "ops with a required department", ops.length);
  const names = {};
  for (const { o } of ops) for (const d of (o.requiredDepartments || (o.requiredDepartment ? [o.requiredDepartment] : [])))
    names[String(d)] = (names[String(d)] || 0) + 1;
  console.log(`         departments used: ${JSON.stringify(names)}`);
  const pWith = panels.filter(({ p }) => (p.requiredDepartments || []).length || p.requiredDepartment);
  row(pWith.length, "panels with one", panels.length);
}

console.log("\n5. DRAG-TO-REORDER  (ops within a panel)");
{
  // Not directly observable — order is just array position. What IS observable is
  // whether the stored order differs from the order the titles would sort in,
  // which is the only evidence that somebody moved something deliberately.
  let reordered = 0, checked = 0;
  for (const { p } of panels) {
    const t = (p.subs || []).filter(o => o && !o.deletedAt).map(o => String(o.title || ""));
    if (t.length < 2) continue;
    checked++;
    const sorted = [...t].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (JSON.stringify(t) !== JSON.stringify(sorted)) reordered++;
  }
  row(reordered, "panels whose op order is NOT title order", checked);
  console.log(`         INFERRED, and weakly: ops created out of order look the same as ops`);
  console.log(`         dragged. This is an upper bound on deliberate reordering, not a count.`);
}

console.log("\n6. OVERRIDE START DATE  (_rescheduleStartDate / isReschedule)");
{
  // #462 cleaned the live residue, so this reads the field's own footprint plus
  // the flag that survives it.
  const resched = jobs.filter(j => j.isReschedule);
  row(resched.length, "jobs flagged isReschedule", jobs.length);
  const override = jobs.filter(j => j._rescheduleStartDate);
  row(override.length, "jobs still carrying _rescheduleStartDate", jobs.length,
    "cleaned on 2026-10-08 (#462) and stripped on every save since, so 0 here means the field is no longer persisted, NOT that the control is unused.");
  const later = jobs.filter(j => j.scheduledLater);
  row(later.length, "jobs flagged scheduledLater", jobs.length);
}

console.log("\n7. PER-OP hpd  (the estimate, now inline in Job Details)");
{
  const withH = ops.filter(({ o }) => (Number(o.hpd) || 0) > 0);
  row(withH.length, "ops carrying an estimate", ops.length);
  const panelOwn = panels.filter(({ p }) => !(p.subs || []).length);
  row(panelOwn.length, "panels with NO ops, which own their own estimate", panels.length,
    "these are the only panels whose Est. h cell is editable; the rest show a roll-up.");
  const panelDatesOwn = panels.filter(({ p }) => !(p.subs || []).some(o => o && !o.deletedAt && o.start && o.end));
  row(panelDatesOwn.length, "panels with no DATED ops, which own their own dates", panels.length);
}
