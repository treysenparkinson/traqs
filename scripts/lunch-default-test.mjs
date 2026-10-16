// #331 — THE LUNCH DEFAULT IS WRITTEN ONCE (Trey, 2026-10-13: "point them all at the one default").
//
// `{ time: "12:00", durationMinutes: 30 }` stood as a literal in the org-settings bootstrap
// (twice), the remote-settings fallback, the Time Clock lunch editor and the Time Settings
// inputs — all agreeing with DEFAULT_ORG_SETTINGS.lunch today, and each one edit away from
// not agreeing, which is how #12's day-view overlay drifted. Every one now reads the default.
//
//   node scripts/lunch-default-test.mjs
import { readFileSync } from "node:fs";
import { DEFAULT_ORG_SETTINGS } from "../src/orgDefaults.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
// Code only: a comment may quote the old literal while explaining it (R2).
// LF first: on a CRLF checkout the trailing \r stops `//.*$` matching, so no comment is stripped (#376).
const code = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
  .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");

ok("the default itself is 12:00 for 30 minutes", { ...DEFAULT_ORG_SETTINGS.lunch }, { time: "12:00", durationMinutes: 30 });
ok("no lunch object literal remains in TRAQS.jsx",
  (code.match(/\{\s*time:\s*"12:00",\s*durationMinutes:\s*30\s*\}/g) || []).length, 0);
ok("no half-literal fallback either (`|| { time: \"12:00\" }`, `|| { durationMinutes: 30 }`)",
  (code.match(/\|\|\s*\{\s*(time:\s*"12:00"|durationMinutes:\s*30)\s*\}/g) || []).length, 0);
ok("the bootstrap and fallbacks read DEFAULT_ORG_SETTINGS.lunch",
  (code.match(/DEFAULT_ORG_SETTINGS\.lunch/g) || []).length >= 6, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
