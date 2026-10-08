// #457 — every web sign-in sends the org's Auth0 connection.
//
// An org with `config.connection` (Matrix: "matrixpci", Microsoft) must reach
// Auth0 with `connection` set, or Auth0 shows its default page — email/password
// and Google — where the Microsoft enterprise connection has no button. Trey's
// partner hit exactly that on 2026-10-08.
//
// Two web paths sent it (tapping your name on the roster, the admin sign-in).
// The third did not: the RECOVERY re-login in safeGetToken, which only runs
// after a session has expired. The working paths are the ones everyone uses, so
// nobody noticed. (The iOS sign-in had the same gap — see the SCHEDULE_MAP entry.)
//
// A RATCHET OVER EVERY loginWithRedirect CALL, not a check on one line: the next
// sign-in path added without the connection is the same bug, and this is where
// it would be caught.
//
//   node scripts/login-connection-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// Each loginWithRedirect( … ) call, by balanced parentheses.
function calls(code) {
  const out = [];
  let i = 0;
  while ((i = code.indexOf("loginWithRedirect(", i)) >= 0) {
    const open = i + "loginWithRedirect".length;
    let depth = 0, j = open;
    for (; j < code.length; j++) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") { depth--; if (depth === 0) break; }
    }
    out.push(code.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}
const sendsConnection = (call) => /connection: orgConfig\.connection/.test(call);

console.log("\n1. THE SCANNER (must-catch / must-pass)");
{
  const fixture = `
    function a() { loginWithRedirect({ authorizationParams: { login_hint: x, ...(orgConfig?.connection ? { connection: orgConfig.connection } : {}) } }); }
    function b() { loginWithRedirect({ appState: { returnTo: f(1) } }); }`;
  const c = calls(fixture);
  ok("finds both calls, nested parentheses and all", c.length, 2);
  ok("passes the one that sends the connection, flags the one that does not", c.map(sendsConnection), [true, false]);
}

console.log("\n2. EVERY WEB SIGN-IN SENDS THE ORG'S CONNECTION");
const SRC = codeOf(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const all = calls(SRC);
// Guard the input: three call sites at the time of writing. Fewer means the
// scanner stopped matching (or a path was removed — re-baseline deliberately).
if (all.length < 3) { console.error(`found ${all.length} loginWithRedirect calls in App.jsx, expected ≥3`); process.exit(2); }
ok(`RED: all ${all.length} loginWithRedirect calls pass orgConfig.connection`,
  all.filter(c => !sendsConnection(c)).map(c => c.replace(/\s+/g, " ").slice(0, 90)), []);
ok("...the recovery re-login keeps its returnTo", all.some(c => /returnTo: window\.location\.pathname/.test(c) && sendsConnection(c)), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
