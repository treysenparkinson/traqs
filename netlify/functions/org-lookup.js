import { readJson, listOrgCodes } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { validateToken } from "./_utils/auth.js";

// Resolve which organization(s) an email belongs to. Used by the mobile app
// right after Auth0 login so users don't have to type an org code by hand.
//
// Auth: requires a valid Auth0 bearer token. We don't read email from the
// token (Auth0 access tokens don't carry email by default); the client passes
// it as a query param after fetching /userinfo. The token requirement is
// purely to keep this endpoint from being a free org-enumeration tool.
//
// Returns: { matches: [{ code, name, domain, adminEmail }, ...] }
//   0 matches → 200 with empty array (so mobile can show "no org" UI)
//   1 match   → auto-pick on the client
//   2+        → client shows a picker
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET") return err(405, "Method not allowed");

  try { await validateToken(event); } catch (e) { return err(401, e.message); }

  const email = (event.queryStringParameters?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return err(400, "Valid email required");
  const emailDomain = email.split("@")[1];

  let codes;
  try {
    codes = await listOrgCodes();
  } catch (e) {
    console.error("org-lookup listOrgCodes error:", e);
    return err(500, "Failed to search organizations");
  }

  const matches = [];
  await Promise.all(
    codes.map(async (code) => {
      const config = await readJson(`orgs/${code}/config.json`).catch(() => null);
      if (!config) return;
      const isAdmin = config.adminEmail?.toLowerCase() === email;
      const isDomainMatch = config.domain?.toLowerCase() === emailDomain;
      if (!isAdmin && !isDomainMatch) return;

      // Domain match alone isn't enough — the org's people roster is the
      // source of truth for "is this user actually a member". An admin email
      // always passes (covers the bootstrap case where the admin hasn't been
      // added to the roster yet).
      let inRoster = isAdmin;
      if (!inRoster) {
        const people = await readJson(`orgs/${code}/people.json`).catch(() => null);
        if (Array.isArray(people)) {
          inRoster = people.some((p) => (p?.email || "").toLowerCase() === email);
        }
      }
      if (!inRoster) return;

      matches.push({
        code,
        name: config.name,
        domain: config.domain,
        adminEmail: config.adminEmail,
      });
    })
  );

  return json(200, { matches });
}
