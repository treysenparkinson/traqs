import { readJson, writeJson } from "./_utils/s3.js";
import { updateJson } from "./_utils/update-json.js";
import { preflight, json, err } from "./_utils/cors.js";
import { requireOrgMember } from "./_utils/auth.js";
import { personFromAdmin, settleInvitesOnLogin } from "./_utils/invite.js";
import { nowIso } from "./_utils/timestamps.js";

// Authenticated mirror of the public `/org?code=…` endpoint that the login
// screen calls. The public endpoint returns ONLY non-PII fields (name,
// domain, optional SSO connection). This endpoint, scoped behind
// requireOrgMember, also returns the server-derived `isAdmin` / `isMember`
// booleans plus the rest of the config — so the client never needs to
// receive `adminEmail` to know whether the current user is the admin.
//
// Replaces the prior pattern where App.jsx compared the logged-in user's
// email against `orgConfig.adminEmail` client-side; that required leaking
// the admin's email to anyone who guessed the org code.
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET") return err(405, "Method not allowed");

  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

  try {
    const config = await readJson(`orgs/${member.orgCode}/config.json`);
    if (!config) return err(404, "Organization not found");

    // Self-provision: a brand-new org boots with an empty people.json (org.js
    // POST — "not even the creator's"), so a founding admin has no person row
    // and TRAQS.jsx's client-side loggedInUser resolution has no fallback for
    // that (it only ever matches against the people array), leaving them
    // stuck on "Loading TRAQS…" forever. This endpoint is the one authenticated
    // call App.jsx's gate makes exactly once per (isAuthenticated, orgCode)
    // pair, BEFORE TRAQS.jsx mounts and fetches people — so writing the missing
    // person record here, ahead of that fetch, is what the org.js comment
    // means by "written on first login, the same path an invited admin takes."
    let personId = member.personId;
    if (personId == null && member.isAdmin) {
      const peopleKey = `orgs/${member.orgCode}/people.json`;
      try {
        const people = (await readJson(peopleKey).catch(() => null)) ?? [];
        const already = people.find(p => String(p?.email || "").toLowerCase().trim() === member.email);
        if (already) {
          personId = already.id;
        } else {
          // #292. Append-if-absent, with the dedupe INSIDE the conditional
          // write. The check above is a fast path; this is the one that
          // decides, because two first-logins racing both read an empty match
          // and both used to append — one admin, two roster rows.
          const person = personFromAdmin(config, member.email, people, nowIso());
          personId = person.id;
          await updateJson(peopleKey, (stored) => {
            const arr = Array.isArray(stored) ? stored : [];
            const dup = arr.find(p => !p?.deletedAt && String(p?.email || "").toLowerCase().trim() === member.email);
            if (dup) { personId = dup.id; return { abort: "already" }; }
            return { value: [...arr, person] };
          });
        }
      } catch (e) {
        // Non-fatal: worst case the client sees isMember:false again and
        // retries next load, same as any other transient S3 hiccup.
        console.error("org-config: self-provision failed:", e);
      }
    }

    // SIGNING IN SPENDS THE INVITE. This is the once-per-login call on the web
    // (App.jsx's gate) and on iOS (RootView), so it is where an invitee who
    // got in without pressing Accept -- Add Employee already put them on the
    // roster -- stops showing as Pending Invitation. See settleInvitesOnLogin.
    // Non-fatal, like the self-provision above: a failed write just leaves the
    // card pending until the next sign-in.
    if (personId != null) {
      const invitesKey = `orgs/${member.orgCode}/invites.json`;
      try {
        const invites = (await readJson(invitesKey).catch(() => null)) ?? [];
        const settled = settleInvitesOnLogin(invites, member.email, nowIso());
        if (settled.changed) await writeJson(invitesKey, settled.invites);
      } catch (e) {
        console.error("org-config: invite settle failed:", e);
      }
    }

    // Strip admin PII — the whole reason this endpoint exists is so the client
    // never receives adminEmail(s); it relies on the server-derived isAdmin below.
    const { adminEmail, adminEmails, ...safeConfig } = config;
    // THE TIER, so the client can enforce what the tier offers (#422): the sign-in domain is a
    // Business control, and its restriction must not outlive a move to Basic. Read the way
    // tasks.js reads it — no billing record is Basic.
    let tier = "basic";
    try { tier = (await readJson(`orgs/${member.orgCode}/billing.json`))?.tier || "basic"; } catch { tier = "basic"; }
    return json(200, {
      ...safeConfig,
      tier,
      // Server-derived authorization signals. The client should rely on
      // these, not on comparing emails locally.
      isMember: personId != null,
      isAdmin: member.isAdmin,
      // WHICH PERSON THIS TOKEN IS — the caller's own row id, nothing about anyone else. App.jsx
      // checks it against the name tapped on the roster, which since #385 carries no email to
      // compare (scripts/wrong-account-test.mjs).
      personId: personId != null ? String(personId) : null,
    });
  } catch (e) {
    console.error("org-config GET error:", e);
    return err(500, "Failed to read org config");
  }
}
