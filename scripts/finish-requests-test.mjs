// Finish requests: one representation, and the guards on the path that opens them.
//
// Timeclock chunk B. Three representations of one fact — pendingFinish, finishRequest,
// finishRequests[] — which were wrong about each other 10 moments out of 11 across the
// sampled history of Matrix's tasks.json. finishRequests[] is now authoritative,
// pendingFinish is a single-writer mirror for iOS, and the singular pointer is read-only
// legacy.
//
//   node scripts/finish-requests-test.mjs
import { register } from "module";
// Real timestamps: the conflict/stamp behaviour is live in this suite's server half, and the
// other loader stubs changedIds to [] — see conflict-log-test for what that hides.
register("./itest-loader-real-timestamps.mjs", import.meta.url);

import { pendingFinishOf, pendingEntryOf, openRequest, resolveRequest, normalizeFinishState } from "../src/finishRequests.js";

let timeclock;
try { timeclock = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load timeclock.js:", e); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const entry = (status, id = "r1", at = "2026-10-01T10:00:00.000Z") => ({ id, by: "7", byName: "W", at, status });

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. The reconciliation rule — which side wins when the mirror and the list disagree");
// Rule 1: a pending entry is open whatever the mirror says. Absence of the mirror is not
// evidence of resolution — two code paths fail to set it (#173, #175).
ok("a pending entry with no mirror is OPEN (the #173 shape)", pendingFinishOf({ finishRequests: [entry("pending")] }), true);
ok("...and with the mirror explicitly false, still OPEN", pendingFinishOf({ pendingFinish: false, finishRequests: [entry("pending")] }), true);
// Rule 2: the flag is the only witness to an old iOS request. Dropping it loses a real one.
ok("mirror true with an EMPTY list is OPEN (an old iOS request)", pendingFinishOf({ pendingFinish: true }), true);
ok("...and with finishRequests: [] likewise", pendingFinishOf({ pendingFinish: true, finishRequests: [] }), true);
// Rule 3: the list can prove a resolution; a bit cannot prove anything.
ok("mirror true but every entry resolved is CLOSED", pendingFinishOf({ pendingFinish: true, finishRequests: [entry("approved")] }), false);
ok("...declined counts as resolved too", pendingFinishOf({ pendingFinish: true, finishRequests: [entry("declined")] }), false);
ok("nothing at all is CLOSED", pendingFinishOf({}), false);
ok("a null op is CLOSED, not a crash", pendingFinishOf(null), false);
// The newest pending entry is the one a UI shows.
ok("pendingEntryOf returns the NEWEST pending entry", pendingEntryOf({ finishRequests: [
  entry("pending", "old", "2026-10-01T09:00:00.000Z"), entry("pending", "new", "2026-10-01T11:00:00.000Z"),
] })?.id, "new");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. One writer — a call site cannot set two of three");
{
  const op = { id: "OP" };
  const opened = { ...op, ...openRequest(op, { requestId: "r9", by: "7", byName: "W", at: "2026-10-01T12:00:00.000Z" }) };
  ok("openRequest sets the list AND the mirror", [opened.finishRequests.length, opened.pendingFinish], [1, true]);
  ok("...and writes no singular pointer", opened.finishRequest, undefined);
  ok("...so the op reads as open", pendingFinishOf(opened), true);
  const closed = { ...opened, ...resolveRequest(opened, { status: "approved", by: "1", at: "2026-10-01T13:00:00.000Z" }) };
  ok("resolveRequest closes the entry AND the mirror", [closed.finishRequests[0].status, closed.pendingFinish], ["approved", false]);
  ok("...records who resolved it", [closed.finishRequests[0].resolvedBy, closed.finishRequests[0].resolvedAt], ["1", "2026-10-01T13:00:00.000Z"]);
  ok("...and the op reads as closed", pendingFinishOf(closed), false);
}
{
  // Two pending entries and a resolve that names neither: closing only one would leave the
  // op open after a decision that was supposed to end it.
  const op = { finishRequests: [entry("pending", "a"), entry("pending", "b")] };
  const closed = { ...op, ...resolveRequest(op, { status: "declined", at: "2026-10-01T13:00:00.000Z" }) };
  ok("resolving with no id closes EVERY pending entry", [closed.finishRequests.map(r => r.status), closed.pendingFinish],
    [["declined", "declined"], false]);
}
{
  const op = { finishRequests: [entry("pending", "a"), entry("pending", "b")] };
  const closed = { ...op, ...resolveRequest(op, { requestId: "a", status: "approved", at: "2026-10-01T13:00:00.000Z" }) };
  ok("...but a named id closes only that one, and the op stays open", [closed.finishRequests.map(r => r.status), closed.pendingFinish],
    [["approved", "pending"], true]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. The normaliser — same rule, and idempotent");
ok("an op with nothing is left alone", normalizeFinishState({ id: "x" }), null);
ok("an op already agreeing is left alone", normalizeFinishState({ id: "x", pendingFinish: true, finishRequests: [entry("pending")] }), null);
// The bug the dry run caught: an ABSENT mirror already means "not pending", so treating it
// as a disagreement wanted to stamp pendingFinish:false onto all 1,481 nodes of the tree.
ok("an absent mirror on a clean op is NOT a disagreement", normalizeFinishState({ id: "x", finishRequests: [entry("approved")] }), null);
{
  const n = normalizeFinishState({ id: "x", finishRequests: [entry("pending")] });
  ok("a pending entry with no mirror sets the mirror", n, { pendingFinish: true });
}
{
  const n = normalizeFinishState({ id: "x", pendingFinish: true, finishRequests: [entry("approved")] });
  ok("a stale true mirror over a resolved list is cleared", n, { pendingFinish: false });
}
{
  const op = { id: "x", pendingFinish: true, team: ["7"], lastModifiedAt: "2026-09-01T00:00:00.000Z" };
  const n = normalizeFinishState(op);
  ok("a flag with no list synthesises an entry rather than losing the request",
    [n.finishRequests.length, n.finishRequests[0].status, n.finishRequests[0].synthesized, n.finishRequests[0].by, n.finishRequests[0].at],
    [1, "pending", true, "7", "2026-09-01T00:00:00.000Z"]);
  ok("...and running it again changes nothing", normalizeFinishState({ ...op, ...n }), null);
}
{
  const op = { id: "x", finishRequests: [entry("approved", "a")], finishRequest: { requestId: "a" } };
  ok("a pointer at a resolved entry is dropped", normalizeFinishState(op), { finishRequest: undefined });
}
{
  const op = { id: "x", finishRequests: [entry("approved", "a")], finishRequest: { requestId: "gone" } };
  ok("a dangling pointer is dropped", normalizeFinishState(op), { finishRequest: undefined });
}
{
  const op = { id: "x", pendingFinish: true, finishRequests: [entry("pending", "a")], finishRequest: { requestId: "a" } };
  ok("a pointer at a LIVE entry is left alone", normalizeFinishState(op), null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. #180 — the guards on the server path that opens a request");
const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json",
  groups: "orgs/TESTORG/groups.json", messages: "orgs/TESTORG/messages.json" };
const reset = () => {
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver" },
    [K.people]: [
      { id: 7, name: "Wendy Worker", userRole: "user", pin: "PIN7" },
      { id: 8, name: "Oscar Other", userRole: "user", pin: "PIN8" },
      { id: 1, name: "Ada Admin", userRole: "admin", pin: "PIN1" },
    ],
    [K.tasks]: [{ id: "JOB", title: "Job", subs: [{ id: "PANEL", title: "Panel",
      subs: [{ id: "OP", title: "Op", team: [7] }] }] }],
  };
  globalThis.__WRITES = []; globalThis.__ETAGS = {};
};
const op = () => globalThis.__S3[K.tasks][0].subs[0].subs[0];
const req = (personId, extra = {}) => timeclock({ httpMethod: "POST", headers: {}, body: JSON.stringify({
  action: "finishRequest", jobId: "JOB", panelId: "PANEL", opId: "OP", personId, pin: "PIN" + personId, ...extra }) });

reset();
{
  const res = await req(7);
  ok("the assigned worker may raise one", res.statusCode, 200);
  ok("...and it sets the list and the mirror together", [(op().finishRequests || []).length, op().pendingFinish], [1, true]);
  ok("...attributed to the verified person", [op().finishRequests[0].by, op().finishRequests[0].byName], ["7", "Wendy Worker"]);
}
reset();
{
  const res = await req(8);
  ok("someone NOT on the op is refused (scope)", res.statusCode, 403);
  ok("...and nothing was written", (op().finishRequests || []).length, 0);
}
reset();
{
  const res = await req(1);
  ok("an admin may raise one for work they are not on", res.statusCode, 200);
}
reset();
{
  await req(7);
  const res = await req(7);
  ok("asking twice is a no-op, not a second entry (idempotency)", [res.statusCode, res.body.alreadyOpen], [200, true]);
  ok("...the list still holds exactly one", (op().finishRequests || []).length, 1);
}
reset();
{
  await req(7, { personName: "Ada Admin" });
  ok("a personName in the body is ignored — the roster decides", op().finishRequests[0].byName, "Wendy Worker");
}
reset();
{
  const res = await timeclock({ httpMethod: "POST", headers: {}, body: JSON.stringify({
    action: "finishRequest", jobId: "JOB", panelId: "PANEL", opId: "NOSUCH", personId: 7, pin: "PIN7" }) });
  ok("an op that does not exist is still a 404", res.statusCode, 404);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. #177/#179 — releasing the hold a finish request put on a session");
const withClock = (frozen = true) => {
  reset();
  globalThis.__S3[K.people][0].activeJobClock = {
    clockIn: "2026-10-01T09:00:00.000Z", sessionId: "S1", jobId: "JOB", panelId: "PANEL", opId: "OP",
    ...(frozen ? { frozenAtMs: 1759311000000 } : {}),
  };
};
const release = (body) => timeclock({ httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "releaseJobSession", ...body }) });
const jc = () => globalThis.__S3[K.people][0].activeJobClock;

globalThis.__AUTH = { personId: "1", isAdmin: true, email: "a@x.com" };
withClock();
{
  const res = await release({ personId: 7, sessionId: "S1", outcome: "resume" });
  ok("resume lifts the freeze and leaves the worker on the job", [res.statusCode, jc() !== null, jc()?.frozenAtMs], [200, true, undefined]);
  ok("...and keeps the session itself", jc()?.sessionId, "S1");
}
withClock();
{
  await release({ personId: 7, sessionId: "S1", outcome: "clear" });
  ok("clear ends the session outright", jc(), null);
}
withClock();
{
  const res = await release({ personId: 7, sessionId: "SOMETHING-ELSE", outcome: "clear" });
  ok("a decision about a session that already ended releases nothing",
    [res.body.released, jc() !== null], [false, true]);
}
reset();
{
  const res = await release({ personId: 7, outcome: "clear" });
  ok("no active clock is a success, not an error", [res.statusCode, res.body.released], [200, false]);
}
withClock();
{
  globalThis.__AUTH = { personId: "8", isAdmin: false, email: "o@x.com" };
  const res = await release({ personId: 7, sessionId: "S1", outcome: "clear" });
  ok("someone with no approve permission cannot end another person's session", res.statusCode, 403);
  ok("...and it is untouched", jc()?.frozenAtMs, 1759311000000);
}
withClock();
{
  globalThis.__AUTH = { personId: "7", isAdmin: false, email: "w@x.com" };
  const res = await release({ personId: 7, sessionId: "S1", outcome: "resume" });
  ok("a worker may always release their OWN hold", [res.statusCode, jc()?.frozenAtMs], [200, undefined]);
}
globalThis.__AUTH = { personId: "1", isAdmin: true, email: "a@x.com" };
withClock();
{
  const res = await release({ personId: 7, sessionId: "S1", outcome: "nonsense" });
  ok("an outcome that is neither resume nor clear is refused", res.statusCode, 400);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
