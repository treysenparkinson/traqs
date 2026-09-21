// READ-ONLY. Do two ops on the same row occupy the same time?
//
// Checks BOTH layers, because they can disagree:
//   DATA    — stored start/end ranges that intersect
//   VISUAL  — rendered extents that intersect. A bar's drawn length comes from hpd, NOT from
//             op.end, so an op can be "historical" by its stored end and still be painted
//             weeks past today. That mismatch is its own overlap source.
//
//   node tools/diag-overlap.mjs            worst rows first
//   node tools/diag-overlap.mjs Tyler      one row, every clash listed

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const [tasks, people, prod] = await Promise.all([
  get("orgs/MTX2026TRAQS/tasks.json"), get("orgs/MTX2026TRAQS/people.json"),
  get("orgs/MTX2026TRAQS/productionhours.json").catch(() => []),
]);

const who = (process.argv[2] || "").toLowerCase();
const PHPD = 7.5, WORK_START = 8, WORK_END = 16;
const hourTs = (ds, h) => new Date(ds + "T00:00:00").getTime() + h * 3600000;
const dayMs = 86400000;
const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
const parse = (ds) => new Date(ds + "T12:00:00").getTime();
// Business days forward from a date, weekends only.
const addBD = (ds, n) => {
  let t = parse(ds), left = Math.max(0, Math.round(n));
  while (left > 0) { t += dayMs; const wd = new Date(t).getDay(); if (wd !== 0 && wd !== 6) left--; }
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const producedByOp = new Map();
for (const s of prod || []) if (s && !s.deletedAt && s.opId != null) producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));

const rows = [];
for (const person of people) {
  const ops = [];
  for (const job of tasks) for (const panel of job.subs || []) for (const op of panel.subs || []) {
    if (!(op.team || []).some((x) => String(x) === String(person.id))) continue;
    if (!op.start || !op.end || op.status === "Finished") continue;
    const size = Math.max(1, (op.team || []).length);
    const worked = Math.max(producedByOp.get(String(op.id)) || 0, Number(op.loggedHours) || 0);
    const perPerson = ((Number(op.hpd) || 0) > 0 ? Number(op.hpd) / size : PHPD)
      + Math.max(0, worked - (Number(op.hpd) || 0)) / size;          // + overrun, as the render does
    const spanBD = Math.max(0, Math.ceil(perPerson / PHPD) - 1);
    const sH = op.startHour ?? WORK_START;
    const eH = op.start === op.end
      ? (op.endHour ?? Math.min(sH + perPerson, WORK_END))
      : (op.endHour ?? WORK_END);
    const vEnd = addBD(op.start, spanBD);
    ops.push({
      id: op.id, title: `${panel.title} · ${op.title}`.slice(0, 44),
      start: op.start, end: op.end, sH, eH,
      // Hour-precision extents. Comparing DATES alone counts two ops that share a day but sit
      // at 08:00-12:00 and 13:00-16:00 as a clash, which they are not.
      dataS: hourTs(op.start, sH), dataE: hourTs(op.end, eH),
      visS: hourTs(op.start, sH), visE: hourTs(vEnd, op.start === vEnd ? Math.min(sH + perPerson, WORK_END) : WORK_END),
      visualEnd: vEnd, hpd: Number(op.hpd) || 0, worked,
      historical: op.end < TODAY,
    });
  }
  if (ops.length < 2) continue;
  ops.sort((a, b) => a.start.localeCompare(b.start));

  // Strict inequality: touching end-to-start is adjacency, not overlap.
  const over = (aS, aE, bS, bE) => aS < bE && bS < aE;
  const dataHits = [], visualHits = [];
  for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) {
    const a = ops[i], b = ops[j];
    if (over(a.dataS, a.dataE, b.dataS, b.dataE)) dataHits.push([a, b]);
    if (over(a.visS, a.visE, b.visS, b.visE)) visualHits.push([a, b]);
  }
  rows.push({ name: person.name, ops, dataHits, visualHits });
}

if (who) {
  const row = rows.find((r) => (r.name || "").toLowerCase().includes(who));
  if (!row) { console.log(`no row matching "${who}"`); process.exit(0); }
  console.log(`${row.name} — ${row.ops.length} ops, ${row.dataHits.length} DATA overlaps, ${row.visualHits.length} VISUAL overlaps\n`);
  for (const [a, b] of row.visualHits.slice(0, 15)) {
    const inData = a.start <= b.end && b.start <= a.end;
    console.log(`  ${inData ? "DATA+VISUAL" : "VISUAL ONLY"}`);
    console.log(`    ${a.start} ${a.sH}h .. ${a.end} ${a.eH}h  (paints to ${a.visualEnd}, ${a.hpd}h)${a.historical ? " HISTORICAL" : ""}  ${a.title}`);
    console.log(`    ${b.start} ${b.sH}h .. ${b.end} ${b.eH}h  (paints to ${b.visualEnd}, ${b.hpd}h)${b.historical ? " HISTORICAL" : ""}  ${b.title}`);
    console.log("");
  }
} else {
  rows.sort((a, b) => b.visualHits.length - a.visualHits.length);
  const totD = rows.reduce((s, r) => s + r.dataHits.length, 0);
  const totV = rows.reduce((s, r) => s + r.visualHits.length, 0);
  console.log(`today ${TODAY}\nDATA overlaps: ${totD}    VISUAL overlaps: ${totV}\n`);
  for (const r of rows.slice(0, 12)) {
    console.log(`  ${(r.name || "?").padEnd(12)} ${String(r.ops.length).padStart(3)} ops   data ${String(r.dataHits.length).padStart(4)}   visual ${String(r.visualHits.length).padStart(4)}`);
  }
}
