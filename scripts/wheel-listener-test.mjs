// The schedule's horizontal wheel pan can actually cancel the wheel — #231.
//
// It was `onWheel={handleTeamWheel}`, and React 17+ registers wheel listeners as PASSIVE at the
// root, so the handler's preventDefault() was ignored (with a console warning): a horizontal
// trackpad swipe panned the schedule AND scrolled the page — or, in Chrome on a Mac, read as a
// Back gesture. It is now a native listener added with { passive: false } by a stable callback
// ref, which also keeps teamRef.current for its other readers.
//
// Scoped, comments stripped (R4).
//
//   node scripts/wheel-listener-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");

ok("#231 the schedule no longer takes the wheel through React's passive onWheel", !/onWheel=\{handleTeamWheel\}/.test(S));
const at = S.indexOf("const setTeamScrollEl = useCallback(");
const fn = S.slice(at, S.indexOf("}, [", at) + 30);
ok("#231 a callback ref attaches it natively", at > 0 && /addEventListener\("wheel", handleTeamWheel, \{ passive: false \}\)/.test(fn));
ok("#231 ...removes it from the element it left", /removeEventListener\("wheel", handleTeamWheel\)/.test(fn));
ok("#231 ...keeps teamRef.current for its other readers", /teamRef\.current = el;/.test(fn));
ok("#231 ...and is stable (a dependency array), so React does not detach and re-attach it every render", /\}, \[handleTeamWheel\]\)/.test(fn));
ok("#231 the schedule's scroll element uses it", /ref=\{setTeamScrollEl\}/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
