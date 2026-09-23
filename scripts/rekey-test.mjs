// Re-keying an org prefix: the rewrite, and the check that makes success
// provable rather than assumed.
//
// The centrepiece is the last section. "The copy succeeded" is not evidence —
// after a copy the stale references still resolve, because the old prefix is
// still there, and they break a week later when it is deleted. So there is a
// fixture where the rewrite is deliberately SKIPPED, and the acceptance check
// has to catch it. If that fixture ever passes, the check is decoration.
//
//   node scripts/rekey-test.mjs

import {
  collectOrgRefs, rewriteOrgRefs, verifyRefsResolve, REF_BEARING_FILES,
} from "../netlify/functions/_utils/rekey.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};

const OLD = "MTX2026TRAQS";
const NEW = "MTX.7K2P.9QX4";
const att = (code, n) => `orgs/${code}/attachments/pXTWWEOPLHE${n}-photo.jpg`;

// Shaped like the real thing: messages hold an attachments array, tasks hold
// them on a panel, several levels down.
const messages = () => ([
  { id: "m1", text: "here you go", attachments: [{ key: att(OLD, "a"), filename: "photo.jpg" }] },
  { id: "m2", text: "no attachment here", attachments: [] },
  { id: "m3", attachments: [{ key: att(OLD, "b") }, { key: att(OLD, "c") }] },
]);
const tasks = () => ([
  { id: "j1", subs: [
    { id: "p1", attachments: [{ key: att(OLD, "d") }], subs: [
      { id: "o1", notes: "no key" },
    ] },
  ] },
]);

// ── finding them ─────────────────────────────────────────────────────────
eq("every key in messages is found, however nested",
  collectOrgRefs(messages(), OLD).length, 3);
eq("including ones several levels down in tasks",
  collectOrgRefs(tasks(), OLD).length, 1);
eq("a file with none reports none",
  collectOrgRefs([{ id: "x", attachments: [] }], OLD), []);
eq("another org's keys are not ours to find",
  collectOrgRefs([{ key: att("OTHERORG", "z") }], OLD), []);
eq("a string that merely mentions the prefix mid-way is not a key",
  collectOrgRefs([{ text: `see orgs/${OLD}/attachments/x.jpg for details` }], OLD), []);
eq("null and undefined do not throw",
  collectOrgRefs([null, undefined, 0, false], OLD), []);

// ── rewriting them ───────────────────────────────────────────────────────
{
  const before = messages();
  const { value, changed } = rewriteOrgRefs(before, OLD, NEW);
  eq("every key is rewritten", changed, 3);
  eq("...to the new prefix", collectOrgRefs(value, NEW).length, 3);
  eq("...leaving none on the old one", collectOrgRefs(value, OLD).length, 0);
  eq("the filename survives intact",
    value[0].attachments[0].filename, "photo.jpg");
  eq("the id part of the key survives — only the prefix moves",
    value[0].attachments[0].key, att(NEW, "a"));
  eq("the INPUT is not mutated, so a failed run leaves a known state",
    collectOrgRefs(before, OLD).length, 3);
}
eq("another org's keys are left alone",
  rewriteOrgRefs([{ key: att("OTHERORG", "z") }], OLD, NEW).changed, 0);
eq("a file with nothing to do reports zero rather than failing",
  rewriteOrgRefs([{ id: "x" }], OLD, NEW).changed, 0);
eq("both ref-bearing files are named explicitly",
  REF_BEARING_FILES, ["messages.json", "tasks.json"]);

// ── the acceptance check ─────────────────────────────────────────────────
// A bucket that contains only the NEW prefix — i.e. the old one has been
// deleted, which is the state the migration is heading for.
const bucketAfterDelete = new Set([
  att(NEW, "a"), att(NEW, "b"), att(NEW, "c"), att(NEW, "d"),
]);
const exists = (key) => Promise.resolve(bucketAfterDelete.has(key));

{
  const migrated = rewriteOrgRefs([...messages(), ...tasks()], OLD, NEW).value;
  const refs = collectOrgRefs(migrated, NEW);
  const { checked, missing } = await verifyRefsResolve(refs, exists);
  eq("with the rewrite done, every reference resolves", missing, []);
  eq("and all four were actually checked", checked, 4);
}

eq("duplicate references are checked once",
  (await verifyRefsResolve([att(NEW, "a"), att(NEW, "a")], exists)).checked, 1);
eq("a reference to an object that is not there is reported",
  (await verifyRefsResolve([att(NEW, "zzz")], exists)).missing, [att(NEW, "zzz")]);

// ── RED PROOF: THE REWRITE IS SKIPPED ────────────────────────────────────
// This is the failure the whole exercise exists to prevent. The copy runs, the
// objects land under the new prefix, every count looks right — and the data
// still points at the old prefix. While the old prefix exists this is
// invisible. The check has to catch it anyway, BEFORE the delete.
let skipRedOk = true;
{
  const notMigrated = [...messages(), ...tasks()];      // rewrite deliberately not run
  const refs = collectOrgRefs(notMigrated, OLD);         // still the old prefix
  const { missing } = await verifyRefsResolve(refs, exists);

  if (missing.length !== 4) {
    skipRedOk = false;
    console.error(`RED PROOF FAILED: skipping the rewrite left ${missing.length} unresolved, expected 4`);
  } else {
    console.log(`red proof: with the rewrite skipped, ${missing.length} references do not resolve — `
      + `the check catches it before the old prefix is deleted`);
  }

  // And the trap it replaces: while the old prefix is still present, those very
  // same references DO resolve. A migration verified against the old bucket
  // passes and still breaks a week later.
  const bucketBeforeDelete = new Set([...bucketAfterDelete, att(OLD, "a"), att(OLD, "b"), att(OLD, "c"), att(OLD, "d")]);
  const stillThere = await verifyRefsResolve(refs, (k) => Promise.resolve(bucketBeforeDelete.has(k)));
  if (stillThere.missing.length !== 0) {
    skipRedOk = false;
    console.error("RED PROOF FAILED: the deferred-failure property does not reproduce");
  } else {
    console.log("red proof: against the pre-delete bucket the same broken data verifies CLEAN — "
      + "which is why the check must run against the new prefix alone");
  }
}

// A partial rewrite — one file done, one missed — is the realistic version of
// the same mistake, and must be caught just as loudly.
{
  const half = [...rewriteOrgRefs(messages(), OLD, NEW).value, ...tasks()];
  const refs = [...collectOrgRefs(half, NEW), ...collectOrgRefs(half, OLD)];
  const { missing } = await verifyRefsResolve(refs, exists);
  eq("one file rewritten and one missed is caught", missing, [att(OLD, "d")]);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && skipRedOk ? 0 : 1);
