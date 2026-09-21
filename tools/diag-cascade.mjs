// READ-ONLY. How far does a person's row cascade, in real data, with the real push rules?
//
// Written after the backlog regression: the cursor push applied to every past-due op, so rows
// ran months into the future and bars were painted off the window. This runs the SAME
// rowPushHours the schedule runs, against live tasks.json, and reports the worst push per row.
//
//   node tools/diag-cascade.mjs           every row, worst first
//   node tools/diag-cascade.mjs Tyler     one row, op by op

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { rowPushHours } from "../src/statsMath.js";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const [tasks, people, prod] = await Promise.all([
  get("orgs/MTX2026TRAQS/tasks.json"), get("orgs/MTX2026TRAQS/people.json"),
  get("orgs/MTX2026TRAQS/productionhours.json").catch(() => []),
]);

const who = (process.argv[2] || "").toLowerCase();
const PHPD = 7.5, WORK_START = 8, TOTAL_WORK = 8;
const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;

// Business days between two ISO dates, weekends only (holidays ignored — this is a magnitude
// check, not a placement check).
const dayMs = 86400000;
const bd = (a, b) => {
  // Arithmetic, not a day-by-day walk: across a summer of data the loop version took minutes.
  const A = new Date(a + "T12:00:00"), B = new Date(b + "T12:00:00");
  const sign = B >= A ? 1 : -1;
  const lo = sign > 0 ? A : B, hi = sign > 0 ? B : A;
  const days = Math.round((hi - lo) / dayMs);
  let n = Math.floor(days / 7) * 5;
  let d = new Date(lo);
  for (let i = 0; i < days % 7; i++) { d = new Date(d.getTime() + dayMs); const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++; }
  return sign * n;
};
const producedByOp = new Map();
for (const s of prod || []) if (s && !s.deletedAt && s.opId != null) producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));

const rows = [];
for (const person of people) {
  const ops = [];
  for (const job of tasks) for (const panel of job.subs || []) for (const op of panel.subs || []) {
    if (!(op.team || []).some((x) => String(x) === String(person.id))) continue;
    if (!op.start || !op.end || op.status === "Finished") continue;
    const worked = Math.max(producedByOp.get(String(op.id)) || 0, Number(op.loggedHours) || 0);
    ops.push({ id: op.id, start: op.start, end: op.end, startHour: op.startHour ?? WORK_START,
      hpd: Number(op.hpd) || 0, teamSize: Math.max(1, (op.team || []).length),
      workedHoursShown: worked, isFullyWorked: op.status === "Finished", locked: !!op.locked, title: `${panel.title} · ${op.title}` });
  }
  if (!ops.length) continue;
  ops.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const NOWDAY = process.env.NO_CURSOR ? null : TODAY;
  const r = rowPushHours({ ops, nowDay: NOWDAY, nowHour: 8, cfg: { workStartH: WORK_START, totalWorkH: TOTAL_WORK, productiveHoursPerDay: PHPD, diffBD: bd } });
  const worst = Math.max(0, ...[...r.pushes.values()]);
  rows.push({ name: person.name, ops, r, worst, anchored: r.atCursor.size });
}

if (who) {
  const row = rows.find((x) => (x.name || "").toLowerCase().includes(who));
  if (!row) { console.log(`no row matching "${who}"`); process.exit(0); }
  console.log(`${row.name} — ${row.ops.length} ops, ${row.anchored} cursor-anchored, worst push ${row.worst.toFixed(1)}h (${(row.worst / PHPD).toFixed(1)} working days)\n`);
  for (const op of row.ops) {
    const push = row.r.pushes.get(String(op.id)) || 0;
    const tag = row.r.atCursor.has(String(op.id)) ? " AT-CURSOR" : "";
    console.log(`  ${op.start}..${op.end}  ${String(op.hpd).padStart(6)}h  push ${push.toFixed(1).padStart(7)}h${tag}  ${op.title}`);
  }
} else {
  rows.sort((a, b) => b.worst - a.worst);
  console.log(`today ${TODAY} — worst push per row (a row running months out is the regression)\n`);
  for (const r of rows.slice(0, 12)) {
    console.log(`  ${(r.name || "?").padEnd(12)} ${String(r.ops.length).padStart(3)} ops  ${String(r.anchored).padStart(3)} at-cursor  worst ${r.worst.toFixed(0).padStart(6)}h = ${(r.worst / PHPD).toFixed(0).padStart(4)} working days`);
  }
}
