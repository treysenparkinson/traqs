// Invite links for an organization.
//
//   GET    ?token=…            public — what the landing screen needs to log in
//   GET                        auth   — list this org's invites
//   POST   { email, role }     auth + manageTeam — create one
//   POST   { token, accept }   auth   — accept, AFTER the invitee has logged in
//   DELETE { token }           auth + manageTeam — revoke
//
// Membership is written on accept, never on create. The token in the link grants
// nothing on its own: it names which address is expected, and the accept path
// refuses unless the AUTHENTICATED email matches. That ordering is what makes
// the link safe to paste into a chat client, and it is why no Auth0 Management
// API is needed — the invitee signs in through the ordinary flow first.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { requireOrgMember } from "./_utils/auth.js";
import { requirePerm } from "./_utils/can.js";
import { nowIso } from "./_utils/timestamps.js";
import { isValidOrgCode } from "./_utils/orgcode.js";
import { filterLive } from "./_utils/entities.js";
import {
  makeInvite, checkInvite, publicInviteView, personFromInvite,
  markAccepted, activeInvites,
} from "./_utils/invite.js";

const invitesKey = (code) => `orgs/${code}/invites.json`;
const peopleKey = (code) => `orgs/${code}/people.json`;

const readInvites = async (code) => (await readJson(invitesKey(code)).catch(() => null)) ?? [];

const ses = new SESClient({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  },
});
const FROM_EMAIL = process.env.SEND_FROM_EMAIL || "no-reply@traqs.app";
// Netlify sets URL to the site's canonical origin in every context (prod,
// branch deploys, and `netlify dev`), so the emailed link matches whichever
// deploy actually sent it without needing a separate configured value.
const SITE_URL = process.env.URL || "https://traqs.netlify.app";

const escHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Best-effort. The invite is already created and its link already returned to
// the admin (see the create handler) before this runs, so a failed send just
// falls back to the admin sharing that link themselves — it never costs the
// invite itself.
async function sendInviteEmail(invite, code) {
  const config = await readJson(`orgs/${code}/config.json`).catch(() => null);
  const orgName = config?.name || "your organization";
  const link = `${SITE_URL}/?org=${encodeURIComponent(code)}&invite=${encodeURIComponent(invite.token)}`;
  const expiresLabel = new Date(invite.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const bodyText = `Hello,

You've been invited to join ${orgName} on TRAQS.

Accept your invitation:
${link}

This link works once and expires ${expiresLabel}.

If you weren't expecting this, you can safely ignore this email.

— The TRAQS Team`;

  const bodyHtml = `<p>Hello,</p>
<p>You've been invited to join <strong>${escHtml(orgName)}</strong> on TRAQS.</p>
<p style="margin:28px 0;">
  <a href="${link}" style="background:#6366f1;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;display:inline-block;">Accept Invitation</a>
</p>
<p style="color:#94a3b8;font-size:12px;">This link works once and expires ${expiresLabel}. If you weren't expecting this, you can safely ignore this email.</p>`;

  try {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [invite.email] },
      Message: {
        Subject: { Data: `You're invited to join ${orgName} on TRAQS` },
        Body: { Text: { Data: bodyText }, Html: { Data: bodyHtml } },
      },
    }));
    return true;
  } catch (e) {
    console.error("invite SES send error:", e);
    return false;
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  // ── Public lookup by token ───────────────────────────────────────────
  // Unauthenticated by necessity: the invitee has to know which org to sign in
  // to before they can authenticate. It returns the org code and name and
  // nothing else — in particular NOT the invited address, which would let
  // whoever holds a forwarded link learn who it was meant for.
  const qToken = event.queryStringParameters?.token;
  if (event.httpMethod === "GET" && qToken) {
    const code = event.queryStringParameters?.org;
    if (!isValidOrgCode(code)) return err(400, "Missing or invalid org");
    const invites = await readInvites(code);
    const found = (invites || []).find((i) => i && i.token === qToken);
    // A bad token and a revoked one are both "this link does not work" to an
    // anonymous caller. Distinguishing them here would turn this into an oracle
    // for which tokens exist.
    if (!found || found.revokedAt || found.acceptedAt) return err(404, "This invite link is no longer valid");
    const config = await readJson(`orgs/${code}/config.json`).catch(() => null);
    return json(200, publicInviteView(found, code, config?.name));
  }

  let member;
  try { member = await requireOrgMember(event); }
  catch (e) { return err(e.statusCode || 401, e.message); }
  const code = member.orgCode;

  // ── List ─────────────────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    const invites = await readInvites(code);
    // Tokens are not returned in the list. The link is shown once, at creation;
    // re-reading it later from any admin's session widens who can replay it.
    // Tokens stripped; ids kept. The id is what revoke needs and what the UI
    // keys rows on.
    const safe = (invites || []).map(({ token, ...rest }) => rest);
    return json(200, { invites: safe, activeCount: activeInvites(invites).length });
  }

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON body"); }
  }

  // ── Accept ───────────────────────────────────────────────────────────
  // Runs after the invitee has authenticated, which is the whole point: the
  // email on the token is compared against the identity that just logged in.
  if (event.httpMethod === "POST" && body.accept) {
    const invites = await readInvites(code);
    const idx = (invites || []).findIndex((i) => i && i.token === body.token);
    const check = checkInvite(idx >= 0 ? invites[idx] : null, { email: member.email });
    if (!check.ok) return err(check.status, `Invite ${check.reason}`);

    const people = (await readJson(peopleKey(code)).catch(() => null)) ?? [];
    const live = filterLive(people);
    // Already on the roster — the invite is spent but nothing new is created.
    // Without this a second accept would add a duplicate person for one address.
    const already = live.find((p) => String(p?.email || "").toLowerCase().trim() === member.email);
    const stamp = nowIso();
    const nextInvites = invites.map((i, n) => (n === idx ? markAccepted(i, stamp) : i));

    if (already) {
      await writeJson(invitesKey(code), nextInvites);
      return json(200, { ok: true, personId: already.id, created: false });
    }

    const person = personFromInvite(invites[idx], live, stamp);
    await writeJson(peopleKey(code), [...people, person]);
    await writeJson(invitesKey(code), nextInvites);
    return json(200, { ok: true, personId: person.id, created: true });
  }

  // ── Create ───────────────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    try { requirePerm(member, "manageTeam"); } catch (e) { return err(e.statusCode, e.message); }
    const email = String(body.email || "").toLowerCase().trim();
    if (!email.includes("@") || email.length > 200) return err(400, "Invalid email");

    const invites = await readInvites(code);
    // One live invite per address. A second would leave two tokens able to admit
    // the same person, and revoking one would look like it had worked.
    const live = activeInvites(invites).find((i) => i.email === email);
    if (live) return err(409, "That address already has a pending invite");

    const invite = makeInvite({ email, role: body.role, invitedBy: member.email });
    await writeJson(invitesKey(code), [...invites, invite]);
    const emailSent = await sendInviteEmail(invite, code);
    // The token is returned ONCE, here, for the link. It is never listed again.
    return json(200, { ok: true, token: invite.token, orgCode: code, expiresAt: invite.expiresAt, emailSent });
  }

  // ── Revoke ───────────────────────────────────────────────────────────
  if (event.httpMethod === "DELETE") {
    try { requirePerm(member, "manageTeam"); } catch (e) { return err(e.statusCode, e.message); }
    // BY ID, NOT BY TOKEN. The list deliberately does not return tokens, so
    // revoking by token would force it to — defeating the point. The id is a
    // handle: safe to list, useless to an interceptor.
    const id = body.id || event.queryStringParameters?.id;
    const invites = await readInvites(code);
    const idx = (invites || []).findIndex((i) => i && i.id === id);
    if (idx < 0) return err(404, "Invite not found");
    if (invites[idx].acceptedAt) return err(409, "That invite has already been accepted");
    const stamp = nowIso();
    const next = invites.map((i, n) => (n === idx ? { ...i, revokedAt: stamp } : i));
    await writeJson(invitesKey(code), next);
    return json(200, { ok: true });
  }

  return err(405, "Method not allowed");
}
