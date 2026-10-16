// #125 — TIER_RULES_MODE: the tier line, checked on the server.
//
//   node scripts/tier-rules-test.mjs
//
// Ruled 2026-10-16: built in LOG mode — record what a Basic org does with the Business job
// layer, refuse nothing until the records have been read. The enforce path exists (same
// rollout shape as the other flags) and is tested here, because a switch nobody has run in
// its "on" position is a switch that fails the day it is flipped.
//
// Every rollout variable is SET here, never inherited (#529): the build runs with whatever
// Netlify's environment holds, and a suite that read it would assert production's modes.
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

for (const v of ["SCHEDULE_RULES_MODE", "TASK_CONFLICT_MODE", "OVERLAP_RULE_MODE", "IDENTITY_PROVIDER_MODE", "TZ_FALLBACK_MODE", "TIER_RULES_MODE"]) {
  process.env[v] = "off";
}

let R, tasksFn, timeclockFn;
try {
  R = await import(new URL("../netlify/functions/_utils/tier-rules.js", import.meta.url).href);
  tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
  timeclockFn = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the code under test:", e); process.exit(2); }
for (const f of ["jobLayerReason", "jobLayerViolations", "orgTier"]) if (typeof R[f] !== "function") { console.error(`${f} missing`); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// Basic's client writes a shift as a general job with one level of subs.
const SHIFT = (id, extra = {}) => ({ id, title: "Shift", jobType: "general", subs: [{ id: `${id}s`, title: "Shift", team: ["7"], start: "2099-10-05", end: "2099-10-05" }], ...extra });
const PANEL_JOB = (id, extra = {}) => ({ id, title: "Job", subs: [{ id: `${id}p`, title: "Panel", subs: [{ id: `${id}o`, title: "Op", team: ["7"] }] }], ...extra });

// ── 1. THE SHAPE ────────────────────────────────────────────────────────────
console.log("\n1. What counts as the job layer");
ok("a Basic shift is not", R.jobLayerReason(SHIFT("a")), null);
ok("an explicit panel job is", R.jobLayerReason({ id: "b", jobType: "panel", subs: [] }), "panel-job");
ok("job → panel → op nesting is, whatever the jobType says", R.jobLayerReason(PANEL_JOB("c", { jobType: "general" })), "nested-ops");
ok("a new panel job is reported as new", R.jobLayerViolations([PANEL_JOB("c")], []), [{ jobId: "c", reason: "nested-ops", isNew: true }]);
ok("an UNCHANGED panel job is not reported (old data, saved alongside something else)",
  R.jobLayerViolations([{ ...PANEL_JOB("c"), lastModifiedAt: "x" }], [{ ...PANEL_JOB("c"), lastModifiedAt: "y" }]), []);
ok("...a changed one is", R.jobLayerViolations([PANEL_JOB("c", { title: "Renamed" })], [PANEL_JOB("c")]).map(v => [v.jobId, v.isNew]), [["c", false]]);
ok("a tombstone is never reported (deleting is not using)", R.jobLayerViolations([PANEL_JOB("c", { deletedAt: "t" })], []), []);
ok("shifts are never reported", R.jobLayerViolations([SHIFT("a"), SHIFT("b", { title: "x" })], [SHIFT("b")]), []);

// ── 2. tasks.js ─────────────────────────────────────────────────────────────
console.log("\n2. POST /tasks (real handler)");
const K = { tasks: "orgs/TESTORG/tasks.json", people: "orgs/TESTORG/people.json", settings: "orgs/TESTORG/settings.json",
  billing: "orgs/TESTORG/billing.json", events: "orgs/TESTORG/rule-events.json" };
const seed = (mode, tier, tasks = [SHIFT("a")]) => {
  process.env.TIER_RULES_MODE = mode;
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [K.tasks]: JSON.parse(JSON.stringify(tasks)), [K.people]: [{ id: 1, userRole: "admin" }, { id: 7 }], [K.settings]: {},
    ...(tier ? { [K.billing]: { tier } } : {}) };
  globalThis.__AUTH = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
};
const tierEvents = () => (globalThis.__S3[K.events]?.records || []).filter(r => r.tag === "tier-rule")
  .map(r => [r.rule, r.mode, r.refused, r.jobId ?? r.action, r.reason ?? null]);
const post = (t) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(t) });
const stored = () => globalThis.__S3[K.tasks].map(j => j.id);
const withPanel = () => [SHIFT("a"), PANEL_JOB("p")];

seed("log", null);
{ const r = await post(withPanel());
  ok("log, Basic: a new panel job is SAVED", [r.statusCode, stored()], [200, ["a", "p"]]);
  ok("...and recorded as a tier-rule it would have refused", tierEvents(), [["job-layer", "log", false, "p", "nested-ops"]]); }
seed("log", "basic");
{ await post(withPanel()); ok("log, an explicit basic billing record reads the same", tierEvents().length, 1); }
seed("log", "business");
{ const r = await post(withPanel()); ok("log, Business: saved, nothing recorded", [r.statusCode, tierEvents()], [200, []]); }
seed("log", null);
{ const r = await post([SHIFT("a", { title: "Moved" }), SHIFT("b")]);
  ok("log, Basic: shift edits record nothing", [r.statusCode, tierEvents()], [200, []]); }
seed("log", null, withPanel());
{ const r = await post([SHIFT("a", { title: "Moved" }), PANEL_JOB("p")]);
  ok("log, Basic: old panel data saved UNCHANGED beside a shift edit records nothing", [r.statusCode, tierEvents()], [200, []]); }
seed("off", null);
{ const r = await post(withPanel()); ok("off: saved, nothing recorded", [r.statusCode, tierEvents()], [200, []]); }
seed("enforce", null);
{ const r = await post(withPanel());
  ok("enforce, Basic: refused 403, the stored tree untouched", [r.statusCode, r.body?.tierRule, stored()], [403, "job-layer", ["a"]]);
  ok("...and the refusal is recorded as refused", tierEvents(), [["job-layer", "enforce", true, "p", "nested-ops"]]); }
seed("enforce", "business");
{ const r = await post(withPanel()); ok("enforce, Business: saved", [r.statusCode, stored()], [200, ["a", "p"]]); }
seed("enforce", null);
{ const r = await post([SHIFT("a", { title: "Moved" })]); ok("enforce, Basic: a shift edit still saves", r.statusCode, 200); }
seed("log", null);
{ const r = await tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify({ upsert: [PANEL_JOB("p")], delete: [] }) });
  ok("log, Basic: the DELTA body is checked too", [r.statusCode, tierEvents().map(e => e[3])], [200, ["p"]]); }

// ── 3. timeclock.js — the job clock ─────────────────────────────────────────
console.log("\n3. The job clock (real timeclock.js)");
const tc = (action, extra = {}) => timeclockFn({ httpMethod: "POST", headers: {}, queryStringParameters: {},
  body: JSON.stringify({ action, personId: "7", jobId: "p", panelId: "pp", opId: "po", sessionId: "s1", ...extra }) });
const seedClock = (mode, tier) => {
  seed(mode, tier, withPanel());
  globalThis.__S3[K.people] = [{ id: 1, userRole: "admin" }, { id: 7, name: "W" }];
  globalThis.__AUTH = { personId: "7", isAdmin: false, adminPerms: undefined, email: "7@x" };
};
const TIER_MSG = "The job clock is part of the Business plan.";
const msg = (r) => r.body?.error ?? r.body?.message ?? r.body;
seedClock("enforce", null);
{ const r = await tc("jobClockIn"); ok("enforce, Basic: jobClockIn refused 403 by the tier rule", [r.statusCode, msg(r)], [403, TIER_MSG]);
  ok("...recorded as refused", tierEvents(), [["job-clock", "enforce", true, "jobClockIn", null]]); }
for (const a of ["jobClockOut", "updateJobSession", "releaseJobSession"]) {
  seedClock("enforce", null);
  const r = await tc(a);
  ok(`enforce, Basic: ${a} is NOT refused by the tier (it would strand a running clock)`, msg(r) === TIER_MSG, false);
  ok(`...but it is recorded`, tierEvents(), [["job-clock", "enforce", false, a, null]]);
}
seedClock("log", null);
{ const r = await tc("jobClockIn"); ok("log, Basic: jobClockIn goes on to its own checks", msg(r) === TIER_MSG, false);
  ok("...recorded, not refused", tierEvents(), [["job-clock", "log", false, "jobClockIn", null]]); }
seedClock("enforce", "business");
{ const r = await tc("jobClockIn"); ok("enforce, Business: no tier refusal, nothing recorded", [msg(r) === TIER_MSG, tierEvents()], [false, []]); }
seedClock("enforce", null);
{ await timeclockFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify({ action: "payClockIn", personId: "7" }) });
  ok("the PAY clock is Basic's and is never checked", tierEvents(), []); }
seedClock("enforce", null);
globalThis.__AUTH_FAIL = { status: 401, message: "expired" };
{ const r = await tc("jobClockIn"); ok("an unauthenticated request is a 401 and writes no rule event", [r.statusCode, tierEvents()], [401, []]); }
globalThis.__AUTH_FAIL = null;

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
