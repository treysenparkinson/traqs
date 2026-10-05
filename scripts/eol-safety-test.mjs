// #376 — a suite that reads a repo file and matches a MULTI-LINE pattern against
// it must normalise newlines first, or it cannot work on a CRLF checkout.
//
// This repo is checked out with core.autocrlf=true: the index holds LF, the
// working copy holds CRLF, and every literal written inside a .mjs file is LF.
// So any pattern spanning a newline compares LF against CRLF and never matches.
//
// That failure has two faces and the second is the dangerous one:
//   LOUD  — a positive assertion stops matching, and the suite goes red for a
//           reason that has nothing to do with the code (schedule-parity, #376).
//   QUIET — a NEGATIVE assertion ("this bad pattern is absent") can no longer
//           match anything, so it passes vacuously and reports code as correct
//           without ever looking at it. #314 found four permission gates reading
//           green for a week that way.
//
// web-gates-test fixed its own instance in 2609224 and schedule-parity was
// written afterwards with the same flaw, which is why this is a SUITE and not a
// one-off sweep: the pattern comes back every time somebody writes a new suite.
//
//   node scripts/eol-safety-test.mjs

import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("./", import.meta.url);
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// Every suite in the directory, minus this one and the shared helpers.
const SKIP = new Set(["eol-safety-test.mjs", "_code-view.mjs"]);
const files = readdirSync(DIR).filter(f => f.endsWith(".mjs") && !SKIP.has(f));

// ── the detector ───────────────────────────────────────────────────────────
// Precision matters more than reach here. A scan that flags every suite holding
// a "\n" anywhere flags the ones that build in-memory fixtures too, and a list
// of 27 names that are mostly fine is a list nobody reads — the same failure as
// a permanently red build.
//
// So: find the variables that hold FILE CONTENT, then ask whether a newline
// pattern is ever matched against one of THOSE.
// The forms that actually normalise: an explicit CRLF replace, an EOL-aware
// split (what codeOf does), or going through codeOf itself.
const NORMALISES = /replace\(\s*\/\\r\\n\/g\s*,\s*["'`]\\n["'`]\s*\)|split\(\s*\/\\r\?\\n\/|codeOf\s*\(/;

const fileVarsOf = (src) => {
  const vars = [];
  // const X = readFileSync(...)  — and NOT immediately normalised on the same
  // expression, nor wrapped in codeOf(), which normalises internally.
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(codeOf\s*\()?\s*readFileSync\(([^;]*?)\);/g)) {
    const [whole, name, wrappedInCodeOf] = m;
    if (wrappedInCodeOf) continue;                       // codeOf normalises
    if (/\.replace\(\s*\/\\r\\n\/g|\.split\(\s*\/\\r\?\\n\//.test(whole)) continue;  // normalised inline
    vars.push(name);
  }
  // const X = codeOf(J) — X is normalised even though J may not be.
  return vars;
};

// NOT every `\n` is a hazard, and getting this wrong in the loose direction is
// what produced a 27-name list that was almost entirely false positives.
//
// A CRLF document CONTAINS "\n" — the sequence is \r THEN \n. So a pattern
// anchored on the newline alone still matches:
//
//   "\n    if (x)"      matches "\r\n    if (x)"     — \n starts the pattern
//   /\s*\n\s*const/     matches "...\r\n  const"     — \s* absorbs the \r
//   /[^\n]*\n\s*/       matches                      — [^\n] absorbs the \r
//
// The hazard is a LITERAL CHARACTER immediately before the newline, because
// that character is then required to sit directly against \n, and on a CRLF
// copy a \r sits between them:
//
//   "… => {\n"          does NOT match "… => {\r\n"  — this is #314's bug
//
// So: flag a newline whose preceding character is a literal. Quantifiers (* ?),
// a character-class negation (^), a literal's opening delimiter and the start of
// a group are all safe, because each can absorb or precede the \r.
const SAFE_BEFORE = new Set(["*", "?", "^", "+", '"', "'", "`", "/", "(", "|", "]", undefined]);
const hazardsIn = (line) => {
  const out = [];
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] !== "\\" || line[i + 1] !== "n") continue;
    if (i >= 1 && line[i - 1] === "\\") continue;        // \\n — an escaped backslash
    out.push(SAFE_BEFORE.has(line[i - 1]) ? null : line.slice(Math.max(0, i - 12), i + 2));
  }
  return out.filter(Boolean);
};

// A whole-file equality compare is the other hazard, and the one schedule-parity
// had: no pattern at all, just `committed !== text` over an entire document.
// No trailing \b: `committed !== text` puts "=" next to " ", and a word
// boundary cannot exist between two non-word characters, so the anchor made the
// pattern unmatchable — it reported schedule-parity clean while schedule-parity
// was the whole reason for writing this.
const WHOLE_FILE_COMPARE = (v) => new RegExp(`(?:\\b${v}\\s*[!=]==|[!=]==\\s*${v}\\b)`);

const bitesOn = (src, vars) => {
  const hits = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^\s*(\/\/|\*)/.test(L)) continue;              // a comment cannot assert
    for (const v of vars) {
      if (!new RegExp(`\\b${v}\\b`).test(L)) continue;
      const hz = hazardsIn(L);
      if (hz.length) { hits.push(`${v} @${i + 1}: …${hz[0]}`); break; }
      if (WHOLE_FILE_COMPARE(v).test(L)) { hits.push(`${v} @${i + 1}: whole-file compare`); break; }
    }
  }
  return hits;
};

const flagged = [];
for (const f of files) {
  const src = readFileSync(new URL(f, DIR), "utf8");
  const vars = fileVarsOf(src);
  if (!vars.length) continue;                     // reads nothing unnormalised
  const hits = bitesOn(src, vars);
  if (hits.length) flagged.push(`${f} (${hits.slice(0, 2).join(", ")})`);
}

console.log("\n1. Every suite that matches multi-line patterns normalises newlines first");
{
  ok(`no suite reads a file unnormalised and matches across lines${flagged.length ? " — " + flagged.join(", ") : ""}`,
    flagged, []);
}

console.log("\n2. The two suites that already fixed this keep their normalisation");
{
  // Named explicitly. If somebody removes the normalisation from either, the
  // generic scan above catches it — but naming them says WHY it is there, which
  // a generic failure message cannot.
  for (const f of ["web-gates-test.mjs", "schedule-parity-test.mjs"]) {
    const src = readFileSync(new URL(f, DIR), "utf8");
    ok(`${f} normalises what it reads`, NORMALISES.test(src), true);

    // The canary must be a WORKING CONDITION, not just a message. Found by
    // mutation: replacing the guard with `if (false)` left the console.error
    // string in place, so an assertion that looked for the wording passed over
    // a canary that could never fire — a guard guarding nothing, which is the
    // exact family this suite exists to catch.
    const lines = src.split(/\r?\n/);
    const at = lines.findIndex(l => /newline normalisation is broken|CR survived|EOL canary is broken/i.test(l));
    ok(`...and carries a canary message`, at >= 0, true);
    let cond = "";
    for (let i = at; i >= 0 && i > at - 6; i--) {
      const m = lines[i].match(/^\s*if\s*\((.*)\)\s*\{?\s*$/);
      if (m) { cond = m[1]; break; }
    }
    ok(`...whose condition is real, not a constant`,
      cond.length > 0 && !/^\s*(false|true|0|1)\s*$/.test(cond), true);
    ok(`...and actually inspects what was read`,
      /\\r|includes\(|test\(/.test(cond) && /[A-Z_]{2,}|committed/.test(cond), true);
  }
}

console.log("\n3. RED PROOF — the comparison really is EOL-sensitive");
{
  // Not a theory: this is the exact arithmetic the parity gate performed.
  const lf = '{\n  "a": 1\n}\n';
  const crlf = lf.replace(/\n/g, "\r\n");
  ok("LF and CRLF forms of one document are NOT equal as strings", lf === crlf, false);
  ok("...and differ by exactly one byte per line", crlf.length - lf.length, 3);
  ok("...while parsing to the same value", JSON.stringify(JSON.parse(lf)) === JSON.stringify(JSON.parse(crlf)), true);
  ok("...so normalising makes them equal", lf === crlf.replace(/\r\n/g, "\n"), true);
  // And the quiet half: a negative assertion over CRLF text can never fire.
  const bad = "if (x) {\n  danger();";
  ok("a NEGATIVE multi-line assertion passes vacuously on a CRLF copy",
    bad.replace(/\n/g, "\r\n").includes(bad), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
