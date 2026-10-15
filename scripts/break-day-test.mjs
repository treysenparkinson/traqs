// The admin break timer's fallback reads "today" in the SHOP's zone, like the events it matches — #308.
//
// `breakStartTs` falls back to the payhours log when neither activeBreak nor the clock-in's own
// events carry the open break, and it filtered that log on `e.date === today` with
// today = new Date(now).toISOString().slice(0, 10) — the UTC date. The server stamps each
// event's `date` in the org's zone (timeclock.js localDayOf), so from 18:00 in Denver (00:00
// UTC) the filter looked in TOMORROW's events and missed an open break. It uses shopDay(now).
//
// Scoped to breakStartTs, comments stripped (R4).
//
//   node scripts/break-day-test.mjs

import { readFileSync } from "node:fs";
import { shopDay, setShopZone } from "../src/shopTime.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = S.indexOf("const breakStartTs = (p) => {");
const fn = S.slice(at, S.indexOf("const startTsFor", at));
ok("breakStartTs is found", at > 0);
ok("#308 it no longer takes today as the UTC date", !/toISOString\(\)\.slice\(0, 10\)/.test(fn));
ok("#308 it takes today in the shop's zone", /const today = shopDay\(now\);/.test(fn));

// The difference, executed: 19:00 in Denver on the 15th is the 16th in UTC.
setShopZone("America/Denver");
const evening = Date.parse("2026-10-16T01:00:00Z");   // 19:00 MDT, 2026-10-15
ok("#308 at 19:00 Denver the shop's day is still the 15th", shopDay(evening) === "2026-10-15");
ok("...where the UTC date had already moved on", new Date(evening).toISOString().slice(0, 10) === "2026-10-16");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
