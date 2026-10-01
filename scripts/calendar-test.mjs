// One working calendar and one set of defaults — SCHEDULE_MAP root cause 6
// (#21, #78, #79, #80, #81, #82, #85, #86, #213, #214).
//
//   node scripts/calendar-test.mjs
//
// Working-day math read the org's work week and holidays only when a caller
// remembered to pass them; left out, it silently used Mon–Fri with no holidays —
// and a set of helpers never took holidays at all. So a holiday was painted over,
// moves landed on weekends, and an empty work week hung every open session. Now:
//   - scheduleRules.workCalendar(settings) is the one calendar: holidays included,
//     every loop bounded, an empty work week read as Mon–Fri;
//   - the web's addBD/nextBD/diffBD/weekdaySegments/… delegate to it, and a call
//     that leaves out org options gets the ORG's calendar, not Mon–Fri;
//   - src/orgDefaults.js is the one set of defaults (07:00–15:00, 30-min lunch,
//     one 15-min break at 10:00), a stored null counting as missing;
//   - the server refuses workDays: [] outright.
import { readFileSync } from "node:fs";
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

let R, D, S, O, settingsFn;
try {
  R = await import(new URL("../src/scheduleRules.js", import.meta.url).href);
  D = await import(new URL("../src/orgDefaults.js", import.meta.url).href);
  S = await import(new URL("../src/statsMath.js", import.meta.url).href);
  O = await import(new URL("../src/overlapRules.js", import.meta.url).href);
  settingsFn = (await import(new URL("../netlify/functions/settings.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the modules under test:", e); process.exit(2); }
if (typeof R.workCalendar !== "function") { console.error("scheduleRules.js does not export workCalendar"); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const MON = "2026-10-05", TUE = "2026-10-06", WED = "2026-10-07", THU = "2026-10-08", FRI = "2026-10-09";

console.log("\n1. workCalendar: the same answers as the old helpers when there are no holidays");
{
  const c = R.workCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [] });
  ok("isWorkDay: Mon yes, Sat no", [c.isWorkDay(MON), c.isWorkDay("2026-10-10")], [true, false]);
  ok("add(Fri, 1) → Mon; add(Mon, -1) → Fri", [c.add(FRI, 1), c.add("2026-10-12", -1)], ["2026-10-12", FRI]);
  ok("next(Sat) → Mon; next(Mon) → Mon", [c.next("2026-10-10"), c.next(MON)], ["2026-10-12", MON]);
  ok("diff(Mon, Fri) = 4 (working days after Mon, up to Fri)", c.diff(MON, FRI), 4);
  ok("diffSigned(Fri, Mon) = -4", c.diffSigned(FRI, MON), -4);
  ok("span(Mon, Fri) = 5 (inclusive)", c.span(MON, FRI), 5);
  ok("countForward(Mon, 3) → Wed (start included)", c.countForward(MON, 3), WED);
  ok("segments(Thu, next Tue) split at the weekend", c.segments(THU, "2026-10-13", MON, "2026-10-16"), [{ start: THU, end: FRI }, { start: "2026-10-12", end: "2026-10-13" }]);
}

console.log("\n2. …and holidays are skipped everywhere (#78, #80)");
{
  const c = R.workCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [TUE] });
  ok("a holiday is not a working day", c.isWorkDay(TUE), false);
  ok("add(Mon, 1) → Wed", c.add(MON, 1), WED);
  ok("span(Mon, Wed) = 2", c.span(MON, Wed()), 2);
  ok("countForward(Mon, 2) → Wed", c.countForward(MON, 2), WED);
  ok("segments(Mon, Wed) split at the holiday, so a bar can't paint over it", c.segments(MON, WED, MON, FRI), [{ start: MON, end: MON }, { start: WED, end: WED }]);
}
function Wed() { return WED; }

console.log("\n3. Bounded: an empty work week is Mon–Fri, and nothing loops forever (#82)");
{
  const c = R.workCalendar({ workDays: [] });
  ok("workDays [] reads as Mon–Fri", [c.isWorkDay(MON), c.isWorkDay("2026-10-10")], [true, false]);
  const every = []; for (let d = new Date("2026-01-01T12:00:00Z"), i = 0; i < 800; i++, d.setUTCDate(d.getUTCDate() + 1)) every.push(d.toISOString().slice(0, 10));
  const allHol = R.workCalendar({ holidays: every });
  const t0 = Date.now(); const r = allHol.add("2026-01-01", 1); const took = Date.now() - t0;
  ok("two years of holidays: add() returns, and fast", [typeof r, took < 2000], ["string", true]);
}

console.log("\n4. One set of defaults (#213, #214)");
{
  ok("the defaults are what a new org sees on first run", [D.DEFAULT_ORG_SETTINGS.workStart, D.DEFAULT_ORG_SETTINGS.workEnd, D.DEFAULT_ORG_SETTINGS.lunch, D.DEFAULT_ORG_SETTINGS.breaks],
     ["07:00", "15:00", { time: "12:00", durationMinutes: 30 }, [{ time: "10:00", durationMinutes: 15 }]]);
  const n = D.withOrgDefaults({ workStart: null, workEnd: "", lunch: null, workDays: [], holidays: null });
  ok("a stored null or empty value counts as missing", [n.workStart, n.workEnd, n.lunch, n.workDays, n.holidays], ["07:00", "15:00", { time: "12:00", durationMinutes: 30 }, [1, 2, 3, 4, 5], []]);
  ok("an org that chose no breaks keeps none", D.withOrgDefaults({ breaks: [] }).breaks, []);
  ok("set values win", D.withOrgDefaults({ workStart: "08:00" }).workStart, "08:00");
  const webCfg = S.buildDayWindows(7, 15, D.DEFAULT_ORG_SETTINGS.breaks, D.DEFAULT_ORG_SETTINGS.lunch);
  const server = O.overlapContext({}, null);
  ok("a new org: the web and the server agree on the productive day (7.25 h)", [Math.max(1, 8 - webCfg.deadH), server.productiveHoursPerDay], [7.25, 7.25]);
  ok("buildDayWindows' own lunch default is 30 min, not 60", S.buildDayWindows(7, 15, [], { time: "12:00" }).deadH, 0.5);
}

console.log("\n5. The import's range shift keeps working days (#86)");
{
  const c = R.workCalendar({ workDays: [1, 2, 3, 4, 5] });
  const r = S.shiftRangeForward("2025-09-01", "2025-09-05", "2026-09-30", c);
  ok("a 5-working-day range moved to Wed lands Wed → next Tue, still 5 working days", [r.start, r.end, c.span(r.start, r.end)], ["2026-09-30", "2026-10-06", 5]);
  ok("a range already past the floor is untouched", S.shiftRangeForward("2026-10-05", "2026-10-09", "2026-09-30", c), { start: "2026-10-05", end: "2026-10-09", shiftedDays: 0 });
}

console.log("\n6. The web's helpers use the org calendar (sliced from TRAQS.jsx and run)");
const SRC = readFileSync(process.env.CAL_SRC || new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
{
  const line = (name) => { const at = SRC.search(new RegExp(`\\nconst ${name} = `)); if (at < 0) return null; const e = SRC.indexOf("\n", at + 1); return SRC.slice(SRC.indexOf("=", at) + 1, e).trim().replace(/;$/, ""); };
  const block = (name) => { const at = SRC.search(new RegExp(`\\n(const|let|function) ${name}\\b`)); if (at < 0) return null; let i = SRC.indexOf("{", at), d = 0; for (; i < SRC.length; i++) { if (SRC[i] === "{") d++; else if (SRC[i] === "}" && --d === 0) break; } return SRC.slice(at + 1, i + 1); };
  const calSrc = block("setOrgCalendar");
  if (!calSrc || !line("addBD")) { ok("TRAQS.jsx has setOrgCalendar and delegating helpers", false, true); }
  else {
    const toDS = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const addD = (ds, n) => { const d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + n); return toDS(d); };
    const mod = new Function("workCalendar", "toDS", "addD", `
      let _orgCalSettings = {}; const _calCache = new Map();
      ${block("calOf") || ""}
      ${calSrc}
      const addBD = ${line("addBD")}; const nextBD = ${line("nextBD")}; const diffBD = ${line("diffBD")};
      const isWorkDay = ${line("isWorkDay")}; const weekdaySegments = ${line("weekdaySegments")};
      const getWorkingDayDuration = ${line("getWorkingDayDuration")};
      return { setOrgCalendar, addBD, nextBD, diffBD, isWorkDay, weekdaySegments, getWorkingDayDuration };`)(R.workCalendar, toDS, addD);
    mod.setOrgCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [TUE] });
    ok("addBD without options uses the org's holiday (#81)", mod.addBD(MON, 1), WED);
    ok("addBD with only workDays still skips the org's holiday", mod.addBD(MON, 1, { workDays: [1, 2, 3, 4, 5] }), WED);
    ok("isWorkDay(holiday) is false (#78)", mod.isWorkDay(TUE, [1, 2, 3, 4, 5]), false);
    ok("weekdaySegments splits at the holiday (#80)", mod.weekdaySegments(MON, WED, MON, FRI, [1, 2, 3, 4, 5]), [{ start: MON, end: MON }, { start: WED, end: WED }]);
    ok("getWorkingDayDuration(Mon, Wed) = 2", mod.getWorkingDayDuration(MON, WED, [1, 2, 3, 4, 5]), 2);
    // countForward direct, not through a TRAQS wrapper: the wrapper had no callers left and
    // went with root cause 9 chunk 2, so slicing it out of the file was testing dead code.
    ok("countForward(Mon, 2) = Tue — the 2nd working day counting inclusively", R.workCalendar({ workDays: [1, 2, 3, 4, 5] }).countForward(MON, 2), TUE);
    ok("...and it honours the org's holidays", R.workCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [TUE] }).countForward(MON, 2), WED);
    mod.setOrgCalendar({ workDays: [] });
    ok("an empty work week doesn't hang addBD (#82)", mod.addBD(MON, 1), TUE);
  }
  ok("panel/job moves shift children by working days (#85)", /addD\(op\.start, startDelta\)|addD\(s\.start, startDelta\)/.test(SRC), false);
  ok("grid shading asks isWorkDay, so holidays are shaded (#79)", /!orgSettings\.workDays\.includes\(new Date\([^)]*\)\.getDay\(\)\)/.test(SRC), false);
  ok("the live settings update repairs an empty work week like the load does", SRC.includes("setOrgSettings(prev => withOrgDefaults({ ...prev, ...s }))"), true);
  ok("the import's range shift is given the org calendar", SRC.includes("shiftRangeForward(start, end, _floor, orgCal)"), true);
}

console.log("\n7. The server refuses an empty work week (enforced, #82)");
{
  const K = "orgs/TESTORG/settings.json";
  const seed = () => { globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__S3 = { [K]: { workDays: [1, 2, 3, 4, 5], workStart: "08:00" } };
    globalThis.__AUTH = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" }; };
  const post = (b) => settingsFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(b) });
  seed(); { const r = await post({ workDays: [], workStart: "08:00" }); ok("workDays: [] → 400, nothing written", [r.statusCode, globalThis.__S3[K].workDays], [400, [1, 2, 3, 4, 5]]); }
  seed(); { const r = await post({ workDays: [8, "x"], workStart: "08:00" }); ok("no valid day in workDays → 400", r.statusCode, 400); }
  seed(); { const r = await post({ workDays: [1, 2, 3, 4, 5, 6], workStart: "08:00" }); ok("control: a real work week saves", [r.statusCode, globalThis.__S3[K].workDays.length], [200, 6]); }
  seed(); { const r = await post({ workStart: "09:00" }); ok("control: settings without workDays save", r.statusCode, 200); }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
