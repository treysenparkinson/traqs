// Server-enforced schedule rules — SCHEDULE_MAP root cause 3 (#1).
//
//   node scripts/schedule-rules-test.mjs
//
// Part 1 runs the pure rule module (src/scheduleRules.js), which the web and
// netlify/functions/tasks.js both import. Part 2 runs the REAL tasks.js on an
// in-memory S3 in each SCHEDULE_RULES_MODE: off | log (default) | enforce.
//
// Rules (only what a write CHANGES is checked, so data already breaking a rule
// never blocks an unrelated save):
//   (lock)      — REMOVED 2026-10-02. op.locked is retired: the only real lock
//                 is an active clock, which is the next rule. Section 3 below
//                 now pins the REMOVAL rather than testing the rule.
//   activeClock — no schedule, team or removal change to an op someone is
//                 clocked into, nor removal of its panel or job. Everyone.
//   department  — every team member of a unit with a requiredDepartment
//                 (op → panel → job) holds it as primary or secondary. Everyone.
//   businessDay — a leaf's changed start/end is a working day, not a holiday.
//                 Admins exempt.
//   past        — a leaf's start is not moved (or created) before today in the
//                 org's timezone. Admins exempt.
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

let rules, tasksFn;
try {
  rules = await import(new URL("../src/scheduleRules.js", import.meta.url).href);
  tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the modules under test:", e); process.exit(2); }
for (const f of ["isWorkingDay", "personDeptMatch", "unitDepartment", "scheduleRuleViolations"]) {
  if (typeof rules[f] !== "function") { console.error(`src/scheduleRules.js does not export ${f}`); process.exit(2); }
}

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// 2026-10-02 is a Friday, 10-03/04 the weekend, 10-05 Monday, 10-06 a holiday.
const TODAY = "2026-10-01";
const people = [
  { id: 1, name: "Admin", userRole: "admin", department: "Office" },
  { id: 7, name: "Wendy", department: "Wiring" },
  { id: 8, name: "Sam", department: "Assembly", secondaryDepartment: "Wiring" },
  { id: 9, name: "Olga", department: "Assembly" },
];
const tree = () => [{
  id: "JOB", title: "Job", start: "2026-10-01", end: "2026-10-09",
  subs: [{
    id: "PANEL", title: "Panel", requiredDepartment: "Wiring", start: "2026-10-01", end: "2026-10-09",
    subs: [
      { id: "OP", title: "Op", start: "2026-10-01", end: "2026-10-02", startHour: 7, endHour: 15, team: [7] },
      { id: "LOCKED", title: "Locked op", locked: true, start: "2026-10-05", end: "2026-10-07", team: [7] },
    ],
  }, {
    id: "PANEL2", title: "No department", start: "2026-10-08", end: "2026-10-09",
    subs: [
      { id: "FREE", title: "Unrestricted", start: "2026-10-08", end: "2026-10-09", team: [9] },
      { id: "BLANK", title: "Blank department", requiredDepartment: "", start: "2026-10-08", end: "2026-10-09", team: [9] },
    ],
  }],
}];
const node = (t, id) => { for (const j of t) { if (j.id === id) return j; for (const p of j.subs || []) { if (p.id === id) return p; for (const o of p.subs || []) if (o.id === id) return o; } } };
const ctx = (over = {}) => ({ people, workDays: [1, 2, 3, 4, 5], holidays: ["2026-10-06"], today: TODAY, isAdmin: false, ...over });
const check = (mut, over) => { const prev = tree(), next = tree(); mut(next, prev); return rules.scheduleRuleViolations(next, prev, ctx(over)).map(v => `${v.rule}:${v.id}`).sort(); };

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Helpers");
ok("Friday is a working day", rules.isWorkingDay("2026-10-02", { workDays: [1, 2, 3, 4, 5] }), true);
ok("Saturday is not", rules.isWorkingDay("2026-10-03", { workDays: [1, 2, 3, 4, 5] }), false);
ok("a holiday is not", rules.isWorkingDay("2026-10-06", { workDays: [1, 2, 3, 4, 5], holidays: ["2026-10-06"] }), false);
ok("default work days are Mon–Fri", [rules.isWorkingDay("2026-10-05"), rules.isWorkingDay("2026-10-04")], [true, false]);
ok("primary department matches", rules.personDeptMatch(people[1], "Wiring"), "primary");
ok("secondary department matches", rules.personDeptMatch(people[2], "Wiring"), "secondary");
ok("other department does not", rules.personDeptMatch(people[3], "Wiring"), false);
{ const t = tree(); const [j] = t, [p, p2] = j.subs;
  ok("department inherits op → panel → job", rules.unitDepartment(p.subs[0], p, j), "Wiring");
  ok("no department anywhere up the tree", rules.unitDepartment(p2.subs[0], p2, j), "");
  ok("an empty department is unset, as on the web (deptOfUnit)", rules.unitDepartment({ requiredDepartment: "" }, { requiredDepartment: "Wiring" }, j), "Wiring"); }

console.log("\n2. Unchanged data never violates, even when it already breaks a rule");
ok("identical trees", check(() => {}), []);
ok("an op already on a weekend, untouched, while another field changes",
   check((n, p) => { node(p, "OP").end = "2026-10-03"; node(n, "OP").end = "2026-10-03"; node(n, "OP").title = "Renamed"; }), []);
ok("an out-of-department member already on the team, untouched",
   check((n, p) => { node(p, "OP").team = [7, 9]; node(n, "OP").team = [7, 9]; node(n, "OP").title = "x"; }), []);

console.log("\n3. lock — REMOVED, and the removal is what is asserted");
// RULED 2026-10-02: the only real lock is an active clock. A clocked-out op
// moves freely, including one already worked on.
//
// op.locked never meant what its name promised. Its four writes were ALL in the
// split path, marking the already-worked remnant of a split; there was no UI to
// set it and none to clear it (#49 found the missing unlock — there was no lock
// either). So this rule refused writes against a flag no user could create or
// remove, on precisely the ops the ruling says should move freely.
//
// These assert the rule is GONE rather than being deleted, so a stray `locked`
// on older stored data cannot quietly start refusing writes again. activeClock
// below is the rule that still carries the protection.
ok("moving an op carrying a stray locked flag is allowed", check(n => { node(n, "LOCKED").start = "2026-10-07"; }), []);
ok("...so is changing its hours", check(n => { node(n, "LOCKED").startHour = 9; }), []);
ok("...and its team", check(n => { node(n, "LOCKED").team = [7, 8]; }), []);
ok("...and removing it", check(n => { node(n, "PANEL").subs = node(n, "PANEL").subs.filter(o => o.id !== "LOCKED"); }), []);
ok("...and tombstoning it", check(n => { node(n, "LOCKED").deletedAt = "2026-10-01T15:00:00Z"; }), []);
ok("renaming it is fine", check(n => { node(n, "LOCKED").title = "Renamed"; }), []);
ok("unlocking and moving in one write is fine", check(n => { const o = node(n, "LOCKED"); o.locked = false; o.start = "2026-10-07"; }), []);
ok("...for admins too, since there is no rule left to be exempt from", check(n => { node(n, "LOCKED").start = "2026-10-07"; }, { isAdmin: true }), []);

console.log("\n4. activeClock");
const clocked = people.map(p => p.id === 7 ? { ...p, activeJobClock: { clockIn: "2026-10-01T14:00:00Z", jobId: "JOB", panelId: "PANEL", opId: "OP" } } : p);
const onClock = (mut, over = {}) => check(mut, { people: clocked, ...over });
ok("moving the op someone is clocked into", onClock(n => { node(n, "OP").end = "2026-10-05"; }), ["activeClock:OP"]);
ok("changing its team", onClock(n => { node(n, "OP").team = [7, 8]; }), ["activeClock:OP"]);
ok("removing its panel (reported on the clocked op)", onClock(n => { n[0].subs = n[0].subs.filter(p => p.id !== "PANEL"); }), ["activeClock:OP"]);
ok("deleting its job — only activeClock now, the lock rule is gone", onClock(n => { n[0].deletedAt = "2026-10-01T15:00:00Z"; }), ["activeClock:OP"]);
ok("another op in the same panel is fine", onClock(n => { node(n, "FREE").end = "2026-10-12"; }), []);
ok("renaming the clocked op is fine", onClock(n => { node(n, "OP").title = "Renamed"; }), []);
ok("admins are not exempt", onClock(n => { node(n, "OP").end = "2026-10-05"; }, { isAdmin: true }), ["activeClock:OP"]);

console.log("\n5. department");
ok("adding someone outside the department", check(n => { node(n, "OP").team = [7, 9]; }), ["department:OP"]);
ok("adding someone with it as a secondary is fine", check(n => { node(n, "OP").team = [7, 8]; }), []);
ok("an op with no department anywhere takes anyone", check(n => { node(n, "FREE").team = [9, 1]; }), []);
ok("setting a department the team doesn't hold", check(n => { node(n, "FREE").requiredDepartment = "Wiring"; }), ["department:FREE"]);
ok("a new op assigned outside its inherited department", check(n => { node(n, "PANEL").subs.push({ id: "NEW", title: "New", start: "2026-10-08", end: "2026-10-08", team: [9] }); }), ["department:NEW"]);
ok("admins are not exempt", check(n => { node(n, "OP").team = [7, 9]; }, { isAdmin: true }), ["department:OP"]);

console.log("\n6. businessDay");
ok("moving an end onto a Saturday", check(n => { node(n, "OP").end = "2026-10-03"; }), ["businessDay:OP"]);
ok("moving a start onto a holiday", check(n => { const o = node(n, "FREE"); o.start = "2026-10-06"; }), ["businessDay:FREE"]);
ok("spanning a weekend is fine", check(n => { node(n, "OP").end = "2026-10-05"; }), []);
ok("admins are exempt", check(n => { node(n, "OP").end = "2026-10-03"; }, { isAdmin: true }), []);

console.log("\n7. past");
ok("moving a start before today", check(n => { node(n, "OP").start = "2026-09-30"; }), ["past:OP"]);
ok("creating an op that starts before today", check(n => { node(n, "PANEL").subs.push({ id: "OLD", title: "Old", start: "2026-09-29", end: "2026-10-01", team: [7] }); }), ["past:OLD"]);
ok("a start already in the past can stay", check((n, p) => { node(p, "OP").start = "2026-09-28"; node(n, "OP").start = "2026-09-28"; node(n, "OP").end = "2026-10-05"; }), []);
ok("admins are exempt", check(n => { node(n, "OP").start = "2026-09-30"; }, { isAdmin: true }), []);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. tasks.js, by SCHEDULE_RULES_MODE");
const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json" };
let logs = [];
const realWarn = console.warn;
console.warn = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("{")) { try { const o = JSON.parse(a[0]); if (o.tag) { logs.push(o); return; } } catch {} }
  realWarn(...a);
};
const seed = (mode, auth) => {
  if (mode === undefined) delete process.env.SCHEDULE_RULES_MODE; else process.env.SCHEDULE_RULES_MODE = mode;
  delete process.env.TASK_CONFLICT_MODE;
  logs = [];
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver", workDays: [1, 2, 3, 4, 5], holidays: ["2026-10-06"] },
    [K.people]: clone(people),
    [K.tasks]: tree(),
  };
  globalThis.__AUTH = { ...auth };
};
const ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const post = (t) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(t) });
const stored = () => globalThis.__S3[K.tasks];
// Was a LOCK violation; the lock rule is retired (ruling 3). department is the
// replacement because it is the only other rule admins are not exempt from,
// which is what these mode blocks depend on — person 9 does not hold the op's
// department. See section 5.
const deptViolation = () => { const t = tree(); node(t, "OP").team = [7, 9]; return t; };

seed("enforce", ADMIN);
{
  const res = await post(deptViolation());
  ok("enforce: a violating write is refused with 422", res.statusCode, 422);
  ok("enforce: the body names each violation", (res.body?.violations || []).map(v => `${v.rule}:${v.id}`), ["department:OP"]);
  ok("enforce: nothing was written", node(stored(), "OP").team, [7]);
  ok("enforce: the refusal is logged", logs.filter(l => l.tag === "schedule-rule").map(l => [l.mode, l.rule, l.id]), [["enforce", "department", "OP"]]);
}
seed("enforce", ADMIN);
{
  const t = tree(); node(t, "OP").end = "2026-10-03";                      // Saturday, but admin
  const res = await post(t);
  ok("enforce: an admin's weekend move is allowed", [res.statusCode, node(stored(), "OP").end], [200, "2026-10-03"]);
}
seed(undefined, ADMIN);
{
  const res = await post(deptViolation());
  ok("log (default): the write is accepted", [res.statusCode, node(stored(), "OP").team], [200, [7, 9]]);
  ok("log: the would-be refusal is logged", logs.filter(l => l.tag === "schedule-rule").map(l => [l.mode, l.rule, l.id, l.personId]), [["log", "department", "OP", "1"]]);
}
seed("off", ADMIN);
{
  const res = await post(deptViolation());
  ok("off: accepted, nothing logged", [res.statusCode, logs.filter(l => l.tag === "schedule-rule").length], [200, 0]);
}
seed("enforce", ADMIN);
{
  globalThis.__S3[K.people] = clone(clocked);
  const t = tree(); node(t, "OP").end = "2026-10-05";
  const res = await post(t);
  ok("enforce: active clock is read from people.json", [res.statusCode, (res.body?.violations || []).map(v => v.rule)], [422, ["activeClock"]]);
}
seed("enforce", ADMIN);
{
  const t = tree(); node(t, "OP").team = [7, 9];
  const res = await post(t);
  ok("enforce: department is enforced for admins", [res.statusCode, (res.body?.violations || []).map(v => v.rule)], [422, ["department"]]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
