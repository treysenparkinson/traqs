// #416 — menus arrive WITH their rows, not one row at a time.
//
// Trey's ruling: remove the one-by-one item animation on things that appear under
// a pointer; keep the fade-in on popups and modals; lists and pages are untouched
// ("the ruling is about things that appear under a pointer, not content arriving
// on a page").
//
// WHAT WAS ACTUALLY STAGGERING — surveyed before changing anything, because the
// `.anim-stagger` family was partly deleted in the dead-code sweep and the live
// cascade had to be found rather than assumed. It was CONTEXT MENUS, through one
// helper, and NOT the dropdowns:
//
//   ctxRowAnim (:3233)   toolDrop/toolDropUp, idx * 38ms   10 rows on the main menu
//   SimpleDrop           NOTHING on its rows — already clean
//   MultiDrop            names `tqDropIn`, WHICH IS NEVER DECLARED — already dead
//
// The main schedule/jobs menu fed a RUNNING index (`let _ci = -1; ci = () => ++_ci`)
// to ten rows, so the last started at 342ms and finished at 482ms — half a second
// before the app's most-used menu was readable.
//
// THE CONTAINER ENTRANCES ARE KEPT, and asserted here so a later sweep does not
// read "remove the animation" and take them too: `.anim-ctx` (ctxMenuIn),
// `.anim-drop` (dropIn) and SimpleDrop's own `menuIn`.
//
//   node scripts/menu-stagger-test.mjs
import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const SRC_URL = new URL("../src/TRAQS.jsx", import.meta.url);
const SRC = readFileSync(SRC_URL, "utf8");

// THIS SUITE DOES NOT USE codeOf(), AND THAT IS DELIBERATE (#418). Its JSX-comment
// regex `\{\s*\/\*[\s\S]*?\*\/\s*\}` matches a CSS rule's opening `{` followed by a
// `/* comment */` and then runs on to the next `*/` that happens to precede a `}` —
// two of those matches swallow 298 and 459 lines of TRAQS.jsx, and the `/*` tokens
// they consume unevenly leave the NEXT pass unbalanced. Measured: 772 unambiguous
// code lines (3.7%) are absent from the view, whole functions among them. An
// ABSENCE assertion naming anything in that gap passes unconditionally, which is
// the exact failure its own header warns about.
//
// So the comment handling here is the minimum that is CORRECT: whole-line comments
// only. Block comments stay, so every PRESENCE assertion below is written in a full
// code form that prose could not satisfy.
const CODE = SRC.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

// ── the helper itself, sliced out and executed ──────────────────────────────
const sliceFn = (anchor) => {
  const at = SRC.indexOf(anchor);
  if (at < 0) {
    console.error(`\n  ABORT  could not slice ${anchor} out of TRAQS.jsx — anchor moved.`);
    process.exit(2);
  }
  let i = SRC.indexOf("{", at), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === "{") depth++; else if (SRC[i] === "}" && --depth === 0) break; }
  return SRC.slice(at, i + 1);
};
const ctxRowAnim = new Function(`${sliceFn("function ctxRowAnim(")}; return ctxRowAnim;`)();

console.log("\n1. ctxRowAnim — a row carries no delay, whichever way the menu opened");
{
  // RED: this returned `toolDrop 0.14s ${idx * 38}ms both ease-out`.
  const delayOf = (s) => (String(s || "").match(/\b(\d+(?:\.\d+)?)(ms|s)\b/g) || [])[1] ?? null;
  for (const idx of [0, 1, 2, 5, 9]) {
    ok(`row ${idx}, menu opening down, has a 0ms delay`, delayOf(ctxRowAnim(idx, false).animation), "0ms");
    ok(`row ${idx}, menu flipped up, has a 0ms delay`, delayOf(ctxRowAnim(idx, true).animation), "0ms");
  }
  // Direction survives: a menu above its anchor still has its rows arrive from below.
  ok("a downward menu uses toolDrop", /\btoolDrop\b/.test(ctxRowAnim(0, false).animation), true);
  ok("an upward menu uses toolDropUp", /\btoolDropUp\b/.test(ctxRowAnim(0, true).animation), true);
  ok("the row still animates at all", /0\.14s/.test(ctxRowAnim(0, false).animation), true);
  // A row that never opted in still gets nothing.
  ok("no animIdx means no animation", ctxRowAnim(undefined, false), {});
  // Every row is now identical, which is the property in one line.
  ok("rows 0 and 9 are indistinguishable", ctxRowAnim(0, false).animation, ctxRowAnim(9, false).animation);
}

console.log("\n2. THE SWEEP — no toolDrop anywhere carries a non-zero delay");
{
  // The assertion that catches the next one. Five sibling rows had their position's
  // delay BAKED IN as a literal (190ms, 76ms, 38ms x3) because they are not
  // CtxMenuItem components, so fixing the helper alone would have left the cascade
  // half-running on four menus.
  const offenders = [];
  SRC.split(/\r?\n/).forEach((ln, i) => {
    for (const m of ln.matchAll(/toolDrop(?:Up)?\s+[\d.]+m?s\s+([\d.]+)(m?s)/g))
      if (Number(m[1]) !== 0) offenders.push(`${i + 1}: ${m[0]}`);
  });
  ok("no literal non-zero toolDrop delay survives", offenders, []);
  // ...and the only COMPUTED ones left are the two Trey ruled out of scope, named
  // here rather than excluded by a pattern. The first version of this assertion
  // demanded zero computed delays anywhere and so contradicted section 7, which
  // requires these two to SURVIVE — two assertions in one suite disagreeing about
  // the same lines. An allow-list says which exceptions are deliberate and still
  // fails on a new one.
  const RULED_OUT_OF_SCOPE = ["${pi * 38}", "${di*38}"]; // settings table, deps modal
  const interp = [];
  SRC.split(/\r?\n/).forEach((ln, i) => {
    for (const m of ln.matchAll(/toolDrop(?:Up)?[^`"']*?(\$\{[^}]*\})m?s/g))
      if (!RULED_OUT_OF_SCOPE.includes(m[1])) interp.push(`${i + 1}: ${m[0].slice(0, 60)}`);
  });
  ok("no NEW computed toolDrop delay survives", interp, []);
  ok("...and the two ruled exceptions are still exactly two", SRC.split(/toolDrop(?:Up)?[^`"']*?\$\{[^}]*\}m?s/).length - 1, 2);
}

console.log("\n3. THE CONTAINER ENTRANCES ARE KEPT — this was never 'remove the animation'");
{
  ok(".anim-ctx still drops the menu in", /\.anim-ctx\s+\{\s*animation:\s*ctxMenuIn\b/.test(CODE), true);
  ok(".anim-ctx-up still exists for a flipped menu", /\.anim-ctx-up\s+\{\s*animation:\s*ctxMenuInUp\b/.test(CODE), true);
  ok(".anim-drop still fades the dropdown in", /\.anim-drop\s+\{\s*animation:\s*dropIn\b/.test(CODE), true);
  // SCOPED TO SimpleDrop, not to the file. `animation: "menuIn 0.15s ease-out"`
  // appears FOURTEEN times, so a bare presence check stayed green with SimpleDrop's
  // own copy deleted — that mutant was the only survivor of the first run. Assert
  // the statement where it has to be, not the string somewhere.
  const at = CODE.indexOf("function SimpleDrop(");
  const sd = at < 0 ? "" : CODE.slice(at, at + 4200);
  ok("SimpleDrop was found", sd.length > 1000, true);
  ok("SimpleDrop's own menu still animates", /animation: "menuIn 0\.15s ease-out"/.test(sd), true);
  // SimpleDrop's ROWS were already clean and must stay that way: this is the
  // component Trey calls a dropdown, and it is not what was staggering.
  ok("...and no row inside it carries an animation", /toolDrop|tqDropIn|animationDelay/.test(sd), false);
}

console.log("\n4. tqDropIn — the reference to a keyframe that was never declared");
{
  // RED: MultiDrop's rows said `animation: tqDropIn 0.18s ease both ${ri * 0.02}s`.
  // One reference, zero @keyframes, so the rows had NO entrance and nobody missed
  // it. Trey's ruling: drop the reference, because restoring the keyframe would be
  // ADDING an animation under the same ruling that removes one.
  // Against CODE, not SRC: the comment at the fix site NAMES the thing removed,
  // which is what makes it worth reading, and a raw scan matches its own prose.
  ok("tqDropIn is gone from the code", /tqDropIn/.test(CODE), false);
  ok("...and the comment that explains it is still there", /tqDropIn/.test(SRC), true);
}

console.log("\n5. EVERY ANIMATION NAME USED IS DECLARED — the guard for the next dead reference");
{
  // The first census of this reported 17 false positives because it could not see
  // a name built by interpolation (`${up ? "toolDropUp" : "toolDrop"}`). Names are
  // collected from BOTH forms here, and verified against the declarations.
  const DIR = new URL("../src/", import.meta.url);
  const declared = new Set(), used = new Map();
  const KEYWORDS = new Set(["none", "inherit", "initial", "unset", "ease", "linear", "both", "forwards", "backwards", "infinite", "alternate", "reverse", "normal", "running", "paused", "ease-in", "ease-out", "ease-in-out", "steps", "cubic-bezier", "calc", "var", "to", "from"]);
  for (const f of readdirSync(DIR).filter(n => /\.(js|jsx|css)$/.test(n))) {
    const src = readFileSync(new URL(f, DIR), "utf8");
    for (const m of src.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) declared.add(m[1]);
    src.split(/\r?\n/).forEach((ln, i) => {
      // Prose is not code. "...have different curves in ONE animation: the hold is
      // linear" reported a keyframe called `the` on the first run of this.
      if (/^\s*(\/\/|\*)/.test(ln)) return;
      for (const m of ln.matchAll(/animation(?:Name)?\s*:\s*(`[^`]*`|"[^"]*"|'[^']*'|[^;,}]*)/g)) {
        const v = m[1];
        const names = [];
        // Only a QUOTED value can be resolved. `animation: anim` is a runtime
        // variable whose keyframe name this scanner cannot know, and guessing
        // reported seven of those as missing keyframes on the first run.
        if (/^[`"']/.test(v)) {
          const plain = v.slice(1).match(/^\s*([A-Za-z_][\w-]*)/);
          if (plain) names.push(plain[1]);
        }
        // ...plus every quoted name inside an interpolation, which is how the
        // up/down pair is written (`${up ? "toolDropUp" : "toolDrop"}`).
        for (const q of v.matchAll(/\$\{[^}]*\}/g))
          for (const s of q[0].matchAll(/["']([A-Za-z_][\w-]*)["']/g)) names.push(s[1]);
        for (const n of names) if (!KEYWORDS.has(n)) used.set(n, `${f}:${i + 1}`);
      }
    });
  }
  ok("the census found the names it should", [used.has("toolDrop"), used.has("toolDropUp"), used.has("ctxMenuIn") || declared.has("ctxMenuIn")], [true, true, true]);
  const missing = [...used.entries()].filter(([n]) => !declared.has(n)).map(([n, at]) => `${n} (${at})`).sort();
  ok("no animation names a keyframe that does not exist", missing, []);
}

console.log("\n6. THE DEAD STATE AROUND THE CASCADE THAT NO LONGER RUNS");
{
  // `rowAnim` returned {} and five call sites spread it. `optBaseLenRef` existed
  // only to feed it an index. All of it goes.
  ok("rowAnim is gone", /\browAnim\b/.test(CODE), false);
  ok("optBaseLenRef is gone", /\boptBaseLenRef\b/.test(CODE), false);
  // The reversed cascade needed the row COUNT. With no order to reverse there is
  // nothing to count, so the measurement and its DOM marker go with it.
  ok("the context menu no longer counts its rows", /querySelectorAll\("\[data-ctx-row\]"\)/.test(CODE), false);
  ok("...and the marker it counted is gone", /data-ctx-row/.test(CODE), false);
  ok("ctxRowAnim no longer takes a count", /function ctxRowAnim\(animIdx, up\)/.test(CODE), true);
  ok("...and the context carries only the direction", /createContext\(\{ up: false \}\)/.test(CODE), true);

  // BUT `optEditSeq` STAYS, and this is the assertion that says why. Its comment
  // called it a cascade re-trigger, and it is not: `body` is ALWAYS rendered (the
  // editor collapses via grid-template-rows: 0fr, it does not unmount), so the
  // `key` is what remounts .tq-opt-scroll and re-fires `tqOptScrollOn` — the 0.42s
  // window that keeps a scrollbar from flickering in during the 0.3s expansion.
  // Deleting it as dead would have reintroduced that flicker on every reopen.
  ok("optEditSeq is KEPT", /\boptEditSeq\b/.test(CODE), true);
  ok("...as the remount key on the scroll container", /<div key=\{optEditSeq\} className="tq-opt-scroll"/.test(CODE), true);
  ok("...and tqOptScrollOn is still what it re-fires", /\.tq-opt-scroll \{[^}]*animation: tqOptScrollOn/.test(CODE), true);
  ok("...and its comment no longer claims a cascade", /optEditSeq[^\n]*staggered cascade/.test(CODE), false);
}

console.log("\n7. OUT OF SCOPE — lists and pages keep their stagger");
{
  // Trey: "the ruling is about things that appear under a pointer, not content
  // arriving on a page". These are asserted PRESENT so a later sweep reading
  // "remove the stagger" does not take them on this entry's authority.
  ok("the Time Clock settings team table still staggers", /toolDrop 0\.14s \$\{pi \* 38\}ms/.test(CODE), true);
  ok("the Dependencies modal rows still stagger", /toolDrop 0\.14s \$\{di\*38\}ms/.test(CODE), true);
  ok("the schedule's team-select bubbles still stagger", /animationDelay: `\$\{ri \* 25\}ms`/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
