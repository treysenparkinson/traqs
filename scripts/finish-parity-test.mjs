#!/usr/bin/env node
// #477. The finish-request status rule, run by the REAL web code and frozen to a
// file both platforms test against.
//
// WHY THIS ONE IS NOT LIKE schedule-parity. That fixture compares PORTS — the
// same function written twice. These are deliberately DIFFERENT functions:
//
//   web  requestStatusOf(target, requestId) -> String    (src/finishRequests.js)
//   iOS  CompletionRequestRules.status(target:requestId:) -> String?
//
// and iOS's header says where it departs on purpose: "the web falls back to
// 'pending' even when the target is MISSING, which is exactly what let a
// resolved request render live Approve/Deny whenever its job wasn't loaded. An
// unfound target stays nil — unknown — here."
//
// So this fixture is NOT asserting the two agree. It asserts THE DOCUMENTED
// DEPARTURE IS THE ONLY DIFFERENCE, by carrying iOS's expected answer as a
// per-case field next to the web's. A case where they differ must say so in
// `iosDiffers`, with a reason, or the Swift suite fails. Prose in a header is
// not diffable; a column is.
//
// WHY IT IS WORTH HAVING WHILE THE TWO AGREE ON EVERY LIVE RECORD: this rule is
// the one handshake that CROSSES the platforms — a request is raised on iOS and
// approved on the web — so a divergence here is guaranteed to reach a user. The
// agreement today is what makes it cheap to pin, not a reason to skip it.
//
//   node scripts/finish-parity-test.mjs          check
//   node scripts/finish-parity-test.mjs --write  regenerate after a deliberate change
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { requestStatusOf } from "../src/finishRequests.js";

const FILE = new URL("../fixtures/finish-parity.json", import.meta.url);
const WRITE = process.argv.includes("--write");

// ── THE CASES ────────────────────────────────────────────────────────────────
// The eleven historical combinations from finishRequests.js's own header, plus
// the mirror-only record the upsert stands behind and the unfound target that is
// the documented departure. `target: null` means the job was not loaded.
//
// `ios` is what CompletionRequestRules.status is expected to return — null for
// Swift's nil. When it differs from `web`, `why` must say why.
const REQ = "r1";
const row = (over = {}) => ({ id: REQ, by: "7", byName: "Worker", at: "2026-10-01T12:00:00Z", status: "pending", ...over });

const CASES = [
  { name: "no target at all — the job is not loaded",
    target: null, requestId: REQ,
    ios: null, why: "iOS returns nil for an unfound target; the web falls back to pending. The documented departure: a wrong 'pending' renders Approve/Deny buttons that do nothing." },

  { name: "a pending row names this request",
    target: { status: "In Progress", finishRequests: [row()] }, requestId: REQ },

  { name: "an approved row names this request",
    target: { status: "Finished", finishRequests: [row({ status: "approved", resolvedBy: "1", resolvedByName: "Trey", resolvedAt: "2026-10-02T09:00:00Z" })] }, requestId: REQ },

  { name: "a declined row names this request",
    target: { status: "In Progress", finishRequests: [row({ status: "declined", resolvedBy: "1", resolvedByName: "Trey", resolvedAt: "2026-10-02T09:00:00Z", declineReason: "Not wired" })] }, requestId: REQ },

  { name: "the row is for a DIFFERENT request, and this one has no trace",
    target: { status: "In Progress", finishRequests: [row({ id: "other", status: "approved" })] }, requestId: REQ,
    ios: null, why: "No row, no stamp, no mirror, not finished. The web's fallback ends in 'pending'; iOS returns nil. The SECOND departure, and prose did not record it — this fixture is what found it." },

  { name: "a later request is pending; this older one was approved",
    target: { status: "In Progress", finishRequests: [row({ status: "approved" }), row({ id: "r2" })] }, requestId: REQ },

  { name: "mirror only — an old iOS build wrote pendingFinish and no row",
    target: { status: "In Progress", pendingFinish: true }, requestId: REQ },

  { name: "the deprecated singular stamp names this request, no row",
    target: { status: "In Progress", finishRequest: { requestId: REQ, by: "7", byName: "Worker", at: "2026-10-01T12:00:00Z" } }, requestId: REQ },

  { name: "the stamp names a DIFFERENT request and the mirror is set",
    target: { status: "In Progress", pendingFinish: true, finishRequest: { requestId: "other" } }, requestId: REQ },

  { name: "#173 — stamp plus a pending row, mirror never set",
    target: { status: "In Progress", finishRequest: { requestId: REQ }, finishRequests: [row()] }, requestId: REQ },

  { name: "#175 — the op is Finished and the row is still pending",
    target: { status: "Finished", finishRequests: [row()] }, requestId: REQ },

  { name: "all three forms set, the server path",
    target: { status: "In Progress", pendingFinish: true, finishRequest: { requestId: REQ }, finishRequests: [row()] }, requestId: REQ },

  { name: "nothing at all, and the item is Finished",
    target: { status: "Finished" }, requestId: REQ },

  { name: "nothing at all, and the item is open",
    target: { status: "In Progress" }, requestId: REQ,
    ios: null, why: "Same shape as the different-request case: the web's fallback ends in 'pending', iOS in nil." },

  { name: "an empty list and no flags",
    target: { status: "Not Started", finishRequests: [] }, requestId: REQ,
    ios: null, why: "An empty list is the same as no list. Web 'pending', iOS nil." },

  { name: "a row with no status at all",
    target: { status: "In Progress", finishRequests: [{ id: REQ, by: "7" }] }, requestId: REQ,
    ios: null, why: "iOS's displayStatus skips a row with no status, then finds no stamp and no mirror; the web falls through to pending for the same reason." },

  { name: "a numeric row id against a string requestId — the drift both sides handle",
    target: { status: "In Progress", finishRequests: [row({ id: 1 })] }, requestId: "1" },

  { name: "no requestId given, with a pending row present",
    target: { status: "In Progress", finishRequests: [row()] }, requestId: null,
    ios: null, why: "No id to match. The web's `same()` refuses a null on either side and falls through to its pending default; iOS has no request to report on and returns nil." },
];

// ── COMPUTE from the real implementation. Nobody types the `web` column. ─────
const compute = () => CASES.map((c) => {
  const web = requestStatusOf(c.target, c.requestId);
  const ios = "ios" in c ? c.ios : web;          // same as the web unless stated
  if ("ios" in c && !c.why) {
    console.error(`finish-parity: case "${c.name}" declares a departure with no reason`);
    process.exit(2);
  }
  if (!("ios" in c) && c.why) {
    console.error(`finish-parity: case "${c.name}" gives a reason but declares no departure`);
    process.exit(2);
  }
  return { name: c.name, target: c.target, requestId: c.requestId, web, ios,
    ...(ios !== web ? { iosDiffers: true, why: c.why } : {}) };
});

const cases = compute();
const payload = {
  note: "Generated by scripts/finish-parity-test.mjs from src/finishRequests.js. Do not hand-edit. "
      + "`web` is computed; `ios` is what CompletionRequestRules.status must return. "
      + "`iosDiffers` marks a DELIBERATE departure and `why` must justify it.",
  cases,
};
const text = JSON.stringify(payload, null, 2) + "\n";

if (WRITE || !existsSync(FILE)) {
  writeFileSync(FILE, text);
  console.log(`finish-parity: wrote ${cases.length} cases to fixtures/finish-parity.json`);
  console.log(`  ${cases.filter(c => c.iosDiffers).length} declare a deliberate iOS departure.`);
  console.log(`  Now make FinishParityTests (iOS) pass against it before shipping.`);
  process.exit(0);
}

// Same CRLF handling as schedule-parity: the committed blob is LF, and a Windows
// checkout must not fail on line endings for a reason that has nothing to do
// with the rule. The canary says so plainly if the normalisation is ever lost.
const committed = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
if (/\r/.test(committed)) {
  console.error("finish-parity: a CR survived normalisation — the EOL canary is broken (#376)");
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (label, good) => { console.log(`  ${good ? "PASS" : "FAIL"}  ${label}`); good ? pass++ : fail++; };

if (committed !== text) {
  const was = JSON.parse(committed);
  const changed = cases.filter((c, i) => JSON.stringify(was.cases?.[i]) !== JSON.stringify(c)).map(c => c.name);
  console.error(`finish-parity: FAIL — the web rule no longer produces the committed fixture.`);
  console.error(`  cases that changed: ${changed.join("; ") || "(ordering or note)"}`);
  console.error(`  If the change is deliberate: node scripts/finish-parity-test.mjs --write,`);
  console.error(`  then make FinishParityTests (iOS) pass against it before shipping.`);
  process.exit(1);
}

// Properties of the fixture itself, so it cannot rot into a rubber stamp.
console.log("\nfinish-parity");
ok(`${cases.length} cases, which is the whole committed file`, cases.length === JSON.parse(committed).cases.length);
ok("every case names a target state or says there is none",
  cases.every(c => "target" in c));
ok("every declared departure carries a reason",
  cases.filter(c => c.iosDiffers).every(c => typeof c.why === "string" && c.why.length > 20));
ok("no case claims a departure while agreeing",
  cases.every(c => !!c.iosDiffers === (c.ios !== c.web)));
// The fixture is worthless if it only contains cases where the two agree, and
// equally worthless if every case is a departure.
const diffs = cases.filter(c => c.iosDiffers).length;
ok(`it covers both: ${cases.length - diffs} agreeing and ${diffs} departing`, diffs > 0 && diffs < cases.length);
ok("the web never returns null — its fallback always answers",
  cases.every(c => typeof c.web === "string"));
ok("every departure is iOS returning null where the web guesses pending",
  cases.filter(c => c.iosDiffers).every(c => c.ios === null && c.web === "pending"));
ok("the four resolved spellings are the only ones produced",
  [...new Set(cases.map(c => c.web))].every(s => ["pending", "approved", "declined"].includes(s)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
