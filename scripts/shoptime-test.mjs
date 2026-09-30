// Shop time (root cause 6: #76 #77 #215). Schedule geometry reads in the org's
// timezone whoever is looking; with no org zone it is the viewer's own.
//
// Runs itself in a viewer zone that is NOT the shop's (New York viewing a Denver shop),
// because every bug here is invisible to a viewer sitting in the shop's own zone.
//
// Red-first hooks: SHOP_SRC / STATS_SRC / AH_SRC point the imports at other copies
// (e.g. a placeholder shopTime, or HEAD's statsMath / after-hours) to prove the checks fail.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

if (process.env.TZ !== "America/New_York") {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, TZ: "America/New_York" } });
  process.exit(r.status ?? 1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = (envKey, rel) => pathToFileURL(process.env[envKey] ? path.resolve(process.env[envKey]) : path.join(root, rel)).href;
const shop = await import(url("SHOP_SRC", "src/shopTime.js"));
const stats = await import(url("STATS_SRC", "src/statsMath.js"));
const ah = await import(url("AH_SRC", "netlify/functions/_utils/after-hours.js"));

let pass = 0, fail = 0;
const check = (name, fn) => {
  let ok = false, why = "";
  try { const r = fn(); ok = r === true; if (!ok) why = ` (got ${JSON.stringify(r)})`; } catch (e) { why = ` (threw ${e.message})`; }
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${why}`); }
};
const eq = (a, b) => (a === b ? true : { got: a, want: b });
const near = (a, b) => (Math.abs(a - b) < 1e-6 ? true : { got: a, want: b });
const Z = "2026-09-30T";
const DEN = "America/Denver";

console.log("1. shopTime reads the shop's clock, not the viewer's");
shop.setShopZone?.(DEN);
check("08:00 in Denver is 14:00Z (viewer in New York)", () => eq(shop.shopMs("2026-09-30", 8), Date.parse(Z + "14:00:00Z")));
check("the hour of 14:00Z is 8 on the shop's clock", () => near(shop.shopHour(Date.parse(Z + "14:00:00Z")), 8));
check("23:00 Denver on the 30th is still the 30th for the shop", () => eq(shop.shopDay(Date.parse("2026-10-01T05:00:00Z")), "2026-09-30"));
check("fractional hour: 12:30 Denver", () => eq(shop.shopMs("2026-09-30", 12.5), Date.parse(Z + "18:30:00Z")));
check("an explicit zone overrides the session zone", () => eq(shop.shopMs("2026-09-30", 8, "Europe/London"), Date.parse(Z + "07:00:00Z")));

console.log("2. DST days: wall-clock hours (#77)");
check("spring forward: 08:00 on 2026-03-08 is 14:00Z (MDT)", () => eq(shop.shopMs("2026-03-08", 8), Date.parse("2026-03-08T14:00:00Z")));
check("fall back: 08:00 on 2026-11-01 is 15:00Z (MST)", () => eq(shop.shopMs("2026-11-01", 8), Date.parse("2026-11-01T15:00:00Z")));
const sunCfg = { workStartH: 8, workEndH: 17, deadWindows: [], workDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] };
check("a full 08–17 spring-forward Sunday is 9 productive hours", () =>
  near(stats.productiveHoursBetween(shop.shopMs("2026-03-08", 8), shop.shopMs("2026-03-08", 17), sunCfg), 9));
check("a full 08–17 fall-back Sunday is 9 productive hours", () =>
  near(stats.productiveHoursBetween(shop.shopMs("2026-11-01", 8), shop.shopMs("2026-11-01", 17), sunCfg), 9));

console.log("3. no org zone → the viewer's own clock, unchanged");
shop.setShopZone?.(null);
check("shopMs equals new Date(y, m, d, h)", () => eq(shop.shopMs("2026-09-30", 8), new Date(2026, 8, 30, 8).getTime()));
check("fractional hour equals the local Date", () => eq(shop.shopMs("2026-09-30", 9.75), new Date(2026, 8, 30, 9, 45).getTime()));
check("shopDay equals the local date", () => eq(shop.shopDay(Date.parse("2026-10-01T03:00:00Z")), "2026-09-30"));
check("shopHour equals getHours", () => near(shop.shopHour(Date.parse(Z + "14:30:00Z")), 10.5));
check("the viewer's own zone named explicitly is the same as none", () => { shop.setShopZone?.("America/New_York"); const r = eq(shop.shopMs("2026-09-30", 8), new Date(2026, 8, 30, 8).getTime()); shop.setShopZone?.(null); return r; });
check("an unknown zone falls back to the viewer's", () => { shop.setShopZone?.("Mars/Olympus"); const r = eq(shop.shopMs("2026-09-30", 8), new Date(2026, 8, 30, 8).getTime()); shop.setShopZone?.(null); return r; });

console.log("4. the schedule's time math follows the shop zone");
shop.setShopZone?.(DEN);
const cfg = { workStartH: 8, workEndH: 17, deadWindows: [{ start: 12, dur: 1 }], workDays: [1, 2, 3, 4, 5], holidays: [] };
check("productive hours 08:00–17:00 Denver = 8 (viewer in NY)", () =>
  near(stats.productiveHoursBetween(Date.parse(Z + "14:00:00Z"), Date.parse(Z + "23:00:00Z"), cfg), 8));
check("dayHourMs is shop time", () => eq(stats.dayHourMs("2026-09-30", 8), Date.parse(Z + "14:00:00Z")));
check("normalizeToWorkTime: 06:00 Denver rolls to 08:00 Denver", () =>
  eq(stats.normalizeToWorkTime(Date.parse(Z + "12:00:00Z"), cfg), Date.parse(Z + "14:00:00Z")));
check("normalizeToWorkTime: 16:00 Denver is inside the window", () =>
  eq(stats.normalizeToWorkTime(Date.parse(Z + "22:00:00Z"), cfg), Date.parse(Z + "22:00:00Z")));
check("normalizeToWorkTime: 18:00 Denver Friday rolls to Monday 08:00", () =>
  eq(stats.normalizeToWorkTime(Date.parse("2026-10-03T00:00:00Z"), cfg), Date.parse("2026-10-05T14:00:00Z")));

console.log("5. end of day (#215): one rule");
// 2026-10-02 is a Friday.
check("09:00 clock-in → 17:00 that day, shop time", () =>
  eq(stats.endOfWorkingDayMs(Date.parse("2026-10-02T15:00:00Z"), cfg), Date.parse("2026-10-02T23:00:00Z")));
check("18:00 Friday clock-in → Monday's 17:00, not instantly unclosed", () =>
  eq(stats.endOfWorkingDayMs(Date.parse("2026-10-03T00:00:00Z"), cfg), Date.parse("2026-10-05T23:00:00Z")));
check("the roll skips a holiday", () =>
  eq(stats.endOfWorkingDayMs(Date.parse("2026-10-03T00:00:00Z"), { ...cfg, holidays: ["2026-10-05"] }), Date.parse("2026-10-06T23:00:00Z")));
check("a late clock-in open an hour later is NOT unclosed", () =>
  eq(stats.openSessionEnd({ clockInMs: Date.parse("2026-10-03T00:00:00Z"), nowMs: Date.parse("2026-10-03T01:00:00Z"), cfg }).unclosed, false));
check("a 09:00 clock-in still open at 17:30 Denver IS unclosed, frozen at 17:00", () => {
  const r = stats.openSessionEnd({ clockInMs: Date.parse("2026-10-02T15:00:00Z"), nowMs: Date.parse("2026-10-02T23:30:00Z"), cfg });
  return r.unclosed === true && r.endMs === Date.parse("2026-10-02T23:00:00Z") ? true : r;
});
check("with an explicit timeZone in cfg the rule ignores the session zone", () => {
  shop.setShopZone?.(null);
  const r = eq(stats.endOfWorkingDayMs(Date.parse("2026-10-02T15:00:00Z"), { ...cfg, timeZone: DEN }), Date.parse("2026-10-02T23:00:00Z"));
  shop.setShopZone?.(DEN);
  return r;
});

console.log("6. after-hours alert: the same end of day + grace, backstop");
const org = { workEnd: "17:00", timeZone: DEN, workDays: [1, 2, 3, 4, 5], holidays: [] };
check("09:00 clock-in alerts at 17:30 Denver", () =>
  eq(ah.afterHoursAlertAt("2026-10-02T15:00:00Z", org), Date.parse("2026-10-02T23:30:00Z")));
check("a late clock-in is capped by the 12 h backstop", () =>
  eq(ah.afterHoursAlertAt("2026-10-03T00:00:00Z", org), Date.parse("2026-10-03T12:00:00Z")));
check("no zone → backstop only", () =>
  eq(ah.afterHoursAlertAt("2026-10-02T15:00:00Z", { ...org, timeZone: null }), Date.parse("2026-10-03T03:00:00Z")));
check("a bad zone → backstop, not a throw", () =>
  eq(ah.afterHoursAlertAt("2026-10-02T15:00:00Z", { ...org, timeZone: "Mars/Olympus" }), Date.parse("2026-10-03T03:00:00Z")));
check("the alert's end of day is the web's end of day", () =>
  eq(ah.afterHoursAlertAt("2026-10-02T15:00:00Z", org) - ah.GRACE_MS, stats.endOfWorkingDayMs(Date.parse("2026-10-02T15:00:00Z"), { ...cfg, timeZone: DEN })));

console.log("7. the web reads schedule time through shop time (executed)");
const jsx = fs.readFileSync(process.env.WEB_TZ_SRC || path.join(root, "src/TRAQS.jsx"), "utf8");
const line = (re) => { const m = jsx.match(re); if (!m) throw new Error("anchor not found: " + re); return m[0]; };
check("hourTs is shop wall-clock time", () => {
  const src = line(/const hourTs = \(ds, h\) => [^\n]+;/);
  const hourTs = new Function("shopMs", src + "; return hourTs;")(shop.shopMs);
  return eq(hourTs("2026-09-30", 8), Date.parse(Z + "14:00:00Z"));
});
check("TD follows the shop's day each render", () => {
  const src = line(/setShopZone\(orgSettings\.timeZone\);\s*TD = shopDay\(\);/);
  let TD = "stale";
  let zone = null;
  new Function("setShopZone", "shopDay", "orgSettings", "TDref", src.replace("TD = shopDay()", "TDref.v = shopDay()"))(
    (z) => { zone = z; }, () => "2026-09-30", { timeZone: DEN }, { set v(x) { TD = x; } });
  return zone === DEN && TD === "2026-09-30" ? true : { zone, TD };
});
check("no schedule code reads the viewer's clock hour (getHours) any more", () => {
  const hits = jsx.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /\.getHours\(\)/.test(l));
  // The two left are admin time pickers editing an absolute timestamp, which stays viewer-local.
  const ok = hits.every(([, l]) => /setSinceEdit|tsLocal/.test(l));
  return ok ? true : hits.map(([n]) => n);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
