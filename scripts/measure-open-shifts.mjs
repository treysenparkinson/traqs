#!/usr/bin/env node
// #502. THE PUNCHES NOBODY CLOSED.
//
// #501 found these while measuring something else: punches running far past any
// real shift, carrying hours that payroll would pay if someone confirmed the
// timesheet without looking. This measures them before anything is proposed.
//
// THE INSTRUMENT IS THE ENTRY ID. A punch id is `tc_${Date.now()}_${rand}`,
// stamped when the ENTRY IS CREATED — which is the moment of clock-out — and
// nothing in the edit path rewrites it. So the id is an independent witness to
// when the shift really ended, and `id-time minus clockOut` says whether the
// stored clock-out is the real one. Calibrated below before it is used.
//
//   node scripts/measure-open-shifts.mjs

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

const rows = await get(`orgs/${ORG}/payhours.json`);
const people = await get(`orgs/${ORG}/people.json`);
const nameOf = (id) => people.find(p => String(p.id) === String(id))?.name || `?${id}`;
const punches = rows.filter(r => r && !r.eventType && r.clockIn && r.clockOut);
const hrs = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const idMs = (id) => { const m = /^tc_(\d{13})_/.exec(String(id || "")); return m ? Number(m[1]) : null; };
const L = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const stored = (p) => Number(p.hours) || 0;

// 12h is the threshold forgot-clockout itself uses (STALE_MS), so the same line
// is drawn here rather than inventing a second one.
const STALE_H = 12;
const long = punches.filter(p => hrs(p.clockIn, p.clockOut) > STALE_H)
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));

console.log(`payhours.json: ${punches.length} closed punches, ${long.length} over ${STALE_H}h\n`);

console.log("0. THE WITNESS, CALIBRATED");
const drift = punches.map(p => ({ p, d: (idMs(p.id) - Date.parse(p.clockOut)) / 60000 })).filter(x => Number.isFinite(x.d));
const near = drift.filter(x => Math.abs(x.d) < 1);
console.log(`   punches with a decodable id: ${drift.length} of ${punches.length}`);
console.log(`   id-time within 1 minute of the stored clock-out: ${near.length} (${(100 * near.length / drift.length).toFixed(1)}%)`);
console.log(`   so a punch whose id DISAGREES with its clock-out had that clock-out moved by hand.`);

console.log("\n1. WHOSE, AND WHEN");
const byPerson = {};
for (const p of long) (byPerson[nameOf(p.personId)] ??= []).push(p);
for (const [n, list] of Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length)) {
  const h = list.reduce((s, x) => s + stored(x), 0);
  console.log(`   ${n.padEnd(9)} ${String(list.length).padStart(2)} punches, ${h.toFixed(2).padStart(7)} stored hours, ${list[0].date} → ${list[list.length - 1].date}`);
}
console.log(`   TOTAL ${long.length} punches, ${long.reduce((s, x) => s + stored(x), 0).toFixed(2)} stored hours`);
console.log(`   (all closed punches: ${punches.reduce((s, x) => s + stored(x), 0).toFixed(2)} stored hours)`);

console.log("\n2. WAS forgot-clockout EVEN DEPLOYED YET?");
// Shipped d576e60, 2026-07-06. Everything before that date was never watched.
const SHIPPED = "2026-07-06";
const before = long.filter(p => p.date < SHIPPED), after = long.filter(p => p.date >= SHIPPED);
console.log(`   forgot-clockout shipped ${SHIPPED} (d576e60), every 15 min, flags shifts open > 12h`);
console.log(`   long punches BEFORE it existed: ${before.length} (${before.reduce((s, x) => s + stored(x), 0).toFixed(2)} hours) — never watched`);
console.log(`   long punches AFTER:             ${after.length} (${after.reduce((s, x) => s + stored(x), 0).toFixed(2)} hours) — the sweep should have fired`);

console.log("\n3. WHAT THE SWEEP DOES WHEN IT FIRES, AND WHAT IT LEAVES BEHIND");
console.log("   it pushes the worker and the admins, stamps activeClockIn.forgotNotifiedAt,");
console.log("   and NEVER auto-closes: 'an admin corrects it manually'.");
console.log("   forgotNotifiedAt lives on activeClockIn, and clock-out destructures");
console.log("   { clockIn, jobRefs, events, source } off it and drops the rest — so the");
console.log("   entry carries NO record that a notification was ever sent.");
const openNow = people.filter(p => p?.activeClockIn?.clockIn);
console.log(`   people clocked in right now: ${openNow.length}`);
for (const p of openNow) console.log(`     ${p.name}: since ${L(p.activeClockIn.clockIn)} (${((Date.now() - Date.parse(p.activeClockIn.clockIn)) / 3600000).toFixed(1)}h), forgotNotifiedAt=${p.activeClockIn.forgotNotifiedAt || "none"}`);
const everStamped = people.filter(p => p?.activeClockIn?.forgotNotifiedAt).length;
console.log(`   carrying a forgotNotifiedAt stamp: ${everStamped}`);

console.log("\n4. HAS ANY OF IT BEEN CONFIRMED AND PAID?");
const conf = long.filter(p => p.confirmed);
console.log(`   long punches in a CONFIRMED timesheet: ${conf.length} of ${long.length}`);
for (const p of conf) console.log(`     ${nameOf(p.personId)} ${p.date} ${stored(p)}h confirmedAt=${p.confirmedAt || "?"}`);
console.log(`   stored hours sitting in OPEN timesheets: ${long.filter(p => !p.confirmed).reduce((s, x) => s + stored(x), 0).toFixed(2)}`);

console.log("\n5. WHERE THE LINE ACTUALLY FALLS — the longest shift nobody disputes");
// A shift is taken as real when its clock-out was NOT moved by hand (the id
// agrees) AND it is under the 12h line. The top of that pile is the honest
// ceiling for a working day here.
const real = punches.filter(p => hrs(p.clockIn, p.clockOut) <= STALE_H)
  .sort((a, b) => hrs(b.clockIn, b.clockOut) - hrs(a.clockIn, a.clockOut));
console.log(`   longest ten punches at or under ${STALE_H}h:`);
for (const p of real.slice(0, 10))
  console.log(`     ${nameOf(p.personId).padEnd(9)} ${p.date}  ${L(p.clockIn)} → ${L(p.clockOut)}  ${hrs(p.clockIn, p.clockOut).toFixed(2)}h gross, ${stored(p).toFixed(2)}h net`);
const over = (h) => punches.filter(p => hrs(p.clockIn, p.clockOut) > h).length;
console.log(`   punches over  8h: ${over(8)}`);
console.log(`   punches over 10h: ${over(10)}`);
console.log(`   punches over 11h: ${over(11)}`);
console.log(`   punches over 12h: ${over(12)}`);
console.log(`   punches over 13h: ${over(13)}`);
console.log(`   punches over 14h: ${over(14)}`);
console.log(`   punches over 16h: ${over(16)}`);

console.log("\n6. EVERY ONE OF THEM");
for (const p of long) {
  const t = idMs(p.id);
  const moved = t == null ? "?" : Math.abs(t - Date.parse(p.clockOut)) / 60000 < 1 ? "clock-out is genuine" : `clock-out MOVED ${((Date.parse(p.clockOut) - t) / 3600000).toFixed(2)}h`;
  console.log(`   ${nameOf(p.personId).padEnd(9)} ${p.date}  ${L(p.clockIn)} → ${L(p.clockOut)}  ${hrs(p.clockIn, p.clockOut).toFixed(2).padStart(7)}h gross  ${stored(p).toFixed(2).padStart(7)}h stored  ${p.confirmed ? "CONFIRMED" : "open"}  src=${(p.source || "?").padEnd(7)} ${moved}`);
}

console.log("\n7. THE SAME CLOCK-IN TWICE — a second defect in this pile");
// Two entries sharing a personId and a clockIn mean one open session produced
// two punches: the session was closed twice, or re-opened from a stale copy.
const seen = {};
for (const p of punches) (seen[`${p.personId}|${p.clockIn.slice(0, 16)}`] ??= []).push(p);
const dupes = Object.entries(seen).filter(([, v]) => v.length > 1);
console.log(`   (personId, clock-in minute) pairs with more than one punch: ${dupes.length}`);
for (const [k, v] of dupes) {
  console.log(`     ${nameOf(v[0].personId)} ${L(v[0].clockIn)} — ${v.length} punches:`);
  for (const p of v) console.log(`        ${p.id}  → ${L(p.clockOut)}  ${stored(p).toFixed(2)}h  ${p.confirmed ? "CONFIRMED" : "open"}`);
}
const dupHours = dupes.reduce((s, [, v]) => s + v.slice(1).reduce((t, p) => t + stored(p), 0), 0);
console.log(`   hours in the DUPLICATE copies (first of each kept): ${dupHours.toFixed(2)}`);

// ── 8. TWO DIFFERENT DEFECTS ARE IN THIS PILE ────────────────────────────
//
// A punch that shares its clock-in minute with another punch is not a shift
// nobody closed — it is a shift that WAS closed and came back. people.js has
// the mechanism written down: the desktop autosaves the whole roster, so a
// browser holding a stale copy re-asserts an activeClockIn the server already
// cleared, and the next clock-out writes a SECOND entry off the same clock-in.
console.log("\n8. FORGOTTEN, OR RESURRECTED?");
const dupKeys = new Set(dupes.map(([k]) => k));
const resurrected = long.filter(p => dupKeys.has(`${p.personId}|${p.clockIn.slice(0, 16)}`));
const forgotten = long.filter(p => !dupKeys.has(`${p.personId}|${p.clockIn.slice(0, 16)}`));
console.log(`   long punches sharing a clock-in with another punch (RESURRECTED): ${resurrected.length}, ${resurrected.reduce((s, p) => s + stored(p), 0).toFixed(2)}h`);
console.log(`   long punches that are the only one off their clock-in (FORGOTTEN): ${forgotten.length}, ${forgotten.reduce((s, p) => s + stored(p), 0).toFixed(2)}h`);
console.log(`   last duplicate anywhere in the file: ${dupes.map(([, v]) => v[0].date).sort().pop()}`);
console.log(`   (activeClockIn was pinned server-owned on POST in 87f6a7e, 2026-07-14,`);
console.log(`    and re-stated in c4521c3, 2026-09-03 — duplicates by month below)`);
const dupMonth = {};
for (const [, v] of dupes) { const m = v[0].date.slice(0, 7); dupMonth[m] = (dupMonth[m] || 0) + 1; }
console.log(`   ${JSON.stringify(dupMonth)}`);

console.log("\n9. DID THE SHIFT CROSS A NIGHT?");
// The honest separator for "nobody closed this". A 12.6h day is a long day; a
// punch clocked out on a LATER CALENDAR DAY, after the shop was dark, is a
// shift that ran unattended.
const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const sameDay = long.filter(p => dayOf(p.clockIn) === dayOf(p.clockOut));
const crossed = long.filter(p => dayOf(p.clockIn) !== dayOf(p.clockOut));
console.log(`   clocked out the SAME local day (a long day, probably real): ${sameDay.length}, ${sameDay.reduce((s, p) => s + stored(p), 0).toFixed(2)}h`);
for (const p of sameDay) console.log(`     ${nameOf(p.personId).padEnd(9)} ${p.date}  ${L(p.clockIn)} → ${L(p.clockOut)}  ${stored(p).toFixed(2)}h`);
console.log(`   clocked out on a LATER day (nobody closed it): ${crossed.length}, ${crossed.reduce((s, p) => s + stored(p), 0).toFixed(2)}h`);

// ── 10. IS THE SWEEP RUNNING AT ALL? ─────────────────────────────────────
// forgotNotifiedAt dies with the session, but the job-clock pass persists its
// state to jobclock-alerts.json. If that file exists and carries stamps, the
// scheduled function is firing; if it is absent, the cron is the suspect.
console.log("\n10. IS THE SCHEDULED SWEEP FIRING?");
try {
  const alerts = await get(`orgs/${ORG}/jobclock-alerts.json`);
  const keys = Object.keys(alerts || {});
  console.log(`   jobclock-alerts.json EXISTS — ${keys.length} entries`);
  const stamps = Object.values(alerts || {}).map(v => (typeof v === "string" ? v : v?.notifiedAt)).filter(Boolean).sort();
  console.log(`   stamps run ${stamps[0] || "?"} → ${stamps[stamps.length - 1] || "?"}`);
  console.log(`   => the scheduled function HAS run and written state.`);
} catch (e) {
  console.log(`   jobclock-alerts.json: ${e.name} — ${e.name === "NoSuchKey" ? "never written" : e.message}`);
  console.log(`   => no positive evidence the sweep has ever fired for this org.`);
  console.log(`      NOT proof it never ran: the job-clock pass only writes when a JOB`);
  console.log(`      clock is open past end of day, which is a different trigger from`);
  console.log(`      the 12h pay-shift pass. A quiet file here is consistent with both.`);
}

// ── 11. COULD THE NOTIFICATION LAND? ─────────────────────────────────────
// The sweep's only action is a push. If nobody has a token, it fires into
// nothing — and people.js records that a stale roster POST used to WIPE
// pushToken, repeatedly, until c4521c3 (2026-09-03) pinned it.
console.log("\n11. COULD THE PUSH HAVE LANDED?");
const live = people.filter(p => p && !p.deletedAt);
const withTok = live.filter(p => p.pushToken);
console.log(`   live people: ${live.length}, carrying a pushToken: ${withTok.length}`);
for (const p of live) console.log(`     ${String(p.name).padEnd(9)} pushToken=${p.pushToken ? "yes" : "NO "}  role=${p.userRole || "-"}`);
console.log("   pushToken was wiped by stale roster POSTs until c4521c3 (2026-09-03);");
console.log("   before that date a sweep could fire correctly and reach no one.");
