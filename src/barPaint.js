// Bar paint and text contrast -- the one place a schedule bar's fill is composed and
// the one place the colour of text ON that fill is decided.
//
// Lifted out of TRAQS.jsx so it can be TESTED. The rule these helpers implement is
// not expressible as "was the right function called": it is a measured ratio against
// a composited ground, so the test has to compute real numbers against real palette
// colours. A 32,000-line React file cannot be imported by a node script; this can.
//
// Everything here is pure: colours in, colours out, no DOM, no React, no module state.

import { complementSpans } from "./statsMath.js";


function hexLum(hex) {
  const r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const l=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
  return 0.2126*l(r)+0.7152*l(g)+0.0722*l(b);
}
function blendHex(hex, f) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const t=f>0?255:0, a=Math.abs(f), c=v=>Math.min(255,Math.max(0,Math.round(v+(t-v)*a))).toString(16).padStart(2,"0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
// blendHex only moves a colour toward white or black. mixHex blends two actual
// colours, which is what estimating a composited backdrop needs (a liquid wash is
// its colour laid over the page colour, not a lightened version of either).
function mixHex(a, b, t = 0.5) {
  try {
    const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    const c = i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0");
    return `#${c(0)}${c(1)}${c(2)}`;
  } catch { return a; }
}
// THE rule for "black text or white text on this?". One function, because it was
// split three ways: surface and system chrome asked hexLum (gamma-corrected sRGB
// relative luminance) at < 0.5, while the page background asked isLight
// (0.299/0.587/0.114, no gamma) at > 0.5. Those disagree across a wide mid-tone
// band, so the SAME colour got white text as a card and black text as a page
// background — and both thresholds were wrong anyway.
//
// 0.1791 is not a taste value, it is where the two options are equally readable.
// WCAG contrast is (Ll + 0.05) / (Ld + 0.05); setting contrast-against-white equal
// to contrast-against-black gives (L + 0.05)^2 = 1.05 * 0.05, so L = sqrt(0.0525)
// - 0.05 = 0.1791. Below it white wins, above it black wins, and it agrees with the
// measured better-contrast choice on every colour in the app's palettes.
//
// The old 0.5 was far too high: everything from L=0.179 to L=0.5 — mid greys, the
// blue accent, most saturated mid-tones — was called "dark" and handed white text
// when black was the more readable choice.
const TEXT_POLARITY_L = 0.1791;
function wantsLightText(hex) {
  try { return hexLum(hex) < TEXT_POLARITY_L; } catch { return true; }
}

function hexA(hex, a) {
  try { const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,a))})`; }
  catch { return hex; }
}

// isLight() removed. It was the second, contradictory answer to the question
// wantsLightText() now owns, and leaving it in the file invites the split to come
// back. Anything asking "is this light or dark?" for TEXT purposes must use
// wantsLightText so every surface resolves the same way.
// Text on an accent fill. Every primary button paints brandGrad(accent), which ends
// ACCENT_FILL_DARKEST darker than the accent itself, so the decision has to be made
// against that darkest stop and not against the flat colour. Judging the flat colour
// puts black text on any accent sitting just above the crossover — #3b82f6 at
// L=0.234 reads "black" flat, but its gradient bottoms out at L=0.137, which is
// firmly white territory. That is the black-text-on-a-dark-button case.
//
// This is what the old hexLum > 0.35 threshold was doing by accident: an accent
// needs roughly L>0.31 for its darkened end to clear the 0.179 crossover. Same
// compensation, derived rather than guessed, and it reuses the one crossover so a
// colour still resolves consistently everywhere.
const ACCENT_FILL_DARKEST = -0.22; // keep in step with brandGrad's second stop
function accentText(accent) {
  try { return wantsLightText(blendHex(accent, ACCENT_FILL_DARKEST)) ? "#ffffff" : "#0f172a"; }
  catch { return "#ffffff"; }
}

// Completed work stays on the schedule (see showCompleted) but reads as done: the job's
// OWN colour, muted. Deliberately not replaced with a flat grey — this returned T.textDim,
// which threw the job colour away entirely and, being a near-white/mid-grey token, painted
// bars that read as dead slabs rather than as the job you recognise.
//
// mixHex toward a neutral keeps the hue identifiable while draining the saturation, and it
// returns a HEX, which matters: the segment renderer builds `${colour}bb` alpha suffixes,
// so an rgba() here (hexA) would produce invalid CSS. Falls through unchanged for any
// non-hex colour rather than feeding it to a hex parser.
//
// Module-level because the board paints finished work from two separate sources — the
// `bars` array the day/month views build, and the raw task tree the expanded subtask
// segments read — and one rule beats muting each renderer by hand.
//
// COLOUR ONLY, deliberately. Nothing here touches hit-testing or pointer-events, so a
// finished bar still opens details, still right-clicks for Reopen / Set Worked Hours, and
// still drags. accentText() picks the label colour from this, so text stays readable.
// Two signals stack for "finished": the colour desaturates, and the bar goes 30%
// transparent so the grid reads through it. The mute is lighter than it was (0.62 -> 0.34)
// now that transparency carries part of the job — at 0.62 plus a 30% fade the bars washed
// out to near-illegible, and the hue is what makes a bar recognisable as its job.
const DONE_MUTE = "#8c8c94";
const barPaint = (item, color) =>
  (item && item.status === "Finished" && typeof color === "string" && color.startsWith("#"))
    ? mixHex(color, DONE_MUTE, 0.34)
    : color;
// Multiplied INTO each renderer's existing opacity rather than assigned over it: those
// expressions already carry drag ghosting and the hover dim (0.2 for other people's rows),
// and overwriting them would strand a finished bar at full opacity mid-drag.
const DONE_FADE = 0.7;
const barFade = (item) => (item && item.status === "Finished" ? DONE_FADE : 1);

// The "spent" fill, shared by a drained reservoir and a stopped live bar. Replaces a
// flat-black hatch (rgba(0,0,0,0.28)/0.14) that read as grime on every light ladder
// rather than as an emptied block. Opaque, so it REPLACES the fill it covers instead
// of muddying it, and mixed toward the row surface so it lands the same way on all
// four theme ladders instead of only on the dark ones.
// How far a spent fill is mixed toward the row surface. Asks the SURFACE being mixed
// toward, not T.colorScheme: on a custom theme colorScheme tracks the PAGE background
// (dk = hexLum(bg) < 0.18) while these fills mix toward the surface, and the two can
// land on opposite sides of the divide -- the theme builder keeps a separate surfDk
// for exactly this reason. One function so the ratio cannot drift between the fill
// and the text that has to contrast it.
// A finished bar is muted toward DONE_MUTE -- the same grey barPaint already uses for Finished
// work -- rather than washed toward the page surface.
//
// The surface mix it replaces sat 72-80% of the way to the background, which left a DONE bar
// technically present and visually absent. Grey at 0.8 keeps a trace of the bar's own hue so a
// row of finished ops still reads as distinct jobs, while sitting clearly apart from the row
// behind it in both light and dark themes.
//
// Flat, no pattern: see WORKED_STRIPE above for why the hatch is gone.
const SPENT_MUTE_RATIO = 0.8;
function spentBarFill(T, barColor) {
  return mixHex(barColor, DONE_MUTE, SPENT_MUTE_RATIO);
}

// A FINISHED bar's fill: the spent grey, carrying the 30% of the row that `opacity: 0.7`
// used to put there. The fade moved off the element and into the fill because an element
// opacity composites the TEXT with its ground, and two colours composited at the same
// alpha over the same backdrop converge: measured across the live palette, a DONE label
// could not clear 2.93:1 on ANY theme with ANY colour while the element was faded, and
// every DONE bar on the schedule was under AA for that reason alone. Fading the fill and
// leaving the glyph opaque puts the same bars at 5.0-7.7:1 and looks identical.
//
// The row colour is what the bar sits on, so the result is what the eye actually got
// before -- this is not a lighter DONE bar, it is the same pixels with the text pulled out
// of the composite.
function doneBarFill(T, barColor, rowColor) {
  const row = rowColor || T?.surfaceSolid || T?.surface || "#202024";
  return mixHex(spentBarFill(T, barColor), row, 1 - DONE_FADE);
}

// The grey both in-progress regions sit on. A step AWAY from the row surface, not a mix
// toward it: mixing toward the surface is what left a DONE bar "technically present and
// visually absent", and idle is the region most exposed to that failure because low
// presence is exactly what it conveys. So it carries two bounds, not one -- far enough
// from the row to still read as a bar, far enough from DONE to separate from it.
//
// Step direction asks the SURFACE, never T.colorScheme, for the reason given above
// spentBarFill: on a custom theme colorScheme tracks the PAGE while these fills sit on the
// row, and the two can land on opposite sides of the divide. Same idiom as the theme's own
// border tokens, blendHex(surf, surfDk ? +x : -x).
//
// "Lighter, closer to background" in the palette ruling means PRESENCE, not luminance --
// read literally it inverts on the two dark ladders, where nearer the row means darker.
// Stepping away from the surface gives the intended ordering on all four.
//
// Measured, in CIE L* across the ten job colours and all four ladders: idle-to-row 13.1
// at worst (frost), idle-to-DONE 19.8 at worst (custom). Both clear of the ~10 where a
// boundary stops being comfortable.
const IDLE_STEP_DK = 0.20, IDLE_STEP_LT = -0.13;
// Idle keeps a smaller hue trace than DONE's 0.2, so in-progress ops still read as distinct
// jobs while idle stays the most recessive of the three greys.
const IDLE_HUE_TRACE = 0.88;
function idleBarFill(T, barColor) {
  const surfDk = wantsLightText(T.surface);
  return mixHex(barColor, blendHex(T.surface, surfDk ? IDLE_STEP_DK : IDLE_STEP_LT), IDLE_HUE_TRACE);
}

// The worked hatch. 45deg, and that is the point: every other hatch in this file is 135deg
// -- the off-day row wash, the in-bar PTO fill, the tail's, the purple overlay. The opposite
// diagonal separates worked from ALL of them rather than only from the PTO fill beside it,
// and a worked bar next to a PTO bar now visibly cross-hatches instead of merging.
//
// Angle rather than period is the knob because period differentiation is weakest exactly
// where bars are densest: between the texture floor and ~24px only two or three stripes
// render, and at that density 4/8 against PTO's 6/12 is indistinguishable while a direction
// flip is instant.
//
// The stripe is the bar's own colour STEPPED IN VALUE, not the raw colour. Raw was the
// obvious reading of "tinted at low alpha" and it fails: idle already carries 12% of the
// same hue, so a same-hue stripe over it is a hue match with only a small luminance shift,
// and on the mid-value job colours the hatch all but vanished -- 2.8 L* at its worst. The
// value step makes the delta independent of hue: 10.5 L* at worst, 16.6 at best, tight
// across all four ladders, at the lowest alpha that clears 10 everywhere. Tinted, never the
// flat black that read as grime and got the original WORKED_STRIPE retired.
const HATCH_BAND = 4, HATCH_PERIOD = 8, HATCH_STEP = 0.40, HATCH_ALPHA = 0.30;
// Below this the stripes cannot resolve -- two of them at 16px, one at 8 -- so texture stops
// carrying worked-vs-idle and a value step takes over. Reuses the existing _thinBar
// threshold rather than inventing one.
const HATCH_MIN_PX = 16;
function workedHatchLayer(T, barColor) {
  const surfDk = wantsLightText(T.surface);
  const s = hexA(blendHex(barColor, surfDk ? HATCH_STEP : -HATCH_STEP), HATCH_ALPHA);
  return `repeating-linear-gradient(45deg, ${s}, ${s} ${HATCH_BAND}px, transparent ${HATCH_BAND}px, transparent ${HATCH_PERIOD}px)`;
}
// The sub-floor stand-in for the stripes. Stepped harder than the hatch is (11.1 L* at
// worst): the region is only a few pixels tall there, so it needs more separation than a
// full-height bar, not less.
const SUBFLOOR_STEP_DK = 0.22, SUBFLOOR_STEP_LT = -0.15;
function workedFlatFill(T, barColor) {
  return blendHex(idleBarFill(T, barColor), wantsLightText(T.surface) ? SUBFLOOR_STEP_DK : SUBFLOOR_STEP_LT);
}

// The one place a schedule bar's fill is composed. Call sites pass the three-region geometry --
// `spans`, WHERE the work happened as [startPct, endPct] pairs across this bar, and dividerPct --
// the CURSOR, a time position, UNCLAMPED so now past the planned end reads past 100 rather than
// pinning. Never pass an hours RATIO as either: a ratio says how much and these say when, and
// they diverge on any late start. The visuals lane owns what these become; this lane owns the
// call sites and the numbers.
//
// `state` is the bar's own state, never a texture: "pto" | "done" | "held" | "paused" |
// "running" | "worked" | "scheduled". Texture is a decision made FROM it -- DONE is never
// inferred back out of a fill, which is what let a DONE bar and a worked bar read the same
// once before. "worked" is clocked-out-but-hatched; "scheduled" is genuinely untouched.
//
// Composed as layered backgrounds on ONE property rather than as child divs. The four
// absolutely-positioned WORKED_STRIPE overlays this replaces are what drew stripes through
// the DONE badge from the bar's left edge at zIndex 2 -- the bug that took three sessions to
// find. A background layer cannot escape its own box, so that class of defect goes away with
// the technique instead of being fixed again.
//
// Layer order is paint order, first on top:
//   1  opaque right of the cursor  -> the unworked remainder, hiding everything beneath
//   2  opaque over the GAPS        -> flat idle grey, wherever no work was clocked
//   3  the hatch, or its value-step stand-in below the texture floor
//   4  the idle grey as the base colour
// Layer 2 is the complement of the spans rather than one boundary, which is what lets idle
// appear to the LEFT of the hatch (work that started late) and BETWEEN two hatches (work done
// in two sittings). Both are ordinary and neither is expressible with a single worked front.
function activeBarFill(T, barColor, spans, dividerPct, state, renderPx, rowColor) {
  if (state === "pto") return `repeating-linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.22) 6px, transparent 6px, transparent 12px), ${barColor}`;
  if (state === "done") return doneBarFill(T, barColor, rowColor);
  // "worked" is the clocked-out case -- nobody on the clock, hatched extent locked, cursor
  // still advancing and opening idle behind it (§3a, §3d) -- so it renders exactly as the live
  // states do; what differs is whether the worked front is still moving, and that is the
  // caller's number, not a texture.
  //
  // There is no state guard here any more. "scheduled" used to return a plain colour block,
  // written when the tail call site was handed the WHOLE bar's percentages while covering a
  // different span, so regions drawn from them would have put both boundaries in the wrong
  // place. The tail takes per-segment spans and its own cursor now, so that reason expired --
  // but the guard stayed, and it was the cause of coloured unworked bars sitting LEFT of the
  // cursor against §1. It short-circuited before the cursor was ever read, so no amount of
  // correct geometry could have fixed it from the other side.
  //
  // The three cases fall out of logic already below rather than needing branches:
  //   future untouched  cursor is NEGATIVE, C clamps to 0, the empty-and-C<=0 return fires
  //                     -> plain colour, which is right: nothing has elapsed yet
  //   straddling        idle left of the cursor, colour beyond it
  //   wholly past       C clamps to 100, the colour layer is skipped, complement covers all
  //                     -> all idle, the true statement about untouched elapsed time
  // Region-capable is the safer default for any state added later, too: this defect was an
  // over-exclusion, and a state that genuinely carries no regions has no spans and no cursor
  // inside it, which the return below already handles.

  // Clamped for PAINT only. dividerPct arrives unclamped so past-100 can carry the overrun
  // signal, but a gradient stop outside the box renders as a plausible fully-worked bar
  // rather than as something visibly wrong. The raw value stays on the data attribute, where
  // the overrun is still readable and still assertable.
  const C = Math.max(0, Math.min(100, Number.isFinite(dividerPct) ? dividerPct : 0));
  const worked = (spans || []).filter(s => Array.isArray(s) && s[1] > s[0]);
  if (worked.length === 0 && C <= 0) return barColor;

  const idle = idleBarFill(T, barColor);
  // A run of hard stops: one colour from a% to b%, then the next. Two stops per boundary is
  // what makes the edge a line rather than a fade.
  const banded = (ranges, colour) =>
    `linear-gradient(to right, ${ranges.map(([a, b]) => `transparent ${a}%, ${colour} ${a}%, ${colour} ${b}%, transparent ${b}%`).join(", ")})`;

  const layers = [];
  // 1 — the unworked remainder, opaque, hiding everything beneath it.
  if (C < 100) layers.push(`linear-gradient(to right, transparent 0%, transparent ${C}%, ${barColor} ${C}%, ${barColor} 100%)`);
  // 2 — flat idle over every interval that was NOT worked. This is the complement rather than
  // a single boundary, which is the whole difference between the two readings: work that
  // started late leaves idle to its LEFT, and a bar worked in two sittings has idle between
  // them. A lone worked-front cannot express either.
  const gaps = complementSpans(worked, 0, 100);
  if (gaps.length) layers.push(banded(gaps, idle));
  // 3 — the worked record itself. Below the texture floor stripes stop resolving, so the
  // value step stands in; above it the hatch is drawn full width and layer 2 cuts it back to
  // the spans, which is cheaper than clipping a repeating gradient per interval.
  if (worked.length) {
    if (renderPx < HATCH_MIN_PX) layers.push(banded(worked, workedFlatFill(T, barColor)));
    else layers.push(workedHatchLayer(T, barColor));
  }
  // 4 — idle as the base, so any sliver left by rounding is grey rather than bar colour.
  layers.push(idle);
  return layers.join(", ");
}

// Badge and label colour for a bar carrying regions. They are flexStart, so they sit at the
// bar's LEFT -- which under the three-region model is grey ground, not the op colour that
// accentText(bc) contrasts. Kept separate from liveBarTextColor because that helper is also
// what the DONE badge calls, passing the literal "held" to reach its spent-contrast branch;
// overloading the same state strings would have handed DONE the wrong ground.
function barLabelColor(T, barColor) {
  return accentText(idleBarFill(T, barColor));
}


// Text on a spent fill contrasts the SPENT colour, not the bar's original one -- the two can
// land on opposite sides of the light/dark crossover. Derived from spentBarFill rather than
// restated, so the fill and the text sitting on it cannot drift apart.
function liveBarTextColor(T, barColor, state = "running") {
  if (state === "running") return accentText(barColor);
  return accentText(spentBarFill(T, barColor));
}


// ─────────────────────────────────────────────────────────────────────────────
// THE CONTRAST RULE
// ─────────────────────────────────────────────────────────────────────────────
// Three parts, and all three are load-bearing:
//
//   1 GROUND, NOT BAR.  Text contrasts the composited pixels under its OWN run.
//     A bar's fill is a layer stack (activeBarFill above), so one bar presents up
//     to six different grounds across its width. Which ones a label sits on comes
//     from the SAME spans + cursor the fill was composed from -- never re-derived
//     from a different cursor, and never "the bar's colour".
//
//   2 POLARITY BY MEASUREMENT, NOT BY THRESHOLD.  Compute both ratios against the
//     real ground and take the winner. accentText() must NOT be used on bars: it
//     judges blendHex(c, -0.22), the darkest stop of a brand gradient that bars do
//     not paint. That compensation is right for a CTA and wrong for a flat fill --
//     measured on the live Matrix palette it picks the WORSE polarity on 8 of 17
//     job colours, 162 of 241 bars, bottoming out at 3.01:1 where ink scores 5.92.
//
//   3 GUARANTEE, NOT HOPE.  If the winning polarity still cannot reach AA, the
//     GROUND moves, not the text (legibleBarColor), and where a run genuinely
//     crosses grounds that disagree, the glyph carries both polarities (twoToneRim).
//
// Thresholds are WCAG 2.2: 4.5:1 for the 9-11px text on a bar, 3:1 for the marks
// that are not text (lock border, grips, select ring, check).
export const AA_TEXT = 4.5;
export const AA_NONTEXT = 3;
export const INK = "#0f172a";
export const PAPER = "#ffffff";

// sRGB compositing, the same arithmetic the compositor does: fg at alpha a over bg.
// Used wherever a colour is painted translucent -- a tinted pill, a 0.25 scrim, the
// hatch stripe over idle -- because the ratio has to be measured against what is
// actually on screen, not against the colour that was asked for.
function overHex(fg, bg, a) {
  try {
    const f = [1, 3, 5].map(i => parseInt(fg.slice(i, i + 2), 16));
    const b = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16));
    return "#" + f.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
  } catch { return fg; }
}
// WCAG 2.2 contrast ratio. hexLum is already the gamma-corrected relative luminance.
function contrastRatio(a, b) {
  const l1 = hexLum(a), l2 = hexLum(b);
  return l1 > l2 ? (l1 + 0.05) / (l2 + 0.05) : (l2 + 0.05) / (l1 + 0.05);
}
// The worst ratio `ink` achieves across every ground the run crosses.
const worstOn = (ink, grounds) => Math.min(...grounds.map(g => contrastRatio(ink, g)));

// THE polarity decision. Ink or paper, whichever reads better on the WORST ground the
// run crosses. No threshold constant: the crossover is only ever an approximation of
// this, and every approximation of it so far has been wrong somewhere in the palette.
export function barInk(grounds) {
  const gs = (Array.isArray(grounds) ? grounds : [grounds]).filter(g => typeof g === "string" && g[0] === "#");
  if (!gs.length) return PAPER;
  return worstOn(INK, gs) >= worstOn(PAPER, gs) ? INK : PAPER;
}
// What that choice actually scores. Call sites use it to decide whether the glyph
// needs its second tone; the test uses it to assert the floor.
export function barInkRatio(grounds) {
  const gs = (Array.isArray(grounds) ? grounds : [grounds]).filter(g => typeof g === "string" && g[0] === "#");
  if (!gs.length) return 0;
  return worstOn(barInk(gs), gs);
}

// The hatch is not one colour and it is not two either, as far as a glyph is concerned.
// Returns [between-stripes, on-a-stripe, what a glyph actually gets].
//
// The bands are 4px on, 4px off at 45deg -- 2.83px measured perpendicular. An 11px label's
// stem is ~1.3px wide and ~8px tall, so it crosses three or four bands on its way down: it
// can sit inside one for a couple of pixels, never for its whole length. Judging text
// against the full-strength stripe therefore condemns grounds no glyph ever sees whole, and
// judging it against the gap alone is optimistic. The third value is the area mean -- the
// stripe at half its alpha, because it covers half the surface -- and that is the ground the
// text rule uses. The two phases stay exported because a 3px grip is a different shape and
// the non-text marks are checked against both.
export function hatchPhases(T, barColor) {
  const idle = idleBarFill(T, barColor);
  const stripe = blendHex(barColor, wantsLightText(T.surface) ? HATCH_STEP : -HATCH_STEP);
  return [idle, overHex(stripe, idle, HATCH_ALPHA), overHex(stripe, idle, HATCH_ALPHA / 2)];
}

// EVERY GROUND A BAR PRESENTS, derived from the same arguments activeBarFill is given.
// `side` says which part of the bar the run covers:
//   "left"  badges, icons, and the start of the title  -- the elapsed end
//   "right" the hours label, flush right               -- the unworked remainder
//   "label" the title, which is flex:1 and CROSSES     -- everything in between
// Returns the composited colours, not layer descriptions: a hatch is two phases (on a
// stripe and between stripes) and both are returned, because a 1px glyph stem can land
// wholly on either.
export function barGrounds(T, barColor, { state, spans = [], cursorPct = 0, renderPx = 999, side = "label", rowColor = null } = {}) {
  const row = rowColor || T?.surfaceSolid || T?.surface || "#202024";
  if (state === "pto") return [barColor, overHex(PAPER, barColor, 0.22)];
  // DONE no longer fades the ELEMENT (see barFade), so the text sits on the faded fill
  // at full opacity and the ground is that fill -- one colour, no compositing of the
  // glyph itself.
  if (state === "done") return [doneBarFill(T, barColor, row)];

  const C = Math.max(0, Math.min(100, Number.isFinite(cursorPct) ? cursorPct : 0));
  const worked = (spans || []).filter(s => Array.isArray(s) && s[1] > s[0]);
  if (!worked.length && C <= 0) return [barColor];          // untouched: one ground

  const idle = idleBarFill(T, barColor);
  const elapsed = [];
  const gaps = complementSpans(worked, 0, C);
  if (gaps.some(([a, b]) => b > a)) elapsed.push(idle);
  if (worked.some(([a]) => a < C)) {
    if (renderPx < HATCH_MIN_PX) elapsed.push(workedFlatFill(T, barColor));
    else elapsed.push(idle, hatchPhases(T, barColor)[2]);
  }
  if (!elapsed.length) elapsed.push(idle);

  if (side === "left") return C > 0 ? elapsed : [barColor];
  if (side === "right") return C < 100 ? [barColor] : elapsed;
  return C >= 100 ? elapsed : C <= 0 ? [barColor] : [...elapsed, barColor];
}

// GUARANTEE, part one: a job colour that cannot carry its own label is nudged until it
// can. Uniformly -- the WHOLE fill steps, so idle, hatch and spent all derive from the
// stepped colour and the bar is still one colour. A band behind the label would read as
// a fourth region and the three-region grammar cost more to build than this bug costs.
//
// Measured on the live Matrix palette: 3 of 17 colours (89 of 241 bars) cannot reach
// 4.5:1 with either polarity -- #e3368d 4.40, #c43ce6 4.37, #2d7be7 4.33. A 0.08 step
// clears all three (4.80-4.92) and is the smallest step that does.
export const LEGIBLE_STEP = 0.08, LEGIBLE_STEP_MAX = 0.24;
export function legibleBarColor(barColor) {
  try {
    if (typeof barColor !== "string" || barColor[0] !== "#") return barColor;
    let c = barColor;
    for (let i = 0; i < LEGIBLE_STEP_MAX / LEGIBLE_STEP && barInkRatio([c]) < AA_TEXT; i++) {
      c = blendHex(c, barInk([c]) === PAPER ? -LEGIBLE_STEP : LEGIBLE_STEP);
    }
    return c;
  } catch { return barColor; }
}

// The same guarantee for text that has to KEEP ITS HUE -- a status amber, a danger red --
// rather than resolve to ink or paper. Steps the colour away from its ground until it clears,
// which is the only move available when the hue is carrying meaning and the ground is fixed.
// Hue is preserved because blendHex only moves toward white or black.
//
// Use it for tinted text on a surface. Where the pill can be FILLED instead, fill it and take
// barInk: a 13%-alpha wash behind hue-coloured text is the pattern that put the overdue badge
// at 2.53:1 on the dark ladders, and no amount of stepping the text fixes a ground that faint.
export function legibleOn(colour, ground, threshold = AA_TEXT) {
  try {
    let c = colour;
    const away = wantsLightText(ground) ? 1 : -1;      // dark ground -> lighten the text
    for (let i = 0; i < 12 && contrastRatio(c, ground) < threshold; i++) c = blendHex(c, away * 0.08);
    return c;
  } catch { return colour; }
}

// GUARANTEE, part two: a title that spans the cursor crosses grounds that disagree on
// polarity -- measured, 20 of 33 colour x theme combinations do, and the best a single
// colour can manage on the dark ladders is 2.06:1. The glyph carries BOTH tones: the
// fill in the better polarity, a 1px rim in the other.
//
// A rim drawn with text-shadow, not -webkit-text-stroke. A stroke is CENTRED on the
// glyph edge, so at the 11px bar label it eats ~0.5px off a ~1.3px stem -- 40% of the
// letterform -- and reads fuzzy and bold. Four hard 1px shadows paint OUTSIDE the glyph
// and leave it at full weight. Not a blur: a soft halo averages toward the ground it is
// trying to separate from, which is what the 3px/0.60 halo it replaces was doing.
//
// Returned as a textShadow string, so it costs nothing on the bars that do not need it.
export function twoToneRim(ink) {
  const o = ink === PAPER ? INK : PAPER;
  return `1px 0 0 ${o}, -1px 0 0 ${o}, 0 1px 0 ${o}, 0 -1px 0 ${o}`;
}
// THE ALERT CHANNEL. One mark at the bar's right edge for the three ways a bar can have run
// past where it should be, in precedence order: an unclosed clock, then overrun, then past
// the job's due date. One channel because they are one question -- "this has gone beyond its
// end" -- and because the bar has no other free edge.
//
// TWO TONES, and that is not decoration. A flat danger-red cap is invisible on this palette:
// measured against Matrix's 17 live job colours it fails 3:1 on ALL of them, worst 1.01:1,
// because the palette is full of reds and magentas and red-on-red has no contrast. Stepping
// the hue (legibleOn) rescues most but bottoms out at 2.88 on a DONE bar. So the cap carries
// a 1px separator in barInk(fill) -- the same ink the labels use, so it is guaranteed against
// whatever the fill is -- and the danger hue sits outboard of it, where its job is to be
// recognisable against the ROW, which it clears at 3.37-5.25:1.
//
// Weakest link in the whole chain, across 17 colours x 4 themes x 3 fills: 3.37:1.
export const ALERT_ORDER = ["unclosed", "overrun", "pastdue"];
export const ALERT_LABEL = {
  unclosed: "Someone is still clocked in past the end of their day",
  overrun: "Worked past its estimate",
  pastdue: "Running past the job's due date",
};
export function alertCap(T, fill, kind) {
  if (!kind) return null;
  const hue = T?.danger || "#f43f5e";
  return { sep: barInk([fill]), hue, title: ALERT_LABEL[kind] || "" };
}

// The lunch/break window, as a HAIRLINE rather than a step in the fill.
//
// Two reasons, and the second is the binding one. Measured: a fill step cannot reach 3:1
// against the bar at any usable magnitude -- 1.76:1 at a 0.30 step, which is already a heavy
// band -- because stepping a mid-tone colour toward its own ink runs out of room. And the
// fill is the progress channel and nothing else may write to it, so a lunch gap painted INTO
// the fill would be a second meaning in the one place that already has one.
//
// A 1px line in barInk is the same ink the labels sit in, so it inherits their guarantee:
// 4.61:1 at worst against the bar colour, 6.56:1 against idle.
export function lunchHairline(fill) { return barInk([fill]); }

// The whole decision for one run of text, in one call. `grounds` from barGrounds().
export function barTextStyle(grounds, { nonText = false } = {}) {
  const ink = barInk(grounds);
  const r = barInkRatio(grounds);
  return { color: ink, textShadow: r < (nonText ? AA_NONTEXT : AA_TEXT) ? twoToneRim(ink) : undefined, ratio: r };
}


export {
  hexLum, blendHex, mixHex, hexA, wantsLightText, TEXT_POLARITY_L,
  accentText, ACCENT_FILL_DARKEST,
  DONE_MUTE, barPaint, DONE_FADE, barFade,
  SPENT_MUTE_RATIO, spentBarFill, doneBarFill, idleBarFill, workedHatchLayer, workedFlatFill,
  HATCH_MIN_PX, HATCH_STEP, HATCH_ALPHA, activeBarFill, barLabelColor, liveBarTextColor,
  overHex, contrastRatio,
};
