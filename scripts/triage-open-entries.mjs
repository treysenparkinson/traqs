#!/usr/bin/env node
// SETTLING "WHAT IS ACTUALLY LEFT" WITHOUT READING 251 ENTRIES BY HAND.
//
// Five of five sampled unmarked entries turned out to be already fixed (#17,
// #34, #38, #54, #78). A sample gives the RATE and not the IDENTITY, so this
// does the two cheap tiers that give identity:
//
//   TIER 1 — AN ENTRY THAT NAMES A SYMBOL WHICH NO LONGER EXISTS CANNOT
//            DESCRIBE LIVE CODE. Every backticked identifier in the entry is
//            looked up across src/ and netlify/. If NONE of them survives, the
//            code the entry is about is gone. This is evidence, not proof — a
//            rename leaves the defect behind — so these are reported as
//            "re-read, probably stale" and not auto-closed.
//
//   TIER 2 — A SUITE THAT CITES THE ENTRY NUMBER CLOSED IT. Many suites were
//            written as the fix and name their entry in the header.
//
// Whatever survives both is the residue: the real unknown, to be read by hand,
// highest-cost-first.
//
//   node scripts/triage-open-entries.mjs

import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const LEDGER_FROM = 1458;   // "## DEFECT LIST"
const RESOLVED = /\b(FIXED|BUILT|CORRECTED|RETIRED|MEASURED|RESOLVED|WITHDRAWN|SUPERSEDED|NON-FINDING|DESIGN CHOICE|Leave as is|CLOSED|VERIFIED STALE|DELETED|ALREADY GONE)\b/;
const NATIVE = /\b(iOS|Swift|macOS|Android|Kotlin)\b/;

const lines = readFileSync("SCHEDULE_MAP.md", "utf8").split(/\r?\n/);
const byNum = new Map();
lines.forEach((l, i) => {
  if (i + 1 < LEDGER_FROM) return;
  const m = /^(\d{1,3})\. (.*)$/.exec(l);
  if (m) byNum.set(Number(m[1]), { n: Number(m[1]), body: m[2] });
});
const ledger = [...byNum.values()].sort((a, b) => a.n - b.n);
const unmarked = ledger.filter(e => !RESOLVED.test(e.body));
const web = unmarked.filter(e => !NATIVE.test(e.body));
console.log(`ledger ${ledger.length} entries; unmarked ${unmarked.length}; unmarked and not native-only ${web.length}\n`);

// One grep of the whole source, once, rather than per symbol.
const SRC = execSync('git ls-files src netlify', { encoding: "utf8" }).split(/\r?\n/)
  .filter(f => /\.(js|jsx|mjs)$/.test(f))
  .map(f => readFileSync(f, "utf8")).join("\n");
const SUITES = readdirSync("scripts").filter(f => f.endsWith(".mjs"))
  .map(f => ({ f, text: readFileSync(`scripts/${f}`, "utf8") }));

// Identifiers only: a backticked token that looks like code, not prose or a path.
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]{3,}$/;
const NOISE = new Set(["true", "false", "null", "undefined", "this", "const", "return", "start", "end", "team", "date", "name", "type", "mode", "hours", "tasks", "people", "data", "logs"]);
const symbolsOf = (body) => [...new Set((body.match(/`([^`]+)`/g) || [])
  .map(s => s.slice(1, -1).trim())
  .flatMap(s => s.split(/[.(){}\[\],\s/:]+/))
  .filter(s => IDENT.test(s) && !NOISE.has(s)))];

const tier1 = [], tier2 = [], residue = [], noSymbols = [];
for (const e of web) {
  // A CITATION IS A CANDIDATE, NOT A CLOSURE. Restricted to real suites — a
  // `measure-*` script naming an entry is the measurement, not the fix, and
  // this file naming one is its own header. `(?!\d)` because `#1` must not
  // match inside `#17`, and the header slice because a suite names the entry
  // it was written for at the top, while a passing mention lower down is just
  // a cross-reference.
  const cited = SUITES.filter(s => s.f.endsWith("-test.mjs")
    && new RegExp(`#${e.n}(?!\\d)`).test(s.text.slice(0, 1200)));
  if (cited.length) { tier2.push({ ...e, by: cited.map(s => s.f) }); continue; }
  const syms = symbolsOf(e.body);
  if (!syms.length) { noSymbols.push(e); continue; }
  const alive = syms.filter(s => SRC.includes(s));
  if (alive.length === 0) tier1.push({ ...e, syms });
  else residue.push({ ...e, syms, alive });
}

console.log(`TIER 2 — a suite names the entry: ${tier2.length}`);
for (const e of tier2) console.log(`  ${String(e.n).padStart(3)}  ${e.body.slice(0, 80)}\n        closed by ${e.by.join(", ")}`);

console.log(`\nTIER 1 — every symbol the entry names is gone from src/ and netlify/: ${tier1.length}`);
for (const e of tier1) console.log(`  ${String(e.n).padStart(3)}  [${e.syms.join(", ")}]  ${e.body.slice(0, 92)}`);

console.log(`\nNO SYMBOL TO CHECK (prose-only entries, must be read): ${noSymbols.length}`);
for (const e of noSymbols) console.log(`  ${String(e.n).padStart(3)}  ${e.body.slice(0, 100)}`);

console.log(`\nRESIDUE — names at least one symbol that still exists: ${residue.length}`);
console.log(`  (this is the real unknown; everything above is accounted for)\n`);
for (const e of residue.slice(0, 1000)) console.log(`  ${String(e.n).padStart(3)}  {${e.alive.slice(0, 4).join(",")}}  ${e.body.slice(0, 95)}`);

console.log(`\n── SUMMARY ──`);
console.log(`  unmarked, not native-only   ${String(web.length).padStart(4)}`);
console.log(`  tier 2, a suite names it    ${String(tier2.length).padStart(4)}`);
console.log(`  tier 1, its symbols are gone${String(tier1.length).padStart(4)}`);
console.log(`  prose-only, must be read    ${String(noSymbols.length).padStart(4)}`);
console.log(`  RESIDUE                     ${String(residue.length).padStart(4)}`);
