#!/usr/bin/env node
// #501. DID THE #498 DISPLAY BUG CORRUPT STORED TIME-CLOCK ENTRIES?
//
// #498 fixed a timesheet-row editor that showed UTC where it meant local. The
// WRITE side was correct — `fromLocal` parsed local and produced UTC — so a
// value the user TYPED was stored correctly. The damage path is narrower and
// worth stating exactly, because it decides whether a correction pass is owed:
//
//   `DateField` emits BOTH components on any interaction: `emit(date, time)`.
//   The component the user did NOT touch came from the displayed value, which
//   was the UTC wall clock. So changing the DATE re-sent the UTC TIME as though
//   it were local, and changing the TIME re-sent the UTC DATE.
//
// A field edited that way lands offset by the zone (6 or 7h here), while the
// other field of the pair is untouched and correct. **So the signature is a
// BROKEN PAIR: a duration that moved by about the offset.** That is what this
// looks for, rather than trying to spot a shifted instant on its own, which is
// not detectable from the value alone.
//
//   node scripts/measure-timeclock-shift.mjs

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

const pay = await get(`orgs/${ORG}/payhours.json`);
const rows = Array.isArray(pay) ? pay : [];
const punches = rows.filter(r => r && !r.eventType && r.clockIn);
console.log(`payhours.json: ${rows.length} rows, ${punches.length} punches\n`);

const hrs = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const OFFSETS = [6, 7];                       // Mountain, MDT and MST

console.log("1. THE WINDOW THE BUG COULD HAVE ACTED IN");
console.log("   the naive toLocal shipped 2026-03-20 (c61f6c7) and the ROW EDITOR");
console.log("   that used it shipped 2026-03-20 too; fixed 2026-10-08 (#498).");
const dated = punches.filter(p => p.date);
const days = dated.map(p => p.date).sort();
console.log(`   punches run ${days[0]} → ${days[days.length - 1]}`);
const inWindow = dated.filter(p => p.date >= "2026-03-20" && p.date <= "2026-10-08");
console.log(`   inside that window: ${inWindow.length} of ${dated.length}`);

console.log("\n2. BROKEN PAIRS — the signature");
const closed = punches.filter(p => p.clockOut);
console.log(`   closed punches: ${closed.length}`);
const neg = closed.filter(p => hrs(p.clockIn, p.clockOut) < 0);
const long = closed.filter(p => { const h = hrs(p.clockIn, p.clockOut); return h >= 16; });
const nearOffset = closed.filter(p => {
  const h = hrs(p.clockIn, p.clockOut);
  return OFFSETS.some(o => Math.abs(h - o) < 0.02 || Math.abs(h + o) < 0.02);
});
console.log(`   NEGATIVE duration (clockOut before clockIn): ${neg.length}`);
neg.slice(0, 8).forEach(p => console.log(`     ${p.date} ${p.personId}  ${p.clockIn} → ${p.clockOut}  (${hrs(p.clockIn, p.clockOut).toFixed(2)}h)`));
console.log(`   duration >= 16h: ${long.length}`);
long.slice(0, 10).forEach(p => console.log(`     ${p.date} ${p.personId}  ${hrs(p.clockIn, p.clockOut).toFixed(2)}h  stored hours ${p.hours}`));

console.log("\n3. DURATION DISTRIBUTION, because a shifted pair hides in the tail");
const buckets = { "<0": 0, "0–4": 0, "4–8": 0, "8–10": 0, "10–12": 0, "12–16": 0, "16–24": 0, ">24": 0 };
for (const p of closed) {
  const h = hrs(p.clockIn, p.clockOut);
  if (h < 0) buckets["<0"]++; else if (h < 4) buckets["0–4"]++; else if (h < 8) buckets["4–8"]++;
  else if (h < 10) buckets["8–10"]++; else if (h < 12) buckets["10–12"]++; else if (h < 16) buckets["12–16"]++;
  else if (h < 24) buckets["16–24"]++; else buckets[">24"]++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`   ${k.padEnd(7)} ${String(v).padStart(4)}`);

console.log("\n4. DOES THE STORED `date` AGREE WITH THE LOCAL DAY OF clockIn?");
// The server writes `date: localDayOf(clockIn)`. A clockIn shifted across
// midnight takes the date with it, so a disagreement is a second signature.
const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mismatched = punches.filter(p => p.date && dayOf(p.clockIn) !== p.date);
console.log(`   punches whose date != the local day of clockIn: ${mismatched.length}`);
mismatched.slice(0, 10).forEach(p => console.log(`     stored date ${p.date}, clockIn local day ${dayOf(p.clockIn)}  (${p.clockIn})`));

console.log("\n5. CLOCK-IN HOUR, local — a shifted punch sits at an odd hour");
const byHour = {};
for (const p of punches) { const h = new Date(p.clockIn).getHours(); byHour[h] = (byHour[h] || 0) + 1; }
const odd = Object.entries(byHour).filter(([h]) => Number(h) < 4 || Number(h) >= 22);
console.log(`   clock-ins between 22:00 and 04:00 local: ${odd.reduce((s, [, n]) => s + n, 0)}`);
console.log(`   by hour: ${Object.entries(byHour).sort((a, b) => a[0] - b[0]).map(([h, n]) => `${h}h:${n}`).join(" ")}`);

console.log("\n6. WHICH PATHS WRITE A TIME AT ALL");
console.log("   normal punches are written SERVER-SIDE from new Date().toISOString()");
console.log("   (timeclock.js clockIn/clockOut/jobClockIn/jobClockOut), so no local");
console.log("   conversion is involved and they cannot carry this fault.");
console.log("   the admin editor (adminEditEntry) is the only client path that sends");
console.log("   a composed timestamp — and the only one the display bug could reach.");
const edited = punches.filter(p => p.source && p.source !== "kiosk");
console.log(`   punches whose source is not the kiosk: ${edited.length}`);
const sources = {};
for (const p of punches) sources[String(p.source ?? "(none)")] = (sources[String(p.source ?? "(none)")] || 0) + 1;
console.log(`   by source: ${JSON.stringify(sources)}`);

console.log("\n7. WHAT THE PAYROLL EXPORT READS");
console.log("   rows.push([e.date, name, fmtTime(e.clockIn), fmtTime(e.clockOut), e.hours])");
console.log("   — the STORED values, and `hours` is recomputed server-side from the");
console.log("   stored pair. So a corrupted pair would export corrupted, both in the");
console.log("   times shown and in the hours billed.");
const totalH = closed.reduce((s, p) => s + (Number(p.hours) || 0), 0);
console.log(`   total stored hours across ${closed.length} closed punches: ${totalH.toFixed(2)}`);

// ── 8. WHICH ENTRIES WERE EDITED AT ALL ──────────────────────────────────
//
// There is no `editedBy`/`editedAt` stamp (adminEditEntry does not write one),
// so the edit has to be recognised by its fingerprint. Both editors end in
// `new Date(localString).toISOString()`, and a `datetime-local` string has no
// seconds — so an edited timestamp ALWAYS ends :00.000Z. A machine punch comes
// from `new Date().toISOString()` and lands on a random second and millisecond.
// `adminEditEntry` rewrites BOTH ends of the pair, so an edited punch has the
// signature on both.
console.log("\n8. EDIT FINGERPRINT — seconds and milliseconds are zero");
const zeroed = (iso) => /T\d\d:\d\d:00\.000Z$/.test(String(iso || ""));
const bothZero = closed.filter(p => zeroed(p.clockIn) && zeroed(p.clockOut));
const oneZero = closed.filter(p => zeroed(p.clockIn) !== zeroed(p.clockOut));
console.log(`   both ends zeroed (adminEditEntry rewrote the pair): ${bothZero.length}`);
console.log(`   exactly one end zeroed (a one-sided write):         ${oneZero.length}`);
console.log(`   neither end zeroed (untouched machine punch):       ${closed.length - bothZero.length - oneZero.length}`);
console.log(`   expected by chance at 1/1000 per end: ${(closed.length / 1e6).toFixed(4)} pairs`);

console.log("\n   the edited pairs, with the shift test:");
console.log("   (an edit through the broken row editor lands the touched field 6 or 7h");
console.log("    off; a pair edited on one side only shows it as a broken duration)");
for (const p of bothZero.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
  const h = hrs(p.clockIn, p.clockOut);
  const inH = new Date(p.clockIn).getHours(), outH = new Date(p.clockOut).getHours();
  const odd = h < 0 || h > 16 || inH >= 20 || inH < 4;
  console.log(`     ${odd ? "**" : "  "} ${p.date} person ${p.personId}  local ${String(inH).padStart(2, "0")}:${String(new Date(p.clockIn).getMinutes()).padStart(2, "0")} → ${String(outH).padStart(2, "0")}:${String(new Date(p.clockOut).getMinutes()).padStart(2, "0")}  ${h.toFixed(2)}h  src=${p.source || "?"}`);
}
for (const p of oneZero) {
  const h = hrs(p.clockIn, p.clockOut);
  console.log(`     [1] ${p.date} person ${p.personId}  ${p.clockIn} → ${p.clockOut}  ${h.toFixed(2)}h  src=${p.source || "?"}`);
}

// ── 9. WHO, AND IS IT ALREADY PAID ───────────────────────────────────────
console.log("\n9. WHO THE EDITED ENTRIES BELONG TO, AND WHETHER PAYROLL CLOSED ON THEM");
const people = await get(`orgs/${ORG}/people.json`);
const nameOf = (id) => (people.find(p => String(p.id) === String(id))?.name) || `(unknown ${id})`;
const perPerson = {};
for (const p of bothZero) (perPerson[nameOf(p.personId)] ??= []).push(p);
for (const [n, list] of Object.entries(perPerson))
  console.log(`   ${n}: ${list.length} edited (${list.filter(x => x.confirmed).length} in a confirmed timesheet)`);
console.log(`   all punches by person: ${JSON.stringify(Object.fromEntries(
  Object.entries(punches.reduce((m, p) => ((m[nameOf(p.personId)] = (m[nameOf(p.personId)] || 0) + 1), m), {}))))}`);
const confirmedEdited = bothZero.filter(p => p.confirmed);
console.log(`   edited AND confirmed (payroll closed): ${confirmedEdited.length}`);

// ── 10. THE EDITED PAIRS IN FULL, WITH THE UNWIND ────────────────────────
//
// The corruption needs the admin to change ONE SUB-COMPONENT of a field. The
// untouched component is then re-emitted FROM THE UTC DISPLAY as though it were
// local, so it lands `offset` hours late. Unwinding is therefore: subtract the
// offset from the field that looks wrong and see whether a real shift appears.
console.log("\n10. EVERY EDITED PAIR, RAW, WITH THE SIX-HOUR UNWIND");
const L = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const minus = (iso, h) => new Date(Date.parse(iso) - h * 3600000).toISOString();
for (const p of bothZero.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
  const h = hrs(p.clockIn, p.clockOut);
  const inUnwound = hrs(minus(p.clockIn, 6), p.clockOut);
  const outUnwound = hrs(p.clockIn, minus(p.clockOut, 6));
  const plausible = (x) => x > 0.2 && x <= 13;
  // ORDER MATTERS. A negative duration is the loudest symptom in the file, and
  // the first draft of this line swallowed one as "trivial" because -1.78 < 0.2.
  const verdict =
      h < 0
        ? (plausible(inUnwound) ? `BROKEN — and the offset explains it: clock-IN unwinds to ${L(minus(p.clockIn, 6))}, giving ${inUnwound.toFixed(2)}h`
         : plausible(outUnwound) ? `BROKEN — and the offset explains it: clock-OUT unwinds to ${L(minus(p.clockOut, 6))}, giving ${outUnwound.toFixed(2)}h`
         : "BROKEN (clockOut before clockIn), not by the offset")
    : h < 0.2 ? "TRIVIAL  (under 12 min — a test or a mis-punch, not payroll)"
    : plausible(h) ? "PLAUSIBLE as stored"
    : plausible(inUnwound) ? `SHIFTED: clock-IN unwinds to ${L(minus(p.clockIn, 6))}, giving ${inUnwound.toFixed(2)}h`
    : plausible(outUnwound) ? `SHIFTED: clock-OUT unwinds to ${L(minus(p.clockOut, 6))}, giving ${outUnwound.toFixed(2)}h`
    // A multi-DAY span cannot be the #498 shift, which moves a value by hours.
    : `WRONG by about ${Math.round(h / 24)} day(s) — too big to be the offset`;
  console.log(`   ${nameOf(p.personId).padEnd(8)} ${p.date}  ${L(p.clockIn)} → ${L(p.clockOut)}  ${h.toFixed(2).padStart(7)}h  ${p.confirmed ? "CONFIRMED" : "open     "}  ${verdict}`);
}

// ── 11. WHAT PAYROLL ACTUALLY CARRIES ────────────────────────────────────
console.log("\n11. PAYROLL EXPOSURE");
const stored = (p) => Number(p.hours) || 0;
const corrupt = bothZero.filter(p => hrs(p.clockIn, p.clockOut) < 0 || hrs(p.clockIn, p.clockOut) > 13);
console.log(`   edited pairs whose stored hours are not a real shift: ${corrupt.length}`);
for (const p of corrupt)
  console.log(`     ${nameOf(p.personId)} ${p.date}  stored hours ${stored(p)}  ${p.confirmed ? "IN A CONFIRMED TIMESHEET" : "timesheet still open"}`);
console.log(`     their stored hours total ${corrupt.reduce((s, p) => s + stored(p), 0).toFixed(2)} of ${totalH.toFixed(2)}`);

// Long punches NOT bearing the edit fingerprint are a separate problem — a
// forgotten clock-out, not #498 — but they are the larger payroll number, so
// stating one without the other would misrepresent the file.
const longUnedited = closed.filter(p => hrs(p.clockIn, p.clockOut) > 13 && !(zeroed(p.clockIn) && zeroed(p.clockOut)));
console.log(`\n   NOT #498: punches over 13h with no edit fingerprint: ${longUnedited.length}`);
console.log(`     stored hours in them: ${longUnedited.reduce((s, p) => s + stored(p), 0).toFixed(2)}`);
console.log(`     confirmed (already run through payroll): ${longUnedited.filter(p => p.confirmed).length}`);
