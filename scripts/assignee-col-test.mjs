// The Assignee column on the Jobs list.
//
// The point of the column is that Team could not answer the question: Team reads
// the row's OWN team array, and a job created through the new-job modal has none
// -- assignment lands on the operations. So a fully assigned job showed a blank
// Team cell on its job row, and a Skip Assignee job looked identical to it.
//
//   node scripts/assignee-col-test.mjs
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// ── the column ───────────────────────────────────────────────────────────────
ok("the column is declared", /\{ id: "assignee", label: "Assignee",/.test(S));
ok("it renders in the Jobs grid", S.includes('case "assignee": {'));
// The rollup is computed with the rest of the row's context, not inside the cell:
// the cell renderer runs once per COLUMN, so computing it there walked the job's
// whole subtree thirteen times per row.
ok("...and is not the empty default cell", /who: showAssigneeCol \? _assigneesOf\(item\) : EMPTY_ARR,/.test(S));
ok("...with the rollup done once per row, not once per column",
  (S.match(/_assigneesOf\(item\)/g) || []).length === 1);
// It walks the subtree for a single cell, so it must not run for people who have
// hidden the column -- that would hand them a walk per row they never had before.
ok("...and not at all when the column is hidden",
  S.includes('const showAssigneeCol = orderedStdCols.some(c => c.id === "assignee");'));
// The sort keys are decorated now -- computed once per job rather than inside the
// comparator -- so this is a key builder, not a branch.
ok("it is sortable by clicking the header", /assignee: t => \(_assigneesOf\(t\)\[0\] \|\| \{\}\)\.name \|\| "",/.test(S));

// ── how the cell reads ───────────────────────────────────────────────────────
// Split by HOW MANY, not by level: a crew shows stacked faces and no names, one
// person shows their face and their name. A phase with a single operator then
// reads like the operation under it, which is what it is.
const CELL = S.slice(S.indexOf('case "assignee": {'), S.indexOf('case "appr": {'));
ok("one person gets a face and a name", CELL.includes("if (who.length === 1) return ("));
ok("...their full name, not a first name", CELL.includes("{who[0].name}") && !CELL.includes('name.split(" ")[0]'));
ok("a crew gets faces and no names at all",
  (CELL.match(/\{p\.name/g) || []).length === 0 && (CELL.match(/who\.map\(p => p\.name\)\.join/g) || []).length === 1);
ok("...the one remaining name list being the hover title", CELL.includes("const title = who.map(p => p.name).join(\", \");"));
ok("the faces overlap into a stack", /marginLeft: i === 0 \? 0 : -8/.test(CELL));
// Without this each face is clipped by the NEXT one instead of sitting over it.
ok("...drawn front to back so each sits over the one after it", CELL.includes("zIndex: shown.length - i"));
ok("...with a ring to separate them", (CELL.match(/ring=\{T\.card\}/g) || []).length === 2);
ok("a long crew is capped and counted", CELL.includes("who.slice(0, 5)") && CELL.includes("+{who.length - shown.length}"));
ok("nobody assigned still reads Unassigned", CELL.includes("Unassigned"));
// Job Details no longer has a configurable column table (the Tasks / Gantt /
// Split views were replaced, 2026-10-03): its Sub-jobs table draws the assignee
// cell itself, from team. scripts/job-detail-test.mjs covers that page.
ok("it is not groupable by default, like Team",
  !/GROUPABLE_STD = \[[^\]]*assignee/.test(S));

// ── the width array, which is POSITIONAL ─────────────────────────────────────
// [0] chevron, [1..n] std cols by their `i`, then custom cols, then actions last.
// A std column added without growing this array hands every custom column its
// neighbour's width and leaves the last one off the end of the grid.
const defs = [...S.matchAll(/\{ id: "(\w+)",\s+label: "[^"]*",\s+align: "\w+",\s+i: (\d+) \}/g)]
  .map((m) => ({ id: m[1], i: Number(m[2]) }));
ok("every standard column carries a distinct index", new Set(defs.map((d) => d.i)).size === defs.length);
ok("...numbered 0..n-1 with no gap", defs.every((d, k) => defs.filter((x) => x.i === k).length === 1));
const widths = JSON.parse(S.match(/useState\((\[26, 200[^\]]*\])\)/)[1]);
ok("the width array has one entry per column, plus chevron and actions",
  widths.length === defs.length + 2);
ok("...and the assignee column got a real width, not the actions 36",
  widths[1 + defs.find((d) => d.id === "assignee").i] === 150);
// The boundary between std and custom widths was a bare 13 in six places.
ok("the custom-column boundary is derived from STD_COL_DEFS", S.includes("const CUSTOM_W0 = 1 + STD_COL_DEFS.length;"));
ok("...and no bare boundary literal is left in the width code",
  !/(splice|slice)\(13[,\s)]/.test(S) && !/slice\(0, 13\)/.test(S));
// One declaration plus seven sites that used to read a bare 13: the width effect
// (two reads), the removal splice, the grid template, the two insert splices, and
// the RESIZE HANDLE index on a custom column header.
//
// That last one was missed on the first pass, and it is the one with teeth: the
// handle is positioned by the header it sits on but writes to colWidths by index,
// so with a standard column added and the index left at 13, dragging the first
// custom column's edge silently resized Assignee instead.
ok("...and it is used at every custom-column index site",
  (S.match(/CUSTOM_W0/g) || []).length === 8);
ok("the custom header's resize handle indexes from it too",
  S.includes("const widthIdx = CUSTOM_W0 + i;") && !/const widthIdx = 13 \+ i;/.test(S));
// The standard headers index by the column's own position, which needs no offset.
ok("...while a standard header still indexes by its own position",
  S.includes("const widthIdx = 1 + col.i;"));

// ── an existing user gets the column ─────────────────────────────────────────
// colOrder is persisted as a plain id list, so a column shipped afterwards is
// simply ABSENT from it rather than marked hidden, and has to be back-filled.
//
// There are TWO stored copies: the localStorage cache that paints first, and the
// per-account copy that arrives from the server and REPLACES it. The second one is
// the one that wins. Back-filling only the first -- which is how this shipped at
// first -- makes the column appear on load and vanish again the instant the account
// settings land, which is indistinguishable from it never having shipped.
ok("the back-fill is one shared function, not a local inside the initialiser",
  /^const backfillColOrder = \(saved\) => \{/m.test(S));
ok("the localStorage copy is back-filled", S.includes("backfillColOrder(saved)"));
ok("the per-account copy from the server is back-filled too",
  S.includes("setColOrder(backfillColOrder(remote.colOrder))"));
ok("...and no stored order is applied raw", !/setColOrder\(remote\.colOrder\)/.test(S));
// Exactly two call sites -- the localStorage read and the server read -- and the
// declaration, which is `= (saved) =>` and so is not a call.
ok("it is called twice and nowhere else", (S.match(/backfillColOrder\(/g) || []).length === 2);
ok("...and declared once", (S.match(/const backfillColOrder =/g) || []).length === 1);

const backfillSrc = S.match(/const backfillColOrder = \(saved\) => \{[\s\S]*?\n\};/)[0];
const backfill = new Function("STD_COL_DEFS", backfillSrc + " return backfillColOrder;")(defs);
const old = ["name", "jobNum", "client", "status", "pri", "start", "end", "due", "hrs", "progress", "team", "appr"];
ok("an order saved before today gains the column", backfill(old).includes("assignee"));
ok("...appended, leaving their arrangement alone", backfill(old).slice(0, 12).join() === old.join());
ok("an order that already has it is left alone", backfill([...old, "assignee"]).join() === [...old, "assignee"].join());
ok("a trimmed order keeps its own arrangement at the front", backfill(["name", "status"]).slice(0, 2).join() === "name,status");
ok("an unknown id left by an older build is dropped", !backfill([...old, "ghostCol"]).includes("ghostCol"));
// The failure this is here to catch: the server copy landing raw, over the top.
const painted = backfill(old);
ok("the painted order has it", painted.includes("assignee"));
ok("...and the server copy arriving raw would have taken it away again", !old.includes("assignee"));
ok("...which back-filling that read prevents", backfill(old).includes("assignee"));

// ── a hidden standard column can be brought back ─────────────────────────────
// Hiding one on this page was a ONE-WAY DOOR: the header menu's Add only builds
// new custom columns, and the + picker offered job fields and templates only.
// Nothing put a standard column back, which is the other half of "there is no
// assignee to select".
ok("the + picker lists standard columns that are hidden",
  S.includes("const hidden = STD_COL_DEFS.filter(c => !colOrder.includes(c.id));"));
ok("...adding one puts it back in the order", S.includes("setColOrder(prev => [...prev, c.id]);"));
ok("...and the section is absent when nothing is hidden", S.includes("if (!hidden.length) return null;"));
ok("...showing the user's own name for it if they renamed it", S.includes("{colLabels[c.id] || c.label}"));

// ── the rollup itself, lifted out of the source ──────────────────────────────
// Built from the shipped text so this measures the function, not a copy of it.
const src = S.match(/const _assigneesOf = \(node\) => \{[\s\S]*?\n  \};/)[0];
ok("the rollup exists in the source", !!src);
const make = (people) => {
  // sameId as the app defines it: ids are mixed string/number across web and iOS.
  const sameId = (a, b) => String(a) === String(b);
  // personOf as the app builds it -- a Map keyed by String(id), which is sameId's
  // rule as a key, so the same mixed-type ids still resolve to the same person.
  const byId = new Map();
  people.forEach((p) => { const k = String(p.id); if (!byId.has(k)) byId.set(k, p); });
  const personOf = (id) => (id == null ? null : byId.get(String(id)) || null);
  return new Function("people", "sameId", "personOf", src + " return _assigneesOf;")(people, sameId, personOf);
};
const PEOPLE = [{ id: 1, name: "Ana Cruz" }, { id: "2", name: "Ben Ito" }, { id: 3, name: "Cy Dole" }];
const f = make(PEOPLE);

const job = (ops) => ({ title: "J", team: [], subs: [{ title: "P", team: [], subs: ops }] });
ok("a job answers with the people on its operations",
  f(job([{ team: [1] }, { team: ["2"] }])).map((p) => p.name).join() === "Ana Cruz,Ben Ito");
// The reason the column exists.
ok("...which job.team alone could not, being empty", job([{ team: [1] }]).team.length === 0);
ok("a Skip Assignee job answers with nobody", f(job([{ team: [] }, { team: [] }])).length === 0);
// Person ids are mixed string/number; a dedupe on === would list Ben twice.
ok("the same person on two operations is listed once",
  f(job([{ team: ["2"] }, { team: [2] }])).length === 1);
ok("order follows the operations, not the roster",
  f(job([{ team: [3] }, { team: [1] }])).map((p) => p.name).join() === "Cy Dole,Ana Cruz");
// Legacy single-level tasks predate phases and carry their own team.
ok("a legacy task with no phases falls back to its own team",
  f({ title: "old", team: [1, 3], subs: [] }).map((p) => p.name).join() === "Ana Cruz,Cy Dole");
ok("...and so does a job whose operations are all unassigned",
  f({ title: "j", team: [1], subs: [{ team: [], subs: [{ team: [] }] }] }).map((p) => p.name).join() === "Ana Cruz");
ok("a deleted operation does not count as assigned",
  f({ title: "j", team: [], subs: [{ team: [], subs: [{ team: [1], deletedAt: "2026-01-01" }] }] }).length === 0);
ok("a phase with no operations answers with its own team",
  f({ title: "j", team: [], subs: [{ team: [3], subs: [] }] }).map((p) => p.name).join() === "Cy Dole");
ok("an id with no matching person is dropped, not rendered as undefined",
  f(job([{ team: [99] }, { team: [1] }])).map((p) => p.name).join() === "Ana Cruz");
ok("an op row answers for itself", f({ team: ["2"] }).map((p) => p.name).join() === "Ben Ito");

// ── sorting ──────────────────────────────────────────────────────────────────
// "" compares before any name, so ascending puts the unassigned first -- the jobs
// still waiting on somebody, which is the reason to sort by this column at all.
const nameOf = (j) => (f(j)[0] || {}).name || "";
const rows = [job([{ team: [3] }]), job([{ team: [] }]), job([{ team: [1] }])];
const sorted = [...rows].sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(nameOf);
ok("ascending lists the unassigned first", sorted[0] === "");
ok("...then by name", sorted.slice(1).join() === "Ana Cruz,Cy Dole");

// ── the grid cards scroll sideways as one ────────────────────────────────────
// Each section on the Jobs page is its own card with its own horizontal scroller,
// so scrolling right to reach a late column moved that section alone and left the
// rest behind, columns no longer lining up down the page.
ok("FrostCard can hand out its scrolling box", S.includes("const FrostCard = ({ children, onClick, border, scrollRef, className = \"\", style: sx = {} })"));
ok("...and it is the SCROLLING box, not the outer card", /<div ref=\{scrollRef\} className="tq-card-scroll"/.test(S));
// The Revamp draws every group inside ONE table card, so there is one grid card
// to join; the scroll group still holds it (and the mirroring below stays correct
// should a second card come back).
ok("the jobs grid card joins the group",
  (S.match(/scrollRef=\{registerJobsHScroll\}/g) || []).length === 1);
ok("...and cards elsewhere in the app are left alone",
  (S.match(/<FrostCard/g) || []).length > 1 && !/scrollRef=\{register(?!JobsHScroll)/.test(S));
ok("a scroll on one is mirrored onto the others", S.includes("if (other !== el && other.scrollLeft !== x) other.scrollLeft = x;"));
// Assigning scrollLeft fires `scroll` on each of the others, asynchronously.
ok("the mirrored scrolls cannot answer back", S.includes("if (jobsHSyncing.current) return;"));
ok("...and the guard is released on the next frame, not synchronously",
  S.includes("requestAnimationFrame(() => { jobsHSyncing.current = false; });"));
ok("a purely vertical scroll mirrors nothing", S.includes("if (x === jobsHScrollLeft.current) return;"));
ok("a card that mounts later arrives where the others already are",
  S.includes("if (el.scrollLeft !== jobsHScrollLeft.current) el.scrollLeft = jobsHScrollLeft.current;"));
ok("...and is registered only once", S.includes("if (!el || jobsHScrollers.current.has(el)) return;"));
// React 18 hands a callback ref null on unmount without the element, so there is
// nothing to detach from; unmounted cards are dropped on the next pass instead.
ok("unmounted cards are dropped rather than accumulating",
  S.includes("if (!other.isConnected) { jobsHScrollers.current.delete(other); continue; }"));

// The sync itself, modelled: three cards, one gets scrolled, all three agree and
// the echo does not start a second round.
{
  const group = { set: new Set(), left: 0, syncing: false, frames: [] };
  const card = (name) => {
    const el = { name, scrollLeft: 0, isConnected: true, fire: null };
    group.set.add(el);
    el.scrollLeft = group.left;
    el.fire = () => {
      if (group.syncing) return;
      const x = el.scrollLeft;
      if (x === group.left) return;
      group.left = x;
      group.syncing = true;
      for (const o of group.set) {
        if (!o.isConnected) { group.set.delete(o); continue; }
        if (o !== el && o.scrollLeft !== x) { o.scrollLeft = x; group.frames.push(o); }
      }
      return () => { group.syncing = false; };
    };
    return el;
  };
  const a = card("a"), b = card("b"), c = card("c");
  a.scrollLeft = 420;
  const release = a.fire();
  ok("scrolling one card moves the others", b.scrollLeft === 420 && c.scrollLeft === 420);
  // The echoes arrive before the frame that clears the guard.
  const before = group.left;
  b.fire(); c.fire();
  ok("the echoes change nothing", group.left === before && a.scrollLeft === 420);
  release();
  // A card that appears afterwards.
  const d = card("d");
  ok("a card mounting later starts where the rest are", d.scrollLeft === 420);
  // And one that goes away.
  c.isConnected = false;
  b.scrollLeft = 90; b.fire();
  ok("a later scroll still reaches the live cards", a.scrollLeft === 90 && d.scrollLeft === 90);
  ok("...and the unmounted one is dropped", !group.set.has(c));
  // A vertical-only scroll must not re-broadcast the same position.
  const n = group.frames.length;
  a.fire();
  ok("a scroll that did not move sideways mirrors nothing", group.frames.length === n);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
