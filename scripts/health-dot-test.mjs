// #440 — the health dot, and #445 — the status strings it has to compare.
//
// ─── WHAT I GOT WRONG, BECAUSE THE CORRECTION IS THE POINT ───
//
// I filed #440 saying the dot "reports a data-entry state rather than a work
// state" and that 142 units were ONE DAY from red. Both were wrong, and Trey
// repeated the framing back to me, so it went unchallenged for a turn.
//
// MEASURED: 133 of 182 dated units are genuinely PAST THEIR END DATE and
// unfinished — median 130 days, 75 of them beyond 90. Not one day from red,
// months past it. And every red under today's rule is red under a pure-calendar
// rule, so the dot is not lying about any single unit.
//
// FOUR DIFFERENT RULES PRODUCE THE SAME 133. Today's; dropping the short-circuit;
// red purely on the end date; adding a last-working-day amber. The thresholds
// were never the problem, which is what disproved the framing: if the rule were
// wrong, changing it would move the number.
//
// THE REAL FAULT IS THE LEVEL IT ASKS AT. 110 of the 133 sit on a job in a
// terminal status — the job shipped, its operations were never individually
// closed, and `getHealth` has no rollup, so it judges each one against a
// schedule that stopped mattering the day the job left the building.
//
//   ask the parent, Finished/Shipped only:  133 red -> 42,  on-time 27% -> 74%
//
// E-STRICT, RULED. Not the broader set that also counts FAT and packaging as
// closed: those probably mean the shop is done, and "probably" is how an
// indicator starts lying in the other direction. Widen it with evidence later.
//
// ─── #445, THE PREREQUISITE ───
//
// The org's own status list holds `Finished` AND `finished` as two entries, and
// `Boxed up ` with a trailing space. 11 of Matrix's 28 finished jobs carry the
// lowercase one, so EVERY `status === "Finished"` in the product — 79 of them —
// is blind to 39% of the finished work today. Any rule keyed on a status string
// has to normalise before it can be correct, which is why this lands first.
//
//   node scripts/health-dot-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { normalizeStatus, sameStatus, isClosedStatus, statusLiteralViolations } from "../src/statusText.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const CODE = codeOf(read("../src/TRAQS.jsx"));

console.log("\n1. #445 RED PROOF — the two spellings that cover 28 jobs");
{
  ok("the two entries normalise to one", normalizeStatus("finished"), normalizeStatus("Finished"));
  ok("...and compare equal", sameStatus("finished", "Finished"), true);
  ok("a raw === would not have", "finished" === "Finished", false);
  ok("the trailing space is taken off", normalizeStatus("Boxed up "), "boxed up");
  ok("...and compares equal to the trimmed form", sameStatus("Boxed up ", "Boxed up"), true);
  ok("internal runs of whitespace collapse", normalizeStatus("Shipped/   invoiced"), "shipped/ invoiced");
  ok("null is the empty string, not a crash", normalizeStatus(null), "");
  ok("...and undefined too", normalizeStatus(undefined), "");
  ok("a number is not special-cased into nonsense", normalizeStatus(0), "0");
  ok("two different statuses stay different", sameStatus("Finished", "In Progress"), false);
}

console.log("\n2. #440 — E-STRICT: which statuses close a job");
{
  ok("Finished closes it", isClosedStatus("Finished"), true);
  ok("...in either spelling", isClosedStatus("finished"), true);
  ok("Shipped/ invoiced closes it", isClosedStatus("Shipped/ invoiced"), true);
  ok("Shipped not invoiced closes it", isClosedStatus("Shipped not invoiced"), true);
  // E-BROAD IS NOT BUILT. These are the ones ruled OUT for now, and the
  // assertions exist so widening the set is a deliberate edit with a test that
  // fails, rather than something that drifts in.
  ok("MTX FAT does NOT close it", isClosedStatus("MTX FAT"), false);
  ok("C FAT does not either", isClosedStatus("C FAT"), false);
  ok("Crated does not", isClosedStatus("Crated"), false);
  ok("Boxed up does not", isClosedStatus("Boxed up "), false);
  ok("Ready for Packaging does not", isClosedStatus("Ready for Packaging"), false);
  ok("In Progress certainly does not", isClosedStatus("In Progress"), false);
  ok("an unknown org status does not", isClosedStatus("Procurement"), false);
  ok("an empty status does not", isClosedStatus(""), false);
}

console.log("\n3. #445 — the ratchet over raw status literals");
{
  const V = (s) => statusLiteralViolations(s);
  ok("a raw === against Finished is caught", V(`if (t.status === "Finished") return;`).length, 1);
  ok("...and !== too", V(`const live = xs.filter(x => x.status !== "Finished");`).length, 1);
  ok("...and the minified spelling", V(`if(t.status==="Finished")return;`).length, 1);
  ok("other vocabulary statuses count", V(`if (op.status === "Not Started") n++;`).length, 1);
  ok("the sanctioned helper is clean", V(`if (sameStatus(t.status, "Finished")) return;`).length, 0);
  ok("...and so is isClosedStatus", V(`if (isClosedStatus(job.status)) return "done";`).length, 0);
  ok("a normalised compare is clean", V(`if (normalizeStatus(t.status) === "finished") return;`).length, 0);
  // Not every string called "status" is this vocabulary. Request statuses are
  // server-written lowercase enums and must not be dragged in, or the guard
  // flags correct code and gets switched off (LESSONS #4).
  ok("a request status is not flagged", V(`if (req.status === "approved") return;`).length, 0);
  ok("...nor a finish request", V(`if (fr.status === "pending") n++;`).length, 0);
  ok("a comment quoting the shape is not a violation of itself",
    V(`// never write t.status === "Finished"`).length, 0);

  // A RATCHET, NOT A ZERO, and the gap between them is the finding. 81 raw
  // comparisons stand across 7 files, and on today's data EVERY ONE of them is
  // blind to the 11 jobs whose status is `finished` rather than `Finished` —
  // 39% of the finished work. They do not fade on the gantt, do not count as
  // done in the KPIs, are not skipped by the schedulers, and are not excluded
  // from the overlap rules. Nothing errors.
  //
  // THE CURE IS THE DATA, NOT 81 EDITS: a status list that cannot hold two
  // entries differing only by case or padding, and one normalising pass over
  // what is stored. That is a migration against live data and belongs to its own
  // ruling (#445), so this pass fixes the rule that needed it — the health dot —
  // and stops the eighty-second being written.
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const BASELINE = { "TRAQS.jsx": 69, "timeclock.js": 3, "barPaint.js": 2, "dragMove.js": 2,
    "statsMath.js": 2, "taskActions.js": 2, "overlapRules.js": 1 };
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(f)) files.push(p); } };
  const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  walk(join(root, "src")); walk(join(root, "netlify"));
  const counts = {};
  for (const f of files) {
    const n = statusLiteralViolations(readFileSync(f, "utf8")).length;
    if (n) counts[f.split(/[\\/]/).pop()] = n;
  }
  const names = [...new Set([...Object.keys(counts), ...Object.keys(BASELINE)])].sort();
  ok("no file has MORE raw status comparisons than its baseline",
    names.filter(n => (counts[n] || 0) > (BASELINE[n] || 0)), []);
  ok("...and none has fewer — lower the baseline when one goes",
    names.filter(n => (counts[n] || 0) < (BASELINE[n] || 0)), []);
  ok("no other file has any", names.filter(n => !(n in BASELINE) && counts[n]), []);
  // The health path is the one this pass made correct, so it is held at zero
  // directly rather than by a baseline that could absorb a regression.
  ok("the new health module compares no status literally",
    statusLiteralViolations(read("../src/health.js")).length, 0);
  ok("...nor does statusText itself", statusLiteralViolations(read("../src/statusText.js")).length, 0);
}

console.log("\n4. #440 — the health states, in the order they are decided");
{
  const { healthState } = await import("../src/health.js");
  const TD = "2026-10-07";
  const u = (o) => ({ status: "Not Started", start: "2026-10-01", end: "2026-10-03", ...o });

  // A CLOSED JOB CLOSES ITS WORK. This is the whole fix: 110 of 133 reds.
  ok("an op on a Finished job is done, whatever its own status",
    healthState(u({}), { today: TD, jobStatus: "Finished" }), "done");
  ok("...in the lowercase spelling too, which is 11 of Matrix's 28",
    healthState(u({}), { today: TD, jobStatus: "finished" }), "done");
  ok("...and on a shipped job", healthState(u({}), { today: TD, jobStatus: "Shipped/ invoiced" }), "done");
  ok("but NOT on a job at FAT — E-strict, ruled",
    healthState(u({}), { today: TD, jobStatus: "MTX FAT" }), "critical");

  // The unit's own Finished still wins, with no job in hand.
  ok("its own Finished is done", healthState(u({ status: "Finished" }), { today: TD }), "done");
  ok("...in either spelling", healthState(u({ status: "finished" }), { today: TD }), "done");

  // NOT YET. 12 units were being counted as ON TIME without having begun.
  ok("a unit that has not reached its start is 'notyet'",
    healthState(u({ start: "2026-10-20", end: "2026-10-22" }), { today: TD }), "notyet");
  ok("...and on its start date it IS judged", healthState(u({ start: TD, end: "2026-10-22" }), { today: TD }), "ontime");

  // LATE is a calendar fact.
  ok("past its end and open is late", healthState(u({ end: "2026-10-01" }), { today: TD }), "critical");
  ok("...by one day is still late", healthState(u({ start: "2026-10-01", end: "2026-10-06" }), { today: TD }), "critical");

  // AMBER warns inside the window.
  // 1 Oct -> 10 Oct is 10 days; today is the 7th, so 7/10 is past half.
  ok("in its window with nothing logged, over half gone, needs a look",
    healthState(u({ start: "2026-10-01", end: "2026-10-10", hpd: 8, loggedHours: 0 }), { today: TD, pctDone: 0 }), "behind");
  ok("...but with work logged it is on track",
    healthState(u({ start: "2026-10-01", end: "2026-10-31", hpd: 8 }), { today: TD, pctDone: 0.5 }), "ontime");
  ok("early in its window with nothing logged is still on track",
    healthState(u({ start: "2026-10-06", end: "2026-10-31" }), { today: TD, pctDone: 0 }), "ontime");

  // A unit with no dates cannot be judged on a calendar.
  ok("an undated unit is not judged", healthState(u({ start: "", end: "" }), { today: TD }), "notyet");
}

console.log("\n5. #440 — the two paths collapse BY CONSTRUCTION");
{
  // HealthIcon computed its own health from module scope, where no real progress
  // is available, so it fell through to the status-keyed guesses (0.5/0.15/0.25)
  // that the component path never reaches. Three of 182 units disagreed today —
  // the Jobs list and the dashboard contradicting each other on the same op.
  // It takes the value now, so there is one computation and nothing to agree.
  ok("HealthIcon takes a health value", /const HealthIcon = \(\{ health/.test(CODE), true);
  ok("...and no longer computes one", /const HealthIcon = [^\n]*getHealth\(/.test(CODE), false);
  ok("no call site passes a bare node any more", /<HealthIcon t=\{/.test(CODE), false);
  const sites = (CODE.match(/<HealthIcon /g) || []).length;
  ok("every call site passes health=", (CODE.match(/<HealthIcon health=\{/g) || []).length, sites);
  ok("...and there are still as many as before", sites >= 10, true);
}

console.log("\n6. #440 — the KPIs stop counting unstarted work as on time");
{
  const { healthState, countsAsOnTime, isJudged } = await import("../src/health.js");
  const TD = "2026-10-07";
  ok("'notyet' is not judged", isJudged("notyet"), false);
  ok("every other state is", ["ontime", "behind", "critical", "done"].every(isJudged), true);
  ok("done counts as on time", countsAsOnTime("done"), true);
  ok("ontime counts", countsAsOnTime("ontime"), true);
  ok("behind does not", countsAsOnTime("behind"), false);
  ok("critical does not", countsAsOnTime("critical"), false);
  ok("notyet does not count either way", countsAsOnTime("notyet"), false);
  // The dashboard tile and the employee page both have to exclude it, or the
  // state exists and the number still flatters itself.
  // Matched as a REFERENCE, not a call — both sites pass it to `.filter`, so a
  // regex demanding `isJudged(` is red against correct code.
  ok("the component imports the two helpers rather than re-deriving them",
    /import \{ healthState, isJudged, countsAsOnTime \} from "\.\/health\.js";/.test(CODE), true);
  const tile = CODE.slice(CODE.indexOf("const _jobHealth"), CODE.indexOf("const _jobHealth") + 320);
  ok("the dashboard tile excludes unjudged work", /\.filter\(isJudged\)/.test(tile), true);
  ok("...and scores the rest with countsAsOnTime", /\.filter\(countsAsOnTime\)/.test(tile), true);
  const emp = CODE.slice(CODE.indexOf("const _dueHealth"), CODE.indexOf("const _dueHealth") + 420);
  ok("...and on the employee page", /isJudged/.test(emp), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
