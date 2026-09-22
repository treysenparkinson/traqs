// READ-ONLY. POST-PUSH OVERLAP: do two bars on a row occupy the same time AS DRAWN?
//
// diag-overlap.mjs measures where ops are STORED. This measures where they LAND, which is the
// only place the no-overlap rule can actually be checked -- the difference between the two is
// rowPushHours, the pass that packs a row. A pair that clashes on stored dates is usually fine
// once packed, and a pair that looks fine stored can clash once lengths change.
//
// It imports the shipped rowPushHours and barLengthHours rather than restating them. Every
// time a tool in here has restated the model it has drifted from it and misdirected a
// diagnosis -- a hardcoded nowHour once, a missing hasActiveSession once.
//
//   node tools/diag-packed.mjs

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


import { rowPushHours, barLengthHours, workedSpansByPersonOp, spansDurationMs } from "../src/statsMath.js";

const now = new Date();
const nowHour = now.getHours() + now.getMinutes() / 60;
const perPersonSpans = workedSpansByPersonOp(prod || []);

const producedByOp = new Map();
for (const s of prod || []) if (s && !s.deletedAt && s.opId != null)
  producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));

// Anyone on the clock, keyed by op, from any row -- the same fact the render feeds in.
const activeByOp = new Map();
for (const p of people) {
  const jc = p.activeJobClock;
  if (jc && jc.clockIn && jc.opId != null) activeByOp.set(String(jc.opId), true);
}

// Business days between two dates, weekends only -- the counterpart to addBD above.
const diffBD = (a, b) => {
  if (a === b) return 0;
  const back = b < a;
  let [from, to] = back ? [b, a] : [a, b];
  let t = parse(from), n = 0;
  while (true) {
    t += dayMs;
    const wd = new Date(t).getDay();
    if (wd !== 0 && wd !== 6) n++;
    const d = new Date(t);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (ds >= to) break;
  }
  return back ? -n : n;
};

const cfg = { workStartH: WORK_START, totalWorkH: WORK_END - WORK_START, productiveHoursPerDay: PHPD, diffBD };
let clashes = 0, rowsChecked = 0;

for (const person of people) {
  if (who && !String(person.name || "").toLowerCase().includes(who)) continue;
  const ops = [];
  for (const job of tasks) for (const panel of job.subs || []) for (const op of panel.subs || []) {
    if (!(op.team || []).some((x) => String(x) === String(person.id))) continue;
    if (!op.start || !op.end || op.status === "Finished") continue;
    if (op.end < TODAY) continue;   // history does not render, so it cannot clash visibly
    const size = Math.max(1, (op.team || []).length);
    const worked = Math.max(producedByOp.get(String(op.id)) || 0, Number(op.loggedHours) || 0);
    ops.push({
      id: op.id, title: `${panel.title} · ${op.title}`.slice(0, 40),
      start: op.start, end: op.end, startHour: op.startHour ?? WORK_START,
      hpd: Number(op.hpd) || 0, teamSize: size,
      workedHoursShown: worked, isFullyWorked: false, locked: !!op.locked,
      ownWorkedHours: spansDurationMs(perPersonSpans.get(String(person.id))?.get(String(op.id)) || []) / 3600000,
      // THIS person's own session, matching the shipped rule. Keying on anyone's clock
      // models the behaviour that produced the muted slab, not the one that ships.
      hasActiveSession: !!(person.activeJobClock && person.activeJobClock.clockIn
        && String(person.activeJobClock.opId) === String(op.id)),
    });
  }
  if (ops.length < 2) continue;
  rowsChecked++;
  ops.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const { pushes } = rowPushHours({ ops, nowDay: TODAY, nowHour, cfg });
  // Productive hours from the row's first op, which is the axis rowPushHours works in.
  const base = ops[0];
  // dayFraction, exactly as statsMath defines it: a CLOCK hour scaled into productive hours.
  // Using the raw clock offset here made every length disagree with the cascade by the lunch
  // break's share of the day -- which showed up as two 0.2h "overlaps" that were the tool's.
  const frac = (h) => (h - WORK_START) * PHPD / (WORK_END - WORK_START);
  const prodAt = (ds, h) => diffBD(base.start, ds) * PHPD + frac(h) - frac(base.startHour);
  const nowProd = prodAt(TODAY, nowHour);

  const iv = ops.map((o) => {
    const s = prodAt(o.start, o.startHour) + (pushes.get(String(o.id)) || 0);
    const len = barLengthHours({ ...o, elapsedToCursorH: Math.max(0, nowProd - s) });
    return { o, s, e: s + len };
  });

  const bad = [];
  for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++) {
    if (iv[i].s < iv[j].e && iv[j].s < iv[i].e) bad.push([iv[i], iv[j]]);
  }
  if (!bad.length) continue;
  clashes += bad.length;
  console.log(`
${person.name || person.id}  ${bad.length} packed overlap(s)`);
  for (const [a, b] of bad) {
    console.log(`    ${a.s.toFixed(1)}..${a.e.toFixed(1)}h  ${a.o.title}`);
    console.log(`    ${b.s.toFixed(1)}..${b.e.toFixed(1)}h  ${b.o.title}`);
  }
}

console.log(`
today ${TODAY} ${nowHour.toFixed(2)}h   rows ${rowsChecked}   PACKED overlaps: ${clashes}`);
process.exit(clashes === 0 ? 0 : 1);
