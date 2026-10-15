// Dragging a person's row on the schedule — #144, #145.
//
// #144: the drop target's id went through `Number(rid)` and was then compared strictly with
//       `p.id`. Every person created in the app has a string uid(), so the target was never
//       found and the drop did nothing at all.
// #145: dropping onto a group (or beside someone in another group) wrote `role`, but the
//       schedule groups rows by `department` — so the person stayed in the group they started
//       in, and their role was silently overwritten with a department name.
//
//   node scripts/person-row-drag-test.mjs

import { readFileSync } from "node:fs";
import { movePersonRow } from "../src/personRowDrag.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const ids = (arr) => arr.map(p => p.id);

const PEOPLE = [
  { id: "a1", name: "Ann", department: "Wire", role: "Lead" },
  { id: "b2", name: "Ben", department: "Wire", role: "Tech" },
  { id: "c3", name: "Cy", department: "Cut", role: "Tech" },
  { id: 4, name: "Dee", department: "Cut", role: "Tech" },
];

// ── #144: string ids are found ─────────────────────────────────────────────
{
  // data-rowid is always a string in the DOM.
  const r = movePersonRow(PEOPLE, "a1", { type: "person", id: "c3", pos: "after" });
  ok("#144 a string-id target is found, so the drop moves the row", JSON.stringify(ids(r)) === JSON.stringify(["b2", "c3", "a1", 4]));
  const r2 = movePersonRow(PEOPLE, "c3", { type: "person", id: "a1", pos: "before" });
  ok("#144 before a string-id target", JSON.stringify(ids(r2)) === JSON.stringify(["c3", "a1", "b2", 4]));
  const r3 = movePersonRow(PEOPLE, "a1", { type: "person", id: "4", pos: "before" });
  ok("a numeric id still matches its string form from the DOM (sameId)", JSON.stringify(ids(r3)) === JSON.stringify(["b2", "c3", "a1", 4]));
  ok("an unknown target leaves the list untouched", movePersonRow(PEOPLE, "a1", { type: "person", id: "zz", pos: "after" }) === PEOPLE);
  ok("dropping on yourself leaves the list untouched", movePersonRow(PEOPLE, "a1", { type: "person", id: "a1", pos: "after" }) === PEOPLE);
  ok("an unknown dragged person leaves the list untouched", movePersonRow(PEOPLE, "zz", { type: "person", id: "a1", pos: "after" }) === PEOPLE);
  ok("the input is not mutated", JSON.stringify(ids(PEOPLE)) === JSON.stringify(["a1", "b2", "c3", 4]));
}

// ── #145: the group is the department ──────────────────────────────────────
{
  const r = movePersonRow(PEOPLE, "a1", { type: "person", id: "c3", pos: "after" });
  const ann = r.find(p => p.id === "a1");
  ok("#145 dropped beside someone in another group, they join that DEPARTMENT", ann.department === "Cut");
  ok("#145 ...and their role is left alone", ann.role === "Lead");
  const g = movePersonRow(PEOPLE, "b2", { type: "group", id: "Cut" });
  const ben = g.find(p => p.id === "b2");
  ok("#145 dropped on a group header, they join that department", ben.department === "Cut");
  ok("#145 ...role untouched", ben.role === "Tech");
  ok("#145 ...nobody else changes", g.filter(p => p.id !== "b2").every((p, i) => p === PEOPLE.filter(q => q.id !== "b2")[i]));
}

// RED PROOF: the rule this replaces.
{
  const oldDrop = (prev, personId, over) => {
    const targetNumId = Number(over.id);
    const targetPerson = prev.find(p => p.id === targetNumId);
    return targetPerson ? "moved" : prev;
  };
  ok("red proof: the old Number() lookup never finds a string-id target", oldDrop(PEOPLE, "a1", { type: "person", id: "c3" }) === PEOPLE);
}

// ── the render uses it ─────────────────────────────────────────────────────
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const at = S.indexOf("const startRowDrag = (e, personId) => {");
const handler = S.slice(at, S.indexOf("const updTimeOff =", at)).replace(/^\s*\/\/.*$/gm, "");
ok("the drop goes through movePersonRow", /movePersonRow\(/.test(handler));
ok("#144 no Number() on the row id", !/Number\(rid\)/.test(handler));
ok("#145 the drop writes no role", !/role:\s*(targetPerson|over)/.test(handler));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
