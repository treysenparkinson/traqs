// #446 part 1 — THE STATUS AND PRIORITY EDITORS REFUSE A COLLIDING ENTRY.
//
// `statusOpts` held `Finished` AND `finished`, and `Boxed up ` with a trailing space —
// two names `normalizeStatus` reduces to one, and padding nobody can see. The data cure
// (part 2) is a one-time pass on live records; this is what stops it recurring, and it
// touches no data:
//
//   • a name the edit ADDS or RENAMES is trimmed, and refused if it reduces to the same
//     thing as another entry;
//   • an entry the edit did not touch is left byte-for-byte as stored — trimming
//     `Boxed up ` in the list without trimming the job that stores it would orphan that
//     job (#446's coupling note), and refusing the existing `Finished`/`finished` pair
//     would lock Matrix out of its own list until part 2 runs.
//
//   node scripts/status-list-edit-test.mjs
import { readFileSync } from "node:fs";
import * as statusText from "../src/statusText.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const check = statusText.checkOptionNames;
ok("statusText exports checkOptionNames", typeof check, "function");
const run = (draft, source) => (typeof check === "function" ? check(draft, source) : { names: null, problem: "missing" });

const MATRIX = ["Not Started", "In Progress", "Finished", "finished", "Boxed up "];

console.log("\n1. A NEW OR RENAMED NAME THAT COLLIDES IS REFUSED");
ok("adding FINISHED beside Finished", run([...["Not Started", "Finished"], "FINISHED"], ["Not Started", "Finished"]).problem != null, true);
ok("...with a message naming both", /FINISHED/.test(run(["Finished", "FINISHED"], ["Finished"]).problem || "") && /Finished/.test(run(["Finished", "FINISHED"], ["Finished"]).problem || ""), true);
ok("renaming an entry onto another, differing only in spacing", run(["In Progress", "In  progress"], ["In Progress", "On Hold"]).problem != null, true);
ok("renaming to a padded copy of another is refused too", run(["Shipped", " shipped "], ["Shipped", "Crated"]).problem != null, true);
ok("renaming the duplicate onto its twin's exact spelling is refused (two exact copies)",
  run(["Finished", "Finished"], ["Finished", "finished"]).problem != null, true);

console.log("\n2. A NEW OR RENAMED NAME IS TRIMMED");
{
  const r = run(["Not Started", "  Crated  "], ["Not Started"]);
  ok("no problem", r.problem, null);
  ok("the added name is stored trimmed", r.names, ["Not Started", "Crated"]);
}
{
  const r = run(["Not Started", "Ready  for  FAT"], ["Not Started"]);
  ok("inner runs of spaces collapse to one", r.names, ["Not Started", "Ready for FAT"]);
}

console.log("\n3. WHAT THE EDIT DID NOT TOUCH IS LEFT EXACTLY AS STORED");
{
  // Matrix's real list: an unrelated edit (adding one entry) must save.
  const r = run([...MATRIX, "Crated"], MATRIX);
  ok("the existing Finished/finished pair does not block an unrelated edit", r.problem, null);
  ok("...and `Boxed up ` keeps its trailing space (no orphaned job)", (r.names || []).includes("Boxed up "), true);
  ok("...and nothing else moved", r.names, [...MATRIX, "Crated"]);
}
{
  const r = run(MATRIX.filter(n => n !== "Not Started"), MATRIX);
  ok("deleting an entry is not a collision", r.problem, null);
}
{
  const r = run(["Finished", "In Progress"], ["In Progress", "Finished"]);
  ok("reordering is not a collision", r.problem, null);
}

console.log("\n4. THE EDITOR USES IT FOR BOTH ORG LISTS, AND CANNOT SAVE PAST A REFUSAL");
{
  const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  ok("TRAQS.jsx imports checkOptionNames", /import \{[^}]*\bcheckOptionNames\b[^}]*\} from "\.\/statusText\.js"/.test(J), true);
  ok("the options editor checks the draft against the stored list",
    /const optCheck = isStd \? checkOptionNames\(draft\.map\(optName\), source\.map\(optName\)\) : null;/.test(J), true);
  ok("save writes the checked names, and refuses while there is a problem",
    /const save = \(\) => \{ if \(optCheck\?\.problem\) return; if \(isStd\) \(cid === "status" \? setStatusOpts : setPriOpts\)\(draft\.map\(\(o, i\) => \(\{ \.\.\.o, name: optCheck\.names\[i\] \}\)\)\);/.test(J), true);
  ok("the Save button is disabled while there is a problem", /disabled=\{!dirty \|\| !!optCheck\?\.problem\}/.test(J), true);
  ok("the problem is shown", /\{optCheck\?\.problem && <div[^>]*>\{optCheck\.problem\}<\/div>\}/.test(J), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
