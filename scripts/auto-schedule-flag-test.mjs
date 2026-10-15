// Excluded from auto-scheduling means the same thing on every platform — #229.
//
// Two fields carry one fact. The web writes and reads `noAutoSchedule`; the iOS and Android
// toggles write `autoSchedule: false`. iOS honours BOTH (`isAutoSchedulable` in Models.swift:
// `!(noAutoSchedule ?? false) && (autoSchedule ?? true)`); the web read only its own, so a person
// excluded from a phone was still auto-scheduled from the web, and the web's toggle showed them
// as included. The web now uses iOS's exact rule everywhere — the crew filters, the badges and
// both toggles — and a toggle that INCLUDES someone clears both fields, so no hidden
// `autoSchedule: false` survives an "off".
//
//   node scripts/auto-schedule-flag-test.mjs

import { readFileSync } from "node:fs";
import { isAutoSchedulable, autoScheduleFlags } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

ok("a person with neither field is schedulable", isAutoSchedulable({}) === true);
ok("excluded on the web (noAutoSchedule)", isAutoSchedulable({ noAutoSchedule: true }) === false);
ok("#229 excluded from a phone (autoSchedule: false)", isAutoSchedulable({ autoSchedule: false }) === false);
ok("autoSchedule: true alone is schedulable", isAutoSchedulable({ autoSchedule: true }) === true);
ok("either exclusion wins", isAutoSchedulable({ autoSchedule: true, noAutoSchedule: true }) === false);
ok("#229 excluding writes the web's flag", JSON.stringify(autoScheduleFlags(false)) === JSON.stringify({ noAutoSchedule: true }));
ok("#229 including clears BOTH, so a phone's exclusion cannot linger", JSON.stringify(autoScheduleFlags(true)) === JSON.stringify({ noAutoSchedule: false, autoSchedule: true }));
ok("#229 ...and the result is schedulable even over a phone's exclusion", isAutoSchedulable({ autoSchedule: false, ...autoScheduleFlags(true) }) === true);

const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const raw = (S.match(/[^\n]*\bnoAutoSchedule\b[^\n]*/g) || []);
ok(`#229 nothing in the web reads noAutoSchedule by itself any more (found ${raw.length}: ${JSON.stringify(raw.map(l => l.trim().slice(0, 70)))})`, raw.length === 0);
ok("#229 the crew filters use the shared rule", (S.match(/isAutoSchedulable\(p{1,2}\)/g) || []).length >= 4);
ok("#229 both toggles write through autoScheduleFlags", (S.match(/autoScheduleFlags\(/g) || []).length >= 2);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
