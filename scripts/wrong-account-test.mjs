// "Wrong account" after a perfectly good sign-in — the login screen that needed refreshing.
//
// Trey, 2026-10-17: tap your name on the roster, sign in, and land on "Access Denied — You
// selected Treysen but signed in as Treysen@matrixpci.com. Please sign in with their email."
// The last two words are the tell: "their email" is WrongUserError's fallback for a selected
// person with NO email.
//
// #385 (2026-10-06) allow-listed the unauthenticated roster to id, name, color, department and
// userRole. The roster you tap your name on is that roster, so the person App.jsx saved in
// sessionStorage had no email, and the post-login check compared the Auth0 email against
// `undefined` — a mismatch on every sign-in that starts with a tap on your name. The admin
// sign-in saves nobody, so it went straight in; that is the "sometimes".
//
// The check cannot go back to emails: keeping them off the anonymous roster is the point of
// #385. It compares PERSON IDS instead. The roster still carries the id, and /org-config — the
// gate's one authenticated call — now says which person the token resolved to.
//
//   node scripts/wrong-account-test.mjs
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. /org-config SAYS WHICH PERSON THE TOKEN IS");
{
  const fn = (await import(new URL("../netlify/functions/org-config.js", import.meta.url).href)).handler;
  const seed = (auth, people) => {
    globalThis.__WRITES = []; globalThis.__ETAGS = {};
    globalThis.__S3 = {
      "orgs/TESTORG/config.json": { orgCode: "TESTORG", name: "T", adminEmail: "boss@x.com" },
      "orgs/TESTORG/people.json": people,
    };
    globalThis.__AUTH = { orgCode: "TESTORG", ...auth };
  };
  const get = () => fn({ httpMethod: "GET", headers: {}, queryStringParameters: {} });

  seed({ personId: "7", isAdmin: false, email: "treysen@matrixpci.com" }, [{ id: 7, name: "Treysen", email: "treysen@matrixpci.com" }]);
  ok("a member's own person id comes back", (await get()).body?.personId, "7");

  // The founding admin has no row until this call writes one. The id returned must be that row's.
  seed({ personId: null, isAdmin: true, email: "boss@x.com" }, []);
  const res = await get();
  const written = (globalThis.__S3["orgs/TESTORG/people.json"] || []).find(p => p.email === "boss@x.com");
  ok("a self-provisioned admin gets the id of the row just written", res.body?.personId != null && res.body?.personId === String(written?.id), true);
}

console.log("\n2. THE VERDICT");
let isWrongAccount = null;
try {
  ({ isWrongAccount } = await import(new URL("../src/wrongAccount.js", import.meta.url).href));
} catch { /* missing module: every case below fails on its assertion */ }
const verdict = (saved, cfg) => (typeof isWrongAccount === "function" ? isWrongAccount(saved, cfg) : "no isWrongAccount");
{
  // The roster person as #385 serves it: no email.
  const tapped = { id: 7, name: "Treysen", color: "#4169e1", department: "Eng", userRole: "admin" };
  ok("THE BUG: the person you tapped, signed in as yourself, is not the wrong account", verdict(tapped, { personId: "7" }), false);
  ok("tapped one person, signed in as another: wrong account", verdict(tapped, { personId: "12" }), true);
  ok("a numeric roster id and the server's string id are the same person", verdict({ id: 7 }, { personId: "7" }), false);
  ok("before /org-config answers there is no verdict", verdict(tapped, {}), false);
  ok("no person row for the token is not this screen's verdict (membership owns it)", verdict(tapped, { personId: null }), false);
  ok("nobody tapped (the admin sign-in): nothing to contradict", verdict(null, { personId: "7" }), false);
  ok("a saved person with no id cannot be contradicted", verdict({ name: "Treysen" }, { personId: "7" }), false);
}

console.log("\n3. App.jsx ASKS THE VERDICT, AND RE-ASKS WHEN THE ANSWER ARRIVES");
{
  const A = codeOf(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
  const at = A.indexOf('setStep("wrong-user")');
  ok("one wrong-user transition (anchor)", at > 0 && A.indexOf('setStep("wrong-user")', at + 1) < 0, true);
  const effStart = A.lastIndexOf("useEffect(", at);
  const effEnd = A.indexOf("}, [", at);
  const body = A.slice(effStart, effEnd);
  const deps = A.slice(effEnd, A.indexOf("]);", effEnd));
  ok("the effect decides with isWrongAccount", /if \(isWrongAccount\(saved, orgConfig\)\)\s*\{\s*setStep\("wrong-user"\)/.test(body), true);
  ok("and no longer compares the selected person's email", /saved\.email|saved\?\.email/.test(body), false);
  // Without this the effect runs once while personId is unknown, returns no verdict, and never
  // runs again when /org-config lands — the domain check's isMember dependency, same reason.
  ok("orgConfig?.personId is a dependency", /orgConfig\?\.personId/.test(deps), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
