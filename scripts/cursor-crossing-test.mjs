// #517. A LIVE CROSS-ROW BAR CROSSED THE CURSOR FOR ITS FIRST SIXTEEN MINUTES.
//
// Trey, testing: "I clocked into a job and the bar on my row renders starting AT
// the cursor and crossing slightly to the right." His rule: worked time
// populates to the LEFT and never crosses the cursor. A sliver left is fine.
//
// WHAT IT IS NOT. Not the cursor-anchored OWNER bar — the §3a path that
// produced #392, #389, #390, #69 and #70 — because he is not on that op's team
// (`2057-03 Cut`, team `["Brayden"]`). It is the CROSS-ROW record bar, a
// different construction for work done by somebody off the team.
//
// WHAT IT IS. The left edge is his clock-in and is correct. The right edge is
// measured from the cursor, which is also correct — and then floored:
//
//     flushRightWidthPct(_xNum, _nowGridPct, 0.03 / nDays * 100)
//
// Below ~16.2 minutes of session the floor EXCEEDS the true width, so
// `left + floor` lands past the cursor. The threshold is `0.03 × 9h` and is the
// same at every zoom.
//
// A SECOND FLOOR IN A SECOND UNIT: `minWidth: _wFirst > 0 ? 2 : 0` on the
// element. At week zoom the percentage floor is ~5px and dominates; at month
// zoom it is ~1.2px and the pixel floor does. Ruled: the pixel floor comes off
// for these bars — a floor that a percentage shift cannot neutralise is the
// same bug in a second unit, and a sub-pixel sliver is better than a bar that
// lies about which side of the line the work is on.
//
// THE FIX IS TO GROW LEFTWARD. The bar keeps its minimum width and its right
// edge stays ON the cursor; the width it gains comes off the left.
//
//   node scripts/cursor-crossing-test.mjs
import { readFileSync } from "node:fs";
import { flushRightBar } from "../src/statsMath.js";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));

console.log("\n1. THE RIGHT EDGE IS ON THE CURSOR, WHATEVER THE WIDTH");
{
  // The invariant, stated as one line: left + width === cursor, always.
  for (const [left, cursor, min] of [
    [10, 10.08, 0.429],   // 3 minutes in — the floor wins
    [10, 10.16, 0.429],   // 6 minutes
    [10, 10.43, 0.429],   // exactly at the threshold
    [10, 11.59, 0.429],   // an hour in — the floor is irrelevant
    [10, 10, 0.429],      // zero-width: clocked in this instant
  ]) {
    const r = flushRightBar(left, cursor, min);
    ok(`left ${left} cursor ${cursor}: right edge lands exactly on the cursor`,
      near(r.left + r.width, cursor), true);
  }
}

console.log("\n2. IT GROWS LEFTWARD, NEVER RIGHTWARD");
{
  const r = flushRightBar(10, 10.08, 0.429);
  ok("a 3-minute session is widened to the floor", near(r.width, 0.429), true);
  ok("...and the extra comes off the LEFT", near(r.left, 10.08 - 0.429), true);
  ok("...so the left edge moves back, not the right forward", r.left < 10, true);

  const s = flushRightBar(10, 11.59, 0.429);
  ok("an hour-old session keeps its own left edge", near(s.left, 10), true);
  ok("...and its true width", near(s.width, 1.59), true);
}

console.log("\n3. EDGES THAT MUST NOT DRAW A LIE");
{
  const z = flushRightBar(10, 10, 0.429);
  ok("a session clocked in this instant is still visible", near(z.width, 0.429), true);
  ok("...entirely to the left of the cursor", near(z.left + z.width, 10), true);
  // Clock skew, or a clock-in stamped slightly ahead. The bar must not flip.
  const neg = flushRightBar(10.5, 10, 0.429);
  ok("a left edge PAST the cursor is pulled back behind it", neg.left + neg.width <= 10 + 1e-9, true);
  ok("...and keeps a positive width", neg.width > 0, true);
  // No floor at all is a legitimate call: the caller decides visibility.
  const nf = flushRightBar(10, 10.08, 0);
  ok("with no floor it is simply the true width", near(nf.width, 0.08) && near(nf.left, 10), true);
  ok("junk in, no NaN out", Number.isFinite(flushRightBar(undefined, null, undefined).width), true);
}

console.log("\n4. SCOPED TO endsNow — ASSERTED, NOT ASSUMED");
{
  ok("the render uses flushRightBar for endsNow bars",
    /const _flush = bar\.endsNow\s*\n?\s*\? flushRightBar\(_xNum, _nowGridPct, 0\.03 \/ nDays \* 100\)/.test(CODE), true);
  ok("...and only for them", /: null;/.test(CODE.slice(CODE.indexOf("const _flush = bar.endsNow"), CODE.indexOf("const _flush = bar.endsNow") + 400)), true);
  ok("a bar that does not end now keeps its own left edge",
    /const _xDraw = _flush \? _flush\.left : _xNum;/.test(CODE), true);
  ok("...and its budget width", /const _wWanted = _flush \? _flush\.width : _wBudget;/.test(CODE), true);
  ok("the hatch boundary is measured from the DRAWN left edge",
    /const _headCursorPct = _wFirst > 0 \? \(\(_nowGridPct - _xDraw\) \/ _wFirst\) \* 100 : 0;/.test(CODE), true);
  ok("the old width-only helper is gone from the render",
    /flushRightWidthPct\(/.test(CODE), false);
}

console.log("\n5. THE PIXEL FLOOR COMES OFF FOR THESE BARS");
{
  // A floor in pixels cannot be neutralised by a shift in percent, so it is the
  // same defect in a second unit. Ruled off for endsNow bars; a sub-pixel
  // sliver is the correct outcome at month zoom.
  ok("minWidth is zero when the bar ends now",
    /minWidth: bar\.endsNow \? 0 : \(_wFirst > 0 \? 2 : 0\)/.test(CODE), true);
  ok("...and still 2px for every other bar",
    /_wFirst > 0 \? 2 : 0/.test(CODE), true);
}

console.log("\n6. THE REASON THIS IS SAFE — AND THE ASSERTION THAT KEEPS IT SAFE");
{
  // Moving the painted origin is what #389 was: the drag anchors on it (#25),
  // so a painted origin that disagrees with the data makes a drop compute to
  // the stored value and the commit a no-op. It is safe HERE only because a
  // cross-row bar refuses BOTH drag paths. If somebody later makes them
  // draggable, this must go red rather than reproducing #389 quietly.
  ok("the schedule blocks dragging a cross-row bar",
    // #102 dropped _isOverrunning from the block; the cross-row half this guards stays.
    /const _dragBlocked = !isPto && [^;]*\bbar\.crossRow\b[^;]*;/.test(CODE), true);
  const DM = readFileSync(new URL("../src/dragMove.js", import.meta.url), "utf8");
  ok("...and the shared landing refuses any record member",
    /if \(m\.isRecord\) return \{ kind: "record", id: m\.id, title: title\(m\) \};/.test(DM), true);
  ok("...with a refusal a person can read",
    /a record of work already done, so it can't be moved or resized/.test(DM), true);
  ok("the day view passes isRecord for a cross-row bar",
    /isRecord: !!bar\.crossRow/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
