// A sign-in that matches nobody on the roster is NOBODY, not the first person on it — #217.
//
// Both roster loads resolved the signed-in user by email and, failing a match, fell back to
// `people[0]`: the cold-hydrate from cache (`prev || match || np[0]`) and the server load
// (`match || resolvedPeople[0]`, and `resolvedPeople[0]` outright with no email at all). The
// first person on a roster is often the org's founding admin, so an unmatched sign-in was
// shown, and acted in the client as, someone else. The server judges every write by the token,
// so this was never a server-side escalation — but the client's gates, "my" views and every
// action stamped with loggedInUser.name were someone else's. Null is already a state the app
// handles (an empty roster produced it), so an unmatched sign-in now resolves to null.
//
// Scoped to the two roster loads, comments stripped (R4).
//
//   node scripts/logged-in-user-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const sets = [...S.matchAll(/setLoggedInUser\(([^;]*)\);/g)].map(m => m[1]);
ok(`the roster loads' setLoggedInUser calls are found (${sets.length})`, sets.length >= 2);
const fallback = sets.filter(a => /\[0\]/.test(a));
ok(`#217 none falls back to the first person on the roster (found ${fallback.length}: ${JSON.stringify(fallback)})`, fallback.length === 0);
ok("#217 ...nor does the server load's resolved user", !/const resolvedUser = [^;]*\[0\]/.test(S));
ok("#217 the cold hydrate resolves by email or keeps what it had", /setLoggedInUser\(prev => prev \|\| match \|\| null\)/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
