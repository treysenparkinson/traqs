// RE-KEYING AN ORG'S S3 PREFIX, and the part that makes it survivable.
//
// Moving orgs/OLD/ to orgs/NEW/ is not a copy. Attachment keys are stored
// INSIDE the data — messages.json and tasks.json hold full
// `orgs/{code}/attachments/{id}-{name}` strings, 25 of them in messages.json
// alone on the live bucket — and a server-side copy moves the objects without
// touching the references to them.
//
// THE FAILURE IS DEFERRED, which is what makes it dangerous. attachment.js GET
// validates only the key's shape, with no ownership check (the key is a
// documented unguessable bearer). So after a copy the stale references still
// resolve, because the old prefix is still there. Nothing looks wrong. They
// break when the old prefix is deleted — a week later, by which point nobody
// connects the two events.
//
// So: "the copy succeeded" is not evidence of anything. The only acceptable
// proof is that every key referenced inside the migrated data resolves against
// the NEW prefix. That is what verifyRefsResolve exists for, and why the tool
// refuses to report success without it.

// Every `orgs/{code}/...` string anywhere in a JSON value, however deeply
// nested. A walk rather than a regex over the serialised text: the serialised
// form would also match keys inside strings that merely look like paths, and
// would give no way to rewrite them in place.
export function collectOrgRefs(value, code, out = []) {
  if (typeof value === "string") {
    if (value.startsWith(`orgs/${code}/`)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectOrgRefs(v, code, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) collectOrgRefs(value[k], code, out);
    return out;
  }
  return out;
}

/**
 * Rewrites every `orgs/{oldCode}/...` string to `orgs/{newCode}/...`, returning
 * a NEW value and the number of strings changed. The input is not mutated — a
 * migration that half-rewrites an object in memory and then fails leaves no way
 * to tell what state it is in.
 *
 * Only this org's prefix is touched. A key belonging to a different org inside
 * the same file is left exactly as it is: it points at data we are not moving,
 * and rewriting it would break a reference that was correct.
 */
export function rewriteOrgRefs(value, oldCode, newCode) {
  let changed = 0;
  const walk = (v) => {
    if (typeof v === "string") {
      const prefix = `orgs/${oldCode}/`;
      if (v.startsWith(prefix)) {
        changed++;
        return `orgs/${newCode}/` + v.slice(prefix.length);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  const result = walk(value);
  return { value: result, changed };
}

/**
 * THE ACCEPTANCE CHECK. Given the references found in the migrated data, asks
 * whether each one actually exists. Returns the ones that do not.
 *
 * `exists` is injected — a HeadObject in production, a set lookup in a test —
 * so this can be exercised against a fixture where the rewrite was deliberately
 * skipped, and be seen to catch it. A check that has never failed is not
 * evidence that it works.
 *
 * Empty `missing` is the ONLY thing that licenses reporting success. Not the
 * copy count, not the rewrite count: both of those can be perfect while every
 * photo in the app points at a prefix that is about to be deleted.
 */
export async function verifyRefsResolve(refs, exists) {
  const unique = [...new Set(refs)];
  const missing = [];
  for (const key of unique) {
    if (!(await exists(key))) missing.push(key);
  }
  return { checked: unique.length, missing };
}

// Files whose contents are known to embed org-prefixed keys. Listed explicitly
// rather than "every json file" so that adding a new one is a decision someone
// makes, not something a migration silently starts depending on.
export const REF_BEARING_FILES = ["messages.json", "tasks.json"];
