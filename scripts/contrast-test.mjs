// Schedule-bar text contrast — measured, not asserted by name.
//
// This test computes REAL WCAG ratios against Matrix's REAL palette. "Did the renderer
// call the right helper" is checked too, at the bottom, but it is the backstop, not the
// test: the defect this covers (root cause 8, chunk A) was nine call sites each picking a
// plausible-looking colour against the wrong surface, and every one of them WAS calling a
// contrast helper. Only the number tells you whether the text can be read.
//
// Structured after scripts/worked-spans-test.mjs: the assertions are then shown to FAIL
// against the rule they replace, because a test that has only ever been green says nothing
// about whether it can discriminate.
//
//   node scripts/contrast-test.mjs
//
// THE PALETTE IS NOT THE BUILT-IN TEN. Matrix's panels carry generated hues, so a fix that
// tabulated swatches would be fiction. These 17 are every job colour on the live schedule
// (orgs/MTX2026TRAQS/tasks.json, 2026-10-01: ops that are assigned, dated and not history),
// with the bar count each one carries. They are a FIXTURE, deliberately: the test must run
// in CI with no S3 and no credentials. scripts/../docs note how to refresh them.

import { readFileSync } from "node:fs";
import {
  barInk, barInkRatio, barGrounds, twoToneRim, legibleBarColor, legibleOn, contrastRatio, overHex,
  accentText, barLabelColor, idleBarFill, workedFlatFill, hatchPhases, doneBarFill, barPaint,
  AA_TEXT, AA_NONTEXT, INK, PAPER,
} from "../src/barPaint.js";

let pass = 0, fail = 0;
const ok = (msg, cond) => { if (cond) { pass++; } else { fail++; console.error("FAIL  " + msg); } };
const r2 = v => Math.round(v * 100) / 100;

// 17 colours / 241 bars.
const MATRIX = [
  ["#e3368d", 81], ["#20b9e4", 56], ["#d334e8", 56], ["#e64e37", 9], ["#4ad2e7", 7],
  ["#c43ce6", 6], ["#4ada86", 5], ["#e148c5", 5], ["#26e086", 3], ["#cae737", 3],
  ["#2d7be7", 2], ["#dfbe39", 2], ["#e340d8", 2], ["#29e398", 1], ["#e99139", 1],
  ["#8240dd", 1], ["#4499e8", 1],
];
const TOTAL_BARS = MATRIX.reduce((s, [, n]) => s + n, 0);

// The three built-in ladders, plus the custom theme one Matrix account is actually on.
// Only the fields the paint helpers read.
const THEMES = [
  { key: "midnight", surface: "#202024", surfaceSolid: "#202024" },
  { key: "obsidian", surface: "#0d0d1a", surfaceSolid: "#0d0d1a" },
  { key: "frost",    surface: "#FBFAF7", surfaceSolid: "#FBFAF7" },
  { key: "custom(Matrix)", surface: "#f5f5f5", surfaceSolid: "#f5f5f5" },
];

// The states a bar is painted in, as activeBarFill is given them. Cursor and spans are the
// SAME numbers the fill is composed from — that is the whole rule, so the test uses them too.
const STATES = [
  { name: "untouched (cursor before the bar)", state: "scheduled", spans: [], cursorPct: -20 },
  { name: "cursor inside, nothing clocked",    state: "scheduled", spans: [], cursorPct: 45 },
  { name: "cursor inside, worked",             state: "worked",    spans: [[0, 40]], cursorPct: 60 },
  { name: "wholly elapsed, worked",            state: "worked",    spans: [[0, 100]], cursorPct: 100 },
  { name: "running",                           state: "running",   spans: [[0, 30]], cursorPct: 55 },
  { name: "held",                              state: "held",      spans: [[0, 30]], cursorPct: 55 },
  { name: "DONE",                              state: "done",      spans: [[0, 100]], cursorPct: 100 },
];
// No sub-16px case here on purpose: the renderer hides every label below 44px
// (_hideBarLabel), so the flat worked fill never carries text. It is checked below as a
// non-text ground, which is what it actually is.
// Where text sits. The title crosses; badges and icons are flush left; hours flush right.
const RUNS = [
  ["title (crosses)", "label"],
  ["badges / icons (left)", "left"],
  ["hours (right)", "right"],
];

// ── 1. Every bar, every theme, every state, every run ────────────────────────
let worst = { r: Infinity }, rimmed = 0, runs = 0, barsUnder = 0;
for (const T of THEMES) {
  for (const [raw, count] of MATRIX) {
    const bc = legibleBarColor(raw);            // the call sites paint this, not `raw`
    let barFails = false;
    for (const st of STATES) {
      for (const [label, side] of RUNS) {
        const g = barGrounds(T, bc, { ...st, side });
        const ratio = barInkRatio(g);
        runs++;
        if (ratio < AA_TEXT) { barFails = true; }
        if (ratio < worst.r) worst = { r: ratio, theme: T.key, bc, raw, state: st.name, label };
        // A run that cannot be carried by one tone gets the second one. The guarantee is
        // then that ONE of the two clears on every ground it crosses.
        const needsRim = ratio < AA_TEXT;
        if (needsRim) {
          rimmed++;
          const other = barInk(g) === PAPER ? INK : PAPER;
          const bothTones = g.every(gr => Math.max(contrastRatio(barInk(g), gr), contrastRatio(other, gr)) >= AA_TEXT);
          ok(`${T.key} ${raw} ${st.name} ${label}: two-tone glyph carries every ground it crosses`, bothTones);
          ok(`${T.key} ${raw} ${st.name} ${label}: rim is the opposite polarity`, twoToneRim(barInk(g)).includes(other));
        } else {
          ok(`${T.key} ${raw} ${st.name} ${label}: ${r2(ratio)}:1 >= ${AA_TEXT}`, ratio >= AA_TEXT);
        }
      }
    }
    if (barFails) barsUnder += count;
  }
}
console.log(`      ${runs} text runs measured across ${THEMES.length} themes x ${MATRIX.length} colours x ${STATES.length} states`);
console.log(`      worst single-tone ratio ${r2(worst.r)}:1 (${worst.theme}, ${worst.raw}, ${worst.state}, ${worst.label})`);
console.log(`      ${rimmed} runs need the second tone; they are the cursor-crossing ones`);

// ── 2. The fill floor: a colour that cannot carry its own label is stepped ────
// 3 of the 17 (#e3368d 4.40, #c43ce6 4.37, #2d7be7 4.33 — 89 of 241 bars) cannot reach AA
// with either polarity flat. The step is uniform, so the bar stays one colour.
for (const [raw] of MATRIX) {
  const stepped = legibleBarColor(raw);
  ok(`${raw}: flat fill carries its label after the legibility step (${r2(barInkRatio([stepped]))}:1)`,
    barInkRatio([stepped]) >= AA_TEXT);
  // and it must not wander: a colour that was already legible is untouched.
  if (barInkRatio([raw]) >= AA_TEXT) ok(`${raw}: already legible, left alone`, stepped === raw);
}
const steppedCount = MATRIX.filter(([c]) => legibleBarColor(c) !== c).length;
console.log(`      ${steppedCount} of ${MATRIX.length} colours needed the step`);

// ── 3. DONE bars: the fade is on the fill, not the element ───────────────────
// With `opacity: 0.7` on the element the glyph and its ground composite together and
// converge; nothing could clear 2.93:1. These assert the ceiling is gone.
for (const T of THEMES) for (const [raw] of MATRIX) {
  // THE ORDER THE APP USES: elColor steps the colour for legibility, THEN barPaint mutes it
  // toward DONE_MUTE, THEN the spent fill and the row fade. Asserting the reverse order would
  // be testing a pipeline nothing runs — the mute is what could undo the step, so it has to
  // come second here too.
  const bc = barPaint({ status: "Finished" }, legibleBarColor(raw));
  const g = barGrounds(T, bc, { state: "done", spans: [[0, 100]], cursorPct: 100, side: "label" });
  ok(`${T.key} ${raw} DONE: ${r2(barInkRatio(g))}:1 >= ${AA_TEXT}`, barInkRatio(g) >= AA_TEXT);
  // The old element fade, measured, for the record: both tones composited at 0.7.
  const faded = overHex(doneBarFill(T, bc, T.surfaceSolid), T.surfaceSolid, 0.7);
  const ceiling = Math.max(contrastRatio(overHex(INK, T.surfaceSolid, 0.7), faded), contrastRatio(overHex(PAPER, T.surfaceSolid, 0.7), faded));
  ok(`${T.key} ${raw} DONE: fading the ELEMENT would still cap below AA (${r2(ceiling)}:1)`, ceiling < AA_TEXT);
}

// ── 4. The non-text marks: lock border, grips, select ring and check ─────────
// 3:1 under WCAG 1.4.11. Today these are hard-coded white at 0.7 alpha, which measures
// 1.32-2.05 on every theme — the light/dark framing in the defect list understates it.
for (const T of THEMES) for (const [raw] of MATRIX) {
  const bc = legibleBarColor(raw);
  for (const [what, side, st] of [
    ["lock border / grip over the colour", "right", { state: "scheduled", spans: [], cursorPct: 45 }],
    ["lock border / grip over idle",       "left",  { state: "scheduled", spans: [], cursorPct: 45 }],
    ["select ring",                        "right", { state: "scheduled", spans: [], cursorPct: -20 }],
  ]) {
    const g = barGrounds(T, bc, { ...st, side });
    ok(`${T.key} ${raw} ${what}: ${r2(barInkRatio(g))}:1 >= ${AA_NONTEXT}`, barInkRatio(g) >= AA_NONTEXT);
  }
  // The select check sits on its own 25% white disc, which is itself over the bar.
  const disc = overHex(PAPER, idleBarFill(T, bc), 0.25);
  ok(`${T.key} ${raw} select check on its disc: ${r2(barInkRatio([disc]))}:1 >= ${AA_NONTEXT}`, barInkRatio([disc]) >= AA_NONTEXT);
  // A 3px grip is a different shape from a glyph: it can sit inside one hatch band, so it
  // is held to BOTH phases at full strength, and to the sub-floor fill a thin bar uses.
  const [lo, hi] = hatchPhases(T, bc);
  ok(`${T.key} ${raw} mark on the hatch, both phases: ${r2(barInkRatio([lo, hi]))}:1 >= ${AA_NONTEXT}`, barInkRatio([lo, hi]) >= AA_NONTEXT);
  ok(`${T.key} ${raw} mark on the sub-16px worked fill: ${r2(barInkRatio([workedFlatFill(T, bc)]))}:1 >= ${AA_NONTEXT}`,
    barInkRatio([workedFlatFill(T, bc)]) >= AA_NONTEXT);
}

// ── 5. The surfaces with their own fill: eng chip, split gantt, overdue pill ──
for (const chip of ["#10b981", "#3b82f6"]) {
  const c = legibleBarColor(chip);
  ok(`eng chip ${chip}: ${r2(barInkRatio([c]))}:1 >= ${AA_TEXT}`, barInkRatio([c]) >= AA_TEXT);
}
for (const T of THEMES) {
  // The split gantt used to paint barColor+"dd" over a row tinted barColor+"07", so its
  // ground was a composite that no colour choice could fix on the dark ladders (3.16 best).
  // It paints the legible colour at full opacity now, so the ground is the colour itself.
  for (const c of ["#94a3b8", "#a78bfa", "#3b82f6", "#f59e0b", "#10b981", "#e32400"]) {
    const g = legibleBarColor(c);
    ok(`${T.key} split gantt ${c}: ${r2(barInkRatio([g]))}:1 >= ${AA_TEXT}`, barInkRatio([g]) >= AA_TEXT);
  }
  // the overdue chip is a FILLED amber pill, not amber text on a tint (which measured
  // 2.53 on the dark ladders) — see the person-row render.
  ok(`${T.key} overdue chip: ${r2(barInkRatio(["#f59e0b"]))}:1 >= ${AA_TEXT}`, barInkRatio(["#f59e0b"]) >= AA_TEXT);
  // The header's "Overdue · N" button keeps its hue (it is a secondary button, not a filled
  // pill — one primary CTA per header), so the TEXT steps instead of the ground.
  const card = T.key === "frost" ? "#FFFFFF" : T.key === "midnight" ? "#27272C" : T.key === "obsidian" ? "#111120" : "#ffffff";
  ok(`${T.key} overdue button: ${r2(contrastRatio(legibleOn("#b45309", card), card))}:1 >= ${AA_TEXT}`,
    contrastRatio(legibleOn("#b45309", card), card) >= AA_TEXT);
  ok(`${T.key} overdue button: the hard-coded amber it replaces fails (${r2(contrastRatio("#b45309", card))}:1)`,
    T.key === "frost" || T.key === "custom(Matrix)" || contrastRatio("#b45309", card) < AA_TEXT);
}

// ── 6. DISCRIMINATION: the rule this replaces, measured, must fail ───────────
// If these ever pass, the test above has stopped being able to tell the difference.
let accentWrong = 0, accentWorst = Infinity, oldFails = 0;
for (const [raw, n] of MATRIX) {
  const measured = barInk([raw]);
  if (accentText(raw) !== measured) { accentWrong += n; }
  accentWorst = Math.min(accentWorst, contrastRatio(accentText(raw), raw));
  if (contrastRatio(accentText(raw), raw) < AA_TEXT) oldFails += n;
}
ok(`accentText picks the worse polarity on part of the live palette (${accentWrong}/${TOTAL_BARS} bars)`, accentWrong > 0);
ok(`accentText on a flat fill drops below AA (worst ${r2(accentWorst)}:1)`, accentWorst < AA_TEXT);
ok(`that is most of the schedule, not an edge case (${oldFails}/${TOTAL_BARS} bars)`, oldFails > TOTAL_BARS / 4);
// barLabelColor on a coloured ground — defect #93, the owner-on-the-clock bar.
let greyOnColour = Infinity;
for (const T of THEMES) for (const [raw] of MATRIX) greyOnColour = Math.min(greyOnColour, contrastRatio(barLabelColor(T, raw), raw));
ok(`grey-contrast text on a coloured ground fails (#93, worst ${r2(greyOnColour)}:1)`, greyOnColour < AA_TEXT);
// hours label alpha — defect #97. 0.85 white / 0.7 black composite toward their own ground.
let alphaWorst = Infinity;
for (const T of THEMES) for (const [raw] of MATRIX) {
  const g = idleBarFill(T, raw);
  const tint = accentText(raw) === PAPER ? overHex(PAPER, g, 0.85) : overHex("#000000", g, 0.7);
  alphaWorst = Math.min(alphaWorst, contrastRatio(tint, g));
}
ok(`alpha on bar text costs contrast it has not got (#97, worst ${r2(alphaWorst)}:1)`, alphaWorst < AA_TEXT);
// spent ground vs bar colour — defect #96.
let doneWorst = Infinity;
for (const T of THEMES) for (const [raw] of MATRIX) {
  const bc = barPaint({ status: "Finished" }, raw);
  doneWorst = Math.min(doneWorst, contrastRatio(accentText(bc), doneBarFill(T, bc, T.surfaceSolid)));
}
ok(`contrasting the bar colour instead of the spent fill fails (#96, worst ${r2(doneWorst)}:1)`, doneWorst < AA_TEXT);

// ── 7. Backstop: the renderers must not decide this for themselves ───────────
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
// renderTeam holds the week/month schedule AND the day view; renderAnalytics follows it.
const schedule = SRC.slice(SRC.indexOf("const renderTeam ="), SRC.indexOf("const renderAnalytics ="))
  // comments explain what the code no longer does, so they are not code
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const banned = [
  [/accentText\s*\(/, "accentText() in a schedule renderer — that helper is for brand-gradient buttons"],
  [/rgba\(255,\s*255,\s*255,\s*0\.[67]\)/, "hard-coded white at 0.6/0.7 (grips, lock border)"],
  [/`2px solid #fff`/, "hard-coded white select border"],
  [/stroke="#fff"/, "hard-coded white check"],
  [/color:\s*["']#fff["']/, "hard-coded white bar text"],
  [/'rgba\(255,255,255,0\.85\)'|"rgba\(255,255,255,0\.85\)"/, "alpha on bar text"],
  [/barFade\(/, "barFade() on a schedule bar — the fade belongs on the fill (doneBarFill)"],
];
for (const [re, why] of banned) ok(`schedule renderer: no ${why}`, !re.test(schedule));
ok("the schedule renderer asks barGrounds for its ground", /barGrounds\s*\(/.test(schedule));
ok("the schedule renderer takes its ink from barInk/barTextStyle", /barInk\s*\(|barTextStyle\s*\(/.test(schedule));
ok("job colours go through legibleBarColor before they are painted",
  /const barFillColor = c => legibleBarColor\(elColor\(c\)\);/.test(SRC));
ok("every bar the schedule builds uses it, so none can be painted raw",
  !/barPaint\((op|panel|sub), elColor\(/.test(SRC) && (SRC.match(/barPaint\((op|panel|sub), barFillColor\(/g) || []).length >= 3);
const splitGantt = SRC.slice(SRC.indexOf("const renderSplitGantt ="), SRC.indexOf("const renderAdmin ="))
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok("#128: the split gantt paints a legible bar and takes its ink from it", /legibleBarColor\s*\(/.test(splitGantt) && /barInk\s*\(/.test(splitGantt));
ok("#128: no hard-coded white on a split-gantt bar", !/color:\s*["']#fff["']|rgba\(255,\s*255,\s*255,\s*0\.\d+\)/.test(splitGantt));
ok("#113: the schedule grid steps by wantsLightText, not hexLum < 0.5",
  /_schedDk\s*=\s*wantsLightText\(/.test(SRC) && !/_schedDk\s*=\s*hexLum\([^)]*\)\s*<\s*0\.5/.test(SRC));
ok("#311: the overdue chip is count-only (the word lives in the title)", !/\{n\}\s*overdue/.test(SRC));
ok("#311: the chip takes its ink from the rule, not a hard-coded amber", !/color:\s*["']#b45309["']/.test(SRC));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
