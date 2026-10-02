// Auto-scheduling, after three rulings (2026-10-02).
//
//   1. DEPARTMENT ABSENCE MEANS OPEN TO ANYONE. An op with no department stated
//      is anyone's job; an op WITH one stated still may not go outside it.
//   2. MANUAL ASSIGNMENT IS A STATE THE SCHEDULER RESPECTS, not a lock. People
//      already on an op stay on it; the op still moves in time.
//   3. THE ONLY REAL LOCK IS AN ACTIVE CLOCK. op.locked is retired.
//
// Ruling 1 was measured before it was acted on. Of 484 live ops at Matrix, 142
// (29.3%) had a department stated, 231 (47.7%) had one INFERRED FROM THE OP'S
// TITLE, and 111 (22.9%) had none. The inference was the bug: Matrix's
// departments are named what its ops are titled — Wire, Cut, Layout — so an op
// titled "Layout" was assignable to ONE of 18 people, "Cut" to one, "Wire" to
// five. 71 ops titled "Layout" funnelled onto a single person.
//
//   node scripts/scheduler-rules-test.mjs

import { readFileSync } from "node:fs";
import { personDeptMatch, unitDepartment, scheduleRuleViolations } from "../src/scheduleRules.js";
import { clearOverlaps, planPushes, overlapContext } from "../src/overlapRules.js";
import { splitWorkedOp } from "../src/statsMath.js";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

console.log("\n1. Department absence means OPEN TO ANYONE");
{
  const anyone = { id: 1, name: "A", department: "Accounts" };
  // The server rule has always been right about this.
  // Boolean since departments became a flat SET on both sides (2026-10-02) —
  // the "primary"/"secondary" return was a preference order nobody used.
  ok("no department required — anyone matches", personDeptMatch(anyone, ""), true);
  ok("...including null, undefined and an empty set",
    [personDeptMatch(anyone, null), personDeptMatch(anyone, undefined), personDeptMatch(anyone, [])], [true, true, true]);
  // ...and an op WITH one stated is still constrained. Ruling 1 has two halves
  // and this is the half that must NOT be relaxed.
  ok("a stated department still excludes someone who lacks it", personDeptMatch(anyone, "Wire"), false);
  ok("...and admits someone holding it, with no tier distinction",
    personDeptMatch({ ...anyone, secondaryDepartment: "Wire" }, "Wire"), true);
  ok("...reading the new person-side set as well as the old pair",
    personDeptMatch({ id: 2, departments: ["Cut", "Wire"] }, ["Wire"]), true);
  ok("...and matching on ANY overlap, which is what makes \"either\" expressible",
    personDeptMatch({ id: 3, departments: ["Cut"] }, ["Wire", "Cut"]), true);
  // unitDepartment: own, then panel, then job, and "" when nothing states one.
  ok("unitDepartment reads own, then panel, then job",
    [unitDepartment({ requiredDepartment: "A" }, { requiredDepartment: "B" }, { requiredDepartment: "C" }),
     unitDepartment({}, { requiredDepartment: "B" }, { requiredDepartment: "C" }),
     unitDepartment({}, {}, { requiredDepartment: "C" }),
     unitDepartment({}, {}, {})], ["A", "B", "C", ""]);
  // THE TITLE HEURISTIC IS GONE. It is the one thing that could put a
  // requirement on an op nobody wrote one for.
  ok("an op TITLED like a department requires nothing",
    unitDepartment({ title: "Wire" }, {}, {}), "");
}

console.log("\n2. ...and the client no longer infers one from the title");
{
  // deptsOfUnit is the real resolver now and returns a SET; deptOfUnit survives
  // only for places that print one name, never for deciding eligibility.
  const fn = J.slice(J.indexOf("const deptsOfUnit ="), J.indexOf("const deptsOfUnit =") + 320);
  ok("deptsOfUnit delegates to the shared rule", /unitDepartments\(n, panel, job\)/.test(fn), true);
  ok("...with no title term", /title/.test(fn), false);
  // The set the heuristic matched against is gone too, or it would be an unused
  // memo waiting to be re-wired.
  ok("the department-name set it matched against is gone", J.includes("deptNamesLower"), false);
}

console.log("\n3. All four schedulers go through the one engine");
{
  // RE-POINTED 2026-10-02 (step 2). These used to pin the INLINE candidate
  // selection in each scheduler — an existing team checked before departments,
  // onTeam rather than a raw .includes. That logic has not gone away; it has
  // moved into src/placement.js, where placement-test asserts the BEHAVIOUR.
  // What is left to assert here is the thing this step is actually for: that
  // every scheduler asks the engine instead of answering for itself.
  //
  // There were FOUR implementations and they disagreed — _autoAssign ignored
  // departments entirely, and the "respect an existing assignment" rule had to
  // be written twice in one sitting. That is what this count prevents.
  const calls = (J.match(/candidatesFor\(/g) || []).length;
  ok("all four call sites use the engine", calls, 4);
  ok("the engine is imported, not reimplemented", /from "\.\/placement\.js"/.test(J), true);

  // No scheduler keeps a private candidate filter. These are the exact shapes
  // that were there, and any of them coming back means the engine has been
  // forked again.
  ok("no inline department filter survives",
    /allCrew\.filter\(pp? => personDeptMatch\(/.test(J), false);
  ok("no inline team filter survives",
    /allCrew\.filter\(pp? => onTeam\(/.test(J), false);
  // THE FALLBACK. This is the department funnel's actual mechanism and it was
  // in two of the four. It must not come back anywhere.
  //
  // Matched as a RETURN STATEMENT, not as free text. Both comments explaining
  // the removal quote the expression verbatim, so a bare search finds the
  // explanation of the deletion and reports the deletion as incomplete. Fourth
  // time this exact trap has bitten in this campaign — see LESSONS #8.
  ok("no all-crew fallback survives",
    /return\s+m(atched)?\.length > 0 \? m(atched)? : allCrew/.test(J), false);

  // _autoAssign gained a rule rather than changing shape: it picked purely by
  // load and ignored departments. Measured before landing — nothing changes at
  // Matrix today, because the FAST TRAQS extraction has no department field and
  // preview ops carry none, so candidatesFor returns the whole roster exactly as
  // the hand-rolled loop did. The change is latent and correct.
  ok("the import's auto-assign asks the engine too",
    /pickCandidate\(candidatesFor\(op, roster/.test(J), true);
  ok("...and no longer scans the roster by hand",
    /for \(const pp of roster\) \{\s*\n\s*const l = load\(/.test(J), false);
}

console.log("\n4. op.locked is retired — the only lock is an active clock");
{
  // The origin: the split stamped it on the already-worked remnant. That was the
  // only thing that ever set it.
  const r = splitWorkedOp({ hpd: 8, workedMs: 4 * 3600000 });
  // `"locked" in r.keep`, not `r.keep.locked === undefined`: ok()'s signature is
  // (label, got, want = true), so passing undefined as `want` silently takes the
  // DEFAULT and asserts true — the assertion then fails for a reason that has
  // nothing to do with the code. Ask whether the key exists instead.
  ok("the split no longer stamps a lock", "locked" in r.keep, false);
  ok("...and the kept half is still identified by its hpd being the worked time", r.keep.hpd, 4);

  // Nothing writes it anywhere now.
  //
  // THE WORD BOUNDARY MATTERS. "isClocked: true" contains the substring
  // "locked: true", so without it this fails on an unrelated clock helper and
  // reports the retirement as incomplete.
  //
  // It also has to be written by a tool that does not re-escape. The first
  // attempt went through a shell and the boundary arrived as a literal
  // BACKSPACE (0x08), which made the regex unmatchable and the assertion
  // VACUOUS — it passed by never testing anything. LESSONS #1 in one byte.
  ok("no client write of locked: true remains", /\blocked: true/.test(J), false);

  // The scheduling paths ignore a stray flag on older stored data.
  const ctx = overlapContext({ workStart: "08:00", workEnd: "16:00", workDays: [1, 2, 3, 4, 5] }, "2026-10-05");
  const op = (id, extra) => ({ id, title: id, start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 16, hpd: 8, team: ["7"], ...extra });
  const tree = (...ops) => ([{ id: "JOB", title: "J", start: "2026-10-05", end: "2026-10-05",
    subs: [{ id: "P", title: "P", start: "2026-10-05", end: "2026-10-05", subs: ops }] }]);
  const moved = clearOverlaps(tree(op("C"), op("L", { locked: true })), ["L"], ctx);
  ok("clearOverlaps moves a unit carrying a stray locked flag",
    moved.tasks[0].subs[0].subs[1].start !== "2026-10-05", true);
  const blocked = planPushes(tree(op("Y", { locked: true })), op("M", { id: "M" }), ctx);
  ok("planPushes is not blocked by one", blocked.blocked, false);

  // The server rule is gone, and activeClock — the real lock — is not.
  const people = [{ id: 7, name: "W", department: "", activeJobClock: null }];
  const before = tree(op("L", { locked: true }));
  const after = tree(op("L", { locked: true, start: "2026-10-07", end: "2026-10-07" }));
  const v = scheduleRuleViolations(after, before, { people, workDays: [1, 2, 3, 4, 5], holidays: [], today: "2026-10-05", isAdmin: true });
  ok("moving a unit with a stray locked flag breaks no rule",
    v.filter(x => x.rule === "lock"), []);
  // The real lock still fires.
  const clocked = [{ id: 7, name: "W", activeJobClock: { clockIn: "2026-10-05T14:00:00Z", opId: "L" } }];
  const v2 = scheduleRuleViolations(after, before, { people: clocked, workDays: [1, 2, 3, 4, 5], holidays: [], today: "2026-10-05", isAdmin: true });
  ok("...but moving an op someone is CLOCKED INTO still does",
    v2.map(x => x.rule), ["activeClock"]);
}

console.log("\n5. The unreachable optimizer is gone");
{
  ok("the optimizePreview state is removed", /const \[optimizePreview, setOptimizePreview\]/.test(J), false);
  ok("...and so is its modal", /<FadeOnClose open=\{!!optimizePreview\}/.test(J), false);
  // The orphaned comments are the tell that something was half-removed before.
  // Matched as LINE COMMENTS, not as free text: the deletion note left in place
  // quotes the old comment names to explain what went, so a bare substring
  // search finds the explanation of the removal and calls it the removal.
  ok("the orphaned optimizer comments are gone",
    /^\s*\/\/ (Swap-first optimizer|Full schedule optimizer)/m.test(J), false);
  ok("...including the one that made #49 look like a missing button",
    /\/\/ Toggle lock on an operation/.test(J), false);
}

console.log("\n6. RED PROOF");
{
  // Ruling 1's red proof is the measured case: an op titled exactly like a
  // department. Under the old heuristic this produced a requirement.
  const oldHeuristic = (node, deptNames) =>
    unitDepartment(node, {}, {}) || (deptNames.has(String(node.title || "").trim().toLowerCase()) ? node.title : "");
  const names = new Set(["wire", "cut", "layout"]);
  ok("the OLD rule manufactured a department from the title",
    oldHeuristic({ title: "Layout" }, names), "Layout");
  ok("...and the new one does not", unitDepartment({ title: "Layout" }, {}, {}), "");
  // Which is the difference between one eligible person and eighteen.
  const crew = [{ id: 1, department: "Layout" }, ...Array.from({ length: 17 }, (_, i) => ({ id: i + 2, department: "Other" }))];
  ok("...worth 1 of 18 candidates versus 18",
    [crew.filter(p => personDeptMatch(p, "Layout")).length, crew.filter(p => personDeptMatch(p, "")).length], [1, 18]);

  const muts = [
    ["the title term's absence", "unitDepartment(n, panel, job) || \"\";"],
    ["the auto-schedule team check", "if (already.length > 0) return already;"],
    ["the reschedule onTeam", "onTeam(op.team, pp.id)"],
  ];
  let red = 0;
  for (const [label, needle] of muts) {
    if (J.split(needle).join("/* gone */").includes(needle)) { console.error(`  RED FAIL  ${label} survives deletion`); fail++; }
    else red++;
  }
  console.log(`  red proof: ${red}/${muts.length} guards go red when their subject is deleted`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
