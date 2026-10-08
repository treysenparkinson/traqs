// #465 — move history is append-only, and the server now holds clients to it.
//
// #458's write — Max attaching a photo from the old iOS build — re-encoded all
// 65 jobs through a model that carries a SUBSET of a moveLog entry, and stripped
// `fromStartHour`, `toStartHour`, `fromEndHour`, `toEndHour`, `fromTeam`,
// `toTeam`, `fromHpd`, `toHpd`, `fromDepartments` and `toDepartments` from 281
// of 283 entries. The record of WHO a move reassigned and at WHAT HOUR, gone.
//
// Five server-side instruments ran on that write and every one found nothing,
// because none of them watches move history. This is the one that does.
//
// THE RULE: for a node that already exists in storage, every stored entry must
// survive the write intact. An incoming entry may ADD fields; it may not drop
// or change them. The array may GROW; it may not shrink.
//
// WHY IT HAS NO FALSE POSITIVES, checked against every write path in the
// product: each one is `[...(existing || []), newEntry]`, a pure append. The
// single exception, `dragMove.js`'s split, writes `moveLog: [goLog]` onto a
// BRAND-NEW node with a new id and no stored predecessor, which this never
// looks at.
//
// AND IT DOES NOT ASK iOS TO MODEL MORE. A thinner entry iOS APPENDS passes
// untouched — the rule only protects entries that already exist. It stops a
// client rewriting history without requiring it to understand history.
//
// WHAT IT DOES NOT CLOSE, recorded here as well as in the entry so nobody later
// assumes the backstop is wider than it is: **the 39 flattened statuses.** A
// status is not pinnable — a user changing one is the normal case — and no
// server-side rule can tell "the user chose Not Started" from "my enum could
// not say anything else", because both arrive as a legal member of the org's
// list. The defences there are the iOS fix and whoever installs it.
//
//   node scripts/movelog-immutable-test.mjs
import { readFileSync } from "node:fs";
import { keepMoveLogDetail } from "../netlify/functions/_utils/move-log-guard.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const idx = (nodes, into = new Map()) => {
  for (const n of nodes || []) { if (n?.id != null) into.set(String(n.id), n); if (Array.isArray(n?.subs)) idx(n.subs, into); }
  return into;
};
const run = (incoming, stored) => { const kept = []; return { out: keepMoveLogDetail(incoming, idx(stored), kept), kept }; };

console.log("\n1. RED PROOF — #458's actual write, replayed from the fixture");
{
  // fixtures/movelog-458.json holds the real arrays: `stored` from version
  // _G1jj8FEpnGatFFaEEfQHIMnXVy0bsgB (2026-10-07T22:58:16Z) and `incoming` as
  // the iOS re-encode sent it at 00:29:17Z. Not a paraphrase of the incident.
  const fx = JSON.parse(readFileSync(new URL("../fixtures/movelog-458.json", import.meta.url), "utf8"));
  ok("the fixture is the real write", fx.nodes.length, 17);
  const stored = fx.nodes.map(n => ({ id: n.id, title: n.title, moveLog: n.stored }));
  const incoming = fx.nodes.map(n => ({ id: n.id, title: n.title, moveLog: n.incoming }));

  // 283 entries on these 17 nodes; 281 of them carried hour detail and the
  // re-encode stripped every one. The other 2 never had it.
  const before = incoming.reduce((s, n) => s + n.moveLog.filter(e => "fromStartHour" in e).length, 0);
  ok("RED: as it arrived, NOT ONE entry carries hour detail", before, 0);

  const { out, kept } = run(incoming, stored);
  const after = out.reduce((s, n) => s + n.moveLog.filter(e => "fromStartHour" in e).length, 0);
  const storedTotal = stored.reduce((s, n) => s + n.moveLog.filter(e => "fromStartHour" in e).length, 0);
  ok("every entry that carried hour detail still does", after, storedTotal);
  ok("...which is all 281 of them", after, 281);
  ok("the guard reports what it put back", kept.length, 281);

  // Byte-for-byte: every stored entry survives whole.
  let intact = 0, total = 0;
  for (let i = 0; i < stored.length; i++) {
    for (let j = 0; j < stored[i].moveLog.length; j++) {
      total++;
      const s = stored[i].moveLog[j], o = out[i].moveLog[j];
      if (Object.keys(s).every(k => JSON.stringify(s[k]) === JSON.stringify(o?.[k]))) intact++;
    }
  }
  ok("every stored entry survives intact", [intact, total], [283, 283]);
  ok("...and no array got shorter", out.every((n, i) => n.moveLog.length >= stored[i].moveLog.length), true);
}

console.log("\n2. WHAT IT MUST NOT TOUCH");
{
  // A thinner entry the client APPENDS is legitimate — iOS models a subset and
  // is allowed to keep doing so. The rule protects history, not the future.
  const stored = [{ id: "a", moveLog: [{ date: "d1", movedBy: "M", fromStartHour: 8 }] }];
  const incoming = [{ id: "a", moveLog: [
    { date: "d1", movedBy: "M" },                       // the stored one, narrowed
    { date: "d2", movedBy: "M" },                       // a NEW thin entry
  ] }];
  const { out, kept } = run(incoming, stored);
  ok("the stored entry is restored", out[0].moveLog[0].fromStartHour, 8);
  ok("the appended entry is left exactly as sent", out[0].moveLog[1], { date: "d2", movedBy: "M" });
  ok("the array keeps its new length", out[0].moveLog.length, 2);
  ok("only the restoration is reported", kept.length, 1);

  // A node with no stored counterpart — the split's new op — is never examined.
  const fresh = [{ id: "new", moveLog: [{ date: "d", movedBy: "M" }] }];
  ok("a brand-new node passes untouched", run(fresh, stored).out[0].moveLog[0], { date: "d", movedBy: "M" });
  ok("...and reports nothing", run(fresh, stored).kept.length, 0);

  // Identity: an untouched node must come back as the SAME object, or every save
  // looks like a change to stampArray and the conflict check.
  const clean = [{ id: "a", moveLog: [{ date: "d1", movedBy: "M", fromStartHour: 8 }] }];
  ok("an undamaged node is returned by identity", run(clean, stored).out[0] === clean[0], true);
  ok("...and so is the array itself", run(clean, stored).out === clean, true);
}

console.log("\n3. HISTORY IS IMMUTABLE, NOT MERELY COMPLETE");
{
  const stored = [{ id: "a", moveLog: [{ date: "d1", movedBy: "Max", fromStartHour: 8 }] }];
  // A changed VALUE on an existing entry is a rewrite of history, so the stored
  // value wins. #458 had none of these, so this costs nothing measured — it is
  // the rule being a rule rather than a patch for one incident.
  const edited = [{ id: "a", moveLog: [{ date: "d1", movedBy: "Trey", fromStartHour: 8 }] }];
  const r = run(edited, stored);
  ok("a rewritten field is put back", r.out[0].moveLog[0].movedBy, "Max");
  ok("...and reported", r.kept.length, 1);
  // A shortened array is history deleted.
  const truncated = [{ id: "a", moveLog: [] }];
  const t = run(truncated, stored);
  ok("a truncated log is restored", t.out[0].moveLog.length, 1);
  ok("...with its detail", t.out[0].moveLog[0].fromStartHour, 8);
  // A dropped array entirely.
  const none = [{ id: "a" }];
  ok("a missing moveLog is restored", run(none, stored).out[0].moveLog.length, 1);
}

console.log("\n4. EDGES THAT MUST NOT THROW ON A WRITE PATH");
{
  const stored = [{ id: "a", moveLog: [{ date: "d" }] }];
  ok("no nodes at all", run(null, stored).out, null);
  ok("a node with no id", run([{ moveLog: [] }], stored).out[0].moveLog, []);
  ok("a null in the array", run([null, { id: "a", moveLog: [] }], stored).out[0], null);
  ok("a stored node with no moveLog", run([{ id: "b", moveLog: [{ x: 1 }] }], [{ id: "b" }]).out[0].moveLog, [{ x: 1 }]);
  ok("a non-array moveLog on either side",
    run([{ id: "c", moveLog: "junk" }], [{ id: "c", moveLog: [{ date: "d" }] }]).out[0].moveLog.length, 1);
  ok("a null entry inside a stored log",
    run([{ id: "d", moveLog: [] }], [{ id: "d", moveLog: [null] }]).out[0].moveLog.length, 1);
  // It must recurse: the damage was on ops, three levels down.
  const deep = [{ id: "j", subs: [{ id: "p", subs: [{ id: "o", moveLog: [{ date: "d" }] }] }] }];
  const deepStored = [{ id: "j", subs: [{ id: "p", subs: [{ id: "o", moveLog: [{ date: "d", fromStartHour: 9 }] }] }] }];
  ok("it reaches an op three levels down",
    run(deep, deepStored).out[0].subs[0].subs[0].moveLog[0].fromStartHour, 9);
}

console.log("\n5. THE ENDPOINT RUNS IT");
{
  const fn = readFileSync(new URL("../netlify/functions/tasks.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  ok("tasks.js imports the guard", /import \{ keepMoveLogDetail \} from "\.\/_utils\/move-log-guard\.js";/.test(fn), true);
  ok("...and applies it to the incoming tree", /incoming = keepMoveLogDetail\(incoming, idx, moveKeeps\);/.test(fn), true);
  ok("...beside the counter guard, on the same index", /keepServerOwned\(incoming, idx, kept\);/.test(fn), true);
  ok("...and records what it restored", /attempt\.moveLogKeeps = moveKeeps;/.test(fn), true);
  ok("the restorations reach the durable log", /tag: "move-log-detail"/.test(fn), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
