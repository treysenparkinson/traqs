// A settings save cannot lose a PTO approval — #150, ruled 2026-10-15 ("fix it as scoped.
// Settings save shouldn't be able to lose a PTO approval").
//
// The 2026-10-12 fix narrowed the window (re-read the roster, lay the edited fields on, POST it
// whole) but did not close it: a write landing between the re-read and the POST was still lost.
// And two more settings saves were the WIDER window — Settings → Worker permissions and
// Settings → Time Clock POSTed the draft roster, a snapshot from when the section opened.
//
// Closed by sending only what was edited: `fieldEdits` diffs the draft against the snapshot the
// screen opened with, and POST /people?action=fields applies those fields, per person, inside ONE
// conditional read-modify-write on the server. A time-off approval landing at any point is kept,
// because nothing the client sends carries `timeOff` at all.
//
//   node scripts/people-fields-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
const { fieldEdits } = await import("../src/rosterEdits.js");

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\nfieldEdits — only what was edited");
{
  const base = [{ id: "1", payType: "hourly", pin: "1111" }, { id: "2", payType: "salary" }];
  const draft = [{ id: "1", payType: "salary", pin: "1111" }, { id: "2", payType: "salary" }];
  ok("#150 an edited field is sent; an untouched one and an untouched person are not", fieldEdits(base, draft, ["payType", "pin"]), [{ id: "1", fields: { payType: "salary" } }]);
  ok("a field cleared in the draft is sent as null", fieldEdits([{ id: "1", adminPerms: { x: true } }], [{ id: "1" }], ["adminPerms"]), [{ id: "1", fields: { adminPerms: null } }]);
  ok("nothing edited, nothing sent", fieldEdits(base, base, ["payType", "pin"]), []);
  ok("fields outside the list are never sent, even if they differ", fieldEdits([{ id: "1", timeOff: [] }], [{ id: "1", timeOff: [{ a: 1 }] }], ["payType"]), []);
}

console.log("\nPOST /people?action=fields");
const fn = (await import(new URL("../netlify/functions/people.js", import.meta.url).href)).handler;
const KEY = "orgs/TESTORG/people.json";
const seed = (auth) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [KEY]: [
    { id: "1", name: "Ada", userRole: "admin" },
    { id: "7", name: "Wendy", userRole: "user", payType: "hourly", timeOff: [] },
  ] };
  globalThis.__AUTH = { ...auth };
};
const ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x", orgCode: "TESTORG" };
const RESTRICTED = { personId: "1", isAdmin: true, adminPerms: { manageTeam: false }, email: "a@x", orgCode: "TESTORG" };
const post = (edits) => fn({ httpMethod: "POST", headers: {}, queryStringParameters: { action: "fields" }, body: JSON.stringify({ edits }) });
const row = (id) => globalThis.__S3[KEY].find(p => p.id === id);

seed(ADMIN);
{
  // The approval lands INSIDE the save's window.
  let fired = false;
  globalThis.__BEFORE_WRITE = async (k) => {
    if (fired || k !== KEY) return; fired = true;
    globalThis.__S3[KEY] = globalThis.__S3[KEY].map(p => p.id === "7" ? { ...p, timeOff: [{ start: "2026-11-02", end: "2026-11-03", status: "approved" }] } : p);
    globalThis.__ETAGS[KEY] = String(Number(globalThis.__ETAGS[KEY] ?? 0) + 1);
  };
  const res = await post([{ id: "7", fields: { payType: "salary" } }]);
  ok("#150 the field edit lands", [res.statusCode, row("7").payType], [200, "salary"]);
  ok("#150 ...and a PTO approval that landed during the save SURVIVES", row("7").timeOff.length, 1);
}
seed(ADMIN);
{
  await post([{ id: "7", fields: { pin: "4321", timeOff: [], name: "Hacked" } }]);
  // This loader stubs pin.js (encryptPin is the identity), so encryption is checked in the
  // source: the fields action writes a PIN only through encryptPin, as the roster POST does.
  ok("a PIN is written", row("7").pin, "4321");
  const SRC = (await import("node:fs")).readFileSync(new URL("../netlify/functions/people.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const act = SRC.slice(SRC.indexOf('action === "fields"'), SRC.indexOf('if (event.httpMethod === "POST") {', SRC.indexOf('action === "fields"')));
  ok("...and only through encryptPin", /k === "pin" \? encryptPin\(String\(v\)\) : v/.test(act), true);
  ok("fields outside the allow-list are ignored (no timeOff, no name)", [row("7").name, row("7").timeOff], ["Wendy", []]);
}
seed(ADMIN);
{
  await post([{ id: "1", fields: { adminPerms: null } }]);
  ok("null clears a field", "adminPerms" in row("1"), false);
}
seed(RESTRICTED);
{
  const res = await post([{ id: "7", fields: { payType: "salary" } }]);
  ok("without manageTeam it is refused, and nothing changes", [res.statusCode, row("7").payType], [403, "hourly"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
