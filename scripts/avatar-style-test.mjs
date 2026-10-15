// PersonAvatar must not mix the `background` shorthand with background-* longhands — #373.
//
// `background` is a shorthand that RESETS background-image, -size and -position. React diffs
// inline styles key by key, so on a render where `background` changed and `backgroundImage`
// did not — a theme switch, an accent change, the person's colour edited — React wrote the
// shorthand alone and the photo was wiped to a plain fill until something else re-rendered.
// React also warned on every render of every avatar. `backgroundColor` collides with nothing.
//
// Scoped to PersonAvatar's own style object, comments stripped (R4).
//
//   node scripts/avatar-style-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const at = S.indexOf("function PersonAvatar(");
ok("PersonAvatar is found exactly once", at > 0 && S.indexOf("function PersonAvatar(", at + 1) < 0);
const body = S.slice(at, S.indexOf("\n}\n", at)).replace(/^\s*\/\/.*$/gm, "");
const styleAt = body.indexOf("style={{");
const style = body.slice(styleAt, body.indexOf("}}", styleAt));
ok("#373 the avatar still sets its photo as a background image", /backgroundImage:/.test(style));
ok("#373 ...and does not also set the `background` shorthand, which resets it", !/(^|[\s,{])background:/.test(style));
ok("#373 ...its fill is backgroundColor", /backgroundColor:/.test(style));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
