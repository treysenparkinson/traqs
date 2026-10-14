// #356. A DELETED JOB IS NOT WORK, AND THE STATS PAGE WAS COUNTING IT AS WORK.
//
// A delete here is a TOMBSTONE: `deletedAt` goes on the job and the children are
// left alone. So an op two levels down keeps its dates, its team and its
// unfinished status, and any traversal that does not check its ANCESTORS reads
// it as live work.
//
// Measured on Matrix before this was written: 49 of 114 jobs are deleted and
// hold 745 ops carrying no tombstone of their own — 565 dated and unfinished,
// 531 teamed, 258 ending today or later. The Stats page's per-person operation
// count showed 681 where the truth is 261, OVERSTATED BY 62%, and four people
// (Chelsea, Andrew, Noah, Carlo) were shown work when they have none at all.
//
// THE CONSUMER WAS FOUND BY READING, NOT BY PATTERN. An earlier regex sweep
// flagged 396 ".subs loops with no deletedAt nearby" and was reported as an
// upper bound rather than a count — correctly, because it scored
// `occupyingUnits` as unguarded when that function checks all three levels.
// This suite pins the one real consumer and the shared helper it now uses.
//
//   node scripts/deleted-job-reach-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(SRC);

console.log("\n1. THE WALK SKIPS A TOMBSTONE AT EVERY LEVEL");
{
  // A job, a panel and an op can each be tombstoned independently, so a filter
  // at one level only is the same defect with a smaller blast radius.
  const { liveOpsOf } = await import("../src/liveTree.js");
  const tree = [
    { id: "J1", subs: [{ id: "P1", subs: [{ id: "O1" }, { id: "O2", deletedAt: "x" }] },
                        { id: "P2", deletedAt: "x", subs: [{ id: "O3" }] }] },
    { id: "J2", deletedAt: "x", subs: [{ id: "P3", subs: [{ id: "O4" }] }] },
  ];
  ok("only the op with no tombstone above it survives", liveOpsOf(tree).map(o => o.id), ["O1"]);
  ok("a deleted OP is skipped", liveOpsOf(tree).some(o => o.id === "O2"), false);
  ok("an op under a deleted PANEL is skipped", liveOpsOf(tree).some(o => o.id === "O3"), false);
  ok("an op under a deleted JOB is skipped", liveOpsOf(tree).some(o => o.id === "O4"), false);
  ok("a null job does not throw", liveOpsOf([null, undefined]).length, 0);
  ok("a job with no subs does not throw", liveOpsOf([{ id: "J" }]).length, 0);
  ok("nothing at all returns nothing", liveOpsOf(null), []);
}

console.log("\n2. THE STATS PAGE USES IT");
{
  ok("allOps is built from the shared walk", /const allOps = liveOpsOf\(tasks\);/.test(CODE), true);
  ok("...and no longer flatMaps the raw tree",
    /const allOps = tasks\.flatMap\(j => \(j\.subs \|\| \[\]\)\)/.test(CODE), false);
  ok("TRAQS imports it", /import \{[^}]*liveOpsOf[^}]*\} from "\.\/liveTree\.js"/.test(CODE), true);
}

console.log("\n3. THE PER-PERSON COUNT COMPARES IDS THE WAY THE REST OF THE FILE DOES");
{
  // Found in the same line. `.includes(p.id)` is strict, and person ids are
  // mixed string/number across web, iOS and the stored history — the silent
  // half of the drift family (#340, #345). The sibling two lines up already
  // used `onTeam`; this one did not.
  ok("the unfinished-operation count uses onTeam",
    // #504: "unfinished" reads the org's list (isFinished), not the spelling.
    /count: allOps\.filter\(op => onTeam\(op\.team, p\.id\) && !isFinished\(op\.status\)\)\.length/.test(CODE), true);
  // SCOPED TO THE LINE THIS ENTRY CHANGED, deliberately. A file-wide assertion
  // was written first and failed on two sites it had no business claiming:
  // `TRAQS.jsx:5837` and `:9560` are the same strict-compare family and are NOT
  // part of #356 — widening the assertion to cover them would either force
  // unrelated edits into this change or stand red. Logged in the entry instead.
  ok("the stats block's own team compare is no longer strict",
    /allOps\.filter\(op => \(op\.team \|\| \[\]\)\.includes\(p\.id\)/.test(CODE), false);
  // NO COUNT ASSERTION ON THE SURVIVORS, and that is a decision rather than an
  // omission. A first draft pinned "exactly two" and the real number is six
  // (TRAQS.jsx:5837, 9560, 11186, 18835, 30845, 32286) — but a count here would
  // go RED the moment somebody fixed one of them, which punishes the right
  // action and teaches people to edit the test. The population is recorded in
  // the entry, where a number belongs; the assertion stays on the one line this
  // change owns.
}

console.log("\n4. WHAT MUST NOT HAVE MOVED");
{
  ok("myOps still filters by onTeam", /const myOps = allOps\.filter\(op => onTeam\(op\.team, personId\)\)/.test(CODE), true);
  // The overlap rule already walked all three levels and is not this entry's
  // business; asserted so a later tidy-up does not route it through the new
  // helper and change what "takes part" means.
  const OR = readFileSync(new URL("../src/overlapRules.js", import.meta.url), "utf8");
  ok("occupyingUnits still does its own three-level walk", /if \(!job \|\| job\.deletedAt\) continue;/.test(OR), true);
  ok("...and still filters panels", /if \(!panel \|\| panel\.deletedAt\) continue;/.test(OR), true);
  ok("...and still filters ops", /\(panel\.subs \|\| \[\]\)\.filter\(o => o && !o\.deletedAt\)/.test(OR), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
