// The .subtle-all-btn stylesheet is defined once — #321 (the half that remained).
//
// The same 611-character themed sheet was pasted into three views (Jobs, Clients, Schedule), so
// a change to one copy would silently diverge from the other two. It is now one definition,
// subtleAllBtnCss, built from the theme where the copies were, and each view still renders its
// own <style> with it — the mechanism is unchanged, which is the point: the entry warns that
// hoisting such a sheet into the static global sheet is where a scoping bug crept in before, and
// this one reads theme values the static sheet cannot. The keyframe half was already closed.
//
//   node scripts/subtle-btn-css-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
ok("#321 the .subtle-all-btn rules are written in exactly one place", (S.match(/\.subtle-all-btn\{display:inline-flex/g) || []).length === 1);
ok("#321 ...as subtleAllBtnCss", /const subtleAllBtnCss = `\.subtle-all-btn\{display:inline-flex/.test(S));
ok("#321 all three views render it", (S.match(/<style>\{subtleAllBtnCss\}<\/style>/g) || []).length === 3);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
