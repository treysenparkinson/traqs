// One name, one @keyframes (#417).
//
// THE HAZARD IS SILENCE, and this file exists because the codebase already
// learned the lesson once and did not keep it. Above the global declarations in
// TRAQS.jsx sits this note:
//
//   "These have to live in the GLOBAL sheet — toolDrop used to be declared only
//    inside the Jobs view's <style>, so the cascade silently did nothing on every
//    other page, and menuIn was never declared at all despite ~20 call sites."
//
// The declaration was MOVED. The original was never deleted. So `toolDrop` was
// declared three times and `menuIn` twice, and a later-parsed @keyframes of the
// same name WINS GLOBALLY — meaning the sheet that comment calls authoritative
// was silently outranked by two copies, one of them re-injected on every theme
// change. All the bodies were identical, which is the whole hazard: nothing was
// wrong on screen, and whoever edited the global one next would have changed
// nothing and had no way to tell.
//
// A DUPLICATE IS NOT ALWAYS A DEFECT, and the guard has to say which:
//
//   A REDUCED-MOTION OVERRIDE is the mechanism working as intended. Redefining
//   `tqPadIn` inside `@media (prefers-reduced-motion: reduce)` is exactly how you
//   turn an animation down, and it is detected rather than listed.
//
// Every other exemption is NAMED, with its reason, and a stale one is a failure in
// its own right — an exemption nobody needs is an excuse the next duplicate
// borrows. Same shape as the stagger allow-list in `shell-redesign-test`.
//
// THE LIST IS DELIBERATELY EMPTY, and the entry that nearly went in it is the
// reason this comment is long. `spin` was declared three times, and the first
// draft exempted it as "three self-contained loading screens, each rendering
// BEFORE the global sheet is on the page". THAT REASON WAS FALSE. TRAQS.jsx
// appends its sheet to document.head at MODULE LOAD (:2310), and App.jsx imports
// TRAQS statically, so the sheet is on the page before any component renders —
// including both loading screens. All three were redundant and two are now gone.
//
// An exemption is a claim about why a rule does not apply, and a claim nobody
// checks is how a guard becomes decoration. This one was wrong on the first try.

/** Declarations that may legitimately repeat a name, each with the reason. */
export const ALLOWED_DUPLICATES = {};

/** The body of the rule starting at `open`, whitespace-normalised for comparison. */
function bodyAt(src, open) {
  const first = src.indexOf("{", open);
  if (first < 0) return "";
  let i = first, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(first, i + 1);
  }
  return "";
}
const normalise = (b) => b.replace(/\s+/g, "").replace(/;\}/g, "}").toLowerCase();

/** Whether this declaration sits inside a prefers-reduced-motion block. */
function insideReducedMotion(src, at) {
  const before = src.slice(Math.max(0, at - 6000), at);
  const media = before.lastIndexOf("@media");
  if (media < 0) return false;
  // A `}` after the @media means that block already closed.
  if (before.lastIndexOf("}") > media) return false;
  return /prefers-reduced-motion/.test(before.slice(media, media + 80));
}

/**
 * Every @keyframes declaration in `src`.
 * @returns {{name: string, line: number, body: string, reduced: boolean}[]}
 */
export function keyframeDeclarations(src) {
  const s = String(src ?? "");
  const out = [];
  for (const m of s.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) {
    out.push({
      name: m[1],
      line: s.slice(0, m.index).split("\n").length,
      body: normalise(bodyAt(s, m.index)),
      reduced: insideReducedMotion(s, m.index),
    });
  }
  return out;
}

/**
 * Names declared more than once across `files` ([{ file, src }]), excluding
 * reduced-motion overrides and the named exemptions. `allowed` is a parameter so
 * the suite can exercise the mechanism on fixtures while the real list is empty.
 * @returns {{name: string, where: string[], identical: boolean}[]}
 */
export function duplicateKeyframes(files, allowed = ALLOWED_DUPLICATES) {
  const byName = new Map();
  for (const { file, src } of files)
    for (const d of keyframeDeclarations(src))
      byName.set(d.name, [...(byName.get(d.name) || []), { ...d, file }]);

  const out = [];
  for (const [name, all] of byName) {
    // A reduced-motion override is the mechanism working, not a collision.
    const real = all.filter((d) => !d.reduced);
    if (real.length < 2) continue;
    if (Object.prototype.hasOwnProperty.call(allowed, name)) continue;
    out.push({
      name,
      where: real.map((d) => `${d.file}:${d.line}`),
      identical: new Set(real.map((d) => d.body)).size === 1,
    });
  }
  return out;
}

/** Exemptions no longer earning their place. */
export function staleExemptions(files, allowed = ALLOWED_DUPLICATES) {
  const byName = new Map();
  for (const { file, src } of files)
    for (const d of keyframeDeclarations(src))
      if (!d.reduced) byName.set(d.name, (byName.get(d.name) || 0) + 1);
  return Object.keys(allowed).filter((n) => (byName.get(n) || 0) < 2);
}
