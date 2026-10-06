// #418 — the scanner 23 suites assert against must not delete code.
//
// `codeOf` was two regexes. The first, `\{\s*\/\*[\s\S]*?\*\/\s*\}`, was meant for
// a JSX comment `{/* … */}`. But a CSS rule inside a template literal also opens
// with `{`, and its first declaration is very often a `/* comment */` — so the
// match STARTS at the rule's brace and runs forward to the next `*/` that happens
// to sit before a `}`, hundreds of lines later. Two such matches swallowed 298 and
// 459 lines of TRAQS.jsx. Worse, they consumed `/*` and `*/` unevenly, leaving the
// plain block-comment pass that runs next unbalanced, which ate more.
//
// MEASURED BEFORE THE FIX, counting only lines that unambiguously begin with a
// JS/JSX token: 772 of 20,598 (3.7%) were absent from the view, 264 of them
// declaring or animating something. `hexToHsl` and `brandGrad` were gone entirely.
//
// EVERY "the old spelling is gone" ASSERTION NAMING ANYTHING IN THAT GAP WAS GREEN
// FOR FREE — and this campaign's wiring assertions are overwhelmingly that shape.
// The file's own header warns that a drifted scanner "is the quietest kind of
// broken test: it keeps passing". It was that test.
//
//   node scripts/code-view-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const has = (src, needle) => codeOf(src).includes(needle);

console.log("\n1. THE BUG — a CSS comment inside a rule must not eat the file");
{
  // This is the exact shape at TRAQS.jsx:1267 and :2197.
  const src = [
    "const CSS = `",
    ".anim-tab {",
    "  /* the press squeeze */",
    "  transition: all 0.32s;",
    "}",
    ".other { color: red; /* trailing */ }",
    "`;",
    "const KEEPME = 1;",
  ].join("\n");
  ok("RED: code after the rule survives", has(src, "const KEEPME = 1;"), true);
  ok("RED: so does the declaration after the comment", has(src, "transition: all 0.32s;"), true);
  ok("...and the second rule", has(src, ".other { color: red;"), true);
  ok("the comments themselves are gone", /press squeeze|trailing/.test(codeOf(src)), false);
  // A CSS comment inside a template literal is stripped, and that is deliberate:
  // this app's whole stylesheet lives in template literals, and a rule's comment
  // names what the rule replaced — exactly the prose that satisfies an assertion
  // about the code. `//` is NOT stripped there, because it is not a CSS comment
  // and inside a template it is almost always a URL.
  ok("a // inside a template is left alone", has("const css = `a { background: url(https://x/y) }`;", "https://x/y"), true);
  // A stray `/*` in template DATA must not reach past the template to delete code.
  ok("an unbalanced /* in template data stays put",
    has("const a = `x /* y`;\nconst AFTER = 12;", "const AFTER = 12;"), true);
  ok("...and one that would span an interpolation",
    has("const a = `/* ${v} */`;\nconst AFTER = 13;", "const AFTER = 13;"), true);
  // The point of that guard is the INTERPOLATION, not the line after it: a comment
  // allowed to span `${v}` would delete the expression inside. Asserting only that
  // AFTER survived let the mutant through on the first run.
  ok("...and the interpolation it would have eaten survives",
    has("const a = `/* ${v} */`;", "${v}"), true);
}

console.log("\n2. A REAL JSX COMMENT IS STILL REMOVED");
{
  const src = "<div>\n  {/* a note standing where markup used to be */}\n  <Thing />\n</div>";
  ok("the note is gone", /a note standing/.test(codeOf(src)), false);
  ok("the markup around it survives", [has(src, "<Thing />"), has(src, "<div>")], [true, true]);
  // Multi-line JSX comments too, which is why the regex existed at all.
  const multi = "<div>\n  {/* line one\n      line two */}\n  <Keep />\n</div>";
  ok("a multi-line JSX comment goes", /line two/.test(codeOf(multi)), false);
  ok("...and what follows stays", has(multi, "<Keep />"), true);
}

console.log("\n3. COMMENT MARKERS INSIDE STRINGS ARE NOT COMMENTS");
{
  ok("a // inside a double-quoted string", has(`const u = "https://traqs.example/api";`, "https://traqs.example/api"), true);
  ok("a // inside a single-quoted string", has(`const u = 'a//b';`, "'a//b'"), true);
  ok("a // inside a template literal", has("const u = `x//y`;", "`x//y`"), true);
  ok("a /* inside a string", has(`const u = "/*not a comment*/";`, "/*not a comment*/"), true);
  ok("...and the code after it", has(`const u = "/*x*/"; const AFTER = 2;`, "const AFTER = 2;"), true);
  // An escaped quote must not end the string early.
  ok("an escaped quote", has(`const u = "a\\"// still string"; const AFTER = 3;`, "const AFTER = 3;"), true);
}

console.log("\n4. JSX TEXT IS NOT A STRING — an apostrophe must not swallow the file");
{
  // A naive scanner opens a string on the apostrophe in "don't" and never closes
  // it, losing everything after. The guard is that a quote which does not close on
  // its own line is a character, not a delimiter.
  const src = "<p>don't do that</p>\nconst AFTER = 4;";
  ok("code after an apostrophe survives", has(src, "const AFTER = 4;"), true);
  ok("...and so does the text", has(src, "don't do that"), true);
  const two = "<p>it's a user's choice</p>\nconst AFTER = 5;";
  ok("two apostrophes on one line still survive", has(two, "const AFTER = 5;"), true);
  // AND THE SCANNER MUST STILL BE SCANNING AFTERWARDS. Surviving the apostrophe is
  // not enough — if it recovers by emitting the rest of the file verbatim, every
  // comment after it is kept, and a presence assertion can then be satisfied by
  // prose. That mutant survived the first run of this suite.
  ok("a comment AFTER an apostrophe is still stripped",
    /secret prose/.test(codeOf("<p>don't</p>\n// secret prose\nconst AFTER = 15;")), false);
}

console.log("\n5. A TRAILING LINE COMMENT IS CUT, THE CODE BEFORE IT IS NOT");
{
  const src = "const a = 1; // explains a\nconst b = 2;";
  ok("the code survives", [has(src, "const a = 1;"), has(src, "const b = 2;")], [true, true]);
  ok("the explanation does not", /explains a/.test(codeOf(src)), false);
  // THE REASON THIS MATTERS: a trailing comment naming the pattern a fix removed
  // would otherwise satisfy a presence assertion about the code.
  ok("a trailing comment cannot satisfy a code assertion",
    /oldSpelling\(/.test(codeOf("newSpelling(); // was oldSpelling()")), false);
}

console.log("\n6. ADJACENCY IS PRESERVED — whole-line comments drop their line");
{
  // Assertions of the form /A\n\s*B/ depend on this: #403's save-skip assertion
  // matched two statements as ADJACENT lines with the comment between them gone.
  // ASSERTED AS THE EXACT OUTPUT, not with `\s*` between them. `/A\n\s*B/` matches
  // a BLANK LINE between A and B just as happily as nothing, so it could not tell
  // "the comment line was dropped" from "the comment line was blanked and kept" —
  // and the mutant that stopped dropping them survived the first run.
  const src = "setSaveStatus(\"saved\");\n// why we return here\nreturn;";
  ok("the two statements are adjacent", codeOf(src), "setSaveStatus(\"saved\");\nreturn;");
  const jsdoc = "/**\n * docs\n */\nconst f = 1;";
  ok("a JSDoc block drops its lines too", codeOf(jsdoc), "const f = 1;");
  ok("a genuinely blank line is kept", codeOf("const a = 1;\n\nconst b = 2;").split("\n").length, 3);
  // A blank line AFTER a block comment is where line alignment shows: the filter
  // reads `before[idx]` to tell a blanked comment from a real empty line, so a
  // block comment that does not preserve its newlines shifts every index after it.
  ok("a blank line after a block comment survives", codeOf("a;\n/* x\n y */\n\nb;"), "a;\n\nb;");
}

console.log("\n7. REGEX LITERALS ARE NOT COMMENTS");
{
  // THE FIXTURE HAS TO CONTAIN A REAL `//`. `/a\/\/b/` does not — its characters
  // are `\`,`/`,`\`,`/`, never two slashes side by side — so it proved nothing and
  // the "regex detection removed" mutant survived. A character class does: the
  // `]` ... `\/` ... `/` tail of `/[^/]*\//` puts two slashes together.
  ok("a regex whose body really contains //", has("const re = /[^/]*\\//; const AFTER = 14;", "const AFTER = 14;"), true);
  ok("a regex containing escaped slashes", has("const re = /a\\/\\/b/; const AFTER = 6;", "const AFTER = 6;"), true);
  ok("...and one that looks like a block comment opener", has("const re = /\\/\\*/; const AFTER = 7;", "const AFTER = 7;"), true);
  // Division must not be mistaken for a regex and swallow the rest of the line.
  ok("division survives", has("const x = a / b; const AFTER = 8;", "const AFTER = 8;"), true);
  ok("...and a percentage in JSX text", has("<p>50% / 50%</p>\nconst AFTER = 9;", "const AFTER = 9;"), true);
}

console.log("\n8. TEMPLATE INTERPOLATION RETURNS TO CODE");
{
  const src = "const s = `a${ b /* gone */ }c`;\nconst AFTER = 10;";
  ok("a comment inside ${} is removed", /gone/.test(codeOf(src)), false);
  ok("...and the template survives", has(src, "const AFTER = 10;"), true);
  const nested = "const s = `a${ `inner ${x}` }b`;\nconst AFTER = 11;";
  ok("nested templates survive", has(nested, "const AFTER = 11;"), true);
}

console.log("\n9. IT MUST NEVER THROW, AND NEVER RETURN NOTHING");
{
  ok("null", codeOf(null), "");
  ok("undefined", codeOf(undefined), "");
  ok("an unterminated block comment does not eat a file it cannot close",
    codeOf("const A = 1;\n/* never closed\nconst B = 2;").includes("const A = 1;"), true);
  ok("an unterminated template", codeOf("const A = 1;\nconst s = `oops").includes("const A = 1;"), true);
}

console.log("\n10. ON THE REAL FILE — the 772 lines come back");
{
  const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  const CODE = codeOf(SRC);
  // The three probes that found this: a stagger delay, and two whole functions.
  ok("RED: the stagger delay at :19313 is in the view", /\$\{pi \* 38\}ms/.test(CODE), true);
  ok("RED: hexToHsl is in the view", /function hexToHsl\(/.test(CODE), true);
  ok("RED: brandGrad is in the view", /function brandGrad\(/.test(CODE), true);
  // And the measurement itself, as a ratchet rather than a number to admire.
  // A line carrying a TRAILING comment is legitimately rewritten by the scanner,
  // so it cannot be compared verbatim — those are excluded rather than counted as
  // losses. Everything else must survive character for character.
  const isCode = (l) => {
    const t = l.trim();
    // ...and it must also END like code. Prose INSIDE a block comment does not
    // start with `*`, so nothing but the terminator tells it from a statement:
    // "static." and "-- a 4px card lift and two 22px glows --" both parse as
    // "starts with a word" otherwise.
    // A line carrying ANY comment is legitimately rewritten, so it cannot be
    // compared verbatim. What is left must carry a STRONG code signature — prose
    // inside a block comment does not start with `*`, so the signature is the only
    // thing telling "static." and "…and two 22px glows --" from a statement.
    return !!t && !t.includes("//") && !t.includes("/*") && !t.includes("*/")
      && !/^\*/.test(t)
      && /[;{},)>]$/.test(t)
      && /(=>|\bconst |\blet |\bfunction |\breturn )/.test(t)
      // ...and START like code. "The optimizer function that … was gone long
      // before," carries the signature and the terminator and is still prose.
      && /^(const |let |var |return |if |function |<|\}|\{|[A-Za-z_$][\w$]*\s*[:(=.])/.test(t);
  };
  const lines = SRC.split(/\r?\n/).filter(isCode);
  const lost = lines.filter((l) => !CODE.includes(l.trim()));
  console.log(`         (${lines.length} unambiguous code lines, ${lost.length} absent)`);
  ok("no unambiguous code line is missing from the view", lost.slice(0, 5), []);
  // Comments must still actually go, or this "fix" is just not stripping anything.
  ok("the view is smaller than the source", CODE.length < SRC.length, true);
  ok("...and a known comment is gone", /quietest kind of broken test/.test(codeOf(readFileSync(new URL("./_code-view.mjs", import.meta.url), "utf8"))), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
