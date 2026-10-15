// The panel date override places what it can and reports the rest — #351, ruled 2026-10-15
// ("place what the panel can and report the rest. Same ruling as #527 and #532: silently
// dropping someone is the failure mode we keep finding").
//
// overrideSchedulePanel stopped at the FIRST op it could not place and threw the whole
// override away: the pre-#344 abort, still alive in the second engine. It now walks the ops
// with placeOpsInOrder (src/placement.js): a placed op gets its dates and team and moves the
// cursor on; a refused one stays EXACTLY where it was and is reported, with its reason,
// through the same OutcomePanel the wizard and the re-plan preview use.
//
// The two engines are NOT merged here; that is logged separately.
//
//   node scripts/override-partial-test.mjs

import { readFileSync } from "node:fs";
import { placeOpsInOrder, OUTCOME } from "../src/placement.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const eq = (m, got, want) => ok(`${m} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

const next = (d) => String(Number(d) + 1);
const ops = [
  { id: "layout", title: "Layout", start: "1", end: "1", team: ["old"] },
  { id: "wire",   title: "Wire",   start: "2", end: "3", team: ["old"] },
  { id: "labels", title: "Labels", start: "4", end: "4", team: ["old"] },
];
// Wire cannot be placed: nobody is free.
const pick = (op, from) => op.id === "wire"
  ? { team: [], start: from, end: from, outcome: OUTCOME.noWindow }
  : { team: [{ id: "ann" }], start: from, end: from };
const booked = [];
const r = placeOpsInOrder(ops, pick, { start: "10", nextDay: next, book: (m, s, e) => booked.push([m.id, s, e]) });

eq("#351 every op is still there — none is dropped", r.subs.map(o => o.id), ["layout", "wire", "labels"]);
eq("#351 the ops that fit are placed", [r.subs[0].start, r.subs[0].team, r.subs[2].start, r.subs[2].team], ["10", ["ann"], "11", ["ann"]]);
ok("#351 the op that does not fit stays EXACTLY where it was", r.subs[1] === ops[1]);
eq("#351 ...and is reported with its reason", r.blocked.map(b => [b.op.id, b.outcome]), [["wire", OUTCOME.noWindow]]);
eq("#351 the count says what happened", [r.placed, r.rows.length], [2, 3]);
eq("a refused op does not move the cursor on, so the next op takes its place", r.subs[2].start, "11");
eq("only placed ops are booked", booked, [["ann", "10", "10"], ["ann", "11", "11"]]);
{
  // Deliberately unassigned work (no department) is a success with no team, not a refusal.
  const r2 = placeOpsInOrder([{ id: "u" }], () => ({ team: [], start: "5", end: "6", unassigned: true }), { start: "5", nextDay: next });
  eq("deliberately unassigned work is placed, not blocked", [r2.placed, r2.blocked.length, r2.subs[0].start], [1, 0, "5"]);
}
// RED PROOF: the rule this replaces kept nothing once one op failed.
{
  const oldRun = (list) => { const out = []; for (const o of list) { const p = pick(o, "10"); if (p.team.length === 0) return null; out.push(o); } return out; };
  ok("red proof: the old abort threw the whole override away for one op", oldRun(ops) === null);
}

// The wizard's override uses it and reports through the shared panel (comments stripped, R4).
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const at = S.indexOf("const overrideSchedulePanel = (panelId, newStartDate) => {");
const fn = S.slice(at, S.indexOf("const shopCrew =", at)).replace(/^\s*\/\/.*$/gm, "");
ok("#351 the override walks its ops with placeOpsInOrder", /placeOpsInOrder\(/.test(fn));
ok("#351 ...and no longer aborts on the first op it cannot place", !/No available workers for "\$\{sub\.title\}"/.test(fn));
ok("#351 the outcome is reported through OutcomePanel", /<OutcomePanel[^>]*overrideReport\[panel\.id\]/.test(S) || /overrideReport\[panel\.id\][\s\S]{0,120}<OutcomePanel/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
