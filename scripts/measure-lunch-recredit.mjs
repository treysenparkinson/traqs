#!/usr/bin/env node
// THE LUNCH RE-CREDIT, PRICED BEFORE IT IS RULED ON.
//
// Trey's rule: the shop's SCHEDULED lunch belongs to planned time. A session
// that was measured has its own recorded pauses and must not also lose an
// estimate of them. Today `sessionWorkedHours` takes `gross` from
// `productiveHoursBetween`, which removes the org's dead windows — so a worker
// who works through lunch and clocks no pause loses it anyway.
//
// WHAT THE CALENDAR IS ACTUALLY THERE FOR, which decides how far to reverse:
// #194 found `jobClockOut` computing raw `clockOut - clockIn - totalPausedMs`,
// so a Friday-afternoon session closed on Monday credited 67.84h instead of
// 1.32h. `productiveHoursBetween` fixed that by refusing to count nights,
// weekends and holidays. LUNCH IS NOT WHAT IT WAS SOLVING — it is a dead
// window that happens to live inside the working day, and it came along.
//
// So the two reversals are NOT the same size:
//   (A) raw wall clock again      → re-breaks #194. Not measured here.
//   (B) keep the day/hour bounding, drop only the INTRA-DAY dead windows
//                                 → satisfies the rule, keeps #194 fixed.
// (B) is what this prices.
//
//   node scripts/measure-lunch-recredit.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { sessionWorkedHours, buildDayWindows } from "../src/statsMath.js";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const [prod, pay, people, settings] = await Promise.all([
  get(`orgs/${ORG}/productionhours.json`), get(`orgs/${ORG}/payhours.json`),
  get(`orgs/${ORG}/people.json`), get(`orgs/${ORG}/settings.json`),
]);
const nameOf = (id) => people.find(p => String(p.id) === String(id))?.name || `?${id}`;
const hourOf = (v, d) => { const m = /^(\d{1,2})(?::(\d{2}))?/.exec(String(v ?? "")); return m ? Number(m[1]) + Number(m[2] || 0) / 60 : d; };
const workStartH = hourOf(settings?.workStart, 8), workEndH = hourOf(settings?.workEnd, 17);

const base = { workStartH, workEndH, workDays: settings?.workDays || [1, 2, 3, 4, 5],
  holidays: settings?.holidays || [], timeZone: settings?.timeZone };
const withLunch = { ...buildDayWindows(workStartH, workEndH, settings?.breaks, settings?.lunch), ...base };
// deadWindows FORCED EMPTY, not merely "no lunch configured". The first run of
// this used `buildDayWindows(start, end, null, null)`, which injects a DEFAULT
// 30-minute lunch — so it priced the difference between the org's 90 minutes
// and a default 30, and understated the re-credit by half an hour per session.
const noLunch = { ...buildDayWindows(workStartH, workEndH, null, null), ...base, deadWindows: [] };
console.log(`shop ${workStartH}:00–${workEndH}:00, ${settings?.timeZone}`);
console.log(`lunch ${JSON.stringify(settings?.lunch)}  breaks ${JSON.stringify(settings?.breaks)}`);
console.log(`dead windows: with ${JSON.stringify(withLunch.deadWindows)} / without ${JSON.stringify(noLunch.deadWindows)}\n`);

const rows = (prod || []).filter(r => r && !r.deletedAt && r.clockIn && r.clockOut);
console.log(`productionhours.json: ${rows.length} closed job sessions\n`);

// Which (person, day) actually clocked a lunch or break. payhours carries the
// event rows; a session on a day with none clocked no pause at all.
const pausedDays = new Set();
for (const r of pay || []) {
  if (!r || !r.eventType || !r.timestamp) continue;
  if (!/lunch|break/i.test(String(r.eventType))) continue;
  pausedDays.add(`${r.personId}|${r.date || String(r.timestamp).slice(0, 10)}`);
}

let total = 0, touched = 0;
const perPerson = {}, perMonth = {};
const noPause = [];
for (const r of rows) {
  const common = { clockInMs: Date.parse(r.clockIn), clockOutMs: Date.parse(r.clockOut) };
  const a = sessionWorkedHours({ ...common, cfg: withLunch });
  const b = sessionWorkedHours({ ...common, cfg: noLunch });
  const d = Math.round((b.grossH - a.grossH) * 100) / 100;
  if (d <= 0) continue;
  total += d; touched++;
  const n = nameOf(r.personId);
  perPerson[n] = Math.round(((perPerson[n] || 0) + d) * 100) / 100;
  const mo = String(r.date || r.clockIn).slice(0, 7);
  perMonth[mo] = Math.round(((perMonth[mo] || 0) + d) * 100) / 100;
  if (!pausedDays.has(`${r.personId}|${r.date}`)) noPause.push({ r, d, n });
}

console.log("1. THE DELTA");
console.log(`   sessions whose credit would RISE: ${touched} of ${rows.length}`);
console.log(`   hours re-credited in total:       ${total.toFixed(2)}`);
console.log(`   stored hours across all sessions: ${rows.reduce((s, r) => s + (Number(r.hours) || 0), 0).toFixed(2)}`);

console.log("\n2. TO WHOM");
for (const [n, h] of Object.entries(perPerson).sort((a, b) => b[1] - a[1]))
  console.log(`   ${n.padEnd(10)} ${h.toFixed(2).padStart(8)}h`);

console.log("\n3. OVER WHAT PERIOD");
for (const [m, h] of Object.entries(perMonth).sort())
  console.log(`   ${m}  ${h.toFixed(2).padStart(8)}h`);

console.log("\n4. SESSIONS THAT CLOCKED NO PAUSE AT ALL — losing time they worked");
console.log(`   sessions on a day with no lunch or break row for that person: ${noPause.length}`);
console.log(`   hours they lose:  ${noPause.reduce((s, x) => s + x.d, 0).toFixed(2)}`);
const npPerson = {};
for (const x of noPause) npPerson[x.n] = Math.round(((npPerson[x.n] || 0) + x.d) * 100) / 100;
console.log(`   by person: ${JSON.stringify(npPerson)}`);

console.log("\n5. IS ANY OF IT IN A CONFIRMED TIMESHEET?");
// Job sessions are not themselves confirmed; the PAY punch covering the same
// person and day is what payroll locks. That is the thing to check.
const confirmedDays = new Set();
for (const r of pay || []) if (r && !r.eventType && r.confirmed && r.date) confirmedDays.add(`${r.personId}|${r.date}`);
const inConfirmed = rows.filter(r => confirmedDays.has(`${r.personId}|${r.date}`));
let confDelta = 0;
for (const r of inConfirmed) {
  const common = { clockInMs: Date.parse(r.clockIn), clockOutMs: Date.parse(r.clockOut) };
  const d = sessionWorkedHours({ ...common, cfg: noLunch }).grossH - sessionWorkedHours({ ...common, cfg: withLunch }).grossH;
  if (d > 0) confDelta += d;
}
console.log(`   confirmed (person, day) pairs in payhours: ${confirmedDays.size}`);
console.log(`   job sessions falling on a confirmed day:   ${inConfirmed.length}`);
console.log(`   hours among those that would rise:         ${confDelta.toFixed(2)}`);
console.log("   NOTE: a job session is PRODUCTION time, not pay time. Changing it moves");
console.log("   what a job cost, not what anyone is paid — the pay clock is separate and");
console.log("   is not touched by this. Said plainly because 'hours' reads as wages.");
