// Invites: who may accept one, and what accepting does.
//
// The email check is the load-bearing assertion in this file. The ruling is that
// membership is written AFTER first login — which is what makes a token safe to
// put in a URL, because the token alone grants nothing. Drop the email
// comparison and the link itself becomes the credential, and anyone it is
// forwarded to can join the org.
//
//   node scripts/invite-test.mjs

import {
  makeInvite, checkInvite, publicInviteView, personFromInvite,
  markAccepted, activeInvites, newInviteToken, INVITE_TTL_MS,
} from "../netlify/functions/_utils/invite.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};

const T0 = Date.parse("2026-09-23T12:00:00Z");
const inv = (over = {}) => ({ ...makeInvite({ email: "sam@contractor.com", invitedBy: "dana@acmefab.com", nowMs: T0 }), ...over });
const reason = (r) => (r.ok ? "ok" : r.reason);

// ── tokens ───────────────────────────────────────────────────────────────
eq("tokens are long enough that guessing is not a strategy", newInviteToken().length >= 32, true);
eq("two tokens differ", newInviteToken() !== newInviteToken(), true);
eq("tokens are URL-safe — no +, / or = to be escaped in a link",
  /^[A-Za-z0-9_-]+$/.test(newInviteToken()), true);

// ── shape ────────────────────────────────────────────────────────────────
{
  const i = makeInvite({ email: "  SAM@Contractor.com ", invitedBy: "Dana@AcmeFab.com", nowMs: T0 });
  eq("the invited address is normalised", i.email, "sam@contractor.com");
  eq("so is the inviter", i.invitedBy, "dana@acmefab.com");
  eq("role defaults to user", i.role, "user");
  eq("an unknown role is not honoured",
    makeInvite({ email: "a@b.com", role: "superuser", nowMs: T0 }).role, "user");
  eq("admin is honoured", makeInvite({ email: "a@b.com", role: "admin", nowMs: T0 }).role, "admin");
  eq("it starts neither accepted nor revoked", [i.acceptedAt, i.revokedAt], [null, null]);
  eq("it expires in 14 days", Date.parse(i.expiresAt) - T0, INVITE_TTL_MS);
}

// ── the handle is not the credential ─────────────────────────────────────
// The list shows invites so they can be revoked, and must not hand back the
// tokens to do it. So an invite carries an id as well: safe to list, safe to
// put in a revoke request, useless to anyone who intercepts it.
{
  const i = makeInvite({ email: "a@b.com", nowMs: T0 });
  eq("an invite has both an id and a token", [!!i.id, !!i.token], [true, true]);
  eq("and they are different values", i.id === i.token, false);
  eq("two invites get different ids",
    makeInvite({ email: "a@b.com", nowMs: T0 }).id !== makeInvite({ email: "a@b.com", nowMs: T0 }).id, true);
  eq("the id is URL-safe too", /^[A-Za-z0-9_-]+$/.test(i.id), true);
  // What the list endpoint strips, modelled here so the shape is asserted
  // rather than only described in a comment.
  const listed = (({ token, ...rest }) => rest)(i);
  eq("a listed invite keeps its id", !!listed.id, true);
  eq("...and loses its token", listed.token, undefined);
  eq("...but keeps what the UI shows: email, role, when, and whether spent",
    [listed.email, listed.role, !!listed.createdAt, listed.acceptedAt, listed.revokedAt],
    ["a@b.com", "user", true, null, null]);
}

// ── who may accept ───────────────────────────────────────────────────────
eq("the invited address, in the window, may accept",
  reason(checkInvite(inv(), { email: "sam@contractor.com", nowMs: T0 + 1000 })), "ok");
eq("case and padding do not matter",
  reason(checkInvite(inv(), { email: "  SAM@CONTRACTOR.com ", nowMs: T0 + 1000 })), "ok");

// THE ONE THAT MATTERS. Possessing the link is not enough.
eq("a DIFFERENT authenticated address may not accept",
  reason(checkInvite(inv(), { email: "someone.else@elsewhere.com", nowMs: T0 + 1000 })), "email-mismatch");
eq("no identity at all may not accept",
  reason(checkInvite(inv(), { email: "", nowMs: T0 + 1000 })), "no-identity");

eq("a revoked invite is refused",
  reason(checkInvite(inv({ revokedAt: "2026-09-23T13:00:00Z" }), { email: "sam@contractor.com", nowMs: T0 })), "revoked");
eq("an already-accepted invite cannot be reused",
  reason(checkInvite(inv({ acceptedAt: "2026-09-23T13:00:00Z" }), { email: "sam@contractor.com", nowMs: T0 })), "already-accepted");
eq("an expired invite is refused",
  reason(checkInvite(inv(), { email: "sam@contractor.com", nowMs: T0 + INVITE_TTL_MS + 1 })), "expired");
eq("...and is still valid on the last day",
  reason(checkInvite(inv(), { email: "sam@contractor.com", nowMs: T0 + INVITE_TTL_MS })), "ok");
eq("an unknown token is not found",
  reason(checkInvite(null, { email: "sam@contractor.com", nowMs: T0 })), "not-found");

// Each rejection carries its own status so the endpoint does not flatten them.
eq("statuses distinguish the rejections",
  ["revoked", "already-accepted", "expired"].map((r) => ({
    revoked: checkInvite(inv({ revokedAt: "x" }), { email: "sam@contractor.com", nowMs: T0 }).status,
    "already-accepted": checkInvite(inv({ acceptedAt: "x" }), { email: "sam@contractor.com", nowMs: T0 }).status,
    expired: checkInvite(inv(), { email: "sam@contractor.com", nowMs: T0 + INVITE_TTL_MS + 1 }).status,
  }[r])), [403, 409, 403]);

// ── what the landing screen may see ──────────────────────────────────────
{
  const v = publicInviteView(inv(), "MTX.7K2P.9QX4", "Acme Fabrication");
  eq("it learns which org to log in to", v.orgCode, "MTX.7K2P.9QX4");
  eq("and the org's name", v.orgName, "Acme Fabrication");
  eq("but NOT who the invite is for — a link holder must not learn the address",
    v.email, undefined);
  eq("nor the token back again", v.token, undefined);
}

// ── what accepting creates ───────────────────────────────────────────────
{
  const roster = [{ id: 1, email: "dana@acmefab.com" }, { id: "2", email: "x@y.com" }];
  const p = personFromInvite(inv(), roster, "2026-09-23T12:00:00Z");
  eq("the new id does not collide, comparing ids as strings", String(p.id), "3");
  eq("the address carries over", p.email, "sam@contractor.com");
  eq("a name is derived so the roster is not full of blanks", p.name, "Sam");
  eq("a user invite is not an admin", [p.role, p.userRole], ["Team Member", "user"]);
  eq("an admin invite is",
    (({ role, userRole }) => [role, userRole])(personFromInvite(inv({ role: "admin" }), roster, "t")),
    ["Admin", "admin"]);
  eq("who invited them is recorded", p.invitedBy, "dana@acmefab.com");
  eq("an empty roster starts at 1", personFromInvite(inv(), [], "t").id, 1);
}

// Spent, not deleted: the record is the only evidence that this address was
// admitted by invitation rather than by domain.
{
  const a = markAccepted(inv(), "2026-09-23T13:00:00Z");
  eq("accepting stamps the invite", a.acceptedAt, "2026-09-23T13:00:00Z");
  eq("...and leaves the rest intact", a.email, "sam@contractor.com");
  eq("an accepted invite is no longer active", activeInvites([a], T0).length, 0);
}
eq("a live invite is active", activeInvites([inv()], T0).length, 1);
eq("a revoked one is not", activeInvites([inv({ revokedAt: "x" })], T0).length, 0);
eq("an expired one is not", activeInvites([inv()], T0 + INVITE_TTL_MS + 1).length, 0);

// RED PROOF: drop the email comparison and the link becomes the credential.
// Anyone it is forwarded to can join the org, which is exactly what the
// membership-after-login ordering exists to prevent.
let mismatchRedOk = true;
{
  const withoutEmailCheck = (invite) => !invite.revokedAt && !invite.acceptedAt;
  const stranger = "someone.else@elsewhere.com";
  const permissive = withoutEmailCheck(inv());
  const actual = checkInvite(inv(), { email: stranger, nowMs: T0 });
  if (!permissive || actual.ok) {
    mismatchRedOk = false;
    console.error("RED PROOF FAILED: the token-only rule does not admit a stranger");
  } else {
    console.log(`red proof: without the email check a forwarded link admits ${stranger}; `
      + `the check refuses it as ${actual.reason}`);
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && mismatchRedOk ? 0 : 1);
