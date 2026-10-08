#!/usr/bin/env node
// #486. Job Duplicate is removed entirely, and everything it was the only caller
// of goes with it.
//
// THE CHAIN, each link verified rather than assumed:
//   the Duplicate button (Job Details)  -> the only caller of
//   duplicateJobAction (TRAQS.jsx)      -> the only caller of
//   duplicateJob (src/jobDetail.js)     -> the only caller of
//   copyForDuplicate (src/copyRules.js)
//
// So removing the button strands three functions. The point of the removal is
// less surface, so they go too — including `copyForDuplicate`, which #466 built.
// `copyForSplit` and `copyForTemplate` keep their callers and stay, and so do
// WORK_RECORD and ENGAGEMENT_IDENTITY, which the template consumer still reads.
//
//   node scripts/duplicate-removed-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const TQ = read("../src/TRAQS.jsx");
const JD = read("../src/jobDetail.js");
const CR = read("../src/copyRules.js");

console.log("\n1. THE SURFACE IS GONE");
{
  ok("no Duplicate button", /onClick=\{\(\) => duplicateJobAction\(job\)\}/.test(TQ), false);
  ok("...and the word is not left behind as a label", /<Btn size="sm" variant="secondary"[^>]*>Duplicate<\/Btn>/.test(TQ), false);
}

console.log("\n2. NOTHING IS STRANDED — the whole chain goes");
{
  ok("duplicateJobAction is gone", /duplicateJobAction/.test(TQ), false);
  ok("TRAQS no longer imports duplicateJob", /import \{[^}]*duplicateJob[^}]*\} from "\.\/jobDetail\.js"/.test(TQ), false);
  ok("duplicateJob is gone from jobDetail", /export function duplicateJob/.test(JD), false);
  ok("jobDetail no longer imports copyForDuplicate", /copyForDuplicate/.test(JD), false);
  ok("copyForDuplicate is gone from copyRules", /export function copyForDuplicate/.test(CR), false);
  ok("nothing anywhere still calls it", /copyForDuplicate\(/.test(TQ + JD + CR), false);
}

console.log("\n3. WHAT MUST SURVIVE, so the removal is not over-broad");
{
  // jobDetail.js keeps its other exports — they have their own callers.
  for (const f of ["subJobNumber", "jobSessions", "crewHours"]) {
    ok(`jobDetail still exports ${f}`, new RegExp(`export function ${f}|export const ${f}`).test(JD), true);
    ok(`...and TRAQS still imports it`, new RegExp(`import \\{[^}]*${f}[^}]*\\} from "\\./jobDetail\\.js"`).test(TQ), true);
  }
  // The copy rule keeps the two consumers that still have callers.
  ok("copyForSplit survives", /export function copyForSplit/.test(CR), true);
  ok("copyForTemplate survives", /export function copyForTemplate/.test(CR), true);
  ok("...and both are still called", [/copyForSplit\(/.test(read("../src/dragMove.js")), /copyForTemplate\(/.test(CR)], [true, true]);
  // ENGAGEMENT_IDENTITY was shared by duplicate and template; the template keeps it.
  ok("ENGAGEMENT_IDENTITY survives, because the template still drops it",
    /export const ENGAGEMENT_IDENTITY/.test(CR) && /\.\.\.ENGAGEMENT_IDENTITY/.test(CR), true);
  ok("WORK_RECORD survives", /export const WORK_RECORD/.test(CR), true);
  // The Job Details header keeps its other actions.
  // RE-ANCHORED 2026-10-08 (#495): this pinned the header's Edit button, which
  // has since been retired too. Export is what remains, and it is the thing this
  // assertion exists to prove — that removing Duplicate did not take the rest of
  // the header with it.
  ok("the job header still has Export", /onClick=\{\(\) => openJobExport\(fresh\)\}>Export<\/Btn>/.test(TQ), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
