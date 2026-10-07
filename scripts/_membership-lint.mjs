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
 * A PERSON ID USED AS A MAP KEY, OR AS A LOOKUP INTO ONE, WITHOUT `String()`
 * (#384). The third shape in this family, and the one that cost the most.
 *
 * `people.js` built `new Map(existing.map(p => [p.id, p]))` and read it with
 * `existingMap.get(p.id)`, while `reconcileDeletions` — walking the SAME array
 * — compared `String(rec.id)`. On 2026-08-12 a client normalised two numeric
 * ids to strings; those two records matched the reconciler (so survived) and
 * missed this map (so were stripped), losing their PINs, their push tokens,
 * their active clock and an approved PTO entry in one write.
 *
 * WHAT THIS CANNOT DO, recorded rather than pretended away: it cannot check that
 * a map's KEY and its LOOKUP agree. That is a correlation between two
 * expressions bound by a variable, often many lines apart, and matching it needs
 * the code parsed rather than scanned. So the rule is the stricter, checkable
 * one — **always stringify, on both sides** — which makes agreement automatic
 * without ever having to prove it.
 *
 * Scoped to `.id` keys on object-building `new Map(...)` and to reads of an
 * identifier ending `Map`/`ById`, because those are where the drift is
 * measurable and the shape unambiguous.
 *
 * @returns {{line: number, text: string, member: string}[]}
 */
export function idKeyViolations(src) {
  const out = [];
  const lines = String(src == null ? "" : src).split(/\r?\n/);
  const noBlocks = String(src == null ? "" : src).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const stripped = noBlocks.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ""));

  // `new Map(xs.map(v => [v.id, …]))` — the key side.
  const KEY = /new\s+Map\(\s*[\w.?[\]]+\s*\.map\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\[\s*\1\.id\b/g;
  // `fooMap.get(v.id)` / `fooById.has(v.id)` — the lookup side.
  // `byId` and `ById` both occur in this codebase, so the suffix is matched in
  // either casing — a rule that misses half its own naming convention is worse
  // than no rule, because the gap is invisible from the passing build.
  const GET = /\b(\w*(?:Map|[Bb]yId))\s*\.\s*(?:get|has)\(\s*([\w.?[\]]*\.id)\s*\)/g;

  stripped.forEach((line, i) => {
    let m;
    KEY.lastIndex = 0;
    while ((m = KEY.exec(line))) out.push({ line: i + 1, text: lines[i], member: `${m[1]}.id (map key)` });
    GET.lastIndex = 0;
    while ((m = GET.exec(line))) out.push({ line: i + 1, text: lines[i], member: `${m[2]} (${m[1]} lookup)` });
  });
  return out;
}

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
  const TEAM = String.raw`(?:\(\s*[\w.?[\]]*\.?team\s*\|\|\s*\[\s*\]\s*\)|[\w.?[\]]*\.team)`;
  const RE = new RegExp(TEAM + String.raw`\s*\.includes\(\s*([^)]+?)\s*\)`, "g");

  // #436. THE SECOND SPELLING, and it passed clean through every build for five
  // months: `Array.from(new Set([...(op.team || []), personId]))`.
  //
  // A Set dedupes by `===`, so this is the SAME HAZARD as `.includes` wearing
  // different clothes — a member stored as the number 7 and added as the string
  // "7" both survive, and the same human is on the op twice. Silent, like the
  // rest of the family.
  //
  // THE COMMA IS THE WHOLE TEST. `new Set([...(op.team || [])])` with nothing
  // after it is a plain dedupe of one array and is not a membership comparison
  // at all, so it is left alone — a guard that flags harmless code is a guard
  // that gets switched off (LESSONS #4).
  const RE_SET = new RegExp(String.raw`new\s+Set\(\s*(\[)\s*\.\.\.\s*` + TEAM + String.raw`\s*,\s*([^,\]]+?)\s*[,\]]`, "g");

  // THE `.map(String)` GUARD IS ALIVE FOR THIS PATTERN, and that is worth saying
  // because the header above records it being removed as DEAD for `.includes`.
  // It was dead there because `.includes` has to sit directly on `team`, so a
  // `.map(String)` in between already prevented a match. Here the normaliser
  // sits on the ARRAY LITERAL, after the spreads and outside anything the regex
  // can see:
  //
  //     [...new Set([...(panel.team || []), ...ops.flatMap(o => o.team || [])].map(String))]
  //
  // That is SAFE — every id is a string before the Set ever dedupes — and it is
  // live code in the job-detail panel roll-up. Flagging it would be a false
  // positive on the first file the extension ran against, which is how a guard
  // stops being believed (LESSONS #4). So the array's extent is found by
  // matching brackets rather than guessed at, and a normalised one is excluded.
  const normalised = (line, openAt) => {
    let depth = 0;
    for (let k = openAt; k < line.length; k++) {
      const c = line[k];
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) return /^\s*\.map\(\s*String\s*\)/.test(line.slice(k + 1));
      }
    }
    return false;   // unbalanced on this line — report it rather than assume
  };

  stripped.forEach((line, i) => {
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(line))) out.push({ line: i + 1, text: lines[i], member: m[1].trim() });
    RE_SET.lastIndex = 0;
    while ((m = RE_SET.exec(line))) {
      if (normalised(line, m.index + m[0].indexOf("["))) continue;
      out.push({ line: i + 1, text: lines[i], member: m[2].trim() });
    }
  });
  return out;
}
