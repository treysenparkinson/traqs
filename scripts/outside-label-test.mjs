#!/usr/bin/env node
// #116, RULED 2026-10-15. A BAR TOO NARROW FOR ITS NAME SHOWS IT OUTSIDE.
//
// Trey: "the label goes OUTSIDE the bar when it doesn't fit, on the right, with the bar's
// colour as text. A label clipped inside a bar tells you nothing; one outside is readable
// even on a sliver. If it would run off the canvas, flip it to the left of the bar."
//
// Before: only a LIVE bar got an outside label, in plain text colour; every other bar too
// narrow for its name showed none at all. Now every task bar whose name no segment draws
// gets one, in its own hue (stepped for contrast by legibleOn, which keeps the hue), on the
// right — or the left, when the right would run past the canvas.
//
//   node scripts/outside-label-test.mjs
import { readFileSync } from "node:fs";
import { outsideLabelOffset } from "../src/statsMath.js";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. WHERE IT GOES");
{
  // A 10px bar at 100px on a 1,000px canvas, a 60px name.
  ok("on the right of the bar, past a gap", outsideLabelOffset({ barLeftPx: 100, barPx: 10, textPx: 60, canvasPx: 1000 }),
    { side: "right", offsetPx: 16 });
  ok("...clear of whatever sits at the bar's corner (the live dot)",
    outsideLabelOffset({ barLeftPx: 100, barPx: 10, textPx: 60, canvasPx: 1000, rightLeadPx: 19 }), { side: "right", offsetPx: 25 });
  ok("flipped to the LEFT when the right would run off the canvas",
    outsideLabelOffset({ barLeftPx: 950, barPx: 10, textPx: 60, canvasPx: 1000 }), { side: "left", offsetPx: -66 });
  ok("...and kept on the right when it exactly fits",
    outsideLabelOffset({ barLeftPx: 924, barPx: 10, textPx: 60, canvasPx: 1000 }).side, "right");
  ok("an unmeasured name (0px) still goes right", outsideLabelOffset({ barLeftPx: 100, barPx: 10, textPx: 0, canvasPx: 1000 }).side, "right");
}

console.log("\n2. THE SCHEDULE DRAWS IT");
{
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("the old live-only label is gone", /-livelabel"/.test(CODE), false);
  const at = CODE.indexOf('key={barKey + "-outlabel"}');
  ok("there is one outside label per bar", at > 0 && CODE.indexOf('key={barKey + "-outlabel"}', at + 1) < 0, true);
  const block = CODE.slice(CODE.lastIndexOf("...(() => {", at), at + 600);
  ok("...shown when no segment draws the name, not only on a live bar", /if \(!\(_labelHomeless && _wFirst > 0\)\) return \[\];/.test(block), true);
  ok("...in the bar's own hue, stepped for contrast", /color: legibleOn\(bc, _schedSurf\)/.test(block), true);
  ok("...placed by outsideLabelOffset", /_outLabel\.offsetPx/.test(block), true);
  // Homeless: the head would carry it but is too narrow, or a tail would and is too narrow.
  ok("homeless means the segment that would carry it is under 44px",
    /const _labelHomeless = bar\.type === "task" && \(_labelSeg === 0 \? _hideBarLabel : _labelTailPx < 44\);/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
