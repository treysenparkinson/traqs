// The day view's hour grid, the overlay inside a bar, and the live badge.
//
// Day view chunk B. The day view was written against hard-coded hours while every other view
// moved onto the org calendar in root cause 6. On Matrix — 08:00-17:00, 60-minute lunch, two
// 15-minute breaks — the grid drew 05:00-21:00: 7 of 16 columns, 44%, were hours nobody
// works, and the 07:00-18:00 shading lit two more at the edges.
//
// The grid arithmetic is small enough to state directly, so it is stated here rather than
// inferred from the render. The wiring assertions at the end are what catch the version where
// the function is right and the render still holds its own copy of the numbers — which is
// exactly how this got four hard-coded copies in the first place.
//
//   node scripts/day-grid-test.mjs
import { buildDayWindows } from "../src/statsMath.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// The same derivation the component memoises, kept in step by the wiring assertions below.
const grid = (workStartH, workEndH, breaks, lunch) => {
  const cfg = buildDayWindows(workStartH, workEndH, breaks, lunch);
  const HS = Math.max(0, Math.floor(workStartH));
  const HE = Math.min(24, Math.max(HS + 1, Math.ceil(workEndH)));
  const hours = Array.from({ length: HE - HS }, (_, i) => HS + i);
  const dead = new Set();
  for (const w of (cfg.deadWindows || [])) {
    for (let h = Math.floor(w.start); h < Math.ceil(w.start + w.dur); h++) if (h >= HS && h < HE) dead.add(h);
  }
  return { HS, HE, NH: HE - HS, hours, dead: [...dead].sort((a, b) => a - b) };
};

const MATRIX_BREAKS = [{ durationMinutes: 15, time: "10:00" }, { durationMinutes: 15, time: "14:00" }];
const MATRIX_LUNCH = { durationMinutes: 60, time: "12:00" };

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. #7 — the grid is the working day");
{
  const g = grid(8, 17, MATRIX_BREAKS, MATRIX_LUNCH);
  ok("Matrix: 08:00-17:00, nine columns", [g.HS, g.HE, g.NH], [8, 17, 9]);
  ok("...and not one hour outside the working day", [g.hours[0], g.hours.at(-1)], [8, 16]);
  // The old grid drew 05:00-21:00 = 16 columns, of which 7 were unworked.
  ok("...where the old grid drew 16 columns, 7 of them unworked", 16 - g.NH, 7);
}
{
  const g = grid(7, 15, [], { durationMinutes: 30, time: "11:30" });
  ok("a 07:00-15:00 shop gets its own eight columns", [g.HS, g.HE, g.NH], [7, 15, 8]);
}
{
  // Half-hour boundaries: columns are whole hours, so the grid covers the hours the day
  // touches rather than clipping the first and last.
  const g = grid(8.5, 16.5, [], { durationMinutes: 0 });
  ok("a 08:30-16:30 day still shows the hours it touches", [g.HS, g.HE], [8, 17]);
}
{
  const g = grid(9, 9, [], { durationMinutes: 0 });
  ok("a degenerate day still yields one column rather than none", g.NH, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. #7 — shading marks the dead windows, not an invented 07:00-18:00");
{
  const g = grid(8, 17, MATRIX_BREAKS, MATRIX_LUNCH);
  ok("Matrix: the 10:00 break, the noon lunch and the 14:00 break", g.dead, [10, 12, 14]);
  ok("...and a working hour is not shaded", g.dead.includes(9), false);
  // The old test was `h < 7 || h >= 18`, which inside an 08:00-17:00 grid shades NOTHING —
  // so every column looked like work, lunch included.
  ok("...where the old rule would have shaded nothing at all",
    g.hours.filter(h => h < 7 || h >= 18).length, 0);
}
{
  const g = grid(8, 17, [], { durationMinutes: 0 });
  ok("no lunch and no breaks means nothing is shaded", g.dead, []);
}
{
  // A lunch that straddles two columns marks both — a bar drawn over either is partly idle.
  const g = grid(8, 17, [], { durationMinutes: 90, time: "11:30" });
  ok("a lunch spanning two columns marks both", g.dead, [11, 12]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. #13 — the overlay is measured from the bar, not from the day");
// The overlay sits INSIDE the bar, so its percentages are relative to the bar's own span.
// Measured from the org work start, every marker was shifted left by (rawS - wsH).
const marker = (rawS, rawE, mkH, durMin) => {
  const totalM = (rawE - rawS) * 60;
  if (totalM <= 0) return null;
  if (mkH >= rawE || mkH + durMin / 60 <= rawS) return null;
  return { startPct: ((mkH - rawS) * 60 / totalM) * 100, wPct: (durMin / totalM) * 100 };
};
{
  // A bar 10:00-14:00 with lunch at 12:00: the marker belongs halfway along it.
  const m = marker(10, 14, 12, 60);
  ok("lunch at noon on a 10:00-14:00 bar sits halfway", Math.round(m.startPct), 50);
  ok("...and is a quarter of its width", Math.round(m.wPct), 25);
  // The old arithmetic, anchored at an 08:00 work start.
  const oldStart = ((12 - 8) * 60 / ((14 - 8) * 60)) * 100;
  ok("...where the old anchor put it at 67%, two hours early", Math.round(oldStart), 67);
}
{
  const m = marker(8, 17, 12, 60);
  ok("a bar starting at the work start is unaffected — the old bug was invisible there",
    Math.round(m.startPct), Math.round(((12 - 8) * 60 / ((17 - 8) * 60)) * 100));
}
{
  ok("a break entirely before the bar is dropped", marker(13, 17, 10, 15), null);
  ok("a break entirely after the bar is dropped", marker(8, 11, 12, 60), null);
  ok("a break overlapping the bar's start is kept", marker(12.25, 16, 12, 60) !== null, true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. The render uses all of it");
{
  const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // CODE only, for the "no longer present" checks. Every one of these fixes carries a comment
  // QUOTING the thing it replaced — `HS = 5, HE = 21`, `h<7||h>=18`, the lunch literal, the
  // reservoirOpId key — because a reader who meets the new code deserves to know what it is
  // not. Searching the raw source therefore found the old form in the explanation of why it
  // went, and four assertions failed on text that is supposed to be there. The same trap
  // caught the basicLanes comment last chunk; dead-code-test has stripped comments for this
  // reason since root cause 9.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const has = (re) => re.test(CODE);
  ok("the grid is derived once, from the org hours", has(/const dayGrid = useMemo\(\(\) => \{/), true);
  ok("...and the day render destructures it", has(/const \{ HS, HE, NH, hours, dead: deadHours \} = dayGrid;/), true);
  ok("...and so does the drag handler, instead of its own copy",
    has(/const \{ HS: DHS, HE: DHE, NH: DNH \} = dayGrid;/), true);
  // All four hard-coded copies.
  ok("no 5/21 grid constants survive", !has(/HS = 5, HE = 21/) && !has(/DHS = 5, DHE = 21/), true);
  ok("no 07:00-18:00 shading test survives", !has(/h<7\|\|h>=18/) && !has(/h < 7 \|\| h >= 18/), true);
  // #14
  ok("a PTO day still draws its bars", !has(/\{!pOff && barPositions\.map/), true);
  // #13
  ok("the overlay measures from the bar", has(/const totalM = \(rawE - rawS\) \* 60;/), true);
  ok("...and no longer from the org work start", !has(/const totalM = \(rawE - wsH\) \* 60;/), true);
  // #12
  // #12, scoped to the OVERLAY. A loose search found the same literal in five other places —
  // the orgSettings bootstrap (x3) and the Time Settings inputs (x2). Those are the same
  // class and are logged as #331 rather than swept in here: the ruling was the overlay, and
  // quietly widening it would put a settings-defaults change in a day-view paint commit.
  {
    const overlay = CODE.slice(CODE.indexOf("const lnch ="), CODE.indexOf("const lnch =") + 400);
    ok("the overlay uses the shared lunch default", /orgSettings\.lunch \|\| DEFAULT_ORG_SETTINGS\.lunch/.test(overlay), true);
    ok("...and holds no literal of its own", !/\{ time: "12:00", durationMinutes: 30 \}/.test(overlay), true);
  }
  // #15, scoped to liveBadgeFor. reservoirOpId is still CORRECT in shrunkStartH — the
  // shrinking bar IS the reservoir op — so a file-wide search here would be asserting that a
  // right answer elsewhere is wrong.
  {
    const fn = CODE.slice(CODE.indexOf("const liveBadgeFor ="), CODE.indexOf("const liveBadgeFor =") + 300);
    ok("the live badge keys on the clocked op", /sameId\(jc\.opId, op\.id\)/.test(fn), true);
    ok("...not on the reservoir op", !/reservoirOpId/.test(fn), true);
    ok("...while shrunkStartH still keys on the reservoir op, which is right there",
      /sameId\(jc\.reservoirOpId, op\.id\)/.test(CODE.slice(CODE.indexOf("const shrunkStartH ="), CODE.indexOf("const shrunkStartH =") + 400)), true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. the Overdue tray is removed (2026-10-03), and its day-view drop with it");
{
  const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  ok("no overdue drag type is published or read", /x-traqs-overdue/.test(CODE), false);
  ok("no handleOverdueDrop", /handleOverdueDrop/.test(CODE), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
