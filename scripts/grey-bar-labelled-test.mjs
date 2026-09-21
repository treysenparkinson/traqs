#!/usr/bin/env node
// An all-grey bar must say which kind of grey it is.
//
// Two greys read as "nothing is happening here" and they mean opposite things:
// DONE is finished work, idle is work that never started and is now overdue.
// Measured, they separate cleanly — 2.1 to 2.8 contrast across three themes and
// three hues, and structurally, because idle tracks the surface while DONE
// tracks a fixed mute so they move apart in both directions. What neither of
// them carries is a QUANTITY. An all-grey bar cannot say that 15.4h is still
// owed, and there is no bar length to imply it once the bar is behind the
// cursor. So the badge carries it, and this asserts the badge is there.
//
// The invariant: a bar painted entirely grey has a DONE badge or an owed badge,
// never neither.
//
// WRITTEN AGAINST DATA, NOT A DOM. There is deliberately no test credential for
// this app, so the live page is not available to assert against and will not be.
// These run over the values a bar emits, fabricated here and fed from a real
// attribute dump when one is pasted in. That is a constraint on the instrument,
// not on the invariant.
//
// Run: node scripts/grey-bar-labelled-test.mjs

import { complementSpans } from "../src/statsMath.js";

// Mirrors activeBarFill's structure rather than restating its conclusion.
// A colour layer exists only while the cursor is inside the bar; past that the
// idle/hatch complement covers the whole width and nothing coloured remains.
const REGION_CAPABLE = new Set(["running", "held", "paused", "worked", "scheduled"]);
const isAllGrey = (b) => {
  if (b.state === "pto") return false;
  if (b.state === "done") return true;              // flat spent grey, no layers
  if (!REGION_CAPABLE.has(b.state)) return false;
  return Number.isFinite(b.dividerPct) && b.dividerPct >= 100;
};

// Nothing is owed once the worked total reaches the estimate. This reads the
// QUANTITY rather than span coverage: a bar worked to within a minute of its
// estimate owes nothing real — `_barOwedH` floors at 1/60h for exactly that
// reason — while its spans can still fall a rounding error short of covering
// the width. The two disagree only at the margin, and that margin is where a
// coverage proxy would cry wolf.
const owesNothing = (b) =>
  (Number.isFinite(b.workedPct) && b.workedPct >= 100) ||
  (Array.isArray(b.spans) && complementSpans(b.spans, 0, 100).length === 0);

// The invariant, and the reason for each way out.
//
// An ABSENT `owedH` means zero, not missing: the bar emits
// `data-owed-h={owed > 0 ? ... : undefined}`, so the attribute is simply not
// written when there is nothing to report. Treating absence as a failure would
// fire on every bar that legitimately owes nothing.
//
// That does not cost the deletion guard, which was the reason for the stricter
// reading. If `_barOwedH` were removed entirely, every wholly-passed untouched
// bar would report zero owed while still owing, and the clause below fires on
// exactly those — the regression shows up as "owes nothing when it should owe
// something" rather than as a missing attribute.
const violates = (b) => {
  if (!isAllGrey(b)) return null;
  if (b.state === "done") return null;                       // DONE badge
  const owed = b.owedH == null ? 0 : b.owedH;
  if (owed > 0) return null;                                 // owed badge
  if (owesNothing(b)) return null;                           // nothing outstanding to report
  return "all grey with work still outstanding and no badge to say so";
};

const FULL = [[0, 100]];
const cases = [
  // ── must PASS ────────────────────────────────────────────────────────────
  { name: "DONE bar", fires: false,
    bar: { state: "done", dividerPct: 140, spans: FULL, owedH: 0 } },
  { name: "overdue untouched, owed reported", fires: false,
    bar: { state: "scheduled", dividerPct: 175, spans: [], owedH: 15.4 } },
  { name: "overdue part-worked, owed reported", fires: false,
    bar: { state: "worked", dividerPct: 160, spans: [[0, 40]], owedH: 9 } },
  { name: "fully worked, awaiting approval", fires: false,
    bar: { state: "worked", dividerPct: 120, spans: FULL, workedPct: 100, owedH: 0 } },
  // The real emission omits the attribute entirely when nothing is owed, so an
  // absent owedH on a fully-worked bar is the NORMAL case, not a fault.
  { name: "fully worked, owed attribute omitted", fires: false,
    bar: { state: "worked", dividerPct: 120, spans: FULL, workedPct: 100 } },
  // Worked to within a minute of the estimate: owes nothing real, but its spans
  // fall a rounding error short of covering the width. A coverage-only test
  // would fire here; reading the quantity does not.
  { name: "worked to within a minute of estimate", fires: false,
    bar: { state: "worked", dividerPct: 130, spans: [[0, 99.97]], workedPct: 100 } },
  { name: "cursor inside the bar — not all grey", fires: false,
    bar: { state: "scheduled", dividerPct: 41, spans: [], owedH: 0 } },
  { name: "PTO is never grey", fires: false,
    bar: { state: "pto", dividerPct: 200, spans: [], owedH: 0 } },

  // ── must FIRE ────────────────────────────────────────────────────────────
  // The reported bug, after the fill is fixed but before owed is computed:
  // Howie's bar goes grey and still says nothing about the 97.5h it owes.
  { name: "RED overdue untouched, owed 0", fires: true,
    bar: { state: "scheduled", dividerPct: 175, spans: [], owedH: 0 } },
  { name: "RED overdue part-worked, owed 0", fires: true,
    bar: { state: "worked", dividerPct: 160, spans: [[0, 40]], owedH: 0 } },
  // _barOwedH deleted or returning 0 wrongly: the attribute is absent AND the
  // bar still owes. This is how that regression surfaces now that absence is
  // read as zero rather than as missing.
  { name: "RED owed omitted but work outstanding", fires: true,
    bar: { state: "scheduled", dividerPct: 175, spans: [], workedPct: 0 } },
  { name: "RED owed null but work outstanding", fires: true,
    bar: { state: "scheduled", dividerPct: 175, spans: [], workedPct: 0, owedH: null } },
  // Exactly at the boundary: the cursor has just reached the planned end, so the
  // colour layer is gone. 100 is the first all-grey value, not the last coloured one.
  { name: "RED cursor exactly at 100", fires: true,
    bar: { state: "scheduled", dividerPct: 100, spans: [], owedH: 0 } },

  // ── the two bars from the 2026-09-21 report, read out of tasks.json ───────
  // They divide the fix between the two lanes, which is worth pinning down:
  // only one of them is a badge case at all.
  //
  // Howie 402015-02 Wire — planned Sep 14 to OCT 1, untouched, 97.5h. The cursor
  // is INSIDE it at ~41%, so after the fill is fixed it is part grey and part
  // colour, and the colour still shows the work outstanding. No badge needed;
  // the fill fix alone settles it.
  { name: "real: Howie 402015-02 (cursor inside)", fires: false,
    bar: { state: "scheduled", dividerPct: 41.2, spans: [], owedH: 97.5 } },
  // Jason 402101-01 Wire — planned Sep 14 to Sep 16, untouched, 15.4h. Wholly
  // passed, so the cursor is off the end at ~346% and the bar goes entirely
  // grey. This is the case the badge exists for: without it the 15.4h it still
  // owes is nowhere on the schedule.
  { name: "real: Jason 402101-01 (wholly passed)", fires: false,
    bar: { state: "scheduled", dividerPct: 346, spans: [], owedH: 15.4 } },
  { name: "RED real: Jason with owed unreported", fires: true,
    bar: { state: "scheduled", dividerPct: 346, spans: [], owedH: 0 } },
];

// ── real rendered values, when someone can paste them ────────────────────────
//
// There is no credential, so nothing here can open the page. This is the path
// that lets real values reach the assertion anyway: run the snippet below in the
// browser console on the schedule, save what it copies, and pass it with
// `--dump <file>`. The same `violates` runs over it.
//
//   copy(JSON.stringify([...document.querySelectorAll("[data-state]")].map(el => ({
//     id:         el.getAttribute("data-bar-id") || el.className || "(bar)",
//     state:      el.getAttribute("data-state"),
//     dividerPct: parseFloat(el.getAttribute("data-divider-pct")),
//     workedPct:  parseFloat(el.getAttribute("data-worked-pct")),
//     spans:      JSON.parse(el.getAttribute("data-worked-spans") || "[]"),
//     ...(el.hasAttribute("data-owed-h") ? { owedH: parseFloat(el.getAttribute("data-owed-h")) } : {}),
//   }))))
//
// A dump that produced no bars is reported as a failure rather than as a clean
// run: an empty corpus passes every assertion ever written.
const dumpArg = process.argv.indexOf("--dump");
let dump = null;
if (dumpArg !== -1) {
  const { readFileSync } = await import("node:fs");
  dump = JSON.parse(readFileSync(process.argv[dumpArg + 1], "utf8"));
}

let failures = 0;
console.log("\nall-grey bars must carry a badge");
for (const c of cases) {
  const why = violates(c.bar);
  const fired = why !== null;
  const ok = fired === c.fires;
  if (!ok) failures++;
  const label = c.fires ? "should fire" : "should pass";
  console.log(`  ${ok ? "ok  " : "FAIL"} ${c.name.padEnd(38)} ${label}${ok ? "" : `  — got ${fired ? "fired" : "passed"}`}`);
  if (ok && fired) console.log(`         ${why}`);
}

// A guard that has only ever seen the good case is not evidence. If no RED case
// fires, the assertion has stopped discriminating and the greens mean nothing.
const reds = cases.filter(c => c.fires).length;
const redsFiring = cases.filter(c => c.fires && violates(c.bar) !== null).length;
if (redsFiring !== reds) {
  failures++;
  console.log(`\n  FAIL only ${redsFiring}/${reds} RED cases fired — the assertion is not discriminating`);
} else {
  console.log(`\n  ok   all ${reds} RED cases fire; the assertion discriminates`);
}

if (dump) {
  console.log(`\nreal dump — ${dump.length} bar(s)`);
  if (dump.length === 0) {
    failures++;
    console.log("  FAIL dump contains no bars — an empty corpus passes everything");
  }
  let grey = 0, bad = 0;
  for (const b of dump) {
    if (isAllGrey(b)) grey++;
    const why = violates(b);
    if (why) { bad++; failures++; console.log(`  FAIL ${b.id}  state=${b.state} divider=${b.dividerPct} owed=${b.owedH ?? "(absent)"}\n         ${why}`); }
  }
  console.log(`  ${bad === 0 ? "ok  " : "    "} ${grey} all-grey bar(s), ${bad} unlabelled`);
  // A corpus with no all-grey bars cannot demonstrate anything about all-grey
  // bars. Said out loud so a green run on the wrong week is not read as evidence.
  if (grey === 0) console.log("  note  no all-grey bars in this dump — the invariant was not exercised");
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
