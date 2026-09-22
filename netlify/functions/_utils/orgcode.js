// THE ONE PLACE AN ORG CODE IS DEFINED.
//
// Before this, the same rule lived in five independent copies of one regex —
// _utils/auth.js, _utils/org.js, functions/org.js, functions/attachment.js and
// a user-facing string in src/App.jsx. Changing the format meant finding all of
// them, and the one that hides is attachment.js: there the org-code pattern is
// embedded inside an S3 KEY-PATH validator, so it does not look like org-code
// validation when you grep for org-code validation. Missing it 400s every
// attachment download while everything else keeps working.
//
// TWO SHAPES ARE VALID, and that is deliberate:
//
//   legacy   3–20 alphanumeric        MTX2026TRAQS
//   current  PREFIX.XXXX.XXXX         MTX.7K2P.9QX4
//
// Accepting both is not a legacy fallback and not a special case. It is one
// rule — "a code looks like either of these" — which is what lets an org
// created before the format change keep its code without a single branch
// anywhere testing for it. Matrix is not re-keyed; MTX2026TRAQS simply IS its
// code, resolving through the same orgs/{code}/ path as every other org.

// Ambiguous glyphs are out: 0/O and 1/I/L are the pairs people transcribe
// wrong, and this code gets read aloud and typed from a screenshot.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const LEGACY_SOURCE = "[a-zA-Z0-9]{3,20}";
const CURRENT_SOURCE = "[A-Z]{2,6}[.][" + CODE_ALPHABET + "]{4}[.][" + CODE_ALPHABET + "]{4}";

// The bare alternation, for callers that need to embed it in a larger pattern
// (an S3 key path) rather than test a whole string. Exported so the key
// validator and the code validator cannot drift apart — which is exactly how
// attachment.js came to hold its own copy.
export const ORG_CODE_SOURCE = "(?:" + LEGACY_SOURCE + "|" + CURRENT_SOURCE + ")";

const FULL = new RegExp("^" + ORG_CODE_SOURCE + "$");

export function isValidOrgCode(code) {
  return typeof code === "string" && FULL.test(code);
}

// Which shape a code is. Useful for telling a user their code looks like one
// issued before the format changed, rather than just "invalid".
export function orgCodeShape(code) {
  if (typeof code !== "string") return null;
  if (new RegExp("^" + CURRENT_SOURCE + "$").test(code)) return "current";
  if (new RegExp("^" + LEGACY_SOURCE + "$").test(code)) return "legacy";
  return null;
}

// PREFIX from the org name: the first three letters, uppercased, punctuation
// and digits dropped. Deliberately dumb and predictable — "Matrix Systems"
// gives MAT. A cleverer scheme (initials, consonant squeezing) produces
// different answers for names that differ only in spacing, and this string is
// the human-readable half of an identifier people read aloud.
//
// Names with fewer than two usable letters fall back to ORG rather than
// producing a one-character prefix.
export function orgCodePrefix(name) {
  const letters = String(name ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return letters.length >= 2 ? letters.slice(0, 3) : "ORG";
}

// Generates PREFIX.XXXX.XXXX. `randomInt` is injectable so the generator can be
// tested deterministically — without it the only assertion possible is "it
// matches the regex", which would pass on a generator that returned the same
// code every time.
export function generateOrgCode(name, randomInt = (n) => Math.floor(Math.random() * n)) {
  const seg = () => {
    let out = "";
    for (let i = 0; i < 4; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return out;
  };
  return orgCodePrefix(name) + "." + seg() + "." + seg();
}

// Reads and validates the org code from request headers. Header casing varies
// by client and proxy, so both spellings are checked.
export function orgCodeFromHeader(event) {
  const code = event?.headers?.["x-org-code"] || event?.headers?.["X-Org-Code"] || "";
  return isValidOrgCode(code) ? code : null;
}

// The S3 key prefix for an org. Every read and write goes through this shape;
// there is no unprefixed path anywhere in the functions.
export function orgKey(code, file) {
  return "orgs/" + code + "/" + file;
}
