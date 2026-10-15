#!/usr/bin/env node
// ONE COMPLETION REQUEST, ONE CHAT BUBBLE (#329).
//
// finishRequest writes the op (idempotent since #180: a second request for an op that
// already has one open is answered `{alreadyOpen: true}` and writes nothing), then posts a
// bubble to the "Completion Requests" group — and the BUBBLE write is not idempotent at all.
// It is skipped on the second request only because the handler RETURNS before reaching it.
// That ordering is load-bearing and nothing asserted it: move the bubble above the
// alreadyOpen answer and every double-tap on a phone posts a second "Completion requested"
// to every approver.
//
// REAL timeclock.js on the in-memory S3 (itest-loader-real-timestamps.mjs).
//
//   node scripts/finish-bubble-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let tc;
try { tc = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load timeclock.js:", e); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json",
  groups: "orgs/TESTORG/groups.json", messages: "orgs/TESTORG/messages.json" };
const OLD = "2026-09-30T10:00:00.000Z";
const reset = () => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__PRECONDITION_FAILURES = []; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver", workStart: "00:00", workEnd: "24:00", workDays: [0,1,2,3,4,5,6], lunch: { durationMinutes: 0 }, breaks: [] },
    [K.people]: [
      { id: 1, name: "Admin", userRole: "admin", lastModifiedAt: OLD },
      { id: 7, name: "Wendy", userRole: "user", pin: "1234", lastModifiedAt: OLD },
    ],
    [K.tasks]: [{ id: "JOB", title: "Job", lastModifiedAt: OLD, subs: [{ id: "PANEL", title: "Panel",
      subs: [{ id: "OP", title: "Op", status: "In Progress", team: [7] }, { id: "OP2", title: "Op 2", status: "In Progress", team: [7] }] }] }],
  };
  globalThis.__AUTH = { personId: "7", isAdmin: false, email: "w@x" };
};
const request = (opId = "OP") => tc({ httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "finishRequest", jobId: "JOB", panelId: "PANEL", opId, personId: 7, pin: "1234" }) })
  .then(r => (typeof r.body === "string" ? JSON.parse(r.body) : r.body));
const bubbles = (opId) => (globalThis.__S3[K.messages] || []).filter(m => m.type === "finish_request" && (opId == null || m.opId === opId)).length;
const wrote = (key) => globalThis.__WRITES.filter(w => (w.key ?? w) === key).length;

console.log("\n1. THE FIRST REQUEST POSTS ONE BUBBLE");
reset();
{
  const r = await request();
  ok("it is accepted with a request id", [r.ok, typeof r.requestId], [true, "string"]);
  ok("...and posts exactly one bubble", bubbles("OP"), 1);
}

console.log("\n2. A SECOND REQUEST FOR THE SAME OP POSTS NOTHING");
{
  const messagesWrites = wrote(K.messages), groupsWrites = wrote(K.groups);
  const r = await request();
  ok("it is answered alreadyOpen, not an error", [r.ok, r.alreadyOpen], [true, true]);
  ok("...with still exactly one bubble", bubbles("OP"), 1);
  ok("...and no write to messages.json or groups.json at all",
    [wrote(K.messages) - messagesWrites, wrote(K.groups) - groupsWrites], [0, 0]);
}

console.log("\n3. A DIFFERENT OP STILL GETS ITS OWN");
{
  await request("OP2");
  ok("a request for another op posts its bubble", [bubbles("OP"), bubbles("OP2")], [1, 1]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
