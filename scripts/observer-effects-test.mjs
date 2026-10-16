// A ResizeObserver must not be rebuilt on every render — #312.
//
// The split-gantt pane's observer lived in a useEffect with NO dependency array, so after every
// render of this 32,000-line component it disconnected, built a new observer, and wrote
// setSplitGanttPaneWidth on the way: the integer clientWidth from the effect, then the
// fractional contentRect.width from the observer — two values for one box, which is the shape
// of a render loop. It is a callback ref now: attached when the pane mounts, detached when it
// unmounts, and nothing in between.
//
// The check is over EVERY useEffect in TRAQS.jsx, not this one by name, so the next observer
// written the same way fails here too. Each effect's argument list is found by matching
// brackets (strings and comments skipped), and an effect with one argument has no deps.
//
//   node scripts/observer-effects-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The text of the call's arguments, from the "(" after useEffect to its matching ")", and how
// many top-level arguments it has.
function effectArgs(src, at) {
  let i = src.indexOf("(", at), depth = 0, top = 1;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) break; }
    else if (c === "," && depth === 1) top++;
  }
  return { text: src.slice(start, i + 1), args: top };
}

const offenders = [];
let effects = 0;
for (const m of S.matchAll(/\buseEffect\(/g)) {
  effects++;
  const { text, args } = effectArgs(S, m.index);
  if (args < 2 && /new ResizeObserver\(/.test(text)) offenders.push(S.slice(0, m.index).split("\n").length);
}
ok(`the scan found the component's effects (${effects})`, effects > 50);
ok(`#312 no ResizeObserver is built in an effect without dependencies (found at lines ${JSON.stringify(offenders)})`, offenders.length === 0);
// The pane #312 was found on — the split gantt — is DELETED (#130, 2026-10-16), so the two
// assertions on its callback ref went with it. The scan above is the rule, and it stays: it
// is over every effect, so the next observer written without deps fails here.
ok("#130 the split-gantt pane and its observer are gone", !/splitGanttPane/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
