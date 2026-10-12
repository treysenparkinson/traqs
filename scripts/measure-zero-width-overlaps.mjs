#!/usr/bin/env node
// #55. WHAT APPEARS WHEN 172 ZERO-WIDTH OPS ACQUIRE WIDTH.
//
// `opInterval` ends a single-day op at `startHour + durationH`. NOTHING WRITES
// `durationH` — zero occurrences in the data, and the only two places the name
// appears in the repo are that read and a test fixture that invents it. So the
// term is always 0, the interval collapses to `{ s, e: s }`, and `rowOverlaps`
// drops it: "Zero-width ops cannot clash with anything and are skipped."
//
// Its own docblock says it mirrors `opHourRange`, which ends a single-day op at
// `walkProductiveHours(startHour, personShareHours(hpd, teamSize, ppd))`. That
// is the fix. This measures what the fix would REVEAL before it is built,
// because 172 ops acquiring width at once is a product change, not a bug fix.
//
//   node scripts/measure-zero-width-overlaps.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { buildDayWindows, walkProductiveHours, personShareHours, dayHourMs } from "../src/statsMath.js";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const [tasks, people, settings] = await Promise.all([
  get(`orgs/${ORG}/tasks.json`), get(`orgs/${ORG}/people.json`), get(`orgs/${ORG}/settings.json`),
]);

// The org's real day, not a default — the whole measurement is hour arithmetic.
const hourOf = (v, dflt) => { const m = /^(\d{1,2})(?::(\d{2}))?/.exec(String(v ?? "")); return m ? Number(m[1]) + (Number(m[2] || 0) / 60) : dflt; };
const workStartH = hourOf(settings?.workStart, 8);
const workEndH = hourOf(settings?.workEnd, 16);
const cfgBase = buildDayWindows(workStartH, workEndH, settings?.breaks, settings?.lunch);
const cfg = { ...cfgBase, workStartH, workEndH, timeZone: settings?.timeZone };
const ppd = Number(settings?.productiveHoursPerDay) || cfgBase?.productiveHoursPerDay || 8;
console.log(`shop day ${workStartH}:00–${workEndH}:00, ${ppd} productive hours, tz ${settings?.timeZone}\n`);

// TODAY: the shipped opInterval, durationH absent so the term is 0.
const intervalNow = (op) => {
  if (!op || !op.start || !op.end) return null;
  const sH = op.startHour ?? workStartH;
  const eH = op.start === op.end
    ? (op.endHour ?? Math.min(sH + Math.max(0, op.durationH || 0), workEndH))
    : (op.endHour ?? workEndH);
  const s = dayHourMs(op.start, sH, cfg.timeZone), e = dayHourMs(op.end, eH, cfg.timeZone);
  return e > s ? { s, e } : { s, e: s };
};
// AFTER: the single-day end derived from hpd, exactly as opHourRange does.
const intervalFixed = (op) => {
  if (!op || !op.start || !op.end) return null;
  const sH = op.startHour ?? workStartH;
  let eH;
  if (op.start === op.end) {
    const w = walkProductiveHours(sH, personShareHours(op.hpd, (op.team || []).length, ppd), cfg);
    eH = op.endHour ?? (w.days > 1 ? workEndH : Math.min(w.endHour, workEndH));
  } else eH = op.endHour ?? workEndH;
  const s = dayHourMs(op.start, sH, cfg.timeZone), e = dayHourMs(op.end, eH, cfg.timeZone);
  return e > s ? { s, e } : { s, e: s };
};
const clash = (a, b) => a.s < b.e && b.s < a.e;

const ops = [];
for (const j of tasks || []) { if (!j || j.deletedAt) continue;
  for (const p of j.subs || []) { if (!p || p.deletedAt) continue;
    for (const o of p.subs || []) { if (!o || o.deletedAt) continue; ops.push({ o, job: j, panel: p }); } } }
const scheduled = ops.filter(x => x.o.start && x.o.end);
const zeroWidth = scheduled.filter(x => { const i = intervalNow(x.o); return !i || i.e <= i.s; });
console.log(`scheduled ops: ${scheduled.length}`);
console.log(`zero-width under the shipped opInterval: ${zeroWidth.length}`);
console.log(`...still zero-width after the fix: ${zeroWidth.filter(x => { const i = intervalFixed(x.o); return !i || i.e <= i.s; }).length}  (an op with no hpd has nothing to derive from)\n`);

// A person cannot be in two places, so a row is a person. An op sits on every
// row its team names.
const nameOf = (id) => people.find(p => String(p.id) === String(id))?.name || `?${id}`;
const rows = new Map();
for (const x of scheduled) for (const pid of x.o.team || []) {
  if (pid == null) continue;
  const k = String(pid);
  if (!rows.has(k)) rows.set(k, []);
  rows.get(k).push(x);
}
console.log(`rows (people carrying scheduled work): ${rows.size}`);

const pairsFor = (fn) => {
  const out = [];
  for (const [pid, list] of rows) {
    const iv = list.map(x => ({ x, i: fn(x.o) })).filter(v => v.i && v.i.e > v.i.s);
    for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++)
      if (clash(iv[i].i, iv[j].i)) out.push({ pid, a: iv[i].x, b: iv[j].x });
  }
  return out;
};
const now = pairsFor(intervalNow);
const after = pairsFor(intervalFixed);
const keyOf = (p) => `${p.pid}|${[String(p.a.o.id), String(p.b.o.id)].sort().join("|")}`;
const nowKeys = new Set(now.map(keyOf));
const revealed = after.filter(p => !nowKeys.has(keyOf(p)));

console.log(`\n1. WHAT THE GUARD SEES TODAY`);
console.log(`   clashing pairs the shipped opInterval can detect: ${now.length}`);
console.log(`\n2. WHAT THE FIX WOULD REVEAL`);
console.log(`   clashing pairs after deriving the end from hpd: ${after.length}`);
console.log(`   NEWLY VISIBLE: ${revealed.length}`);

// The question that decides whether this is urgent: two single-day ops, same
// person, same day, BOTH invisible today. Those are live double-bookings.
const zeroIds = new Set(zeroWidth.map(x => String(x.o.id)));
const bothInvisible = revealed.filter(p => zeroIds.has(String(p.a.o.id)) && zeroIds.has(String(p.b.o.id)));
console.log(`\n3. DOUBLE-BOOKINGS SITTING ON THE BOARD RIGHT NOW`);
console.log(`   newly-visible pairs where BOTH ops are invisible today: ${bothInvisible.length}`);
const fmt = (x) => `${String(x.o.title || "untitled").slice(0, 26)} [${x.o.start}${x.o.startHour != null ? ` @${x.o.startHour}` : ""} hpd ${x.o.hpd ?? "—"}] (${String(x.job.title || "").slice(0, 20)})`;
for (const p of bothInvisible.slice(0, 40))
  console.log(`     ${nameOf(p.pid).padEnd(9)} ${p.a.o.start}  ${fmt(p.a)}  ✕  ${fmt(p.b)}`);

console.log(`\n4. HOW MUCH OF THE BOARD TURNS RED`);
const touched = new Set();
for (const p of revealed) { touched.add(String(p.a.o.id)); touched.add(String(p.b.o.id)); }
console.log(`   distinct ops involved in a newly-visible clash: ${touched.size} of ${scheduled.length} scheduled`);
const byPerson = {};
for (const p of revealed) byPerson[nameOf(p.pid)] = (byPerson[nameOf(p.pid)] || 0) + 1;
console.log(`   newly-visible pairs per person: ${JSON.stringify(byPerson)}`);
const past = revealed.filter(p => p.a.o.start < new Date().toISOString().slice(0, 10));
console.log(`   ...of which start in the PAST (already happened, nothing to reschedule): ${past.length}`);

console.log(`\n5. THE ONLY SLICE THAT CHANGES ANYONE'S DAY: TODAY FORWARD`);
const TODAY = new Date().toISOString().slice(0, 10);
const fwdNew = revealed.filter(p => p.a.o.start >= TODAY || p.b.o.start >= TODAY);
const fwdNow = now.filter(p => p.a.o.start >= TODAY || p.b.o.start >= TODAY);
console.log(`   today is ${TODAY}`);
console.log(`   clashes the guard already sees, today forward: ${fwdNow.length}`);
console.log(`   NEWLY visible, today forward:                  ${fwdNew.length}`);
for (const p of fwdNew.slice(0, 20)) console.log(`     ${nameOf(p.pid)} ${p.a.o.start}  ${fmt(p.a)}  x  ${fmt(p.b)}`);
const latest = revealed.map(p => p.a.o.start).sort().pop();
console.log(`   latest start among newly-visible pairs: ${latest}`);

// ── 6. THE CORRECTION THAT MATTERS ───────────────────────────────────────
//
// Everything above measures `opInterval`, AND `opInterval` IS NOT THE LIVE
// RULE. overlapRules.js says so in its own header: it replaced five rules that
// disagreed, naming "enforceNoOverlap (… zero-width single-day ops …)" as one
// of them (root cause 5). The live rule occupies `opDaySegments` blocks, which
// derive from hpd already — so single-day ops are NOT invisible to it.
//
// opInterval, intervalsOverlap, rowOverlaps, firstFreeStart, packActiveRow and
// dayShiftToClear have ZERO call sites outside statsMath.js, in src/ and in
// netlify/ alike. dayShiftToClear is imported into TRAQS.jsx and never called.
//
// So the real question — are two single-day ops double-booked on someone right
// now — has to be asked of the LIVE rule, which is what this section does.
const { overlapContext, occupyingUnits, unitBlocks, blocksOverlap } = await import("../src/overlapRules.js");
console.log("\n6. THE LIVE RULE (overlapRules.js), WHICH IS NOT opInterval");
const ctx = overlapContext(settings || {});
const units = occupyingUnits(tasks, ctx);
console.log(`   units the live rule considers (unfinished, dated, reaching today): ${units.length}`);
const liveRows = new Map();
for (const u of units) for (const pid of u.team || []) {
  if (pid == null) continue;
  const k = String(pid);
  if (!liveRows.has(k)) liveRows.set(k, []);
  liveRows.get(k).push(u);
}
let livePairs = 0; const liveList = [];
for (const [pid, list] of liveRows) {
  const withBlocks = list.map(u => ({ u, b: unitBlocks(u, ctx) }));
  for (let i = 0; i < withBlocks.length; i++) for (let j = i + 1; j < withBlocks.length; j++)
    if (blocksOverlap(withBlocks[i].b, withBlocks[j].b)) { livePairs++; liveList.push({ pid, a: withBlocks[i].u, b: withBlocks[j].u }); }
}
console.log(`   DOUBLE-BOOKED PAIRS THE LIVE RULE SEES RIGHT NOW: ${livePairs}`);
for (const p of liveList.slice(0, 25))
  console.log(`     ${nameOf(p.pid).padEnd(9)} ${p.a.start}  "${String(p.a.title || "").slice(0, 24)}" (hpd ${p.a.hpd ?? "—"})  x  "${String(p.b.title || "").slice(0, 24)}" (hpd ${p.b.hpd ?? "—"}) ${p.b.start}`);
const singleDayPairs = liveList.filter(p => p.a.start === p.a.end && p.b.start === p.b.end);
console.log(`   ...of which BOTH units are single-day (the #55 population): ${singleDayPairs.length}`);
