import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { requireOrgMember } from "./_utils/auth.js";
import { personFromAdmin } from "./_utils/invite.js";
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
          const person = personFromAdmin(config, member.email, people, nowIso());
          await writeJson(peopleKey, [...people, person]);
          personId = person.id;
        }
      } catch (e) {
        // Non-fatal: worst case the client sees isMember:false again and
        // retries next load, same as any other transient S3 hiccup.
        console.error("org-config: self-provision failed:", e);
      }
    }

    // Strip admin PII — the whole reason this endpoint exists is so the client
    // never receives adminEmail(s); it relies on the server-derived isAdmin below.
    const { adminEmail, adminEmails, ...safeConfig } = config;
    return json(200, {
      ...safeConfig,
      // Server-derived authorization signals. The client should rely on
      // these, not on comparing emails locally.
      isMember: personId != null,
      isAdmin: member.isAdmin,
    });
  } catch (e) {
    console.error("org-config GET error:", e);
    return err(500, "Failed to read org config");
  }
}
