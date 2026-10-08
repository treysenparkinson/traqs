// Task permissions classified by ACTION, not by field — root cause 4.
//
//   node scripts/task-actions-test.mjs
//
// The old classifier asked "which fields changed?" and sent every field without a
// carve-out to editJobs. But an action writes side effects: a move appends to
// moveLog, an approval writes status, pendingFinish, finishedAt, placement…, so a
// moveJobs-only admin was refused every resize (#42/#43) and an approver without
// editJobs could approve nothing (#169/#170). src/taskActions.js classifies by what
// the write is doing:
//   - logs (moveLog, apprLog) are append-only and ride on the change they record;
//     a moveLog append on a node where nothing else changed needs editJobs;
//   - resolving a finish request is one action: every resolution field on the
//     resolved node, its descendants and its ancestors' bounds → approveCompletions;
//   - marking something Finished is an approval (Complete Now) → approveCompletions;
//   - signing a chain step → canApprove or that step's assignee; changing the
//     chain → editJobs;
//   - attachments are append-only for anyone (a worker's end-of-job photo);
//   - an absent key equals an empty [] / "" / {}.
//
// Part 1: the pure classifier. Part 2: tasks.js in PERMISSION_GATES_MODE enforce
// and log. Part 3: the web's finishedOpFields writes only fields the shared list
// covers (its real source is executed).
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let A, tasksFn;
try {
  A = await import(new URL("../src/taskActions.js", import.meta.url).href);
  tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the modules under test:", e); process.exit(2); }
for (const f of ["classifyTaskActions", "FINISH_RESOLUTION_FIELDS", "LOG_FIELDS"]) {
  if (!(f in A)) { console.error(`src/taskActions.js does not export ${f}`); process.exit(2); }
}

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const LOG0 = { fromStart: "2026-10-01", toStart: "2026-10-02", date: "2026-09-30", movedBy: "A" };
const REQ = { id: "R1", by: 7, byName: "W", at: "2026-09-30T12:00:00Z", status: "pending" };
const tree = () => [{
  id: "JOB", title: "Job", status: "In Progress", start: "2026-10-01", end: "2026-10-09",
  subs: [{
    id: "PANEL", title: "Panel", start: "2026-10-01", end: "2026-10-09",
    attachments: [{ key: "a1", by: 1 }],
    apprChain: [{ label: "QA", assigneeId: 7, done: false }, { label: "Ship", done: false }],
    subs: [
      { id: "OP", title: "Op", status: "In Progress", start: "2026-10-01", end: "2026-10-02", startHour: 7, endHour: 15, hpd: 8, team: [7], moveLog: [LOG0] },
      { id: "OP2", title: "Op 2", status: "Not Started", start: "2026-10-05", end: "2026-10-09", team: [8] },
      { id: "HELD", title: "Held", status: "In Progress", start: "2026-10-01", end: "2026-10-03", team: [7],
        pendingFinish: true, pendingSession: { sessionId: "S1", frozenAtMs: 1 }, finishRequest: { requestId: "R1", by: 7 }, finishRequests: [REQ] },
    ],
  }],
}];
const node = (t, id) => { for (const j of t) { if (j.id === id) return j; for (const p of j.subs || []) { if (p.id === id) return p; for (const o of p.subs || []) if (o.id === id) return o; } } };
const run = (mut, callerId = "1") => {
  const prev = tree(), next = tree(); mut(next, prev);
  const c = A.classifyTaskActions(next, prev, { callerId });
  return { perms: [...c.perms].sort(), needsApprove: c.needsApprove, needsEngineer: c.needsEngineer, changed: c.changed,
           chainSignsFor: (c.chainSigns || []).map(s => s.assigneeId ?? null) };
};
const P = (...perms) => perms.sort();
const approveHeld = (n) => {
  const o = node(n, "HELD");
  Object.assign(o, { status: "Finished", pendingFinish: false, finishedAt: "2026-10-01T15:00:00Z", actualHours: 6,
    start: "2026-09-30", end: "2026-10-01", startHour: 9, endHour: 15, hpd: 6, plannedStart: "2026-10-01", plannedEnd: "2026-10-03" });
  delete o.pendingSession;
  o.finishRequests = [{ ...REQ, status: "approved" }];
  o.moveLog = [{ toStart: "2026-09-30", reason: "approved" }];
  node(n, "PANEL").start = "2026-09-30"; node(n, "JOB").start = "2026-09-30";   // recalcBounds
};

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Moves (#42, #43)");
ok("resize: schedule fields + a moveLog append → moveJobs only",
   run(n => { const o = node(n, "OP"); o.end = "2026-10-03"; o.hpd = 12; o.moveLog = [LOG0, { toEnd: "2026-10-03" }]; }).perms, P("moveJobs"));
ok("push: another op's dates + its moveLog → moveJobs only",
   run(n => { const o = node(n, "OP2"); o.start = "2026-10-06"; o.end = "2026-10-12"; o.moveLog = [{ toStart: "2026-10-06" }]; }).perms, P("moveJobs"));
ok("rewriting an existing moveLog entry → editJobs",
   run(n => { node(n, "OP").moveLog = [{ ...LOG0, movedBy: "Someone else" }]; }).perms, P("editJobs"));
ok("dropping moveLog history → editJobs", run(n => { node(n, "OP").moveLog = []; }).perms, P("editJobs"));
ok("a moveLog append with no move (a forged entry) → editJobs",
   run(n => { node(n, "OP").moveLog = [LOG0, { toStart: "2027-01-01" }]; }).perms, P("editJobs"));
ok("an apprLog append on its own still needs nothing", run(n => { node(n, "PANEL").apprLog = [{ action: "signed" }]; }).perms, []);

console.log("\n2. Resolving a finish request (#169, #170)");
ok("chat approve: status, pendingFinish/Session, finishedAt, placement, moveLog, bounds → approveCompletions only",
   run(approveHeld).perms, P("approveCompletions"));
ok("Hours → Admin approve (pendingFinish true→false, no request touched) → approveCompletions",
   run(n => { const o = node(n, "HELD"); o.status = "Finished"; o.pendingFinish = false; delete o.pendingSession; o.finishedAt = "2026-10-01T15:00:00Z"; }).perms,
   P("approveCompletions"));
ok("decline: request resolved, pendingFinish cleared, placement reverted, moveLog → approveCompletions",
   run(n => { const o = node(n, "HELD"); o.finishRequests = [{ ...REQ, status: "declined" }]; o.pendingFinish = false; delete o.pendingSession;
              o.start = "2026-10-02"; o.moveLog = [{ reason: "declined" }]; }).perms, P("approveCompletions"));
ok("job-level approve cascades status to descendants → approveCompletions",
   run(n => { const j = node(n, "JOB"); j.finishRequests = [{ ...REQ, status: "approved" }]; j.status = "Finished";
              for (const p of j.subs) { p.status = "Finished"; for (const o of p.subs) o.status = "Finished"; } },
       "1").perms, P("approveCompletions"));
ok("approving HELD while retitling OP2 needs both", run(n => { approveHeld(n); node(n, "OP2").title = "Renamed"; }).perms, P("approveCompletions", "editJobs"));

console.log("\n3. Finished without a request (Complete Now) and other status changes");
ok("Complete Now: status → Finished → approveCompletions, not editJobs", run(n => { node(n, "OP").status = "Finished"; }).perms, P("approveCompletions"));
ok("status → On Hold → editJobs", run(n => { node(n, "OP").status = "On Hold"; }).perms, P("editJobs"));

console.log("\n4. Raising a request");
ok("new pending request by the caller + pendingFinish true → nothing",
   run(n => { const o = node(n, "OP"); o.pendingFinish = true; o.finishRequests = [{ ...REQ, id: "R9" }]; o.finishRequest = { requestId: "R9", by: 7 }; }, "7").perms, []);
ok("pendingFinish true with no raise → editJobs", run(n => { node(n, "OP").pendingFinish = true; }).perms, P("editJobs"));

console.log("\n5. Approval chains");
{
  const signQA = (n) => { node(n, "PANEL").apprChain[0] = { label: "QA", assigneeId: 7, done: true, by: 7, byName: "W", at: "2026-10-01T10:00:00Z" }; };
  const r = run(signQA, "7");
  ok("signing a step → no editJobs; checked against the step's assignee", [r.perms, r.chainSignsFor], [[], [7]]);
  const r2 = run(n => { node(n, "PANEL").apprChain[1] = { label: "Ship", done: true, by: 1, at: "x" }; });
  ok("signing an unassigned step → recorded with no assignee", [r2.perms, r2.chainSignsFor], [[], [null]]);
  ok("reverting a signed step → needs canApprove, even for its assignee",
     run((n, p) => { node(p, "PANEL").apprChain[0] = { label: "QA", assigneeId: 7, done: true, by: 7, byName: "W", at: "x" };
                     node(n, "PANEL").apprChain[0] = { label: "QA", assigneeId: 7, done: false, by: null, byName: "", at: null }; }, "7").needsApprove, true);
  ok("adding a step → editJobs", run(n => { node(n, "PANEL").apprChain.push({ label: "Paint", done: false }); }).perms, P("editJobs"));
  ok("renaming a step → editJobs", run(n => { node(n, "PANEL").apprChain[1].label = "Deliver"; }).perms, P("editJobs"));
}

console.log("\n6. Attachments are append-only");
ok("appending a photo → nothing", run(n => { node(n, "PANEL").attachments.push({ key: "a2", by: 7 }); }, "7").perms, []);
ok("removing a photo → editJobs", run(n => { node(n, "PANEL").attachments = []; }, "7").perms, P("editJobs"));
ok("replacing a photo → editJobs", run(n => { node(n, "PANEL").attachments = [{ key: "x", by: 7 }]; }, "7").perms, P("editJobs"));

console.log("\n7. Absent equals empty");
ok("absent attachments/deps/notes vs [] / \"\" is no change",
   run((n, p) => { const pp = node(p, "OP2"); delete pp.team; const nn = node(n, "OP2"); nn.team = []; nn.deps = []; nn.notes = ""; nn.attachments = []; }).changed, false);
ok("a real value is still a change", run(n => { node(n, "OP2").notes = "call first"; }).perms, P("editJobs"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. tasks.js, by PERMISSION_GATES_MODE");
const K = { tasks: "orgs/TESTORG/tasks.json", people: "orgs/TESTORG/people.json", settings: "orgs/TESTORG/settings.json" };
let logs = [];
const realWarn = console.warn;
console.warn = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("{")) { try { const o = JSON.parse(a[0]); if (o.tag) { logs.push(o); return; } } catch {} }
  realWarn(...a);
};
const seed = (mode, auth) => {
  if (mode === undefined) delete process.env.PERMISSION_GATES_MODE; else process.env.PERMISSION_GATES_MODE = mode;
  process.env.SCHEDULE_RULES_MODE = "off"; process.env.TASK_CONFLICT_MODE = "off";
  logs = [];
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [K.tasks]: tree(), [K.people]: [{ id: 1, userRole: "admin" }, { id: 7 }, { id: 8 }], [K.settings]: {} };
  globalThis.__AUTH = { ...auth };
};
const post = (t) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(t) });
const MOVER = { personId: "2", isAdmin: true, adminPerms: { moveJobs: true }, email: "m@x" };                              // moveJobs only
const APPROVER = { personId: "3", isAdmin: true, adminPerms: { approveCompletions: true }, email: "p@x" };                // approve only
const EDITOR_NO_APPROVE = { personId: "4", isAdmin: true, adminPerms: { editJobs: true, approveCompletions: false }, email: "e@x" };
const resized = () => { const t = tree(); const o = node(t, "OP"); o.end = "2026-10-03"; o.moveLog = [LOG0, { toEnd: "2026-10-03" }]; return t; };
const approved = () => { const t = tree(); approveHeld(t); return t; };
const completed = () => { const t = tree(); node(t, "OP").status = "Finished"; return t; };

seed("enforce", MOVER);
ok("enforce: a moveJobs-only admin's resize is accepted (#42)", (await post(resized())).statusCode, 200);
seed("enforce", APPROVER);
ok("enforce: an approver without editJobs can approve (#170)", [(await post(approved())).statusCode, node(globalThis.__S3[K.tasks], "HELD").status], [200, "Finished"]);
seed("enforce", EDITOR_NO_APPROVE);
ok("enforce: Complete Now without approveCompletions is refused", [(await post(completed())).statusCode, node(globalThis.__S3[K.tasks], "OP").status], [403, "In Progress"]);
seed("enforce", { personId: "7", isAdmin: false, email: "w@x" });
{
  const t = tree(); node(t, "PANEL").apprChain[0] = { label: "QA", assigneeId: 7, done: true, by: 7, at: "x" };
  ok("enforce: the assignee signs their own chain step", (await post(t)).statusCode, 200);
}
seed("enforce", { personId: "8", isAdmin: false, email: "s@x" });
{
  const t = tree(); node(t, "PANEL").apprChain[0] = { label: "QA", assigneeId: 7, done: true, by: 8, at: "x" };
  ok("enforce: someone else can't sign it", (await post(t)).statusCode, 403);
}
seed("enforce", { personId: "7", isAdmin: false, email: "w@x" });
{
  const t = tree(); node(t, "PANEL").attachments.push({ key: "a2", by: 7 });
  ok("enforce: a worker's panel photo is accepted", (await post(t)).statusCode, 200);
}

// RE-RULED 2026-10-08: THE LEGACY CLASSIFIER IS GONE, SO THE FLAG NO LONGER
// CHANGES ANYTHING HERE. These three asserted that an UNSET flag fell back to
// `task-perms.js` — that it refused the moveJobs-only resize (#42), allowed a
// Complete Now it should not have, and logged the disagreement. After the
// retirement `src/taskActions.js` decides unconditionally, so the behaviour that
// used to need `enforce` is now the only behaviour. That is the point of the
// retirement rather than a regression, and the same three cases are kept, with
// the opposite expectation, so the change is visible instead of deleted.
seed(undefined, MOVER);
{
  const res = await post(resized());
  ok("flag unset: the moveJobs-only resize is ACCEPTED (#42 is closed for good)", res.statusCode, 200);
  ok("flag unset: nothing is logged, because there is no second opinion",
     logs.filter(l => l.tag === "permission-gate").length, 0);
}
seed(undefined, EDITOR_NO_APPROVE);
{
  const res = await post(completed());
  ok("flag unset: Complete Now without approveCompletions is REFUSED",
     [res.statusCode, node(globalThis.__S3[K.tasks], "OP").status], [403, "In Progress"]);
}
seed("log", MOVER);
ok("the flag is inert on /tasks: 'log' decides the same as unset", (await post(resized())).statusCode, 200);
seed("off", MOVER);
ok("...and so does 'off'", (await post(resized())).statusCode, 200);

// ──────────────────────────────────────────────────────
console.log("\n8b. task-perms.js is retired");
{
  // CODE, NOT COMMENTS. The retirement is explained in prose inside this file,
  // and a bare /task-perms/ over the raw source matches that explanation and
  // fails forever. `codeOf` strips comments and strings, so these assert what
  // the file DOES rather than what it says about itself.
  const raw = readFileSync(new URL("../netlify/functions/tasks.js", import.meta.url), "utf8");
  const fn = codeOf(raw);
  ok("tasks.js does not import task-perms", /task-perms/.test(fn), false);
  ok("...has no legacy classifier", /legacyCls|legacyErr|classifyTaskChanges/.test(fn), false);
  ok("...has no gateDiff block", /gateDiff/.test(fn), false);
  ok("...no longer reads PERMISSION_GATES_MODE", /PERMISSION_GATES_MODE/.test(fn), false);
  ok("...and taskActions decides unconditionally", /const decision = actionErr;/.test(fn), true);
  // ...and the prose explaining why is still there, so the next reader finds it.
  ok("the retirement is explained in the file", /task-perms\.js` is deleted/.test(raw), true);
  let gone = false;
  try { readFileSync(new URL("../netlify/functions/_utils/task-perms.js", import.meta.url)); }
  catch { gone = true; }
  ok("the file itself is deleted", gone, true);

  // THE FLAG IS NOT FREE TO DELETE, and this assertion is the reason written
  // down rather than left to a commit message. `clients.js` reads the SAME
  // variable for something else: whether a no-op client-list save from someone
  // without `manageClients` is let through. `ruleMode` defaults to "log" when a
  // variable is absent, and in "log" that branch calls `requirePerm` every time
  // — so deleting PERMISSION_GATES_MODE from Netlify would start 403ing every
  // worker's client autosave, which `enforce` currently allows.
  const cl = readFileSync(new URL("../netlify/functions/clients.js", import.meta.url), "utf8");
  ok("clients.js STILL reads the flag, so the variable must stay", /ruleMode\("PERMISSION_GATES_MODE"\)/.test(cl), true);
  ok("...and its no-op allowance is conditional on enforce", /gateMode !== "enforce"/.test(cl), true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n9. The web's finishedOpFields stays inside the shared list");
{
  const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  const at = SRC.indexOf("const finishedOpFields = (op, movedByName) => {");
  if (at < 0) { console.error("finishedOpFields not found in TRAQS.jsx"); process.exit(2); }
  let i = SRC.indexOf("{", SRC.indexOf("=>", at)), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === "{") depth++; else if (SRC[i] === "}" && --depth === 0) break; }
  const src = SRC.slice(SRC.indexOf("(op, movedByName)", at), i + 1);
  const scope = new Proxy({
    timeclock: [], sameId: (a, b) => String(a) === String(b),
    toDS: (d) => d.toISOString().slice(0, 10), workStartH: 7, workEndH: 15, SHRINK_MIN_REMAINDER_H: 5 / 60,
    walkProductiveHours: () => ({ startDate: "2026-09-30", startHour: 9 }), productiveHoursBetween: () => 6,
    addBD: (d) => d, TD: "2026-10-01",
  }, {
    has: (_, k) => typeof k === "string" && !(k in globalThis),
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : ((...a) => ({ startDate: "2026-09-30", startHour: 9, endHour: 15, date: "2026-09-30" })))),
  });
  const finishedOpFields = new Function("scope", `with (scope) { return (${src}); }`)(scope);
  const withSession = finishedOpFields({ id: "HELD", hpd: 6, startHour: 7, endHour: 15, start: "2026-10-01", end: "2026-10-03",
    moveLog: [{ sessionId: "S1" }], pendingSession: { sessionId: "S1", sessionSnapshot: [{ opId: "HELD", start: "2026-10-01", end: "2026-10-03", startHour: 7, endHour: 15, hpd: 6 }] } }, "A");
  const without = finishedOpFields({ id: "OP", start: "2026-10-01", end: "2026-10-02" }, "A");
  const keys = [...new Set([...Object.keys(withSession), ...Object.keys(without)])].sort();
  const outside = keys.filter(k => !A.FINISH_RESOLUTION_FIELDS.includes(k));
  if (process.env.SHOW_KEYS) console.log("   finishedOpFields keys:", keys.join(", "));
  ok(`every field it writes is a resolution field (${keys.length} fields)`, outside, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
