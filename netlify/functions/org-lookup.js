import { readJson, listOrgCodes } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { validateToken } from "./_utils/auth.js";
import { filterLive } from "./_utils/entities.js";

// Resolve which organization(s) the AUTHENTICATED user belongs to. Used by
// the mobile app right after Auth0 login so users don't have to type an
// org code by hand.
//
// Auth: requires a valid Auth0 bearer token. The email is derived from the
// token (via /userinfo since Auth0 access tokens for custom APIs don't
// include the email claim by default). The query param is ignored — an
// authenticated user can only look up THEIR OWN orgs, not someone else's.
//
// Returns: { matches: [{ code, name, domain, adminEmail }, ...] }
//   0 matches → 200 with empty array (so mobile can show "no org" UI)
//   1 match   → auto-pick on the client
//   2+        → client shows a picker
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET") return err(405, "Method not allowed");

  let payload;
  try { payload = await validateToken(event); } catch (e) { return err(401, e.message); }

  // Derive the email from the validated token, not from caller input.
  // Previously this trusted the email query param, which let an
  // authenticated user enumerate which orgs ANY email belonged to.
  let email = (payload.email || payload["https://traqs.matrixsystems.com/email"] || "").toLowerCase().trim();
  if (!email) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
    const domain = process.env.AUTH0_DOMAIN;
    if (authHeader && domain) {
      try {
        const res = await fetch(`https://${domain}/userinfo`, { headers: { Authorization: authHeader } });
        if (res.ok) {
          const body = await res.json();
          email = String(body?.email || "").toLowerCase().trim();
        }
      } catch {}
    }
  }
  if (!email || !email.includes("@")) return err(401, "Could not resolve user email from token");
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
        // filterLive: a soft-deleted person is not a member, so a removed
        // employee can no longer resolve/enter the org via this lookup.
        const people = filterLive(await readJson(`orgs/${code}/people.json`).catch(() => null));
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
