#!/usr/bin/env node
// "INCORRECT PIN" ONLY WHEN THE PIN WAS INCORRECT.
//
// The web Time Clock's clock-out and lunch/break handlers shook the keypad and
// printed "Incorrect PIN" on ANY response that was not ok. The server checks the
// PIN first and only then writes, so every failure after the check -- a 503 from
// the #454 local-dev write guard, a 409 "Not currently clocked in", a 429 lockout
// -- was reported as a wrong PIN for a PIN that had just been accepted. Seen
// 2026-10-15 on localhost:8888: four POSTs passed the PIN check, were refused at
// the payhours write, and all four read "Incorrect PIN"; the same PIN worked on iOS,
// which shows the server's message.
//
// `pinErrorMessage(res)` is null for a wrong PIN (keep the shake) and the server's
// own message for everything else.
//
//   node scripts/pin-message-test.mjs
import { readFileSync } from "node:fs";
import { pinErrorMessage } from "../src/pinMessage.js";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. WHICH FAILURES ARE A WRONG PIN");
{
  ok("the server's 401 is a wrong PIN", pinErrorMessage({ error: "Invalid PIN" }), null);
  const guard = "Local development cannot write to the production bucket (writeJson orgs/X/payhours.json). See SCHEDULE_MAP #454.";
  ok("the #454 write refusal is NOT, and says what it is", pinErrorMessage({ error: guard }), guard);
  ok("a 409 is not", pinErrorMessage({ error: "Not currently clocked in" }), "Not currently clocked in");
  ok("a lockout is not", pinErrorMessage({ error: "Too many failed attempts. Try again later." }), "Too many failed attempts. Try again later.");
  ok("a failure with no message still says something", typeof pinErrorMessage({}), "string");
  ok("...and it does not claim the PIN was wrong", /pin/i.test(pinErrorMessage({})), false);
}

console.log("\n2. THE HANDLERS USE IT");
{
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  const body = name => {
    const i = CODE.indexOf(`const ${name} = async pin => {`);
    return i < 0 ? "" : CODE.slice(i, CODE.indexOf("\n    };", i));
  };
  for (const h of ["handleClockInPin", "handleClockOutPin", "handleLunchBreakPin"]) {
    const b = body(h);
    ok(`${h} exists`, b.length > 0, true);
    ok(`${h} asks pinErrorMessage before shaking`, /const _msg = pinErrorMessage\(res\);\s*if \(_msg\) alert\(_msg\);/.test(b), true);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
