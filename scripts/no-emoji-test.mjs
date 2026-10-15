// No emoji in the app — #350, the standing no-emoji rule.
//
// "Emoji" here is what renders as a colour pictograph: anything with Unicode's
// Emoji_Presentation property, plus everything in the U+1F000 block (🗑, 👁 and 🏗 lack the
// property but have no text glyph in any UI font, so they draw as emoji regardless). Dingbats
// and arrows with TEXT presentation — ✕ ✓ ⚠ ↔ ▲ — are type, not emoji, and stay; the
// 2026-09-08 audit said the same.
//
// Every file under src/, comments included: a comment is where a pasted emoji waits to be
// copied into JSX.
//
//   node scripts/no-emoji-test.mjs

import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const EMOJI = /[\p{Emoji_Presentation}\u{1F000}-\u{1FAFF}]/gu;

const walk = (d) => readdirSync(new URL(d, import.meta.url), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(`${d}${e.name}/`) : [`${d}${e.name}`]);
const files = walk("../src/").filter(f => /\.(jsx?|mjs|css|html)$/.test(f));
ok(`src/ was walked (${files.length} files)`, files.length > 20);

const hits = [];
for (const f of files) {
  readFileSync(new URL(f, import.meta.url), "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(EMOJI)) hits.push(`${f.replace("../", "")}:${i + 1} ${m[0]}`);
  });
}
ok(`#350 no emoji anywhere in src/ (found ${hits.length}${hits.length ? ": " + hits.join(", ") : ""})`, hits.length === 0);

// The rule must not catch what it is meant to leave alone.
ok("the dingbats the app uses are not counted as emoji", !"✕✓⚠↔▲▼↩⇅✎✉✖✗".match(EMOJI));
ok("...while the ones it removed are", ["🗑", "👁", "🏗", "⛔", "➕", "✨", "⚪", "🔧"].every(e => e.match(EMOJI)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
