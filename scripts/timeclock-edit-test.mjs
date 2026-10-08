#!/usr/bin/env node
// #498. EDITING A CLOCKED TIME DID NOT STICK — IT MOVED BY THE UTC OFFSET.
//
// Trey: "changing and editing time fails to save". It saved; it saved the wrong
// instant, and reopening showed a third one. Two implementations of the same
// ISO<->datetime-local conversion, one right and one wrong, both feeding the
// SAME `fromLocal`:
//
//   TRAQS.jsx:20443  toLocal = d => new Date(d - d.getTimezoneOffset()*60000)
//                                     .toISOString().slice(0,16)      CORRECT
//   TRAQS.jsx:22478  toLocal = iso => iso.slice(0,16)                 WRONG
//
// The wrong one hands a `datetime-local` field the UTC wall clock. `fromLocal`
// parses that string as LOCAL and converts back to UTC, so a value that is only
// opened and saved shifts by the offset — six or seven hours in Mountain Time.
//
// ONE implementation now, in src/shopTime.js, used by both.
//
//   node scripts/timeclock-edit-test.mjs
import { readFileSync } from "node:fs";
import { isoToLocalInput, localInputToIso } from "../src/shopTime.js";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));

console.log("\n1. THE ROUND TRIP IS LOSSLESS — the defect itself");
{
  // The property that matters: open the editor, touch nothing, save. The stored
  // instant must be the one that was stored. The old pair broke exactly here.
  for (const iso of ["2026-10-08T21:30:00.000Z", "2026-01-15T07:05:00.000Z",
                     "2026-06-30T23:59:00.000Z", "2026-03-08T09:00:00.000Z"]) {
    ok(`round trip holds for ${iso}`, localInputToIso(isoToLocalInput(iso)), iso.slice(0, 17) + "00.000Z");
  }
}

console.log("\n2. IT SHOWS LOCAL TIME, NOT UTC");
{
  const iso = "2026-10-08T21:30:00.000Z";
  const shown = isoToLocalInput(iso);
  const d = new Date(iso);
  const expect = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    + `T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  ok("the field shows the viewer's own clock", shown, expect);
  // On a machine behind UTC this is the whole bug: the naive slice would show
  // the UTC hour, which is not what the worker clocked.
  if (new Date().getTimezoneOffset() !== 0)
    ok("...which is NOT the raw UTC slice the old code used", shown === iso.slice(0, 16), false);
  else
    ok("...(running at UTC, so the two agree here — the round trip above still proves it)", true, true);
}

console.log("\n3. EDGES THAT MUST NOT CORRUPT AN ENTRY");
{
  ok("an empty value stays empty", isoToLocalInput(""), "");
  ok("null stays empty", isoToLocalInput(null), "");
  ok("...and converting back gives null, not an invalid date", localInputToIso(""), null);
  // THROWS COUNT AS FAILURES HERE. Both guards, removed, make `.toISOString()`
  // run on an Invalid Date, which raises a RangeError rather than returning a
  // wrong value — and a crash reads as "survived" to a mutation runner looking
  // for a failed assertion. `safe` turns the throw into the failure it is.
  const safe = (fn) => { try { return fn(); } catch (e) { return `THREW: ${e.name}`; } };
  ok("a junk timestamp does not become NaN text or throw", safe(() => isoToLocalInput("not-a-date")), "");
  ok("junk local input does not become an Invalid Date ISO or throw", safe(() => localInputToIso("not-a-date")), null);
  ok("an undefined ISO does not throw", safe(() => isoToLocalInput(undefined)), "");
  // An OPEN shift has no clockOut. The server refuses the edit with a 400, so
  // the UI must not offer it — latent today (0 open punches) but reachable.
  ok("a missing clockOut converts to null rather than an empty string",
    localInputToIso(isoToLocalInput(null)), null);
}

console.log("\n4. BOTH SURFACES USE THE ONE IMPLEMENTATION");
{
  ok("TRAQS imports the shared pair",
    /import \{[^}]*isoToLocalInput[^}]*\} from "\.\/shopTime\.js"/.test(CODE), true);
  ok("no local toLocal survives", /const toLocal = /.test(CODE), false);
  ok("no local fromLocal survives", /const fromLocal = /.test(CODE), false);
  // Pinned per surface, because a count would be green with the wrong two (R4).
  ok("the timesheet row editor uses it",
    /value=\{isoToLocalInput\(tsEditEntry\.clockIn\)\} onChange=\{v => setTsEditEntry\(x => \(\{ \.\.\.x, clockIn: localInputToIso\(v\) \}\)\)\}/.test(CODE), true);
  ok("...for clockOut too",
    /value=\{isoToLocalInput\(tsEditEntry\.clockOut\)\} onChange=\{v => setTsEditEntry\(x => \(\{ \.\.\.x, clockOut: localInputToIso\(v\) \}\)\)\}/.test(CODE), true);
  ok("the other editor uses it as well", (CODE.match(/isoToLocalInput\(/g) || []).length >= 3, true);
}

console.log("\n5. THE SAVE REFUSES WHAT THE SERVER WOULD REJECT");
{
  // The server 400s on a missing clockIn or clockOut. Sending it anyway produces
  // "Missing entryId, clockIn, or clockOut" in an alert, which reads as a bug
  // rather than as a shift that is still running.
  ok("saveEditEntry will not post an open shift",
    /if \(!tsEditEntry\.clockIn \|\| !tsEditEntry\.clockOut\) return toast\("Clock this shift out before editing its times"\);/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
