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
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

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
const cbAt = S.indexOf("const splitGanttPaneRef = useCallback(");
ok("#312 the split-gantt pane's observer is attached by a callback ref", cbAt > 0);
// A callback ref with no deps is a NEW function every render, and React then detaches and
// re-attaches it every render — the same rebuild, moved. It must be stable.
ok("#312 ...and that ref is stable (useCallback with a dependency array)", cbAt > 0 && effectArgs(S, cbAt + "const splitGanttPaneRef = ".length).args === 2);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
