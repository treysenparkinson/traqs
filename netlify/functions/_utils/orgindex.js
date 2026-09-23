// AUTH0 ORGANIZATION → TRAQS ORG CODE, and the access decision that follows.
//
// The Auth0 org_id (org_xxxxxxxx) is NOT the S3 prefix. It is opaque, Auth0
// controls its format, and binding our key space to a vendor identifier means
// we could never leave Auth0 without re-keying every object we own. The code is
// ours; the org_id is a claim we map through an index.
//
//   orgs/_index/auth0/{org_id}.json   -> { orgCode }
//   orgs/_index/code/{code}.json      -> { auth0OrgId }
//
// The leading underscore keeps the index out of the org namespace: a valid org
// code can never begin with one, so `orgs/_index/` cannot collide with a real
// org and the jobs that enumerate orgs by prefix can skip it by that one rule.

export const INDEX_PREFIX = "orgs/_index/";

export const auth0IndexKey = (orgId) => `${INDEX_PREFIX}auth0/${encodeURIComponent(orgId)}.json`;
export const codeIndexKey = (code) => `${INDEX_PREFIX}code/${encodeURIComponent(code)}.json`;

// Is this `orgs/<segment>/...` segment a real org, or reserved infrastructure?
// Used by backup-daily and timeoff-cleanup, which walk the orgs/ prefix and
// would otherwise treat the index as an org with no config and no people.
export function isReservedOrgSegment(segment) {
  return typeof segment === "string" && segment.startsWith("_");
}

// The org segment of an S3 key, or null if the key is not org-scoped.
export function orgSegmentFromKey(key) {
  if (typeof key !== "string") return null;
  const parts = key.split("/");
  return parts[0] === "orgs" && parts.length > 2 ? parts[1] : null;
}

/**
 * THE ACCESS DECISION. Pure, so it can be exhaustively tested without S3, Auth0
 * or a running request — this is the security-critical half and it should not
 * need a live token to exercise.
 *
 * Three inputs:
 *   tokenOrgId   the org_id claim on the VERIFIED access token, or null
 *   indexedCode  what that org_id maps to in the index, or null
 *   headerCode   the X-Org-Code the client sent, already format-checked
 *
 * THE POINT OF THE EXERCISE: where the org comes from. Today the code arrives
 * only as a client-supplied header, and the server trusts it because it then
 * checks the caller against THAT org's people file. That check is real, but it
 * means a user in org A can address org B and is stopped only by B's roster —
 * one stale or mistakenly-added person row is the whole boundary.
 *
 * With Auth0 Organizations the token itself names the org. The header becomes a
 * cross-check: it must AGREE with the claim or the request is refused. It stops
 * being a source of truth.
 *
 * WHY THE CLAIM IS NOT YET REQUIRED. Auth0 Organizations is not configured, so
 * no token in circulation carries org_id. Demanding it would 403 every request
 * in the product the moment this ships. So a token without the claim keeps the
 * existing behaviour, and a token WITH it gets the strict path. That is a
 * migration state, not a fallback to live with: once every token carries the
 * claim, `requireClaim` flips to true and the old path is gone. The caller is
 * told which path ran (`via`) so the rollout can be observed rather than
 * guessed at.
 */
export function resolveOrgAccess({ tokenOrgId, indexedCode, headerCode, requireClaim = false }) {
  const hdr = headerCode || null;

  if (!tokenOrgId) {
    if (requireClaim) {
      return { ok: false, status: 403, message: "Token does not identify an organization" };
    }
    if (!hdr) return { ok: false, status: 400, message: "Missing or invalid X-Org-Code header" };
    return { ok: true, orgCode: hdr, via: "header" };
  }

  // The token names an org we have never heard of. Not an authentication
  // failure — the token is valid — but there is nothing here for them.
  if (!indexedCode) {
    return { ok: false, status: 403, message: "Organization is not provisioned" };
  }

  // The disagreement this whole change exists to catch. Refuse rather than
  // prefer one: a client sending a code that is not its own is either confused
  // or probing, and silently substituting the right one hides both.
  if (hdr && hdr !== indexedCode) {
    return { ok: false, status: 403, message: "Organization mismatch between session and request" };
  }

  return { ok: true, orgCode: indexedCode, via: "claim" };
}
