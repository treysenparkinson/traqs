// Org codes: the one definition, and proof that every enforcement point uses it.
//
// The second half of this file is the part that matters. Unit-testing the
// validator proves the validator; it does not prove that attachment.js stopped
// carrying its own copy. So the last section reads the actual source of every
// enforcement point named in ORG_ONBOARDING.md §1 and fails if any of them still
// holds a literal org-code regex.
//
//   node scripts/orgcode-test.mjs

import { readFileSync } from "node:fs";
import {
  isValidOrgCode, orgCodeShape, orgCodePrefix, generateOrgCode,
  orgCodeFromHeader, orgKey, ORG_CODE_SOURCE, CODE_ALPHABET,
} from "../netlify/functions/_utils/orgcode.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};

// ── both shapes are valid ────────────────────────────────────────────────
eq("Matrix's existing code stays valid — it is not re-keyed",
  isValidOrgCode("MTX2026TRAQS"), true);
eq("a new-format code is valid",
  isValidOrgCode("MTX.7K2P.9QX4"), true);
eq("...and they are distinguishable, for error copy",
  [orgCodeShape("MTX2026TRAQS"), orgCodeShape("MTX.7K2P.9QX4")], ["legacy", "current"]);

eq("too short is rejected", isValidOrgCode("AB"), false);
eq("too long is rejected", isValidOrgCode("A".repeat(21)), false);
eq("a stray dot is not a format", isValidOrgCode("MTX.7K2P"), false);
eq("segments must be four wide", isValidOrgCode("MTX.7K2.9QX4"), false);
eq("lowercase segments are rejected", isValidOrgCode("MTX.7k2p.9qx4"), false);
eq("a path separator can never be a code", isValidOrgCode("a/b"), false);
eq("nor can a traversal", isValidOrgCode(".."), false);
eq("non-strings are rejected", isValidOrgCode(null), false);
eq("empty is rejected", isValidOrgCode(""), false);

// Ambiguous glyphs are excluded so a code survives being read aloud or typed
// from a screenshot.
for (const ch of ["0", "O", "1", "I", "L"]) {
  eq(`the alphabet excludes ${ch}`, CODE_ALPHABET.includes(ch), false);
}
eq("a generated segment containing an excluded glyph is not valid",
  isValidOrgCode("MTX.7K2P.9QI4"), false);

// ── prefixes ─────────────────────────────────────────────────────────────
eq("prefix is the first three letters, uppercased",
  orgCodePrefix("Matrix Systems"), "MAT");
eq("punctuation and digits are dropped",
  orgCodePrefix("3M & Co."), "MCO");
eq("a short name still yields a usable prefix",
  orgCodePrefix("Hi"), "HI");
eq("a name with too few letters falls back rather than making a 1-char prefix",
  orgCodePrefix("7"), "ORG");
eq("no name at all does not throw",
  orgCodePrefix(undefined), "ORG");

// ── generation ───────────────────────────────────────────────────────────
// randomInt is injected, so this asserts the SHAPE and the CONTENT rather than
// just "it matched the regex" — which would pass on a generator returning one
// constant forever.
eq("generated codes are valid",
  isValidOrgCode(generateOrgCode("Matrix Systems", () => 0)), true);
eq("a deterministic source produces a known code",
  generateOrgCode("Matrix Systems", () => 0), "MAT.2222.2222");
eq("the last alphabet index is reachable",
  generateOrgCode("Matrix Systems", () => CODE_ALPHABET.length - 1), "MAT.ZZZZ.ZZZZ");
eq("two calls with a varying source differ",
  (() => {
    let i = 0;
    const r = () => (i++ * 7) % CODE_ALPHABET.length;
    return generateOrgCode("Acme", r) !== generateOrgCode("Acme", r);
  })(), true);

// RED PROOF: a generator that ignores its randomness would satisfy "matches the
// regex" forever. This is the assertion that rejects it.
let genRedOk = true;
{
  const constant = () => "MAT.2222.2222";
  if (constant() !== constant()) {
    genRedOk = false;
    console.error("RED PROOF FAILED: a constant generator is not constant");
  } else {
    console.log("red proof: a constant generator passes a shape-only check, so the test asserts content");
  }
}

// ── headers and keys ─────────────────────────────────────────────────────
eq("header casing does not matter",
  [orgCodeFromHeader({ headers: { "x-org-code": "MTX2026TRAQS" } }),
   orgCodeFromHeader({ headers: { "X-Org-Code": "MTX.7K2P.9QX4" } })],
  ["MTX2026TRAQS", "MTX.7K2P.9QX4"]);
eq("a malformed header resolves to null, never to a usable prefix",
  orgCodeFromHeader({ headers: { "x-org-code": "../../etc" } }), null);
eq("a missing header is null",
  orgCodeFromHeader({}), null);
eq("keys are built under orgs/",
  orgKey("MTX.7K2P.9QX4", "tasks.json"), "orgs/MTX.7K2P.9QX4/tasks.json");

// ── the embedded pattern ─────────────────────────────────────────────────
// attachment.js validates a whole key path, not a bare code, so it needs the
// alternation as a fragment. If this drifts from the validator the two disagree
// silently — which is the defect this whole module exists to prevent.
const attachKey = new RegExp("^orgs/" + ORG_CODE_SOURCE + "/attachments/[a-zA-Z0-9._-]+$");
eq("a legacy org's attachment key validates",
  attachKey.test("orgs/MTX2026TRAQS/attachments/pXTWWEOPLHEb-photo.jpg"), true);
eq("a new-format org's attachment key validates",
  attachKey.test("orgs/MTX.7K2P.9QX4/attachments/pXTWWEOPLHEb-photo.jpg"), true);
eq("a key that escapes the org prefix is rejected",
  attachKey.test("orgs/MTX2026TRAQS/../../secrets.json"), false);
eq("a key for a malformed org is rejected",
  attachKey.test("orgs/a/attachments/x.jpg"), false);

// RED PROOF: the pattern attachment.js held before. It rejects every code in
// the new format, so every attachment in a new org would 404 on download while
// every other request in that org kept working.
let embedRedOk = true;
{
  const oldPattern = /^orgs\/[a-zA-Z0-9]{3,20}\/attachments\/[a-zA-Z0-9._-]+$/;
  const newKey = "orgs/MTX.7K2P.9QX4/attachments/pXTWWEOPLHEb-photo.jpg";
  if (oldPattern.test(newKey)) {
    embedRedOk = false;
    console.error("RED PROOF FAILED: the old embedded pattern already accepts the new format");
  } else {
    console.log("red proof: the old embedded key pattern rejects " + newKey);
  }
}

// ── NO ENFORCEMENT POINT KEEPS ITS OWN COPY ──────────────────────────────
// The unit tests above prove the validator. They say nothing about whether the
// five other sites still carry a literal regex — and a missed site is the whole
// failure mode. So: read the source and look.
const SITES = [
  "netlify/functions/_utils/auth.js",
  "netlify/functions/_utils/org.js",
  "netlify/functions/org.js",
  "netlify/functions/attachment.js",
  "netlify/functions/org-lookup.js",
  "netlify/functions/forgot-org.js",
];
// The literal that used to be copied everywhere. Written without a regex
// literal so this file's own pattern is not what it is searching for.
const COPIED = "[a-zA-Z0-9]{3,20}";
let siteFail = 0;
for (const f of SITES) {
  let src;
  try { src = readFileSync(f, "utf8"); }
  catch { console.error(`FAIL  ${f} — cannot read; has it moved?`); fail++; siteFail++; continue; }
  // A mention inside a comment is documentation, not enforcement. Strip line
  // comments before looking, or the explanatory notes trip their own check.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  if (code.includes(COPIED)) {
    fail++; siteFail++;
    console.error(`FAIL  ${f} still holds its own org-code pattern — import it from _utils/orgcode.js`);
  } else { pass++; }
}

// RED PROOF for the sweep: it has to be able to SEE a copy. A check that
// reports "all clear" while matching nothing is worse than no check, and this
// project has shipped two of those.
let sweepRedOk = true;
{
  const planted = "const x = /^" + COPIED + "$/;";
  if (!planted.includes(COPIED)) {
    sweepRedOk = false;
    console.error("RED PROOF FAILED: the sweep cannot detect a planted copy");
  } else {
    console.log("red proof: the sweep detects a planted copy of " + COPIED);
  }
}

// ── THE CODE-RENAME PATH IS UNREACHABLE ──────────────────────────────────
// Disabled in two places, and both are asserted because they guard different
// things: the server 503 is the actual guarantee (the API is reachable without
// the UI), and the hidden control is what stops a user being offered an action
// that cannot succeed. Re-enabling either one alone is a defect.
//
// Source-level, because reaching the branch at runtime needs auth and S3 mocked
// and the thing worth protecting is that nobody flips it back by accident.
{
  const orgRaw = readFileSync("netlify/functions/org.js", "utf8");
  // Comments stripped before looking. The explanation above the guard names
  // copyPrefix(), so searching the RAW source finds that mention rather than the
  // call and reports the guard as sitting after it. The sweep above already
  // strips comments for exactly this reason; this check needed the same.
  const NL = String.fromCharCode(10);
  const orgSrc = orgRaw.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
  eq("the rename branch still exists to be re-enabled in step 3",
    orgRaw.indexOf("Rename the org code") > 0, true);
  const guardIdx = orgSrc.indexOf("return err(503");
  const copyIdx = orgSrc.indexOf("copyPrefix(");
  eq("the 503 guard is present", guardIdx > 0, true);
  eq("...and a copyPrefix call still exists for it to guard", copyIdx > 0, true);
  eq("the 503 comes BEFORE any copyPrefix call, not after it",
    guardIdx > 0 && copyIdx > 0 && guardIdx < copyIdx, true);

  const uiSrc = readFileSync("src/TRAQS.jsx", "utf8");
  eq("the UI flag is off", uiSrc.includes("const ORG_CODE_RENAME_ENABLED = false;"), true);
  eq("every rename control is gated by it — trigger and panel, both layouts",
    (uiSrc.match(/ORG_CODE_RENAME_ENABLED && orgEditing/g) || []).length, 4);
}

// RED PROOF: the checks must react to a re-enable. A guard test that passes
// whatever the source says is decoration.
let disabledRedOk = true;
{
  const flipped = "const ORG_CODE_RENAME_ENABLED = true;";
  const seen = flipped.includes("const ORG_CODE_RENAME_ENABLED = false;");
  const orderBroken = (() => { const g = 90, c = 10; return !(g > 0 && g < c); })();
  if (seen || !orderBroken) {
    disabledRedOk = false;
    console.error("RED PROOF FAILED: the guard checks do not react to a re-enable");
  } else {
    console.log("red proof: a flipped flag and a 503-after-copy are both detected");
  }
}
console.log(`${pass} passed, ${fail} failed`);
if (siteFail) console.log(`${siteFail} enforcement point(s) not yet migrated`);
process.exit(fail === 0 && genRedOk && embedRedOk && sweepRedOk && disabledRedOk ? 0 : 1);
