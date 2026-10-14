// #527 — THE WEB WIZARD'S TEAM MODE, on #302's three rulings (Trey, 2026-10-13: "same three
// rulings. Place who's free on the earliest day and report who wasn't; don't wait 300 days for
// a full crew").
//
//   1. HOURS SPLIT EVENLY. hpd is the op's total for the whole crew; the span is each person's
//      share, and the load report credits each member that share — not the whole op to one.
//   2. EVERYONE IN THE CREW MATCHES THE DEPARTMENT. A named member outside it is left off and
//      named. (`candidatesFor` returns a named team outright, whatever its departments.)
//   3. PLACE WHO'S FREE, REPORT WHO WASN'T. The old path waited up to 300 business days for the
//      whole crew, then fell back to whatever subset was free and said nothing about the rest.
//
// The placement is `placeCrew` in src/placement.js — pure, so it is tested here directly — and
// the wizard calls it.
//
//   node scripts/crew-placement-test.mjs
import { readFileSync } from "node:fs";
import * as P from "../src/placement.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
ok("placement.js exports placeCrew", typeof P.placeCrew, "function");
const placeCrew = typeof P.placeCrew === "function" ? P.placeCrew : () => ({});

// Calendar days stand in for business days: the rule is about WHO and HOW LONG, not the calendar.
const addBD = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ada = { id: "u1", name: "Ada", department: "Wire" };
const bob = { id: "u2", name: "Bob", department: "Fab", secondaryDepartment: "Wire" };
const cy  = { id: "u3", name: "Cy",  department: "Cut" };
// busy: { personId: [[start, end], ...] }
const freeFn = (busy = {}) => (id, s, e) => !(busy[id] || []).some(([bs, be]) => bs <= e && be >= s);
const run = (over) => placeCrew({ crew: [ada, bob], departments: ["Wire"], named: [], hours: 15,
  productiveHoursPerDay: 7.5, from: "2026-03-02", addBD, isFree: freeFn(), ...over });
const ids = (r) => (r.team || []).map(p => p.id);

console.log("\n1. Hours split evenly");
{
  const r = run();
  ok("the crew is placed together", ids(r), ["u1", "u2"]);
  ok("15h ÷ 2 = 7.5h each: one day, not the two one person needs", [r.start, r.end], ["2026-03-02", "2026-03-02"]);
  ok("nobody left off", r.left, []);
}

console.log("\n2. Everyone in the crew matches the department");
{
  const r = run({ crew: [ada, cy] });
  ok("the out-of-department member is not placed", ids(r), ["u1"]);
  ok("...and is named, with the reason", r.left, [{ id: "u3", reason: "department" }]);
  ok("...and the span is sized for who is on it", r.end, "2026-03-03");
  const none = run({ crew: [cy] });
  ok("a crew none of whom match is nobody — no-candidates, not a placement", [ids(none), none.outcome], [[], P.OUTCOME?.noCandidates]);
}

console.log("\n3. Place who's free on the earliest day, report who wasn't");
{
  const r = run({ isFree: freeFn({ u2: [["2026-03-02", "2026-03-20"]] }) });
  ok("the earliest day, not a wait for the whole crew", r.start, "2026-03-02");
  ok("the free member is placed", ids(r), ["u1"]);
  ok("the busy one is named", r.left, [{ id: "u2", reason: "busy" }]);
  ok("and the span is resized: one person carries 15h", r.end, "2026-03-03");
  const named = run({ named: ["u1", "gone"] });
  ok("a named member who isn't on the schedulable roster is named too",
    named.left, [{ id: "gone", reason: "notSchedulable" }]);
  const nobody = run({ isFree: () => false });
  ok("nobody free anywhere in the horizon is no-window, crew still counted",
    [ids(nobody), nobody.outcome, nobody.candidates], [[], P.OUTCOME?.noWindow, 2]);
}

console.log("\n4. The load report credits each member their share");
{
  const rep = P.foldRunOutcomes([{ op: { id: "o", title: "Op", hpd: 15 }, outcome: P.OUTCOME?.placed, person: ada, team: [ada, bob] }],
    { crew: [ada, bob] });
  ok("Ada and Bob carry 7.5h each, not 15h on Ada",
    (rep.byPerson || []).map(p => [p.id, p.hours]).sort(), [["u1", 7.5], ["u2", 7.5]]);
  const left = P.foldRunOutcomes([{ op: { id: "o", title: "Op", hpd: 15 }, outcome: P.OUTCOME?.placed, person: ada, team: [ada],
    left: [{ id: "u2", reason: "busy" }] }], { crew: [ada, bob] });
  ok("a row keeps who was left off", left.rows?.[0]?.left, [{ id: "u2", reason: "busy" }]);
}

console.log("\n5. The wizard uses it, and step 3 says who wasn't placed");
{
  const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  ok("team mode calls placeCrew", /placeCrew\(\{ crew: eligible, departments: reqDepts,/.test(J), true);
  ok("the 300-day wait for a full crew is gone", /let allFree=true;/.test(J), false);
  ok("...and so is the silent subset fallback", /const freeSubset=eligible\.filter/.test(J), false);
  ok("placed rows carry the crew and who was left off", (J.match(/team:panelTeam,left:pLeft|team:subTeam,left:sLeft/g) || []).length, 2);
  ok("step 3 lists the people left off a placed op", /Not on it: /.test(J), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
