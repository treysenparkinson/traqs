import Ably from "ably";
import { requireOrgMember } from "./_utils/auth.js";
import { preflight, json, err } from "./_utils/cors.js";

// Issues a short-lived Ably TokenRequest so a browser can subscribe to its org's
// real-time channels WITHOUT ever seeing ABLY_ROOT_KEY. Capability is scoped to
// the caller's org namespace so orgs can't eavesdrop on each other:
//   • subscribe on org-{orgCode}:*          → receive change signals on any entity
//   • subscribe/publish/presence on
//     org-{orgCode}:presence                → reserved for presence indicators
//
// Clients get ONLY subscribe on data channels — they never publish data changes
// directly. Those flow through the Netlify write functions, which publish
// server-side with the root key. (Ably resolves the most specific matching
// resource, so the explicit :presence entry grants publish there without
// widening the org-{orgCode}:* data channels beyond subscribe.)
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

  const key = process.env.ABLY_ROOT_KEY;
  if (!key) return err(503, "Real-time is not configured");

  const { orgCode, personId } = member;
  const capability = {
    [`org-${orgCode}:*`]: ["subscribe"],
    [`org-${orgCode}:presence`]: ["subscribe", "publish", "presence"],
  };

  try {
    const rest = new Ably.Rest({ key });
    const tokenRequest = await rest.auth.createTokenRequest({
      capability: JSON.stringify(capability),
      // Tie the token to the person so future presence shows who's online.
      ...(personId ? { clientId: String(personId) } : {}),
    });
    return json(200, tokenRequest);
  } catch (e) {
    console.error("[ably-token] createTokenRequest failed:", e?.message || e);
    return err(500, "Failed to issue real-time token");
  }
}
