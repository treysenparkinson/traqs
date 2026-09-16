// One-time repair for the job-hours accounting, matching the code changes that
// made op/panel counters derived and session days shop-local.
//
//   1. tasks.json  — RAISE op.loggedHours / panel.loggedHours to their session
//                    total where the counter is behind. Monotonic: a counter is
//                    only ever increased, never lowered.
//   2. productionhours.json — restamp `date` to the shop's calendar day. It was
//                    a UTC slice, so evening work was filed on the next day.
//   2b. payhours.json — same restamp. This is the one that surfaced in the log: a
//                    6:23pm punch stored as the NEXT day read as "today's
//                    clock-in". Rows whose corrected day lands in a different PAY
//                    PERIOD are held back and listed — correcting a day is a bug
//                    fix, moving hours between periods restates payroll. Pass
//                    --allow-period-change to include them.
//   3. settings.json — set `timeZone`, which the server now reads to stamp new
//                    rows. Without it the server keeps its UTC fallback.
//
// Why raise and not rewrite: the counters legitimately hold hours the session
// rows cannot account for. The "Set Worked Hours" override offers "Nobody — job
// progress only", which records progress with no production row, and ops worked
// before productionhours.json existed still carry their totals — one op here
// holds 68.3h against zero rows, from the jobsessions.json era. A first draft of
// this script rewrote counters outright and would have deleted ~90h of real
// recorded progress across three ops.
//
// job.loggedHours is untouched for the same reason, doubly so: the pay clock-out
// path credits it the full punch and writes no session row at all.
//
// DRY RUN BY DEFAULT. Prints the exact diff and writes nothing. Pass --apply to
// write. The bucket has versioning enabled, so an apply is recoverable.
//
//   node scripts/backfill-production-hours.mjs --org MTX2026TRAQS --tz America/Denver
//   node scripts/backfill-production-hours.mjs --org MTX2026TRAQS --tz America/Denver --apply

import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const APPLY = args.includes("--apply");
// --exact sets counters EQUAL to their session total, which can lower them.
// Only correct when the existing counters are known-disposable (a test org, or
// after confirming no "Nobody — job progress only" history matters). The default
// only ever raises, so it can never delete recorded progress.
const EXACT = args.includes("--exact");
// Move payhours rows whose corrected day lands in a DIFFERENT pay period. Off by
// default: that restates payroll totals, which is a decision for whoever runs pay.
const ALLOW_PERIOD_CHANGE = args.includes("--allow-period-change");
const ORG = flag("org");
const TZ = flag("tz");
if (!ORG || !TZ) {
  console.error("usage: --org <ORGCODE> --tz <IANA zone> [--apply]");
  process.exit(2);
}

// Env from the repo's .env, same vars the functions use.
const envPath = new URL("../.env", import.meta.url);
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});
const Bucket = env.S3_BUCKET;
const keyFor = name => `orgs/${ORG}/${name}`;

const getJson = async (name) => {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: keyFor(name) }));
  return JSON.parse(await r.Body.transformToString());
};
const putJson = async (name, value) => {
  await s3.send(new PutObjectCommand({
    Bucket, Key: keyFor(name), Body: JSON.stringify(value), ContentType: "application/json",
  }));
};

// Mirrors orgLocalDay in netlify/functions/timeclock.js and localDay in src/localDay.js.
const localDay = (iso, timeZone) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "").slice(0, 10);
  if (!timeZone) return d.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
};
const round = h => Math.round(h * 100) / 100;

console.log(`org=${ORG}  tz=${TZ}  mode=${APPLY ? "APPLY" : "DRY RUN"}\n`);

const [tasks, sessions, settings, pay] = await Promise.all([
  getJson("tasks.json"),
  getJson("productionhours.json"),
  getJson("settings.json").catch(() => ({})),
  getJson("payhours.json"),
]);

// ── 1. session dates ───────────────────────────────────────────────────────
const dateChanges = [];
const nextSessions = sessions.map(s => {
  if (!s?.clockIn) return s;
  const want = localDay(s.clockIn, TZ);
  if (s.date === want) return s;
  dateChanges.push({ id: s.id, from: s.date, to: want, clockIn: s.clockIn, hours: s.hours, op: s.opTitle });
  return { ...s, date: want };
});

console.log(`── production row dates: ${dateChanges.length} of ${sessions.length} rows move ──`);
for (const c of dateChanges) {
  console.log(`   ${c.from} -> ${c.to}   ${c.clockIn}  ${String(c.hours).padStart(6)}h  ${c.op ?? ""}`);
}

// ── 2. op / panel counters ─────────────────────────────────────────────────
// Live (non-tombstoned) rows only, keyed as strings so numeric legacy ids match.
const byOp = new Map(), byPanel = new Map();
for (const s of nextSessions) {
  if (!s || s.deletedAt) continue;
  const h = Number(s.hours) || 0;
  if (!h) continue;
  if (s.opId != null && s.opId !== "") byOp.set(String(s.opId), (byOp.get(String(s.opId)) || 0) + h);
  if (s.panelId != null && s.panelId !== "") byPanel.set(String(s.panelId), (byPanel.get(String(s.panelId)) || 0) + h);
}

const counterChanges = [];
const nextTasks = tasks.map(job => ({
  ...job,
  subs: (job.subs || []).map(panel => {
    // max(), never assignment — see the header. A counter above its session sum
    // is holding history the rows don't have, and must survive untouched.
    const ops = (panel.subs || []).map(op => {
      const sum = round(byOp.get(String(op.id)) || 0);
      const cur = round(Number(op.loggedHours) || 0);
      if (EXACT ? sum === cur : sum <= cur) return op;
      counterChanges.push({ kind: "op", job: job.title, title: op.title, from: op.loggedHours, to: sum });
      return { ...op, loggedHours: sum };
    });
    const out = { ...panel, subs: ops };
    const pSum = round(byPanel.get(String(panel.id)) || 0);
    const pCur = round(Number(panel.loggedHours) || 0);
    if (EXACT ? pSum !== pCur : pSum > pCur) {
      counterChanges.push({ kind: "panel", job: job.title, title: panel.title, from: panel.loggedHours, to: pSum });
      out.loggedHours = pSum;
    }
    return out;
  }),
}));

const lowered = counterChanges.filter(c => (c.to || 0) < (Number(c.from) || 0));
console.log(`\n── op/panel counters: ${counterChanges.length} change, ${lowered.length} of them LOWERED (${EXACT ? "exact mode" : "raise-only mode"}) ──`);
for (const c of counterChanges) {
  const delta = round((c.to || 0) - (c.from || 0));
  console.log(`   ${c.kind.padEnd(5)} ${String(c.from ?? "unset").padStart(7)} -> ${String(c.to).padStart(7)}  (${delta >= 0 ? "+" : ""}${delta})  ${c.job} / ${c.title}`);
}

// In raise-only mode, a decrease means the logic drifted — refuse rather than
// quietly delete progress. In exact mode decreases are the point, so list them.
if (lowered.length && !EXACT) {
  console.error(`\nABORT: ${lowered.length} counter(s) would DECREASE in raise-only mode.`);
  for (const c of lowered) console.error(`   ${c.job} / ${c.title}: ${c.from} -> ${c.to}`);
  process.exit(1);
}
if (lowered.length) {
  const tot = round(lowered.reduce((a, c) => a + ((Number(c.from) || 0) - (c.to || 0)), 0));
  console.log(`\n   ${tot}h of counter value will be ERASED across ${lowered.length} scope(s):`);
  for (const c of lowered) console.log(`     ${c.job} / ${c.title}: ${c.from} -> ${c.to}`);
}

// ── 2b. payhours dates ─────────────────────────────────────────────────────
// Same UTC-slice bug as the production rows, and the one that showed up in the
// log: a 6:23pm punch was stamped with the NEXT day, so it appeared as "today's
// clock-in" on a day the worker had not started.
//
// Riskier than the production rows, because a punch's `date` decides which PAY
// PERIOD it falls in. Any row whose corrected date would cross a period boundary
// is reported and the script ABORTS rather than quietly restating someone's
// payroll. Confirmed rows are called out for the same reason.
const payPeriodOf = (ds, payDates = [5, 20]) => {
  const [d1, d2] = [...payDates].map(Number).sort((a, b) => a - b);
  const t = new Date(ds + "T00:00:00");
  const y = t.getFullYear(), m = t.getMonth(), day = t.getDate();
  const toDS = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  if (day >= d1 && day < d2) return toDS(new Date(y, m, d1));
  if (day >= d2) return toDS(new Date(y, m, d2));
  return toDS(new Date(y, m - 1, d2));
};
const payDates = settings?.payDates || [5, 20];

// First pass only classifies — nothing is rewritten until the period check below
// has decided which rows are safe to move.
const payChanges = [];
for (const e of pay) {
  if (!e || e.deletedAt) continue;
  const src = e.clockIn || e.timestamp;          // punches carry clockIn, event rows a timestamp
  if (!src) continue;
  const want = localDay(src, TZ);
  if (e.date === want) continue;
  payChanges.push({
    id: e.id, from: e.date, to: want, src, hours: e.hours, kind: e.eventType || "punch",
    person: e.personId, confirmed: !!e.confirmed,
    periodFrom: payPeriodOf(e.date, payDates), periodTo: payPeriodOf(want, payDates),
  });
}

console.log(`\n── payhours dates: ${payChanges.length} of ${pay.length} rows move ──`);
for (const c of payChanges) {
  const flags = [c.confirmed ? "CONFIRMED" : null, c.periodFrom !== c.periodTo ? "PERIOD CHANGE" : null].filter(Boolean);
  console.log(`   ${c.from} -> ${c.to}  ${String(c.kind).padEnd(11)} person=${String(c.person).padEnd(4)} ${c.src}${flags.length ? "   [" + flags.join(", ") + "]" : ""}`);
}
// Rows whose corrected day lands in a different pay period are HELD BACK unless
// explicitly allowed. Fixing the day someone's shift is filed under is a bug fix;
// moving hours between pay periods restates payroll, which is not this script's
// call to make. Holding them back keeps the rest of the correction available.
const crossers = payChanges.filter(c => c.periodFrom !== c.periodTo);
const heldIds = new Set(ALLOW_PERIOD_CHANGE ? [] : crossers.map(c => c.id));
if (crossers.length) {
  console.log(`\n   ${crossers.length} row(s) would change PAY PERIOD — ${ALLOW_PERIOD_CHANGE ? "INCLUDED (--allow-period-change)" : "HELD BACK"}:`);
  for (const c of crossers) {
    console.log(`     ${c.id}  ${c.from} -> ${c.to}   period ${c.periodFrom} -> ${c.periodTo}   ${c.hours ?? "-"}h${c.confirmed ? "   CONFIRMED" : ""}`);
  }
  if (!ALLOW_PERIOD_CHANGE) console.log(`   Pass --allow-period-change to move these too.`);
}
const confirmedMoves = payChanges.filter(c => c.confirmed && !heldIds.has(c.id));
if (confirmedMoves.length) {
  console.log(`\n   note: ${confirmedMoves.length} row(s) being moved are on a CONFIRMED timesheet.`);
  console.log(`   Their pay period is unchanged, so the period total stands — only the day moves.`);
}
const payApplied = payChanges.filter(c => !heldIds.has(c.id));
console.log(`\n   -> ${payApplied.length} of ${payChanges.length} payhours rows will be written.`);

const wanted = new Map(payApplied.map(c => [c.id, c.to]));
const nextPay = pay.map(e => (e && wanted.has(e.id) ? { ...e, date: wanted.get(e.id) } : e));

// ── 3. settings ────────────────────────────────────────────────────────────
const tzChanged = settings?.timeZone !== TZ;
console.log(`\n── settings.timeZone: ${settings?.timeZone ?? "unset"} -> ${TZ}  ${tzChanged ? "(change)" : "(no change)"} ──`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to write.");
  process.exit(0);
}

if (dateChanges.length) await putJson("productionhours.json", nextSessions);
if (payApplied.length) await putJson("payhours.json", nextPay);
if (counterChanges.length) await putJson("tasks.json", nextTasks);
if (tzChanged) await putJson("settings.json", { ...settings, timeZone: TZ });
console.log("\nAPPLIED.");
