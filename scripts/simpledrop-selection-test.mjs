#!/usr/bin/env node
// #483. Every default-trigger SimpleDrop rendered its PLACEHOLDER instead of the
// selected label, because the selected row was looked up in a list that is empty
// while the menu is closed.
//
//   const listOf = () => (typeof options === "function" ? options() : options) || [];
//   const rows = open ? listOf() : [];      // empty while closed, on purpose
//   const sel = rows.find(o => o.value === value);   // ...so sel is undefined
//   ...
//   {sel ? sel.label : placeholder}
//
// A REGRESSION, dated: `99e2785` (2026-10-05) replaced `options.find(...)` with
// the lazy form while adding a thunk + custom trigger for the Jobs page
// quick-assign. The laziness is right — `assignPickerFor` is expensive — but it
// was applied to the one value that has to be known while closed.
//
// THE REAL EXPRESSION IS EXECUTED, not a restatement of it. The three lines are
// cut out of SimpleDrop's source and run, so this fails if the source changes
// shape rather than passing against a copy that cannot drift (LESSONS #1).
//
//   node scripts/simpledrop-selection-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const at = SRC.indexOf("function SimpleDrop({");
if (at < 0) { console.error("SimpleDrop was not found — has it been renamed?"); process.exit(2); }
const BODY = SRC.slice(at, SRC.indexOf("\nfunction ", at + 10));

// Cut the three lines that decide the trigger's label.
const pick = (re, what) => {
  const m = BODY.match(re);
  if (!m) { console.error(`SimpleDrop no longer contains ${what} — the suite cannot execute what it is testing`); process.exit(2); }
  return m[0];
};
const lListOf = pick(/const listOf = \(\) =>[^\n]+/, "listOf");
const lRows = pick(/const rows = [^\n]+/, "rows");
const lSel = pick(/const sel = [^\n]+/, "sel");
console.log(`\nexecuting SimpleDrop's own lines:\n  ${lSel.trim()}`);

// eslint-disable-next-line no-new-func
const run = new Function("options", "open", "value", "trigger",
  `${lListOf}\n${lRows}\n${lSel}\nreturn sel;`);

const OPTS = [{ value: "", label: "—" }, { value: "7", label: "Acme" }, { value: "9", label: "Globex" }];

console.log("\n1. THE TRIGGER SHOWS THE SELECTION WHILE THE MENU IS CLOSED");
{
  ok("a set value resolves its label when CLOSED", run(OPTS, false, "7", null)?.label, "Acme");
  ok("...and when open", run(OPTS, true, "7", null)?.label, "Acme");
  ok("the empty option still resolves", run(OPTS, false, "", null)?.label, "—");
  ok("a value that is on no option resolves to nothing", run(OPTS, false, "404", null), undefined);
  ok("no options at all does not throw", run([], false, "7", null), undefined);
  ok("undefined options does not throw", run(undefined, false, "7", null), undefined);
  // The match is STRICT, and that is deliberate rather than incidental. A loose
  // compare would quietly match a numeric option value against a stored string,
  // which is the id drift this campaign keeps finding (#384, #444, #469) — it
  // would hide the mismatch here and leave it to surface somewhere with no
  // fallback. The strict compare is what makes the call sites' String() the
  // real fix, so a mutant loosening it must fail.
  ok("a NUMERIC option value does not match a stored string",
    run([{ value: 7, label: "Acme" }], false, "7", null), undefined);
  ok("...and the same pair matches once the option is stringified",
    run([{ value: "7", label: "Acme" }], false, "7", null)?.label, "Acme");
}

console.log("\n2. THE LAZINESS IT WAS ADDED FOR IS KEPT");
{
  // The one caller with an expensive thunk is also the one with a custom trigger,
  // which renders its own content and never reads `sel`. So the thunk must not be
  // called for it — that is the whole reason `rows` is lazy.
  let calls = 0;
  const thunk = () => { calls++; return OPTS; };
  run(thunk, false, "7", "<custom/>");
  ok("a CUSTOM-trigger dropdown never resolves the list while closed", calls, 0);
  calls = 0;
  run(thunk, true, "7", "<custom/>");
  ok("...and resolves it once when opened, for the menu", calls >= 1, true);
}

console.log("\n3. EVERY SELECT ON THE GENERAL CARD CAN MATCH ITS OPTIONS");
{
  // The bug was in the component, but a select can also fail by comparing a
  // number against a string — the id drift this campaign keeps finding. These
  // check the card's four selects agree on type, which `===` in `sel` requires.
  const card = SRC.slice(SRC.indexOf('const clientOpts = ['), SRC.indexOf('jdField("notes"'));
  ok("clientOpts stringifies its values", /value: String\(c\.id\)/.test(card), true);
  ok("pmOpts stringifies its values", /value: String\(p\.id\)/.test(card), true);
  ok("the client field stringifies the stored value",
    /jdField\("clientId"[^\n]*toValue: v => \(v == null \? "" : String\(v\)\)/.test(card), true);
  ok("the PM field stringifies the stored value",
    /jdField\("projectManagerId"[^\n]*toValue: v => \(v == null \? "" : String\(v\)\)/.test(card), true);
  // status and pri are plain strings on both sides — withCurrent maps the org's
  // own list to {value, label} with no conversion, so there is nothing to drift.
  ok("status and priority options are built from the org's own strings",
    /const withCurrent = \(list, cur\) =>[\s\S]{0,160}map\(v => \(\{ value: v, label: v \}\)\)/.test(SRC), true);
  ok("...and the job's own value is included when it is off-list",
    /cur && !list\.includes\(cur\) \? \[cur\] : \[\]/.test(SRC), true);
  // The four selects, pinned by name so a fifth cannot be added unnoticed.
  for (const k of ["clientId", "status", "projectManagerId", "pri"])
    ok(`${k} is a select on the card`, new RegExp(`jdField\\("${k}", "[^"]+", "select"`).test(card), true);
  ok("exactly four selects on the card", (card.match(/, "select",/g) || []).length, 4);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
