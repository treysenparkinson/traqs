#!/usr/bin/env node
// Why does a scheduled job leave empty days between bars on one person's row?
//
// Three causes, three different responses, told apart by evidence rather than
// by eye:
//
//   OBJECTIVE      even load spreads work across people, so any single job's
//                  bars are sparse on any one row. The gap days hold OTHER
//                  jobs. Nothing to fix.
//   PRECEDENCE     op N+1 of a panel cannot start until op N ends. The person
//                  is idle because the work is not ready. Makespan cannot fill
//                  it either.
//   NO BACKFILL    an op that COULD have gone in the hole — predecessor done,
//                  person free — was placed after it instead. That is a defect.
//
// The deciding measurement is CREW UTILISATION. A hole can only be filled if
// there is slack to fill it with. Reporting "the plan has gaps" without first
// showing there was room is how you end up optimising a schedule that was
// already oversubscribed.
//
//   node scripts/measure-plan-gaps.mjs [--org MTX2026TRAQS] [--job <id|title>] [--recent 1]

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ORG = val("--org", "MTX2026TRAQS");
const JOB = val("--job", null);
const RECENT = Number(val("--recent", 1));

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const td = await get(`orgs/${ORG}/tasks.json`);
const pd = await get(`orgs/${ORG}/people.json`);
const tasks = Array.isArray(td) ? td : (td.tasks || td.records || []);
const people = Array.isArray(pd) ? pd : (pd.people || pd.records || []);
const nameOf = (id) => (people.find(p => String(p.id) === String(id)) || {}).name || `#${id}`;

const D = (s) => new Date(s + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const isWD = (d) => { const w = d.getUTCDay(); return w !== 0 && w !== 6; };
const bdays = (a, b) => { if (!a || !b || a > b) return []; const o = []; let d = D(a);
  for (let i = 0; i < 2000 && iso(d) <= b; i++) { if (isWD(d)) o.push(iso(d)); d = new Date(d.getTime() + 864e5); } return o; };
const dated = (j) => (j.subs || []).flatMap(p => (p.subs || []).length ? p.subs : [p]).filter(o => o.start && o.end);

// hpd is the op's TOTAL estimated hours, not hours-per-day: pickTeam derives
// duration as ceil(hpd / productiveHoursPerDay) and divides by team size. Every
// hour figure below follows that same reading.
const HPD = 7.5;

let job;
if (JOB) job = tasks.find(j => String(j.id) === JOB || String(j.title || "").toLowerCase().includes(JOB.toLowerCase()));
else job = tasks.filter(j => dated(j).length > 1)
  .sort((a, b) => String(b.lastModifiedAt || "").localeCompare(String(a.lastModifiedAt || "")))[RECENT - 1];
if (!job) { console.log("No job matched."); process.exit(0); }

const panelOf = new Map();
for (const p of (job.subs || [])) for (const o of (p.subs || [])) panelOf.set(String(o.id), String(p.id));
const placed = dated(job).map(o => ({ ...o, team: (o.team || []).map(String) })).filter(o => o.team.length);
if (!placed.length) { console.log("Nothing assigned — no idle days to attribute."); process.exit(0); }

const spanStart = placed.reduce((a, o) => o.start < a ? o.start : a, placed[0].start);
const spanEnd = placed.reduce((a, o) => o.end > a ? o.end : a, placed[0].end);
const win = bdays(spanStart, spanEnd);
const crew = [...new Set(placed.flatMap(o => o.team))];

console.log(`JOB   ${job.title || job.id}  (${job.id})   modified ${job.lastModifiedAt || "—"}`);
console.log(`SPAN  ${spanStart} → ${spanEnd}   ${win.length} business days, ${placed.length} placed ops, ${crew.length} people\n`);

const mapFor = (keep) => {
  const m = new Map(crew.map(p => [p, new Map()]));
  for (const j of tasks) {
    if (!keep(j)) continue;
    for (const o of dated(j)) {
      const team = (o.team || []).map(String);
      const ds = bdays(o.start, o.end); if (!ds.length || !team.length) continue;
      const sh = (Number(o.hpd) || HPD) / team.length / ds.length;
      for (const pid of team) { const mm = m.get(pid); if (!mm) continue; for (const d of ds) mm.set(d, (mm.get(d) || 0) + sh); }
    }
  }
  return m;
};
const other = mapFor(j => String(j.id) !== String(job.id));
const all = mapFor(() => true);

// ── 1. idle days inside this job, and what each one is ─────────────────────
let idleTot = 0, idleFill = 0, idlePrec = 0, idleElse = 0;
console.log("PERSON        OPS  THIS-JOB DAYS   IDLE   BACKFILLABLE  PRECEDENCE  ON ANOTHER JOB");
for (const pid of crew) {
  const ops = placed.filter(o => o.team.includes(pid)).sort((a, b) => a.start.localeCompare(b.start));
  const busy = new Set(ops.flatMap(o => bdays(o.start, o.end)));
  const w = bdays(ops[0].start, ops[ops.length - 1].end);
  const idle = w.filter(d => !busy.has(d));
  let fill = 0, prec = 0, els = 0;
  for (const d of idle) {
    if ((other.get(pid).get(d) || 0) > 0) { els++; continue; }
    // Could an op placed LATER have been pulled into this hole? Only if its
    // panel predecessor had already finished before the hole opened.
    const canPull = ops.filter(o => o.start > d).some(o => {
      const pnl = panelOf.get(String(o.id));
      const predEnd = placed.filter(x => panelOf.get(String(x.id)) === pnl && x.end < o.start)
        .reduce((a, x) => x.end > a ? x.end : a, "");
      return !predEnd || predEnd < d;
    });
    if (canPull) fill++; else prec++;
  }
  idleTot += idle.length; idleFill += fill; idlePrec += prec; idleElse += els;
  console.log(`${nameOf(pid).padEnd(13)} ${String(ops.length).padStart(3)}  ${String(busy.size).padStart(13)}  ${String(idle.length).padStart(5)}  ${String(fill).padStart(12)}  ${String(prec).padStart(10)}  ${String(els).padStart(14)}`);
}
console.log(`\nIDLE PERSON-DAYS inside this job: ${idleTot}`);
console.log(`  backfillable (a defect if > 0)   ${idleFill}`);
console.log(`  precedence   (work not ready)    ${idlePrec}`);
console.log(`  on another job                   ${idleElse}`);

// ── 2. the row as drawn: every job, not just this one ──────────────────────
let empty = 0, pullable = 0;
for (const pid of crew) {
  const ops = placed.filter(o => o.team.includes(pid)).sort((a, b) => a.start.localeCompare(b.start));
  const w = bdays(ops[0].start, ops[ops.length - 1].end);
  const busy = all.get(pid);
  const e = w.filter(d => !((busy.get(d) || 0) > 0));
  empty += e.length;
  for (const d of e) if (ops.some(o => o.start > d)) pullable++;
}
console.log(`\nTRULY EMPTY days on the drawn row (all jobs): ${empty}   of which fillable: ${pullable}`);

// ── 3. panel chains — what a job-scoped view draws ─────────────────────────
let chainGap = 0, chains = 0;
for (const p of (job.subs || [])) {
  const seq = (p.subs || []).filter(o => o.start && o.end).sort((a, b) => a.start.localeCompare(b.start));
  if (seq.length < 2) continue;
  chains++;
  for (let i = 1; i < seq.length; i++) chainGap += Math.max(0, bdays(seq[i - 1].end, seq[i].start).length - 2);
}
console.log(`PANEL CHAINS: ${chains} multi-op panels, ${chainGap} idle business days inside chains`);

// ── 4. THE DECIDING NUMBER: was there room to pack into at all? ────────────
console.log(`\nCREW UTILISATION over the span (capacity ${HPD}h/day)`);
console.log("PERSON         WITH THIS JOB         WITHOUT IT    DAYS OVER CAPACITY");
let uAll = 0, uOther = 0;
for (const pid of crew) {
  const a = win.reduce((s, d) => s + (all.get(pid).get(d) || 0), 0);
  const b = win.reduce((s, d) => s + (other.get(pid).get(d) || 0), 0);
  const over = win.filter(d => (all.get(pid).get(d) || 0) > HPD + 0.01).length;
  const c = win.length * HPD;
  uAll += a; uOther += b;
  console.log(`${nameOf(pid).padEnd(13)} ${a.toFixed(0).padStart(5)}h / ${c.toFixed(0)}h = ${(a / c * 100).toFixed(0).padStart(3)}%   ${b.toFixed(0).padStart(5)}h = ${(b / c * 100).toFixed(0).padStart(3)}%   ${String(over).padStart(13)}`);
}
const cap = win.length * HPD * crew.length;
console.log(`CREW          ${uAll.toFixed(0)}h / ${cap.toFixed(0)}h = ${(uAll / cap * 100).toFixed(0)}%   ${uOther.toFixed(0)}h = ${(uOther / cap * 100).toFixed(0)}% before this job landed`);

const jobHours = placed.reduce((a, o) => a + (Number(o.hpd) || HPD) / o.team.length, 0);
let left = jobHours, day = 0;
const horizon = bdays(spanStart, "2027-12-31");
while (left > 0.01 && day < horizon.length) {
  for (const pid of crew) left -= Math.max(0, HPD - (other.get(pid).get(horizon[day]) || 0));
  day++;
}
console.log(`\nTHIS JOB is ${jobHours.toFixed(0)}h. Packed into whatever slack the crew had left`);
console.log(`(other jobs fixed, precedence ignored — so a LOWER BOUND, not a plan):`);
console.log(`  it needs ${day} business days. The plan spans ${win.length}.`);

console.log(`\nVERDICT`);
if (idleFill > 0 || pullable > 0) {
  console.log(`  BACKFILL DEFECT: ${idleFill} idle + ${pullable} empty days could have been filled.`);
} else if (uOther / cap > 0.8) {
  console.log(`  NOT A BACKFILL FAILURE. Zero backfillable and zero fillable empty days, and the`);
  console.log(`  crew was already at ${(uOther / cap * 100).toFixed(0)}% of capacity before this job landed. The gaps are`);
  console.log(`  other work, not idleness — there was no slack to pack into.`);
} else {
  console.log(`  No backfill defect, and the crew had slack — the gaps are the even-load objective.`);
}
