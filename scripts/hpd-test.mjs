// One meaning of hpd — SCHEDULE_MAP root cause 5 (#210, #211, #212, #216).
//
//   node scripts/hpd-test.mjs
//
// Approved meaning: an op's `hpd` is the op's TOTAL estimated productive hours for
// the WHOLE team. A person's share is hpd ÷ team. The day length for scheduling is
// productiveHoursPerDay (the work window minus lunch and breaks). The org-level
// `hpd` setting was gross (workEnd − workStart), re-derived on every load and saved
// back, and is no longer read. An absent or 0 hpd is unestimated: nothing invents 7.5.
//
// Part 1 runs the pure helpers in src/statsMath.js. Part 2 executes or reads the web
// sites that used the other meanings (structural where the code is inline render).
import { readFileSync } from "node:fs";
let S;
try { S = await import(new URL("../src/statsMath.js", import.meta.url).href); }
catch (e) { console.error("could not load statsMath:", e); process.exit(2); }
const SRC = readFileSync(process.env.HPD_SRC || new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const need = ["buildDayWindows", "walkProductiveHours", "personShareHours", "capacityOf", "opDaySegments", "suspectHpdOps"];
const missing = need.filter(k => typeof S[k] !== "function");

console.log("\n1. Shared helpers in statsMath");
ok("statsMath exports the productive-time helpers and the hpd helpers", missing, []);
if (!missing.length) {
  // 08:00–17:00, lunch 12:00 for 60 min, no breaks → 8 productive hours.
  const cfg = S.buildDayWindows(8, 17, [], { time: "12:00", durationMinutes: 60 });
  const productiveHoursPerDay = 8;
  const isWorkDay = (ds) => { const d = new Date(ds + "T12:00:00Z").getUTCDay(); return d >= 1 && d <= 5 && ds !== "2026-10-07"; };
  const seg = (op) => S.opDaySegments(op, { cfg, productiveHoursPerDay, isWorkDay }).map(s => [s.day, s.startH, s.endH]);

  ok("a person's share is hpd ÷ team", S.personShareHours(16, 2, 8), 8);
  ok("unestimated → one productive day per person", S.personShareHours(0, 3, 8), 8);
  ok("capacity: cap when set", S.capacityOf({ cap: 6 }, 8), 6);
  ok("capacity: cap 0 or absent → productive hours", [S.capacityOf({ cap: 0 }, 8), S.capacityOf({}, 8)], [8, 8]);

  ok("single day, 4 h from 10:00 walks over lunch → 10–15", seg({ start: "2026-10-05", end: "2026-10-05", startHour: 10, hpd: 4, team: [7] }), [["2026-10-05", 10, 15]]);
  ok("same op, 2 people → 2 h each → 10–12", seg({ start: "2026-10-05", end: "2026-10-05", startHour: 10, hpd: 4, team: [7, 8] }), [["2026-10-05", 10, 12]]);
  ok("multi-day from 15:00, 12 h → Mon 15–17, Tue full, Thu 8–10 (Wed is a holiday)",
     seg({ start: "2026-10-05", end: "2026-10-08", startHour: 15, hpd: 12, team: [7] }), [["2026-10-05", 15, 17], ["2026-10-06", 8, 17], ["2026-10-08", 8, 10]]);
  ok("hours run out before the stored end → no block on later days",
     seg({ start: "2026-10-05", end: "2026-10-09", hpd: 16, team: [7] }), [["2026-10-05", 8, 17], ["2026-10-06", 8, 17]]);
  ok("Fri → Mon skips the weekend", seg({ start: "2026-10-02", end: "2026-10-05", hpd: 16, team: [7] }), [["2026-10-02", 8, 17], ["2026-10-05", 8, 17]]);
  ok("an op an admin put on Saturday occupies Saturday", seg({ start: "2026-10-03", end: "2026-10-03", startHour: 9, hpd: 3, team: [7] }), [["2026-10-03", 9, 12]]);
  ok("a single-day op with more hours than the day ends at quitting time", seg({ start: "2026-10-05", end: "2026-10-05", startHour: 8, hpd: 20, team: [7] }), [["2026-10-05", 8, 17]]);
  ok("unestimated single-day op → one productive day", seg({ start: "2026-10-05", end: "2026-10-05", team: [7] }), [["2026-10-05", 8, 17]]);

  const tasks = [{ id: "J1", jobNumber: "100", subs: [{ id: "P1", subs: [
    { id: "RES", start: "2026-10-05", end: "2026-10-06", hpd: 16, team: [7, 8] },        // resize wrote one person's hours
    { id: "OK2", start: "2026-10-05", end: "2026-10-06", hpd: 32, team: [7, 8] },        // a real team total
    { id: "OK1", start: "2026-10-05", end: "2026-10-06", hpd: 16, team: [7] },
  ] }] }, { id: "J2", jobNumber: "200", jobType: "general", subs: [{ id: "P2", subs: [
    { id: "IOS", start: "2026-10-05", end: "2026-10-09", hpd: 7.5, team: [7] },          // iOS simple job's flat per-day value
  ] }] }];
  ok("suspect ops: resize-style per-person totals and iOS per-day values, nothing else",
     S.suspectHpdOps(tasks, { productiveHoursPerDay, isWorkDay }).map(s => [s.id, s.reason]),
     [["RES", "perPersonTotal"], ["IOS", "perDayRate"]]);
}

console.log("\n2. The web uses one meaning");
const has = (label, s) => ok(label, SRC.includes(s), true);
const hasNot = (label, re) => ok(label, re.test(SRC), false);
has("TRAQS.jsx imports the productive-time helpers from statsMath", "buildDayWindows, walkProductiveHours, walkProductiveHoursBack");
hasNot("…and no longer defines them itself", /\nconst buildDayWindows = \(/);
hasNot("#212: org hpd is no longer re-derived from the work window", /hpd\s*=\s*[^;\n]*workEnd[^;\n]*-[^;\n]*workStart|merged\.hpd\s*=/);
hasNot("no scheduling code reads the org hpd", /orgSettings\.hpd\b/);
hasNot("no hpd fallback invents 7.5", /hpd[^;\n]{0,40}(\?\?|\|\|)\s*7\.5/);
hasNot("no cap fallback of a flat 8", /\.cap\s*\|\|\s*8\b/);
has("the team day view draws each op from opDaySegments", "opDaySegments(");
has("the gantt resize writes the team total (× team size), left edge", "_computeHpd(_finalDay, _finalHour, oe, oeH) * _resizeTeamSize");
has("the gantt resize writes the team total (× team size), right edge", "_computeHpd(os, osH, targetDay, clampedHour) * _resizeTeamSize");
has("day-view resizes write productive hours × team, not a clock span", "productiveClockHours(pending.startHour, origEnd, dayWindowCfg) * _dayTeamSize");
hasNot("labels no longer call hpd a per-day number", /"Hours per day"|Hrs\/Day|Hours \/ Day/);
has("the AI import asks for total hours", "total estimated hours for the operation across its whole team");
has("admins get a list of estimates to check", "Estimates to check");

// finishedOpFields must never overwrite hpd with a clock span (#210). Executed.
{
  const at = SRC.indexOf("const finishedOpFields = (op, movedByName) => {");
  if (at < 0) { console.error("finishedOpFields not found"); process.exit(2); }
  let i = SRC.indexOf("{", SRC.indexOf("=>", at)), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === "{") depth++; else if (SRC[i] === "}" && --depth === 0) break; }
  const src = SRC.slice(SRC.indexOf("(op, movedByName)", at), i + 1);
  const scope = new Proxy({ timeclock: [], sameId: (a, b) => String(a) === String(b), toDS: (d) => d.toISOString().slice(0, 10),
    workStartH: 8, workEndH: 17, SHRINK_MIN_REMAINDER_H: 5 / 60 }, {
    has: (_, k) => typeof k === "string" && !(k in globalThis),
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : (() => ({ startDate: "2026-09-30", startHour: 9, endHour: 15, date: "2026-09-30" })))),
  });
  const f = new Function("scope", `with (scope) { return (${src}); }`)(scope);
  const out = f({ id: "O", hpd: 20, team: [7, 8], start: "2026-10-01", end: "2026-10-02", moveLog: [{ sessionId: "S" }],
    pendingSession: { sessionId: "S", sessionSnapshot: [{ opId: "O", startHour: 8, endHour: 12 }] } }, "A");   // snapshot has a clock span, no hpd
  ok("finishing an op keeps its estimate (never the 4 h clock span)", out.hpd ?? 20, 20);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
