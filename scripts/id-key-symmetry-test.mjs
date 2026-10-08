// #444 — the asymmetry that broke people.js, everywhere else it still lives.
//
// `people.js` keyed `existingMap` on a RAW person id and read it with a raw id,
// while `reconcileDeletions` walked the same array comparing `String(rec.id)`.
// One client normalised two numeric ids to strings; those records matched the
// reconciler and missed the map, and a single write lost two PINs, two push
// tokens, an active clock and an approved PTO entry — then got investigated
// twice, as #384 and #349, before anyone noticed it was one bug.
//
// THE RATCHET THEN FOUND NINE MORE OF THE SHAPE. They fall into three groups,
// and the distinction is the whole point of this pass:
//
//   ASYMMETRIC — key raw, probe stringified. Identical to the people.js defect,
//   and safe today only because every caller HAPPENS to stringify. That is
//   precisely the condition that stopped holding.
//
//     dragMove.js  shares     keyed m.id, probed sid(u.id)
//     dragMove.js  moverIds   keyed m.id, probed String(o.unit.id) in
//                             overlapRules — a SET, so the ratchet never saw it
//     dragMove.js  byId       keyed m.id, probed sid(node.id)
//
//   CROSS-BOUNDARY — both sides raw, so they agree, but the two sides come from
//   DIFFERENT arrays. Symmetric in form, one normalisation away from not being.
//
//     TRAQS.jsx    pinById       keys from the server roster, probes from the
//                                settings draft — and these are PERSON ids
//     TRAQS.jsx    scheduledMap  keys from newSubs, probes from p.subs; the very
//                                next line already does String(fresh.id)
//
//   LOCAL — built and consumed inside one function, from one array, never
//   escaping. Fixed anyway, because the cost is nothing and "it cannot drift
//   from here" is an argument that has now failed twice.
//
//     jobDetail.js idMap     one tree walk
//     TRAQS.jsx    jobMap    one forEach over one list
//
// ONE IS LEFT, DELIBERATELY. `getDepGroup`'s `adj` map feeds a Set that is
// RETURNED and probed raw by three callers (`depGroupIds.has(s.id)`,
// `.has(op.id)`, and a `forEach`). Stringifying the map without stringifying
// what the Set carries is correct but subtle, and `getDepGroup` lives inside the
// component where this suite cannot reach it to prove the rewrite behaved. A
// known exception the ratchet carries beats one quietly fixed into something
// else, so the baseline keeps it and says why.
//
// MEASURED: all 1,460 live node ids and all 6 dep ids are strings, so none of
// these is firing today. Neither was people.js, until it was.
//
//   node scripts/id-key-symmetry-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { idKeyViolations } from "./_membership-lint.mjs";
import * as D from "../src/dragMove.js";
import { overlapContext } from "../src/overlapRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DM = read("../src/dragMove.js");
const JD = read("../src/jobDetail.js");
const CODE = codeOf(read("../src/TRAQS.jsx"));

const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const octx = overlapContext(SETTINGS, "2026-09-30");
const PEOPLE = [{ id: "w1", name: "Wendy", departments: [] }];

console.log("\n1. #444 RED PROOF — a NUMERIC mover id, which is all it would take");
{
  // Every caller builds movers with `id: String(op.id)`. This one does not —
  // which is exactly what a future caller, or a native client, will eventually
  // do, and is what happened to people.js.
  const op = { id: 42, title: "Op", start: "2026-10-01", end: "2026-10-01", startHour: 8, hpd: 4, team: ["w1"] };
  const tasks = [{ id: "j1", title: "J", subs: [{ id: "p1", title: "P", subs: [op] }] }];
  const at = { start: "2026-10-02", end: "2026-10-02", startHour: 8, endHour: null };
  const movers = [{ id: 42, node: op, reassigned: false,
    from: { start: op.start, end: op.end, startHour: 8, endHour: null, team: op.team },
    to: { ...at, team: op.team } }];

  const after = D.applyDragMove(tasks, movers, { date: "d", movedBy: "m", people: PEOPLE })[0].subs[0].subs[0];
  ok("a numeric mover id still moves its node", [after.start, after.end], ["2026-10-02", "2026-10-02"]);
  ok("...and is logged, so the move is not silently a no-op", (after.moveLog || []).length, 1);

  // The refusal path reads the same two maps. A miss there means the mover is
  // treated as an obstacle to itself, or its share-hours fall back to the
  // default — both silent.
  const ctx = { isLocked: () => false, isLive: () => false, isOverdue: () => false, timeOff: () => [],
    nowDay: "2026-09-30", nowHour: 10, business: true, tasks, overlapCtx: octx, people: PEOPLE };
  ok("a numeric-id mover is not an overlap with itself", D.refuseDragMove(movers, ctx), null);
}

console.log("\n2. #444 — the three asymmetric sites in dragMove.js");
{
  ok("shares is keyed by String(id)",
    /const shares = new Map\(movers\.map\(m => \[sid\(m\.id\), m\.shareH\]\)\);/.test(DM), true);
  ok("moverIds is too — a Set, which the ratchet cannot see",
    /const moverIds = new Set\(movers\.map\(m => sid\(m\.id\)\)\);/.test(DM), true);
  ok("byId is too",
    /const byId = new Map\(movers\.map\(m => \[sid\(m\.id\), m\]\)\);/.test(DM), true);
  ok("no raw mover id is used as a key any more",
    /new (Map|Set)\(movers\.map\(m => (\[m\.id|m\.id)/.test(DM), false);
  // The probes were already stringified — that was the asymmetry. They stay.
  ok("the byId probe still stringifies", /byId\.get\(sid\(node\.id\)\)/.test(DM), true);
  ok("the shares probe still stringifies", /shares\.has\(sid\(u\.id\)\)/.test(DM), true);
}
// ── 3. #444 — jobDetail's idMap: REMOVED 2026-10-08 (#486) ─────────────────
// Seven assertions, three on the source and four behavioural, covered the
// duplicate path's String(id) keying. `duplicateJob` is gone, so they are not
// lost coverage. The ratchet in section 5 still reads jobDetail.js, so a raw-id
// map key reappearing there is still caught.

console.log("\n4. #444 — the two cross-boundary maps in TRAQS.jsx");
{
  // pinById: keys come from the server's roster, probes from the settings draft.
  // Person ids are the ones that actually drift, so this is the riskiest of the
  // four that were symmetric-but-crossing.
  ok("pinById is keyed by String(id)",
    /new Map\(\(fresh \|\| \[\]\)\.map\(p => \[String\(p\.id\), p\.pin\]\)\)/.test(CODE), true);
  ok("...and probed the same way", /pinById\.get\(String\(p\.id\)\)/.test(CODE), true);

  // scheduledMap: keys from newSubs, probes from p.subs — and the line below it
  // already did String(fresh.id) for a Set, so the file disagreed with itself.
  ok("scheduledMap is keyed by String(id)",
    /new Map\(newSubs\.map\(s => \[String\(s\.id\), s\]\)\)/.test(CODE), true);
  ok("...and probed the same way", /scheduledMap\.get\(String\(orig\.id\)\)/.test(CODE), true);
}

console.log("\n5. #444 — the local map, fixed because 'it cannot drift' has failed twice");
{
  ok("jobMap is keyed by String(id) on every touch",
    (CODE.match(/jobMap\.(has|get|set)\(String\(job\.id\)/g) || []).length, 3);
  ok("...and no raw touch survives", /jobMap\.(has|get|set)\(job\.id/.test(CODE), false);
}

console.log("\n6. THE BASELINE DROPS TO THE ONE KNOWN EXCEPTION");
{
  const files = { "dragMove.js": DM, "jobDetail.js": JD, "TRAQS.jsx": read("../src/TRAQS.jsx") };
  const counts = {};
  for (const [name, src] of Object.entries(files)) {
    const v = idKeyViolations(src);
    counts[name] = v.length;
    for (const x of v) console.log(`         ${name}:${x.line}  ${x.member}`);
  }
  ok("dragMove.js is clean", counts["dragMove.js"], 0);
  ok("jobDetail.js is clean", counts["jobDetail.js"], 0);
  // getDepGroup's `adj` only. Left deliberately: its map feeds a Set that is
  // RETURNED and probed raw by three callers, and `getDepGroup` sits inside the
  // component where this suite cannot drive it. A documented exception beats a
  // subtle rewrite nothing can prove.
  ok("TRAQS.jsx carries exactly one, the documented exception", counts["TRAQS.jsx"], 1);
  ok("...and it is getDepGroup's adj",
    idKeyViolations(files["TRAQS.jsx"])[0]?.text.includes("const adj = new Map(siblings.map"), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
