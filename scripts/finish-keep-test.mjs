#!/usr/bin/env node
// #463. A STALE TREE CANNOT ERASE OR REOPEN A FINISH REQUEST — WITHOUT A FLAG.
//
// people.js pins its server-owned fields AND carries an absence rule (`timeOff` absent is
// not cleared). tasks.js pinned one field, `loggedHours`, and nothing protected the finish
// request the iOS path writes onto an op (`finishRequests`, mirrored by `pendingFinish`).
// A whole-tree POST from a client that loaded before the request was raised carried no
// entry, and only the per-job stale check stood in the way — which is `enforce` in
// production by an env value nobody can read from the repo, and defaults to `log`.
//
// The fields cannot simply be pinned: the web and iOS RESOLVE requests by writing the list
// through this POST. So the rule is the absence rule, by entry id:
//   - a stored entry missing from the incoming copy is kept (absence is not deletion);
//   - a resolved entry is never turned back into `pending`;
//   - everything else — a resolution, a new entry — passes through.
// Run in TASK_CONFLICT_MODE=log on purpose: this must hold with the flag off.
//
//   node scripts/finish-keep-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
// #125: pinned, never inherited (#529) — the tier rule is tier-rules-test's, and here it would
// add rule events this suite does not expect, or refuse its Basic test org in enforce.
process.env.TIER_RULES_MODE = "off";

let tasksFn;
try { tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load tasks.js:", e); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json" };
const OLD = "2026-09-30T10:00:00.000Z";
const entry = (id, status, extra = {}) => ({ id, by: "7", byName: "Wendy", at: "2099-10-05T15:00:00.000Z", status, ...extra });
const tree = (opExtra) => [{ id: "JOB", title: "Job", lastModifiedAt: OLD, subs: [{ id: "PANEL", title: "Panel",
  subs: [{ id: "OP", title: "Op", status: "In Progress", team: [7], ...opExtra }] }] }];
const reset = (stored) => {
  process.env.TASK_CONFLICT_MODE = "log";
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__PRECONDITION_FAILURES = []; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver" },
    [K.people]: [{ id: 1, name: "Admin", userRole: "admin" }, { id: 7, name: "Wendy", userRole: "user" }],
    [K.tasks]: stored,
  };
  globalThis.__AUTH = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
};
const post = (t) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(t) });
const op = () => globalThis.__S3[K.tasks][0].subs[0].subs[0];
const view = () => [op().pendingFinish ?? null, (op().finishRequests || []).map(r => `${r.id}:${r.status}`)];

console.log("\n1. A STALE COPY WITHOUT THE REQUEST DOES NOT ERASE IT");
reset(tree({ pendingFinish: true, finishRequests: [entry("R1", "pending")] }));
{
  // The admin loaded before Wendy raised R1, renamed the job, and saved.
  const stale = tree({});
  stale[0].title = "Job (renamed)";
  const r = await post(stale);
  ok("the save goes through", r.statusCode, 200);
  ok("...the rename lands", globalThis.__S3[K.tasks][0].title, "Job (renamed)");
  ok("...and R1 is still open on the op", view(), [true, ["R1:pending"]]);
}

console.log("\n2. A STALE COPY CANNOT REOPEN A DECIDED REQUEST");
reset(tree({ pendingFinish: false, finishRequests: [entry("R1", "approved", { resolvedBy: "1", resolvedAt: "2099-10-05T16:00:00.000Z" })] }));
{
  const stale = tree({ pendingFinish: true, finishRequests: [entry("R1", "pending")] });
  await post(stale);
  ok("R1 stays approved, with who approved it", [view(), op().finishRequests[0].resolvedBy], [[false, ["R1:approved"]], "1"]);
}

console.log("\n3. WHAT CLIENTS LEGITIMATELY WRITE STILL LANDS");
reset(tree({ pendingFinish: true, finishRequests: [entry("R1", "pending")] }));
{
  await post(tree({ pendingFinish: false, finishRequests: [entry("R1", "declined", { resolvedBy: "1" })] }));
  ok("a resolution passes through", view(), [false, ["R1:declined"]]);
}
reset(tree({ pendingFinish: false, finishRequests: [entry("R1", "declined")] }));
{
  await post(tree({ pendingFinish: true, finishRequests: [entry("R1", "declined"), entry("R2", "pending")] }));
  ok("a new request alongside a decided one passes through", view(), [true, ["R1:declined", "R2:pending"]]);
}
reset(tree({}));
{
  await post(tree({ pendingFinish: true, finishRequests: [entry("R1", "pending")] }));
  ok("the first request on an op with none passes through", view(), [true, ["R1:pending"]]);
}
reset(tree({ pendingFinish: true, finishRequests: [entry("R1", "pending")] }));
{
  const before = JSON.stringify(globalThis.__S3[K.tasks]);
  await post(tree({ pendingFinish: true, finishRequests: [entry("R1", "pending")] }));
  ok("an unchanged save leaves the op exactly as stored", JSON.stringify(op().finishRequests), JSON.stringify(JSON.parse(before)[0].subs[0].subs[0].finishRequests));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
