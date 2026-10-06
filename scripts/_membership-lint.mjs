// A membership comparison must go through `sameId` / `onTeam` (#355, #207).
//
// THE HAZARD IS SILENCE. Person ids are mixed string/number across the web, iOS
// and the stored history, and `(op.team || []).includes(pid)` against a
// number-typed id does not throw — it returns false. The op falls through to the
// department pool, or the counter reads zero, and the result is
// indistinguishable from the behaviour being fixed.
//
// It has bitten TWICE INSIDE OTHER FIXES in this campaign (#340's
// manual-assignment check, #345's even-load counter), both written by someone
// who had just read the rule. That is why this is a build assertion and not nine
// hand-edits: the known sites are latent on today's data, and the value is in
// catching the next one.
//
// SCOPED DELIBERATELY TO `team`. A blanket ban on `.includes(` would flag
// hundreds of legitimate string and array uses, and a guard nobody can live with
// gets switched off rather than believed (LESSONS #4). `team` is where the
// hazard is measurable and the pattern is unambiguous.

// A `NORMALISED = /\.map\(\s*String\s*\)/` guard stood here to let
// `(op.team || []).map(String).includes(String(pid))` through. MUTATION TESTING
// PROVED IT DEAD: removing it changed no assertion, because the pattern below
// requires `.includes(` to sit DIRECTLY on `team`, and a `.map(String)` in
// between already prevents a match. Two mechanisms for one exclusion is a place
// for them to drift apart, so the pattern says it once.
//
// KNOWN GAP, recorded rather than papered over: the HALF-normalised
// `(op.team || []).map(String).includes(pid)` — stringified team, raw member —
// is a real defect and is NOT caught, by the regex or by the guard that used to
// be here. Catching it needs the member expression analysed rather than matched,
// which is a parser, not a grep.

/**
 * Raw team-membership comparisons in `src`.
 * @returns {{line: number, text: string, member: string}[]}
 */
export function membershipViolations(src) {
  const out = [];
  const lines = String(src == null ? "" : src).split(/\r?\n/);
  // Block comments are stripped across the whole file first, then line comments
  // per line: an entry or a header that QUOTES the banned form in order to
  // explain it must not be a violation of itself (LESSONS #5).
  const noBlocks = String(src == null ? "" : src).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const stripped = noBlocks.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ""));

  // `X.team.includes(Y)` and `(X.team || []).includes(Y)`, in spaced or
  // minified spelling. The member expression is captured so the finding can name
  // what was being tested rather than only where.
  const RE = /(?:\(\s*[\w.?[\]]*\.?team\s*\|\|\s*\[\s*\]\s*\)|[\w.?[\]]*\.team)\s*\.includes\(\s*([^)]+?)\s*\)/g;
  stripped.forEach((line, i) => {
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(line))) {
      out.push({ line: i + 1, text: lines[i], member: m[1].trim() });
    }
  });
  return out;
}
