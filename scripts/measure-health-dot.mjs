#!/usr/bin/env node
// #440. What the health dot says today, and what it would say under each
// candidate rule. Counts over Matrix's live board so the options are compared
// on evidence rather than on how they sound.
//
// APPROXIMATION, STATED: progress is taken from `loggedHours`, which is what
// module-scope `getHealth` itself reads. The in-component path uses real
// production hours, so its numbers will differ slightly — that difference IS
// one of the findings here, not a flaw in the measurement.

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
const workDays = new Set(settings.workDays || [1, 2, 3, 4, 5]);
const holidays = new Set((settings.holidays || []).map(h => (typeof h === "string" ? h : h?.date)).filter(Boolean));
const TD = new Date().toISOString().slice(0, 10);

const isWD = (ds) => { const d = new Date(ds + "T12:00:00Z"); return workDays.has(d.getUTCDay()) && !holidays.has(ds); };
const bdaysBetween = (a, b) => { if (!a || !b || a > b) return 0; let n = 0, d = new Date(a + "T12:00:00Z");
  for (let i = 0; i < 2000; i++) { const ds = d.toISOString().slice(0, 10); if (ds > b) break; if (isWD(ds)) n++; d.setUTCDate(d.getUTCDate() + 1); } return n; };

// Every dated schedulable unit: the ops of a panel, or the panel when it has none.
const units = [];
for (const j of tasks) for (const p of j.subs || []) {
  const ops = (p.subs || []).filter(o => o && !o.deletedAt);
  for (const u of (ops.length ? ops : [p])) if (u.start && u.end) units.push(u);
}

const pct = (u) => {
  if (u.status === "Finished") return 1;
  const logged = Number(u.loggedHours || 0), est = Number(u.hpd || 0);
  if (logged === 0 || !(est > 0)) return 0;
  return logged / est;
};
const timeFrac = (u) => {
  const total = Math.max(bdaysBetween(u.start, u.end), 1);
  const elapsed = TD < u.start ? 0 : Math.max(bdaysBetween(u.start, TD > u.end ? u.end : TD), 0);
  return Math.min(elapsed / total, 1);
};

// ── A. Today ─────────────────────────────────────────────────────────────
const optionA = (u) => {
  if (u.status === "Finished") return "done";
  const measured = pct(u), started = measured > 0;
  if ((u.status || "Not Started") === "Not Started" && !started) return TD > u.start ? "critical" : "ontime";
  const pd = measured, pt = timeFrac(u);
  if (u.status === "On Hold" && pt > 0.5) return "critical";
  if (pt > pd + 0.35) return "critical";
  if (pt > pd + 0.15) return "behind";
  return "ontime";
};
// ── B. Drop the short-circuit, judge everything on elapsed-vs-done ───────
const optionB = (u) => {
  if (u.status === "Finished") return "done";
  const pd = pct(u), pt = timeFrac(u);
  if (u.status === "On Hold" && pt > 0.5) return "critical";
  if (pt > pd + 0.35) return "critical";
  if (pt > pd + 0.15) return "behind";
  return "ontime";
};
// ── C. LATE, not BEHIND. Red is a calendar fact, amber is a warning ──────
const optionC = (u) => {
  if (u.status === "Finished") return "done";
  if (TD < u.start) return "notyet";                       // hasn't begun — not judged
  if (TD > u.end) return "critical";                       // its end date passed, unfinished
  if (pct(u) === 0 && timeFrac(u) > 0.5) return "behind";  // half gone, nothing logged
  return "ontime";
};
// ── D. As C, but amber only in the last working day ─────────────────────
const optionD = (u) => {
  if (u.status === "Finished") return "done";
  if (TD < u.start) return "notyet";
  if (TD > u.end) return "critical";
  if (pct(u) === 0 && bdaysBetween(TD, u.end) <= 1) return "behind";
  return "ontime";
};

const OPTIONS = { "A today": optionA, "B no short-circuit": optionB, "C late-not-behind": optionC, "D late + last-day warn": optionD };
const STATES = ["ontime", "behind", "critical", "done", "notyet"];

console.log(`ORG ${ORG}  today ${TD}`);
console.log(`${units.length} dated schedulable units\n`);
console.log("1. WHERE THE BOARD LANDS UNDER EACH RULE");
console.log(`   ${"rule".padEnd(24)} ${STATES.map(s => s.padStart(9)).join("")}   red+amber`);
for (const [name, fn] of Object.entries(OPTIONS)) {
  const c = {}; for (const s of STATES) c[s] = 0;
  for (const u of units) c[fn(u)]++;
  const flagged = c.critical + c.behind;
  console.log(`   ${name.padEnd(24)} ${STATES.map(s => String(c[s]).padStart(9)).join("")}   ${String(flagged).padStart(3)} (${Math.round(100 * flagged / units.length)}%)`);
}

console.log("\n2. WHAT IS ACTUALLY TRUE OF THE BOARD");
const finished = units.filter(u => u.status === "Finished").length;
const notBegun = units.filter(u => TD < u.start).length;
const pastEnd = units.filter(u => u.status !== "Finished" && TD > u.end).length;
const inWindow = units.filter(u => u.status !== "Finished" && TD >= u.start && TD <= u.end).length;
const noLog = units.filter(u => pct(u) === 0 && u.status !== "Finished").length;
console.log(`   finished:                       ${finished}`);
console.log(`   not started yet (today < start): ${notBegun}`);
console.log(`   in their window right now:      ${inWindow}`);
console.log(`   PAST THEIR END, unfinished:     ${pastEnd}`);
console.log(`   unfinished with nothing logged: ${noLog}`);

console.log("\n3. THE TWO PATHS THAT DISAGREE");
// HealthIcon calls getHealth(t) with no override, so pctDone falls back to the
// STATUS-KEYED GUESSES. healthOf supplies real progress, so it never uses them.
const moduleScope = (u) => {
  if (u.status === "Finished") return "done";
  const started = Number(u.loggedHours || 0) > 0;
  if ((u.status || "Not Started") === "Not Started" && !started) return TD > u.start ? "critical" : "ontime";
  const pd = u.status === "In Progress" ? 0.5 : u.status === "Pending" ? 0.15 : u.status === "On Hold" ? 0.25 : 0;
  const pt = timeFrac(u);
  if (u.status === "On Hold" && pt > 0.5) return "critical";
  if (pt > pd + 0.35) return "critical";
  if (pt > pd + 0.15) return "behind";
  return "ontime";
};
let differ = 0; const examples = [];
for (const u of units) {
  const a = optionA(u), m = moduleScope(u);
  if (a !== m) { differ++; if (examples.length < 6) examples.push(`${(u.title || u.id).slice(0, 26).padEnd(28)} status=${String(u.status).padEnd(12)} healthOf=${a}  HealthIcon=${m}`); }
}
console.log(`   units where the two paths DISAGREE today: ${differ} of ${units.length}`);
for (const e of examples) console.log(`     ${e}`);
console.log(`   (the divergence is the status-keyed fallbacks 0.5/0.15/0.25, which`);
console.log(`    only the no-override path ever reaches)`);
let differC = 0;
for (const u of units) if (optionC(u) !== optionC(u)) differC++;
console.log(`   under C/D the red decision is pure calendar, so both paths agree on it;`);
console.log(`   amber still asks "is anything logged", which the two paths measure`);
console.log(`   differently (loggedHours vs real production hours) — so the split`);
console.log(`   narrows but does not close by itself.`);

console.log("\n4. THE KPIs THAT READ IT");
const activeJobs = tasks.filter(t => t.status !== "Finished");
for (const [name, fn] of Object.entries(OPTIONS)) {
  const judged = units.filter(u => fn(u) !== "notyet");
  const onTime = judged.filter(u => ["ontime", "done"].includes(fn(u))).length;
  console.log(`   ${name.padEnd(24)} on-time over judged units: ${judged.length ? Math.round(100 * onTime / judged.length) : 0}%  (${onTime}/${judged.length})`);
}
console.log(`   (${activeJobs.length} active jobs feed the dashboard tile; the employee page`);
console.log(`    runs the same math per person over the ops due in the pay period)`);

console.log("\n5. ARE THE OVERDUE UNITS REAL, OR A BOARD NOBODY CLOSED?");
const overdue = [];
for (const j of tasks) for (const p of j.subs || []) {
  const ops = (p.subs || []).filter(o => o && !o.deletedAt);
  for (const u of (ops.length ? ops : [p])) {
    if (u.start && u.end && u.status !== "Finished" && TD > u.end) overdue.push({ u, job: j, panel: p });
  }
}
const byJobStatus = {};
for (const { job } of overdue) { const s = job.status || "(none)"; byJobStatus[s] = (byJobStatus[s] || 0) + 1; }
console.log(`   overdue units: ${overdue.length}`);
console.log(`   their JOB's status: ${JSON.stringify(byJobStatus)}`);
const ages = overdue.map(o => Math.round((new Date(TD) - new Date(o.u.end)) / 86400000)).sort((a, b) => a - b);
const q = (p) => ages[Math.floor((ages.length - 1) * p)];
console.log(`   days past end — min ${ages[0]}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  max ${ages[ages.length - 1]}`);
const buckets = { "<=7d": 0, "8-30d": 0, "31-90d": 0, ">90d": 0 };
for (const a of ages) buckets[a <= 7 ? "<=7d" : a <= 30 ? "8-30d" : a <= 90 ? "31-90d" : ">90d"]++;
console.log(`   ${JSON.stringify(buckets)}`);
const onFinishedJob = overdue.filter(o => o.job.status === "Finished").length;
console.log(`   overdue units sitting on a job ALREADY marked Finished: ${onFinishedJob}`);
console.log(`   -> these are not late work; they are a job closed without its`);
console.log(`      operations being closed, and the dot has no way to tell.`);

console.log("\n6. OPTION E — a unit on a CLOSED job is not late, it is closed");
const norm = (s) => String(s || "").trim().toLowerCase();
const STRICT = new Set(["finished", "shipped/ invoiced", "shipped not invoiced"]);
const BROAD = new Set([...STRICT, "crated", "boxed up", "ready for packaging", "c fat", "mtx fat"]);
const jobOf = new Map();
for (const j of tasks) for (const p of j.subs || []) {
  const ops = (p.subs || []).filter(o => o && !o.deletedAt);
  for (const u of (ops.length ? ops : [p])) jobOf.set(u, j);
}
const optionE = (set) => (u) => {
  const j = jobOf.get(u);
  if (j && set.has(norm(j.status))) return "done";   // the job is closed; so is its work
  return optionC(u);
};
for (const [label, set] of [["E strict (Finished/Shipped)", STRICT], ["E broad (+FAT/packaging)", BROAD]]) {
  const fn = optionE(set), c = {};
  for (const s of STATES) c[s] = 0;
  for (const u of units) c[fn(u)]++;
  const flagged = c.critical + c.behind;
  console.log(`   ${label.padEnd(28)} ${STATES.map(s => String(c[s]).padStart(9)).join("")}   ${String(flagged).padStart(3)} (${Math.round(100 * flagged / units.length)}%)`);
  const judged = units.filter(u => fn(u) !== "notyet");
  const onT = judged.filter(u => ["ontime", "done"].includes(fn(u))).length;
  console.log(`   ${"".padEnd(28)} on-time: ${Math.round(100 * onT / judged.length)}%  (${onT}/${judged.length})`);
}
console.log("\n   JOB STATUSES IN USE, normalised — note the duplicate:");
const js = {};
for (const j of tasks) js[String(j.status)] = (js[String(j.status)] || 0) + 1;
console.log(`   ${JSON.stringify(js)}`);
