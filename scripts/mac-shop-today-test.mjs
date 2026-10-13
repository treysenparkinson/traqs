// #366 — THE MAC'S "TODAY" IS THE SHOP'S DAY, NOT THE DEVICE'S.
//
// The web's `TD` is `shopDay()` — the org's zone. The Mac kept a device-zone today
// (`JobsDate.todayKey`, a formatter with no time zone), so on a Mac whose zone differs
// from the shop's, the grid's overdue / "soon" colouring and the New Job scheduler's
// earliest day turned over at the wrong midnight. The calendar glyph's date likewise.
//
// SOURCE SHAPE ONLY. The Mac has no test target and the iOS tests cannot compile Mac
// files, so this reads the Swift as text — same standing as native-id-status-test. The
// Mac target itself is typechecked separately (swiftc -typecheck), not built.
//
//   node scripts/mac-shop-today-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const GRID = read("../TRAQS MacBook Native/TRAQS MacBook Native/JobsGrid.swift");
const ICONS = read("../TRAQS MacBook Native/TRAQS MacBook Native/WebIcons.swift");

console.log("\n1. TODAY IS THE SHOP'S DAY");
ok("JobsDate.todayKey reads the shop's zone", /static var todayKey: String \{ ShopTime\.current\.ymd\(Date\(\)\) \}/.test(GRID), true);
ok("...not the device-zone key formatter", /static var todayKey: String \{ keyFormatter\.string\(from: Date\(\)\) \}/.test(GRID), false);

console.log("\n2. THE CALENDAR GLYPH SHOWS THE SHOP'S DATE");
ok("ScheduleGlyph's day comes from the shop's calendar",
  /var day: Int = ShopTime\.current\.calendar\.component\(\.day, from: Date\(\)\)/.test(ICONS), true);

console.log(`\n${pass} passed, ${fail} failed`);
console.log("NOTE: source shape only. The Mac app was not built or run.");
process.exit(fail ? 1 : 0);
