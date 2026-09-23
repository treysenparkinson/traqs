// INVITES. The rules are here and pure; the endpoint is a thin shell over them,
// so the security-critical half can be exercised exhaustively without S3, Auth0
// or a live request.
//
// THE MODEL, per the ruling: membership is written AFTER first login, never
// before. The link carries the org code and a token; the invitee authenticates
// through Auth0 exactly as anyone else does, and only once that succeeds — and
// only if the authenticated email matches the invited one — is a person row
// written. No Auth0 Management API, no new secret.
//
// That ordering is what makes the token safe to put in a URL. It grants nothing
// on its own: possessing it does not create an account, it only marks which
// address is expected. Someone who intercepts a link still has to authenticate
// as that address.

import { randomBytes } from "crypto";

// 24 bytes of CSPRNG, base64url. The token appears in a URL that will be pasted
// into chat clients and email, so it avoids characters that get escaped, and it
// is long enough that guessing is not a strategy.
export const newInviteToken = () => randomBytes(24).toString("base64url");

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;   // 14 days

// An invite carries TWO identifiers and they are not interchangeable:
//
//   token  the credential. It is the link. Returned once, at creation, and
//          never listed again.
//   id     the handle. Safe to list, safe to put in a revoke request, useless
//          to anyone who intercepts it.
//
// Revoking by token would mean the list had to hand tokens back to do its job,
// which is the thing not listing them was for.
export function makeInvite({ email, role = "user", invitedBy, nowMs = Date.now() }) {
  return {
    id: randomBytes(9).toString("base64url"),
    token: newInviteToken(),
    email: String(email || "").toLowerCase().trim(),
    role: role === "admin" ? "admin" : "user",
    invitedBy: String(invitedBy || "").toLowerCase().trim(),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + INVITE_TTL_MS).toISOString(),
    acceptedAt: null,
    revokedAt: null,
  };
}

/**
 * May this token be accepted, by this authenticated email, now?
 *
 * Returns { ok: true, invite } or { ok: false, reason, status }. Every rejection
 * names its reason rather than collapsing to a single "invalid" — an invitee
 * whose link expired needs to be told that, not left guessing.
 *
 * The email comparison is the load-bearing one. Without it the token alone would
 * be enough for whoever holds the link, which is the whole thing the
 * membership-after-login ordering exists to prevent.
 */
export function checkInvite(invite, { email, nowMs = Date.now() } = {}) {
  if (!invite) return { ok: false, status: 404, reason: "not-found" };
  if (invite.revokedAt) return { ok: false, status: 403, reason: "revoked" };
  if (invite.acceptedAt) return { ok: false, status: 409, reason: "already-accepted" };

  const expires = Date.parse(invite.expiresAt);
  if (Number.isFinite(expires) && nowMs > expires) {
    return { ok: false, status: 403, reason: "expired" };
  }

  const authed = String(email || "").toLowerCase().trim();
  if (!authed) return { ok: false, status: 401, reason: "no-identity" };
  if (authed !== String(invite.email || "").toLowerCase().trim()) {
    // Deliberately not "this invite is for someone else" — that would confirm
    // to a link holder which address the invite belongs to.
    return { ok: false, status: 403, reason: "email-mismatch" };
  }
  return { ok: true, invite };
}

// What the unauthenticated landing screen may see. It needs the org code to put
// the user through the right login, and nothing else: returning the invited
// address would let anyone holding a link learn who it was for.
export function publicInviteView(invite, orgCode, orgName) {
  return { orgCode, orgName: orgName || "", expiresAt: invite?.expiresAt || null };
}

/**
 * The person row an accepted invite creates. This is the moment membership
 * begins, and it is also what exempts the address from the org's domain gate —
 * the gate admits members, and accepting an invite is how an outside address
 * becomes one.
 *
 * ids are assigned from the existing roster rather than from the invite, and
 * compared as strings: person ids are mixed string and number in this data.
 */
export function personFromInvite(invite, existingPeople, nowIso) {
  const used = new Set((existingPeople || []).map((p) => String(p?.id)));
  let n = 1;
  while (used.has(String(n))) n++;
  return {
    id: n,
    name: invite.email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    email: invite.email,
    role: invite.role === "admin" ? "Admin" : "Team Member",
    userRole: invite.role === "admin" ? "admin" : "user",
    cap: 8,
    color: "#6366f1",
    timeOff: [],
    invitedBy: invite.invitedBy || null,
    joinedAt: nowIso,
    lastModifiedAt: nowIso,
  };
}

// An invite is spent, not deleted: the record is what says this address was
// admitted by invitation rather than by domain, and deleting it would erase the
// only evidence of how someone got in.
export function markAccepted(invite, nowIso) {
  return { ...invite, acceptedAt: nowIso };
}

export function activeInvites(invites, nowMs = Date.now()) {
  return (invites || []).filter((i) => {
    if (!i || i.revokedAt || i.acceptedAt) return false;
    const exp = Date.parse(i.expiresAt);
    return !Number.isFinite(exp) || nowMs <= exp;
  });
}
