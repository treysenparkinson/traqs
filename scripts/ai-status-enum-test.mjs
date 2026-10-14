// #448 — THE AI SETS THE ORG'S STATUSES, NOT THE CODE'S FIVE (Trey, 2026-10-13: "build the
// AI's list from the org's statuses").
//
// FAST TRAQS's extraction schema pinned `status` to the five DEFAULTS, so on an org with
// seventeen statuses the model could set five and did not know the other twelve existed —
// #447's shape from a different client. The chat tools already read the org's list
// (`enum: STATUSES`); the extraction schema was a module constant that could not see it. It
// is now built from the list at the call.
//
//   node scripts/ai-status-enum-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const code = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8")
  .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");

ok("no AI schema hard-codes the five default statuses",
  /enum:\s*\["Not Started",\s*"Pending",\s*"In Progress",\s*"On Hold",\s*"Finished"\]/.test(code), false);
ok("the extraction schema is built from a status list", /const extractTool = \(statuses\) => \(\{/.test(code), true);
ok("...whose status enum is that list", /status:\s*\{ type: "string", enum: statuses \}/.test(code), true);
ok("FAST TRAQS passes the org's list", /tools: \[extractTool\(STATUSES\)\]/.test(code), true);
ok("the chat tools still read the org's list", (code.match(/enum: STATUSES/g) || []).length >= 2, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
