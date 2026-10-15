// The sign-in domain allowlist is enforced only where the tier offers it — #422, ruled 2026-10-15
// ("enforcement follows the tier. The setting is Business-only, so the restriction should be too
// — otherwise a downgrade keeps a lock with no way to see or clear it").
//
// The control renders on Business only; the enforcement in App.jsx checked only that a domain was
// set. An org moved to Basic with a domain on file kept the gate and lost the only control that
// could see or clear it. /org-config now reports the org's tier (read the way tasks.js reads it:
// billing.json, absent = basic) and App.jsx enforces the domain only on Business. Membership,
// enforced server-side by requireOrgMember, stays the real boundary.
//
//   node scripts/domain-tier-test.mjs
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const fn = (await import(new URL("../netlify/functions/org-config.js", import.meta.url).href)).handler;
const seed = (billing) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {};
  globalThis.__S3 = {
    "orgs/TESTORG/config.json": { orgCode: "TESTORG", name: "T", domain: "matrixpci.com" },
    "orgs/TESTORG/people.json": [{ id: "1", email: "a@x.com" }],
    ...(billing ? { "orgs/TESTORG/billing.json": billing } : {}),
  };
  globalThis.__AUTH = { personId: "1", isAdmin: true, email: "a@x.com", orgCode: "TESTORG" };
};
const get = () => fn({ httpMethod: "GET", headers: {}, queryStringParameters: {} });

seed({ tier: "business" });
ok("#422 a Business org's config says business", (await get()).body?.tier, "business");
seed({ tier: "basic" });
ok("#422 a Basic org's config says basic", (await get()).body?.tier, "basic");
seed(null);
ok("#422 an org with no billing record is basic", (await get()).body?.tier, "basic");

const A = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = A.indexOf("if (!orgConfig.domain) return;");
const gate = A.slice(at, A.indexOf('setStep("domain-error")', at));
ok("#422 App.jsx enforces the domain only on Business", at > 0 && /if \(orgConfig\.tier !== "business"\) return;/.test(gate), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
