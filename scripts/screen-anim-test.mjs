// Every keyframe this file names must be defined in a sheet that outlives the
// screens using it.
//
// WHY THIS EXISTS -- IT HAS CAUGHT THE SAME BUG TWICE.
//
// 1. @keyframes tqScreenIn/tqScreenOut sat in LOADUP_CSS, whose <style> tag was
//    rendered by OrgCodeStep, the welcome screen. Navigating away unmounted that
//    component and removed the rule, so the exit animated (the sheet was still
//    mounted) and the arrival could not.
// 2. The roster card was then given a staged entrance using tqFadeUp -- still in
//    LOADUP_CSS, still owned by the welcome screen. The card rendered at
//    opacity 0 with an animation naming a keyframe that no longer existed, and
//    simply did not appear.
//
// Both times: nothing errored, nothing warned, the build was clean. The tell is
// that the element's computed animation-name reads correctly while
// getAnimations() on it is empty.
//
// The first version of this file asserted two specific names. That is why it
// missed the second occurrence. This one enumerates every tq* animation the file
// uses and checks them all, so a new one cannot be added in the wrong place.
//
//   node scripts/screen-anim-test.mjs

import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (msg, cond) => {
  if (cond) { pass++; console.log("ok    " + msg); }
  else { fail++; console.error("FAIL  " + msg); }
};

// ── the sheets, and where they are mounted ───────────────────────────────────
// A sheet is root-mounted only if the DEFAULT EXPORT renders it. AuthGate returns
// early in a dozen branches, so "somewhere in AuthGate" is not good enough.
const appStart = SRC.indexOf("export default function App()");
ok("the default export is where it is expected to be", appStart > 0);
const app = SRC.slice(appStart);

const SHEETS = [...SRC.matchAll(/const ([A-Z_]+_CSS) = `/g)].map((m) => m[1]);
ok("the stylesheets are declared as named constants", SHEETS.length >= 3);

const rootMounted = SHEETS.filter((n) => app.includes(`<style>{${n}}</style>`));
// THE INVARIANT. A sheet mounted anywhere else is owned by a component, and a
// component can unmount and take its rules with it.
for (const n of SHEETS) {
  const mounts = (SRC.match(new RegExp(`<style>\\{${n}\\}</style>`, "g")) || []).length;
  ok(`${n} is mounted exactly once`, mounts === 1);
  ok(`${n} is mounted by App, above every screen`, rootMounted.includes(n));
}

// Which sheet defines each keyframe: the nearest `const NAME = \`` above it.
const definedIn = (name) => {
  const at = SRC.indexOf("@keyframes " + name);
  if (at < 0) return null;
  const decls = [...SRC.slice(0, at).matchAll(/const ([A-Z_]+) = `/g)];
  return decls.length ? decls[decls.length - 1][1] : null;
};

// ── every animation this file asks for ───────────────────────────────────────
// Picked up from both inline styles (animation: `tqFoo ...`) and CSS text
// (animation: tqFoo ...), then filtered to the ones that are actually keyframe
// names rather than CSS keywords.
const KEYWORDS = new Set(["none", "running", "paused", "infinite", "both", "forwards", "backwards", "alternate", "normal", "reverse", "linear", "ease"]);
const used = [...new Set([...SRC.matchAll(/\b(tq[A-Za-z]+)\b/g)].map((m) => m[1]))]
  .filter((n) => !KEYWORDS.has(n))
  // Class names (tq-page, tq-fade) do not match \w-only, but component and
  // variable names can. Only count something that is defined as a keyframe
  // somewhere, or referenced in an animation shorthand.
  .filter((n) => SRC.includes("@keyframes " + n) || new RegExp(`animation:[^;]*\\b${n}\\b`).test(SRC));

ok("there are animations to check", used.length >= 5);
console.log("      checking: " + used.join(", "));

for (const name of used) {
  const holder = definedIn(name);
  ok(`@keyframes ${name} is defined`, holder !== null);
  ok(`${name} lives in a root-mounted sheet (${holder ?? "nowhere"})`,
    holder !== null && rootMounted.includes(holder));
}

// ── the screen transition's shape ────────────────────────────────────────────
const fnStart = SRC.indexOf("const screenContentStyle =");
const fnEnd = SRC.indexOf("});", fnStart);
ok("screenContentStyle is where it is expected to be", fnStart > 0 && fnEnd > fnStart);
const fn = SRC.slice(fnStart, fnEnd);
ok("it uses two keyframe animations, one per direction",
  new Set([...fn.matchAll(/animation: `?(tq[A-Za-z]+)/g)].map((m) => m[1])).size === 2);

// The timings the user asked for: 0.4s out, 0.5s hold, 0.4s in. Measured live
// in Chrome; asserted here so a change to the numbers is a deliberate edit to
// this line too.
const num = (k) => {
  const m = SRC.match(new RegExp("const " + k + " = (\\d+);"));
  return m ? +m[1] : null;
};
ok("exit runs 400ms", num("SCREEN_OUT_MS") === 400);
ok("then holds on empty paper for 500ms", num("SCREEN_HOLD_MS") === 500);
ok("then the arrival runs 400ms", num("SCREEN_IN_MS") === 400);

// The arrival starts oversized and settles -- big to small, not small to big.
// Read by index rather than by regex: this file has been rewritten through a
// shell heredoc more than once, and a heredoc eats backslashes, which turns an
// escaped pattern into one that matches nothing and a check into a decoration.
const scaleAfter = (marker) => {
  const at = SRC.indexOf(marker);
  if (at < 0) return null;
  const from = SRC.indexOf("scale(", at);
  if (from < 0) return null;
  return Number.parseFloat(SRC.slice(from + 6));
};
ok("the arrival starts bigger than its resting size", scaleAfter("@keyframes tqScreenIn") > 1);
ok("the slides inside the wizard settle down to size too",
  scaleAfter('transform: phase === "out" ?') > 1);

// The swap must happen after the hold, not at the end of the exit -- and every
// screen change must use the same clock, or one of them cuts.
const swaps = (SRC.match(/SCREEN_OUT_MS \+ SCREEN_HOLD_MS/g) || []).length;
ok("every screen change swaps at exit + hold", swaps >= 2);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
