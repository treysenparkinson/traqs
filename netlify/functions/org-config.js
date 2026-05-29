import { readJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { requireOrgMember } from "./_utils/auth.js";

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
    return json(200, {
      ...config,
      // Server-derived authorization signals. The client should rely on
      // these, not on comparing emails locally.
      isMember: member.personId != null,
      isAdmin: member.isAdmin,
    });
  } catch (e) {
    console.error("org-config GET error:", e);
    return err(500, "Failed to read org config");
  }
}
