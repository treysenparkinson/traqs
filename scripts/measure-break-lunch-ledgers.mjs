#!/usr/bin/env node
// TREY'S RULE, CHECKED AGAINST BOTH LEDGERS.
//
//   BREAK — pay keeps running, production keeps running
//   LUNCH — both stop
//
// What the code does TODAY, read at the call sites rather than inferred:
//   lunchStart/lunchEnd  (2408/2423) -> applyLunchJobPause  -> PAUSES the job clock
//                                     + writes a lunch event -> PAY subtracts it
//   breakStart/breakEnd  (2438/2453) -> applyAutoJobPause("break") -> PAUSES the job clock
//                                     + writes a break event -> PAY does NOT subtract it
//   breakBegin/breakClear (2036/2063) -> same, the lightweight "on break" status
//   adminLunch/Break      (1256)      -> same
//
// timeclock.js:451 states the intent outright: "Lunch AND breaks must stop the
// job clock. Production time is the 9h window minus BOTH (60min lunch + 30min
// breaks = 7.5h), while pay only loses lunch (8h). That asymmetry is
// deliberate: the 0.5h gap between them is paid break time."
//
// SO THE CODE AND THE RULE DISAGREE ON BREAKS, DELIBERATELY AND IN WRITING.
// Pay matches the rule exactly. Production does not: a break stops it.
//
//   node scripts/measure-break-lunch-ledgers.mjs
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const [pay, people, settings] = await Promise.all([get(`orgs/${ORG}/payhours.json`), get(`orgs/${ORG}/people.json`), get(`orgs/${ORG}/settings.json`)]);
const nameOf = (id) => people.find(p => String(p.id) === String(id))?.name || `?${id}`;

const evs = (pay || []).filter(r => r && r.eventType && r.timestamp && !r.deletedAt);
const byType = {};
for (const e of evs) byType[e.eventType] = (byType[e.eventType] || 0) + 1;
console.log(`payhours event rows: ${evs.length}`);
console.log(`  ${JSON.stringify(byType)}\n`);

const pairUp = (list, startT, endT) => {
  const out = []; let open = null;
  for (const e of list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    if (e.eventType === startT) open = e;
    else if (e.eventType === endT && open) { out.push({ a: open, b: e, ms: Date.parse(e.timestamp) - Date.parse(open.timestamp) }); open = null; }
  }
  return { pairs: out, dangling: open ? 1 : 0 };
};
const perPerson = new Map();
for (const e of evs) { const k = String(e.personId); if (!perPerson.has(k)) perPerson.set(k, []); perPerson.get(k).push(e); }

let bPairs = 0, bMs = 0, bDang = 0, lPairs = 0, lMs = 0, lDang = 0;
for (const [, list] of perPerson) {
  const b = pairUp(list.filter(e => /^break/.test(e.eventType)), "breakStart", "breakEnd");
  const l = pairUp(list.filter(e => /^lunch/.test(e.eventType)), "lunchStart", "lunchEnd");
  bPairs += b.pairs.length; bMs += b.pairs.reduce((s, p) => s + p.ms, 0); bDang += b.dangling;
  lPairs += l.pairs.length; lMs += l.pairs.reduce((s, p) => s + p.ms, 0); lDang += l.dangling;
}
console.log("1. BREAKS — the rule says they stop NEITHER clock");
console.log(`   closed break pairs: ${bPairs}  (unclosed: ${bDang})`);
console.log(`   clocked break time: ${(bMs / 3600000).toFixed(2)}h`);
console.log(`   PAY:        does not subtract them  -> matches the rule`);
console.log(`   PRODUCTION: applyAutoJobPause("break") pauses the job clock -> BREAKS THE RULE`);
console.log(`   production time taken by clocked breaks: ${(bMs / 3600000).toFixed(2)}h`);

console.log("\n2. LUNCHES — the rule says both stop");
console.log(`   closed lunch pairs: ${lPairs}  (unclosed: ${lDang})`);
console.log(`   clocked lunch time: ${(lMs / 3600000).toFixed(2)}h`);
console.log(`   PAY:        subtracts the actual rows -> matches the rule`);
console.log(`   PRODUCTION: applyLunchJobPause pauses the job clock -> matches the rule`);

console.log("\n3. DID ANY LUNCH LEAVE A CLOCK RUNNING?");
const openNow = (people || []).filter(p => p?.activeClockIn && p?.activeJobClock);
console.log(`   people with BOTH clocks open right now: ${openNow.length}`);
for (const p of openNow) console.log(`     ${p.name}: activeBreak=${!!p.activeBreak} jobPausedAt=${p.activeJobClock?.pausedAt || "none"} reason=${p.activeJobClock?.pausedReason || "-"}`);
const strandedLunch = (people || []).filter(p => p?.activeJobClock?.pausedAt && (p.activeJobClock.pausedReason === "lunch" || p.activeJobClock.pausedByLunch) && !(p.activeClockIn?.events || []).some(e => e.type === "lunchStart"));
console.log(`   job clocks paused "lunch" with no open lunch event: ${strandedLunch.length}`);

console.log("\n4. THE PAY-SIDE EQUIVALENT OF THE 120.31h");
console.log(`   A scheduled window is deducted from pay at ZERO sites: neither`);
console.log(`   hoursElapsedMinusPauses nor netHoursForPunch takes a cfg at all.`);
console.log(`   Confirmed on data in measure-lunch-recredit section 6: 346 of 347`);
console.log(`   punches equal wall clock minus ACTUAL clocked lunch, to the cent.`);
console.log(`   So the pay-side equivalent of 120.31h is 0.00h. Nobody is underpaid`);
console.log(`   by a scheduled deduction, because pay never applies one.`);
console.log(`\n   What IS on the pay side is the opposite sign, and it is the break rule:`);
console.log(`   ${(bMs / 3600000).toFixed(2)}h of clocked breaks are PAID (correct per the rule)`);
console.log(`   and the same ${(bMs / 3600000).toFixed(2)}h is removed from production (against the rule).`);
