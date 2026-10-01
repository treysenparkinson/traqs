#!/usr/bin/env node
// Repair the loggedHours counters that #323 destroyed.
//
// The clock paths credited job, panel and op correctly; the client's whole-tree autosave then
// put a pre-credit copy back, or dropped the key entirely. The session rows in
// productionhours.json were never touched by that race — they are written by their own
// handler to their own file — so they are the record this rebuilds from.
//
// ── The rule: RAISE ONLY ────────────────────────────────────────────────────────────────
// Not `counter = sum(rows)`. These counters legitimately hold hours no row explains:
//
//   - "Set Worked Hours" offers "Nobody — job progress only", which writes the counter and
//     no row at all;
//   - ops worked before productionhours.json existed (2026-07-06) still carry their totals.
//     One op in Matrix holds 68.3h against zero rows.
//
// Summing rows would delete both — 90.16h of them on Matrix today. So a counter is raised to
// the sum of its rows and never lowered, which is exactly `max(counter, rows)`, the rule the
// SCHEDULE already displays by. That is why the UI has looked right while the stored ledger
// rotted underneath it, and it means this backfill cannot invent or destroy an hour: it can
// only restore one the rows already prove.
//
// Deliberately NOT recomputing what each session was worth. The rows keep the wall-clock
// hours they were written with, including the nine over twelve hours that hold 320.55h of
// Matrix's 1,083.6h. Restating those is #325 — a separate decision, because production hours
// feed efficiency and people have been paid against them. `--sessions` prints what that
// restatement would do, and changes nothing.
//
// Run the write path fix FIRST. Backfilling while /tasks still accepts a stale counter just
// feeds the race again.
//
//   node scripts/backfill-logged-hours.mjs                 # dry run, the default
//   node scripts/backfill-logged-hours.mjs --sessions      # #325 deltas, read-only
//   node scripts/backfill-logged-hours.mjs --apply         # write it
//
// Credentials come from .env (S3_BUCKET, MY_AWS_*). --org defaults to MTX2026TRAQS.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { buildDayWindows, sessionWorkedHours } from "../src/statsMath.js";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const APPLY = has("--apply");
const SESSIONS = has("--sessions");
const ORG = val("--org", "MTX2026TRAQS");
const r2 = (x) => Math.round(x * 100) / 100;

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const key = (f) => `orgs/${ORG}/${f}.json`;
const get = async (f) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key(f) }))).Body.transformToString());

const [tasks, prod, settings] = await Promise.all([get("tasks"), get("productionhours"), get("settings").catch(() => ({}))]);
const live = prod.filter(s => s && !s.deletedAt);
console.log(`org ${ORG}: ${tasks.length} jobs, ${prod.length} session rows (${live.length} live)`);
console.log(APPLY ? "MODE: APPLY — tasks.json will be written\n" : "MODE: dry run — nothing will be written\n");

// ── #325: what restating the sessions would do. Read-only, always. ──────────
if (SESSIONS) {
  const cfg = {
    ...buildDayWindows(
      Number(String(settings.workStart || "08:00").split(":")[0]) + Number(String(settings.workStart || "08:00").split(":")[1] || 0) / 60,
      Number(String(settings.workEnd || "17:00").split(":")[0]) + Number(String(settings.workEnd || "17:00").split(":")[1] || 0) / 60,
      settings.breaks, settings.lunch),
    workDays: settings.workDays || [1, 2, 3, 4, 5], holidays: settings.holidays || [], timeZone: settings.timeZone || null,
  };
  const rows = [];
  for (const s of live) {
    const a = Date.parse(s.clockIn), b = Date.parse(s.clockOut);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (s.source === "manual") continue;                 // corrections are already a judgement
    const now = sessionWorkedHours({ clockInMs: a, clockOutMs: b, cfg }).hours;
    const was = Number(s.hours) || 0;
    if (Math.abs(now - was) < 0.01) continue;
    rows.push({ date: s.date, person: s.personId, op: s.opTitle || s.opId, was, now, delta: r2(now - was) });
  }
  rows.sort((x, y) => x.delta - y.delta);
  console.log(`#325 — recomputing ${live.filter(s => s.source !== "manual").length} clocked sessions at productive hours would change ${rows.length}:\n`);
  console.log("  date         was      would be   delta     op");
  for (const r of rows) console.log(`  ${r.date}  ${String(r.was).padStart(7)}h  ${String(r.now).padStart(8)}h  ${String(r.delta).padStart(8)}h  ${String(r.op).slice(0, 34)}`);
  const tot = r2(rows.reduce((a, r) => a + r.delta, 0));
  console.log(`\n  total change ${tot}h against ${r2(live.reduce((a, s) => a + (Number(s.hours) || 0), 0))}h recorded`);
  console.log("  NOT APPLIED — this is the size of the decision, not a plan.");
  process.exit(0);
}

// ── sums by node ────────────────────────────────────────────────────────────
const sum = (k) => {
  const m = new Map();
  for (const s of live) { const id = s[k]; if (id == null || id === "") continue;
    m.set(String(id), r2((m.get(String(id)) || 0) + (Number(s.hours) || 0))); }
  return m;
};
const byOp = sum("opId"), byPanel = sum("panelId"), byJob = sum("jobId");

const changes = [];
const repair = (node, rows, level, label) => {
  const stored = Number(node.loggedHours) || 0;
  const want = rows.get(String(node.id));
  if (want == null) return node;                        // no rows → nothing to prove a raise
  if (!(want > stored + 0.001)) return node;            // raise only
  changes.push({ level, id: String(node.id), label, from: node.loggedHours ?? null, to: r2(want), delta: r2(want - stored) });
  return { ...node, loggedHours: r2(want) };
};

const next = tasks.map(job => {
  const panels = (job.subs || []).map(panel => {
    const ops = (panel.subs || []).map(op => repair(op, byOp, "op", `${job.title} / ${panel.title} / ${op.title}`));
    const p2 = repair({ ...panel, subs: ops }, byPanel, "panel", `${job.title} / ${panel.title}`);
    return p2;
  });
  return repair({ ...job, subs: panels }, byJob, "job", job.title);
});

for (const lvl of ["op", "panel", "job"]) {
  const rs = changes.filter(c => c.level === lvl);
  const absent = rs.filter(c => c.from === null).length;
  console.log(`${lvl.toUpperCase().padEnd(6)} ${String(rs.length).padStart(3)} to repair, +${r2(rs.reduce((a, c) => a + c.delta, 0))}h   (${absent} had the field deleted outright)`);
}
console.log();
for (const c of changes.sort((a, b) => b.delta - a.delta).slice(0, 25))
  console.log(`  ${c.level.padEnd(5)} ${String(c.from ?? "absent").padStart(8)} → ${String(c.to).padStart(8)}  (+${String(c.delta).padStart(7)})  ${c.label.slice(0, 56)}`);
if (changes.length > 25) console.log(`  … and ${changes.length - 25} more`);
console.log(`\ntotal ${changes.length} nodes, +${r2(changes.reduce((a, c) => a + c.delta, 0))}h restored`);

// Nothing is ever lowered, so a node that disagrees downward is left alone and reported —
// those are the counters that legitimately exceed their rows and must survive this.
const kept = [];
for (const job of tasks) {
  const chk = (node, rows, lvl, label) => { const st = Number(node.loggedHours) || 0; const w = rows.get(String(node.id)) || 0;
    if (st > w + 0.001) kept.push({ lvl, label, stored: r2(st), rows: r2(w) }); };
  chk(job, byJob, "job", job.title);
  for (const p of (job.subs || [])) { chk(p, byPanel, "panel", `${job.title} / ${p.title}`);
    for (const o of (p.subs || [])) chk(o, byOp, "op", `${job.title} / ${p.title} / ${o.title}`); }
}
console.log(`\n${kept.length} counters exceed their rows and are LEFT ALONE (manual credit, or work predating productionhours.json):`);
for (const k of kept.slice(0, 10)) console.log(`  ${k.lvl.padEnd(5)} stored ${String(k.stored).padStart(8)}  rows ${String(k.rows).padStart(8)}   ${k.label.slice(0, 54)}`);

if (!APPLY) { console.log("\nDry run. Re-run with --apply to write."); process.exit(0); }
if (!changes.length) { console.log("\nNothing to do."); process.exit(0); }

// Write through PutObject directly: this is a one-off repair, not an app write, and it must
// not publish a realtime delta or stamp lastModifiedAt on every node it touches.
const body = JSON.stringify(next);
if (!Array.isArray(next) || next.length !== tasks.length) { console.error("refusing: shape changed"); process.exit(1); }
await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key("tasks"), Body: body, ContentType: "application/json" }));
console.log(`\nWROTE ${key("tasks")} — ${changes.length} counters repaired, +${r2(changes.reduce((a, c) => a + c.delta, 0))}h.`);
console.log("S3 versioning is on; the previous version is one restore away.");
