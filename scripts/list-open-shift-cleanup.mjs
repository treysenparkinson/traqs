#!/usr/bin/env node
// #502 follow-up: the two worklists, for a human to clear by hand.
//
// READ-ONLY. It writes nothing, to S3 or anywhere else — the decisions here are
// Trey's, Max's, Heston's and Caleb's, and nothing in the data can make them.
//
//   node scripts/list-open-shift-cleanup.mjs

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
const stored = (p) => Number(p.hours) || 0;
const D = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const T = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// Groups sharing a person and a clock-in MINUTE: one open session that produced
// more than one punch (the stale-roster resurrection people.js documents).
const groups = {};
for (const p of punches) (groups[`${p.personId}|${p.clockIn.slice(0, 16)}`] ??= []).push(p);
const dupes = Object.values(groups).filter(v => v.length > 1)
  .map(v => v.sort((a, b) => Date.parse(a.clockOut) - Date.parse(b.clockOut)))
  .sort((a, b) => String(a[0].date).localeCompare(String(b[0].date)));

console.log("═".repeat(78));
console.log("LIST 1 — DUPLICATE SESSIONS. One clock-in, more than one punch.");
console.log("═".repeat(78));
console.log("Each block is ONE clock-in. The worker clocked in once; a stale");
console.log("browser re-asserted the session after it was closed, so the next");
console.log("clock-out wrote another punch off the same start.");
console.log();
console.log("WHICH ONE TO KEEP IS NOT IN THE DATA, so none is marked for you.");
console.log("Where a short, plausible shift sits beside a long one, the short one");
console.log("is almost certainly the real clock-out. Where both are long, the real");
console.log("one was never recorded and the end has to come from the person.");
console.log();

let ghostHours = 0;
for (const g of dupes) {
  const overnight = g.filter(p => D(p.clockOut) !== D(p.clockIn));
  console.log(`  ${nameOf(g[0].personId)} — clocked in ${g[0].date} at ${T(g[0].clockIn)}  (${g.length} punches${overnight.length ? `, ${overnight.length} ran past midnight` : ""})`);
  g.forEach((p, i) => {
    const h = hrs(p.clockIn, p.clockOut);
    const night = D(p.clockOut) !== D(p.clockIn);
    console.log(`      ${i === 0 ? "first" : " then"}  ${p.id}`);
    console.log(`             out ${D(p.clockOut)} ${T(p.clockOut)}${night ? "  (next day or later)" : ""}   ${h.toFixed(2)}h gross, ${stored(p).toFixed(2)}h stored${p.confirmed ? "   CONFIRMED" : ""}`);
  });
  ghostHours += g.slice(1).reduce((s, p) => s + stored(p), 0);
  console.log();
}
console.log(`  ${dupes.length} groups. Hours in the extra copies, keeping the earliest of each: ${ghostHours.toFixed(2)}`);
console.log(`  Ids for deletion, extras only (earliest of each group kept):`);
console.log(`    ${dupes.flatMap(g => g.slice(1)).map(p => p.id).join("\n    ")}`);

// The rest: a long shift that is the ONLY punch off its clock-in. Nothing was
// resurrected; nobody closed it.
const dupKeys = new Set(Object.entries(groups).filter(([, v]) => v.length > 1).map(([k]) => k));
const crossed = punches
  .filter(p => D(p.clockOut) !== D(p.clockIn) && !dupKeys.has(`${p.personId}|${p.clockIn.slice(0, 16)}`))
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));
// A clock-out BEFORE its clock-in is not an unclosed shift — it is a corrupt
// row, and asking the worker when they left would be asking about a shift that
// never had that shape. Split out rather than padded into the worklist.
const backwards = crossed.filter(p => hrs(p.clockIn, p.clockOut) < 0);
const unclosed = crossed.filter(p => hrs(p.clockIn, p.clockOut) >= 0);

console.log();
console.log("═".repeat(78));
console.log("LIST 2 — NOBODY CLOSED THESE. One punch, clocked out a later day.");
console.log("═".repeat(78));
console.log("The clock-out on every one of these is machine-stamped and genuine —");
console.log("the entry id carries the instant it was created and agrees with it. So");
console.log("the START is right and the END is whenever someone next touched the");
console.log("clock. Only the person who worked it knows when they actually left.");
console.log();
console.log("  PERSON     DATE        CLOCKED IN   CLOCKED OUT            STORED   TRUE END");
for (const p of unclosed) {
  console.log(`  ${nameOf(p.personId).padEnd(9)}  ${p.date}  ${T(p.clockIn).padEnd(11)}  ${D(p.clockOut)} ${T(p.clockOut)}  ${stored(p).toFixed(2).padStart(7)}h   __:__`);
}
const byWho = {};
for (const p of unclosed) byWho[nameOf(p.personId)] = (byWho[nameOf(p.personId)] || 0) + 1;
console.log();
console.log(`  ${unclosed.length} punches, ${unclosed.reduce((s, p) => s + stored(p), 0).toFixed(2)} stored hours, none confirmed.`);
console.log(`  To ask: ${Object.entries(byWho).map(([n, c]) => `${n} (${c})`).join(", ")}`);
console.log();
console.log(`  Fix each one in Time Clock → the person's Timestamps → Edit, which`);
console.log(`  posts adminEditEntry and re-derives hours net of lunch.`);

if (backwards.length) {
  console.log();
  console.log("─".repeat(78));
  console.log("NOT A WORKLIST — rows whose clock-out is BEFORE their clock-in.");
  console.log("─".repeat(78));
  console.log("Nobody can supply an end time for these; the shape is wrong, not the");
  console.log("ending. Delete or leave; they carry no hours either way.");
  for (const p of backwards)
    console.log(`  ${nameOf(p.personId).padEnd(9)}  ${p.date}  in ${D(p.clockIn)} ${T(p.clockIn)}  out ${D(p.clockOut)} ${T(p.clockOut)}  ${stored(p).toFixed(2)}h  ${p.id}${p.confirmed ? "  CONFIRMED" : ""}`);
}

// The numbers in #502 were drawn on a different line, and saying so is cheaper
// than leaving two counts in the record that do not add up.
console.log();
console.log("─".repeat(78));
console.log("WHY THESE COUNTS DIFFER FROM #502");
console.log("─".repeat(78));
const over12 = punches.filter(p => hrs(p.clockIn, p.clockOut) > 12);
const sameDayLong = over12.filter(p => D(p.clockOut) === D(p.clockIn));
console.log(`  #502 counted punches over 12 HOURS: ${over12.length}, of which ${sameDayLong.length} ended`);
console.log(`  the same local day — long days, not unclosed shifts. These lists use`);
console.log(`  CROSSED A LOCAL MIDNIGHT instead, which is the separator #502 argued`);
console.log(`  for and the one the #503 confirm gate now applies.`);
console.log(`     over 12h, not in a duplicate group:  ${over12.filter(p => !dupKeys.has(`${p.personId}|${p.clockIn.slice(0, 16)}`)).length}   <- #502's "15 forgotten"`);
console.log(`     crossed midnight, not duplicated:    ${crossed.length}   <- list 2, minus ${backwards.length} backwards row`);
console.log(`  And the ghost ids below are every EXTRA copy (${dupes.flatMap(g => g.slice(1)).length}), not only the long ones (${over12.filter(p => dupKeys.has(`${p.personId}|${p.clockIn.slice(0, 16)}`)).length}):`);
console.log(`  a duplicate session is worth clearing whether or not its copy ran late.`);
