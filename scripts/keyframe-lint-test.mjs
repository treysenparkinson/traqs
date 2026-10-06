// #417 — one name, one @keyframes, and a ratchet so it stays that way.
//
// THE COMMENT PROVES SOMEONE ALREADY LEARNED THIS AND THE CODE DID NOT KEEP IT.
// Above the global declarations in TRAQS.jsx:
//
//   "These have to live in the GLOBAL sheet — toolDrop used to be declared only
//    inside the Jobs view's <style>, so the cascade silently did nothing on every
//    other page, and menuIn was never declared at all despite ~20 call sites."
//
// The declaration was moved and the original was never deleted. A later-parsed
// @keyframes of the same name wins GLOBALLY, so the sheet that comment calls
// authoritative was outranked by two copies — one of them the accent <style>,
// re-injected on every theme change. The bodies were identical once whitespace is
// normalised, which is the whole hazard: nothing looked wrong, and an edit to the
// global one would have changed nothing with no way to tell.
//
//   node scripts/keyframe-lint-test.mjs
import { readFileSync, readdirSync } from "node:fs";
import { keyframeDeclarations, duplicateKeyframes, staleExemptions, ALLOWED_DUPLICATES } from "./_keyframe-lint.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. THE RULE — it finds a duplicate, and says where");
{
  const files = [{ file: "a.js", src: "@keyframes fade { from { opacity: 0 } }" },
                 { file: "b.js", src: "@keyframes fade { from { opacity: 0 } }" }];
  ok("a name declared in two files is a duplicate", duplicateKeyframes(files).map(d => d.name), ["fade"]);
  // `?.` throughout: when a mutant makes the rule report nothing, this suite must
  // FAIL, not crash on [0].where. A crash says the harness broke, not that the
  // property is false — two mutants were "caught" that way on the first run.
  ok("...and both sites are named", duplicateKeyframes(files)[0]?.where, ["a.js:1", "b.js:1"]);
  ok("IDENTICAL BODIES ARE STILL A DUPLICATE — that is the hazard, not an excuse",
    duplicateKeyframes(files)[0]?.identical, true);
  ok("...and differing bodies are reported as differing",
    duplicateKeyframes([{ file: "a.js", src: "@keyframes f { to { opacity: 1 } }" },
                        { file: "b.js", src: "@keyframes f { to { opacity: 0.5 } }" }])[0]?.identical, false);
  // SAME RULE, DIFFERENT FORMATTING, is the shape that actually occurred: the
  // accent sheet's copy was minified and the global one was not. Without
  // whitespace normalisation they read as "different bodies" and the hazard looks
  // like a real override. No fixture exercised this, so the mutant survived.
  ok("spacing does not make two copies of one rule look different",
    duplicateKeyframes([{ file: "a.js", src: "@keyframes f { from { opacity: 0; } to { opacity: 1; } }" },
                        { file: "b.js", src: "@keyframes f{from{opacity:0}to{opacity:1}}" }])[0]?.identical, true);
  // Names carry dashes and digits — `glow-pulse` is in this very stylesheet — and
  // a scan that stops at letters would miss a duplicate of one entirely.
  ok("a dashed name is found", keyframeDeclarations("@keyframes glow-pulse { to { a: 1 } }").map(d => d.name), ["glow-pulse"]);
  ok("a name with a digit is found", keyframeDeclarations("@keyframes fade2 { to { a: 1 } }").map(d => d.name), ["fade2"]);
  ok("...and a dashed name duplicated is reported",
    duplicateKeyframes([{ file: "a.js", src: "@keyframes glow-pulse { to { a: 1 } }" },
                        { file: "b.js", src: "@keyframes glow-pulse { to { a: 2 } }" }]).map(d => d.name), ["glow-pulse"]);
  ok("two declarations in ONE file count too",
    duplicateKeyframes([{ file: "a.js", src: "@keyframes f { to { a: 1 } }\n@keyframes f { to { a: 1 } }" }]).map(d => d.name), ["f"]);
  ok("a name declared once is fine", duplicateKeyframes([{ file: "a.js", src: "@keyframes f { to { a: 1 } }" }]), []);
  ok("no keyframes at all is fine", duplicateKeyframes([{ file: "a.js", src: "const x = 1;" }]), []);
}

console.log("\n2. A REDUCED-MOTION OVERRIDE IS THE MECHANISM WORKING");
{
  // Redefining an animation inside prefers-reduced-motion is how you turn it down.
  // Detected, not listed, because it is structural rather than a judgement call.
  const src = [
    "@keyframes tqPadIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1 } }",
    "@media (prefers-reduced-motion: reduce) {",
    "  @keyframes tqPadIn { from { opacity: 0 } to { opacity: 1 } }",
    "}",
  ].join("\n");
  ok("it is not reported", duplicateKeyframes([{ file: "a.js", src }]), []);
  ok("...and the override is flagged as reduced", keyframeDeclarations(src).map(d => d.reduced), [false, true]);
  // ...but a plain @media is NOT a free pass.
  const other = [
    "@keyframes f { to { a: 1 } }",
    "@media (max-width: 600px) {",
    "  @keyframes f { to { a: 2 } }",
    "}",
  ].join("\n");
  ok("a non-reduced-motion @media is still a duplicate", duplicateKeyframes([{ file: "a.js", src: other }]).map(d => d.name), ["f"]);
  // A closed @media before the declaration must not shelter it.
  const closed = "@media (prefers-reduced-motion: reduce) { .x { a: 1 } }\n@keyframes f { to { a: 1 } }\n@keyframes f { to { a: 2 } }";
  ok("a CLOSED reduced-motion block does not shelter what follows",
    duplicateKeyframes([{ file: "a.js", src: closed }]).map(d => d.name), ["f"]);
}

console.log("\n3. EXEMPTIONS ARE NAMED, AND A STALE ONE IS A FAILURE");
{
  // The real list is EMPTY, so the mechanism is exercised on a fixture list —
  // which is why `allowed` is a parameter rather than read from the module.
  const FIXTURE = { spin: "a reason long enough to be a reason" };
  const twice = [{ file: "a.js", src: "@keyframes spin { to { a: 1 } }" }, { file: "b.js", src: "@keyframes spin { to { a: 1 } }" }];
  ok("an exempt name is not reported", duplicateKeyframes(twice, FIXTURE), []);
  ok("...while the same input without the exemption IS reported",
    duplicateKeyframes(twice, {}).map(d => d.name), ["spin"]);
  // An exemption nobody needs is an excuse the next duplicate borrows.
  ok("an exemption with nothing to exempt is reported as stale",
    staleExemptions([{ file: "a.js", src: "@keyframes spin { to { a: 1 } }" }], FIXTURE), ["spin"]);
  ok("...and is not stale while it is earning its place",
    staleExemptions([{ file: "a.js", src: "@keyframes spin { to { a: 1 } }\n@keyframes spin { to { a: 1 } }" }], FIXTURE), []);
  // THE LIST IS EMPTY ON PURPOSE. The entry that nearly went in it — `spin`,
  // exempted as "loading screens that render before the global sheet is mounted"
  // — was FALSE: the sheet is appended at module load, before anything renders.
  ok("the real exemption list is empty", Object.keys(ALLOWED_DUPLICATES), []);
  ok("...and every entry, if one is ever added, must carry a reason",
    Object.values(ALLOWED_DUPLICATES).every(v => typeof v === "string" && v.length > 20), true);
}

console.log("\n4. THE REAL SOURCE — no name may be declared twice");
{
  const DIR = new URL("../src/", import.meta.url);
  const files = readdirSync(DIR).filter(f => /\.(js|jsx|css)$/.test(f))
    .map(f => ({ file: f, src: readFileSync(new URL(f, DIR), "utf8") }));
  const dupes = duplicateKeyframes(files);
  // RED: toolDrop was declared three times and menuIn twice.
  ok("no keyframe name is declared more than once",
    dupes.map(d => `${d.name} (${d.where.join(", ")})`), []);
  ok("no exemption has gone stale", staleExemptions(files), []);

  // The census must actually be finding things, or an empty result means nothing.
  const all = files.flatMap(f => keyframeDeclarations(f.src));
  console.log(`         (${all.length} declarations, ${new Set(all.map(d => d.name)).size} distinct names)`);
  ok("the census found the stylesheet", all.length > 50, true);
  ok("...including the two this entry is about",
    ["toolDrop", "menuIn"].every(n => all.some(d => d.name === n)), true);
  // The survivors must be the GLOBAL ones. toolDrop/menuIn live together in the
  // static sheet; the accent <style> is re-injected on every theme change and must
  // not carry animations that have nothing to do with the accent.
  const TR = files.find(f => f.file === "TRAQS.jsx").src;
  const accentAt = TR.indexOf("el.textContent = `@keyframes glow-pulse");
  ok("the accent sheet was found", accentAt > 0, true);
  const accent = TR.slice(accentAt, TR.indexOf("`;", accentAt));
  ok("the accent sheet no longer declares toolDrop", /@keyframes toolDrop/.test(accent), false);
  ok("...nor menuIn", /@keyframes menuIn/.test(accent), false);
  ok("...but still declares the ones that DO depend on the accent",
    ["glow-pulse", "optFlash", "newBadgePulse"].every(n => accent.includes(`@keyframes ${n}`)), true);
  ok("the Jobs list header no longer declares toolDrop",
    /<style>\{`@keyframes toolDrop/.test(TR), false);
  ok("the global sheet still declares both",
    /@keyframes menuIn\s+\{[\s\S]{0,200}@keyframes toolDrop\s/.test(TR), true);
  // `spin` was the third case, and the one that nearly earned a false exemption.
  // The global sheet is appended at MODULE LOAD, and App.jsx imports TRAQS
  // statically, so it is on the page before either loading screen renders — both
  // local copies were redundant, not fallbacks.
  const AP = files.find(f => f.file === "App.jsx").src;
  ok("the global sheet is appended at module load, not in a component",
    /if \(!document\.querySelector\('style\[data-traqs\]'\)\) \{ animStyle\.setAttribute/.test(TR), true);
  ok("...and App imports TRAQS statically, so that has already happened",
    /^import TRAQS(,| from)/m.test(AP), true);
  ok("neither loading screen declares spin any more",
    [TR, AP].map(s => /<style>\{`@keyframes spin/.test(s)), [false, false]);
  ok("...and the global sheet still does", /@keyframes spin \{/.test(TR), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
