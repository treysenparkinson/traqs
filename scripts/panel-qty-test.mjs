// A panel with qty > 1 expands ONE way — #485 (the duplication half, and the bug inside it).
//
// The expansion existed three times: the wizard's buildExpanded, the scheduler's expandedOps, and
// the Schedule Later button. The first two gave every copy after the first FRESH op ids and
// remapped the deps inside it; Schedule Later spread the ops verbatim into every copy, so qty 3
// stored three panels holding the SAME op ids, with deps pointing back into the first copy —
// two ops with one id, which every by-id lookup resolves to whichever comes first. All three
// now call expandQty (src/panelQty.js).
//
//   node scripts/panel-qty-test.mjs

import { readFileSync } from "node:fs";
import { expandQty } from "../src/panelQty.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
let n = 0; const uid = () => `u${++n}`;
const cleanDeps = (deps) => (deps || []).filter(d => d !== "__pending__");

const panel = { id: "P", title: "Panel-007", qty: "3", deps: ["__pending__"], subs: [
  { id: "L", title: "Layout", deps: [] },
  { id: "W", title: "Wire", deps: ["L", "__pending__"] },
] };
const out = expandQty(panel, { uid, cleanDeps });
ok("#485 qty 3 makes three copies", out.length === 3);
ok("the first copy keeps the original ids", out[0].id === "P" && out[0].subs.map(s => s.id).join() === "L,W");
const allOpIds = out.flatMap(c => c.subs.map(s => s.id));
ok(`#485 every op id across the copies is unique (${allOpIds.join(",")})`, new Set(allOpIds).size === allOpIds.length);
ok("#485 every panel id is unique", new Set(out.map(c => c.id)).size === 3);
ok("#485 each copy's deps point inside that copy", out.every(c => { const w = c.subs.find(s => s.title === "Wire"); const l = c.subs.find(s => s.title === "Layout"); return w.deps.length === 1 && w.deps[0] === l.id; }));
ok("titles are numbered from the base", out.map(c => c.title).join() === "Panel-001,Panel-002,Panel-003");
ok("qty is stripped and pending deps are cleaned", out.every(c => !("qty" in c) && !c.deps.includes("__pending__")));
const one = expandQty({ id: "Q", title: "Solo", qty: 1, subs: [{ id: "a", deps: ["__pending__"] }] }, { uid, cleanDeps });
ok("qty 1 is one copy, title and ids untouched", one.length === 1 && one[0].id === "Q" && one[0].title === "Solo" && one[0].subs[0].id === "a" && one[0].subs[0].deps.length === 0);

// RED PROOF: the Schedule Later spelling this replaces.
{
  const old = Array.from({ length: 3 }, (_, i) => ({ ...panel, id: i === 0 ? panel.id : uid() }));
  const ids = old.flatMap(c => c.subs.map(s => s.id));
  ok("red proof: the old Schedule Later copies shared op ids", new Set(ids).size < ids.length);
}

const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
ok("#485 all three expansions call expandQty", (S.match(/expandQty\(/g) || []).length >= 3);
ok("#485 none expands by hand any more", !/Array\.from\(\{\s*length:\s*qty\s*\}/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
