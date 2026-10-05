// #374 — Reschedule has been inert since db3a87e, and the dimmed rows were the
// only visible symptom of it.
//
// rescheduleSelection is declared "OP ids selected to be re-planned". The
// context-menu entry that opens Reschedule seeded it with `job.subs.map(p =>
// p.id)` — PANEL ids. Every reader wants op ids: panelSelState, the preflight,
// the per-op checkboxes, excludeOpIds, the scheduling filter and the commit
// merge. No op id was ever in the list, so on open:
//
//   every panel read "none"          -> every row dimmed to 0.4
//   every checkbox unchecked
//   excludeOpIds excluded panel ids  -> the ops being re-planned blocked
//                                       THEMSELVES in the obstacle set
//   the scheduling filter matched 0  -> the run placed nothing
//   the commit merge matched 0       -> the commit changed nothing
//
// A modal that silently does nothing looks like a modal that worked, which is
// why this survived a sign-off and shipped.
//
// The dim was a SYMPTOM, and its fix is separate: a ground change rather than
// group opacity, because the dim text colour measures 2.78 against the panel at
// FULL opacity — so no multiplier both reads as dimmed and keeps the row usable.
//
//   node scripts/replan-selection-test.mjs

import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { AA_TEXT, AA_NONTEXT } from "../src/barPaint.js";
import { LIGHT } from "../src/themeTokens.js";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(J);
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// ── WCAG, composited the way root cause 8 settled: against what is BEHIND it ──
const hex = (h) => { const s = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)); };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg, a) => hex(fg).map((c, i) => a * c + (1 - a) * hex(bg)[i]);
const r2 = (n) => Math.round(n * 100) / 100;

console.log("\n1. THE CLASS GUARD — every write draws its ids from the readers' source");
{
  // The instance was one bad seed. The CLASS is "a writer and a reader
  // disagreeing about what kind of id is in the list", and that is what this
  // asserts: every setRescheduleSelection call either derives ids from
  // selectableOpIdsOf (the same helper panelSelState and the checkboxes read)
  // or transforms `prev`, which cannot introduce a new kind.
  const calls = [...CODE.matchAll(/setRescheduleSelection\(([\s\S]{0,220}?)\)\s*[;,)]/g)].map(m => m[1]);
  ok("there are writers to check", calls.length >= 2, true);
  const sourced = calls.filter(c => /selectableOpIdsOf|prev/.test(c));
  ok("every writer sources from selectableOpIdsOf or prev", sourced.length, calls.length);
  // ...and the specific wrong source can never come back.
  ok("no writer maps panel ids out of job.subs",
    /setRescheduleSelection\(\s*\(?\s*(job|p|ed)\.subs[^)]*\)?\s*\.map\(\s*\w+\s*=>\s*\w+\.id\s*\)/.test(CODE), false);
}

console.log("\n2. The seed selects every selectable OP, which is what 're-plan this job' means");
{
  ok("the reschedule entry seeds through selectableOpIdsOf",
    /setRescheduleSelection\(\s*\(job\.subs \|\| \[\]\)\.flatMap\(\s*p\s*=>\s*selectableOpIdsOf\(p\)\s*\)\s*\)/.test(CODE), true);
  // selectableOpIdsOf already drops clocked ops, so the seed cannot select
  // something the per-op checkbox would refuse — the two agree by construction.
  ok("...and that helper is the one the checkboxes refuse through",
    /const selectableOpIdsOf = \(panel\) => opIdsOf\(panel\)\.filter/.test(CODE), true);
}

console.log("\n3. RED PROOF — why panel ids produced a modal that did nothing");
{
  // Plain data, no app code: this is the arithmetic the real bug performed.
  const panels = [
    { id: "P1", subs: [{ id: "o1" }, { id: "o2" }] },
    { id: "P2", subs: [{ id: "o3" }] },
  ];
  const opIds = panels.flatMap(p => p.subs.map(o => o.id));
  const panelSeed = panels.map(p => p.id);
  const opSeed = panels.flatMap(p => p.subs.map(o => o.id));

  // panelSelState's arithmetic: how many of a panel's OP ids are in the list.
  const selState = (panel, list) => {
    const ids = panel.subs.map(o => o.id);
    const on = ids.filter(id => list.includes(id)).length;
    return on === 0 ? "none" : on === ids.length ? "all" : "some";
  };
  ok("with PANEL ids seeded, every panel reads 'none'",
    panels.map(p => selState(p, panelSeed)), ["none", "none"]);
  ok("...so every row dims and every checkbox is unchecked",
    panelSeed.filter(id => opIds.includes(id)).length, 0);
  // excludeOpIds: the ops being re-planned must leave the obstacle set, or they
  // block themselves and the run can never find a window.
  ok("...and excludeOpIds removes nothing, so the ops block themselves",
    opIds.filter(id => !panelSeed.includes(id)).length, opIds.length);
  // The commit merge keyed on the same list.
  ok("...and the commit merge matches no op, so nothing is written",
    opIds.filter(id => new Set(panelSeed.map(String)).has(String(id))).length, 0);

  ok("with OP ids seeded, every panel reads 'all'",
    panels.map(p => selState(p, opSeed)), ["all", "all"]);
  ok("...and excludeOpIds removes all of them from the obstacle set",
    opIds.filter(id => !opSeed.includes(id)).length, 0);
}

console.log("\n4. The dim is a GROUND CHANGE, not group opacity");
{
  ok("the 0.4 multiplier is gone", /opacity:\s*isPanelSelected\s*\?\s*1\s*:\s*0?\.4/.test(CODE), false);
  ok("...and no opacity is applied to the row at all",
    /isPanelSelected\s*\?\s*1\s*:\s*0?\.\d/.test(CODE), false);
  ok("the row's BACKGROUND carries the state instead",
    /background:\s*isPanelSelected\s*\?\s*T\.bg\s*:\s*T\.card/.test(CODE), true);
  ok("...and it transitions on background, not opacity",
    /transition:\s*"background[^"]*"/.test(CODE), true);
  // The checkbox is the other half of the signal and must still be there: a
  // ground change alone is subtle by design, which is the point — subtle is
  // correct for "not selected", unreadable is not.
  ok("the unchecked checkbox still carries the primary signal",
    /panelSelState\(panel\) === "all"/.test(CODE), true);
}

console.log("\n5. MEASURED against the panel — the reason opacity cannot work");
{
  const sel = LIGHT.bg, unsel = LIGHT.card;
  const dimmed = (c) => r2(ratio(over(c, unsel, 0.4), over(LIGHT.bg, unsel, 0.4)));
  const ground = (c) => r2(ratio(hex(c), hex(unsel)));

  // What 0.4 did to the row.
  ok("at opacity 0.4 primary text fell below the NON-TEXT floor",
    dimmed(LIGHT.text) < AA_NONTEXT, true);
  ok(`...measuring ${dimmed(LIGHT.text)} against AA_NONTEXT ${AA_NONTEXT}`,
    dimmed(LIGHT.text) < 3, true);

  // What the ground change gives.
  ok("on the card ground primary text clears AA", ground(LIGHT.text) >= AA_TEXT, true);
  ok(`...measuring ${ground(LIGHT.text)} against AA_TEXT ${AA_TEXT}`, ground(LIGHT.text) > 16, true);
  ok("...and secondary text clears AA too", ground(LIGHT.textSec) >= AA_TEXT, true);

  // THE ARGUMENT, asserted rather than written in a comment: textDim does not
  // reach AA even at FULL opacity, so every multiplier starts below the line and
  // goes down. That is why no value of opacity was the answer.
  ok("textDim fails AA at full opacity, so no multiplier could have worked",
    ground(LIGHT.textDim) < AA_TEXT, true);
  ok("...and dimming only makes it worse", dimmed(LIGHT.textDim) < ground(LIGHT.textDim), true);

  // The ground change must still be VISIBLE, or it is not a signal.
  ok("the two grounds are actually different", LIGHT.bg !== LIGHT.card, true);
  ok("...by a real but quiet amount", r2(ratio(hex(LIGHT.card), hex(LIGHT.bg))) > 1.05, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
