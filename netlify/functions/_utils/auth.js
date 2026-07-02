import { createRemoteJWKSet, jwtVerify } from "jose";
import { readJson } from "./s3.js";
import { filterLive } from "./entities.js";

const domain = process.env.AUTH0_DOMAIN;
const audience = process.env.AUTH0_AUDIENCE;

let JWKS;

function getJWKS() {
  if (!JWKS) {
    JWKS = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
  }
  return JWKS;
}

/**
 * Validate the Authorization: Bearer <token> header.
 * Returns the decoded JWT payload on success.
 * Throws an Error with a human-readable message on failure.
 */
export async function validateToken(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }

  const token = authHeader.slice(7);

  // Pin algorithm to RS256 — Auth0 issues RS256-signed access tokens, and the
  // JWKS only contains public keys. Without this, jose would accept any
  // algorithm the token *claims*, which is a defense-in-depth gap even if
  // realistically unexploitable here.
  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: `https://${domain}/`,
    audience: audience,
    algorithms: ["RS256"],
  });

  return payload;
}

// ─── Membership ─────────────────────────────────────────────────────────────
//
// `requireOrgMember` validates the token AND verifies the authenticated user
// is actually a member of the org code they're claiming via X-Org-Code.
// Without this, any authenticated user from org A could send a POST with
// `X-Org-Code: ORGB` and the server would happily overwrite org B's data —
// the JWT verifies fine, it's just signed by Auth0 with no per-org binding.

// Two small caches:
//   - userinfoCache: JWT sub → email, populated from /userinfo when the access
//     token doesn't carry an email claim (Auth0 access tokens for custom APIs
//     don't by default). Bounded + TTL'd to avoid unbounded growth and to
//     pick up email changes within a few minutes.
//   - memberCache: (sub, orgCode) → membership result. Short TTL so a removed
//     user gets locked out within ~30s on every server instance.
const USERINFO_TTL_MS = 5 * 60 * 1000;
const USERINFO_MAX = 1000;
const MEMBER_TTL_MS = 30 * 1000;
const MEMBER_MAX = 2000;

const userinfoCache = new Map();    // sub → { email, at }
const memberCache = new Map();      // `${sub}:${orgCode}` → { result, at }

function _capAndSet(map, max, key, value) {
  if (map.size >= max) {
    // Drop the oldest 10% — Map preserves insertion order so the first
    // keys are the oldest.
    const drop = Math.max(1, Math.floor(max * 0.1));
    let i = 0;
    for (const k of map.keys()) {
      if (i++ >= drop) break;
      map.delete(k);
    }
  }
  map.set(key, value);
}

async function emailForToken(event, payload) {
  // Prefer the email claim if Auth0 was configured to emit one. The custom
  // claim path is what an Auth0 Action would set; the bare `email` is what
  // ID tokens carry. Access tokens for custom APIs usually carry neither,
  // which is why we fall back to /userinfo.
  if (payload?.email) return String(payload.email).toLowerCase().trim();
  const customClaim = payload?.["https://traqs.matrixsystems.com/email"];
  if (customClaim) return String(customClaim).toLowerCase().trim();

  const sub = payload?.sub;
  if (sub) {
    const cached = userinfoCache.get(sub);
    if (cached && Date.now() - cached.at < USERINFO_TTL_MS) return cached.email;
    if (cached) userinfoCache.delete(sub);
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  if (!domain) return null;

  try {
    const res = await fetch(`https://${domain}/userinfo`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const email = String(body?.email || "").toLowerCase().trim();
    if (sub && email) _capAndSet(userinfoCache, USERINFO_MAX, sub, { email, at: Date.now() });
    return email || null;
  } catch {
    return null;
  }
}

/**
 * AuthError carries an HTTP status alongside the message so handlers can
 * `return err(e.statusCode, e.message)` uniformly.
 */
export class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Validate the Authorization header AND confirm the authenticated user is
 * a member of the org code declared in `X-Org-Code`. Membership =
 *   (a) user's email is in `orgs/{code}/people.json`, OR
 *   (b) user's email equals `config.adminEmail` (bootstrap path).
 *
 * Returns `{ orgCode, email, personId, isAdmin, payload }`.
 * Throws `AuthError` with statusCode 400 / 401 / 403 on failure.
 *
 * Heavy hot-path callers (autosave tasks, message sends) benefit from a
 * short in-memory cache keyed by (sub, orgCode). 30s lets us pick up role
 * changes quickly while not re-reading two S3 objects on every request.
 */
export async function requireOrgMember(event) {
  const orgCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!/^[a-zA-Z0-9]{3,20}$/.test(orgCode)) {
    throw new AuthError(400, "Missing or invalid X-Org-Code header");
  }

  let payload;
  try {
    payload = await validateToken(event);
  } catch (e) {
    throw new AuthError(401, e.message || "Token validation failed");
  }

  const sub = payload?.sub;
  if (sub) {
    const cached = memberCache.get(`${sub}:${orgCode}`);
    if (cached && Date.now() - cached.at < MEMBER_TTL_MS) {
      return { orgCode, ...cached.result, payload };
    }
  }

  const email = await emailForToken(event, payload);
  if (!email) {
    throw new AuthError(401, "Could not resolve user email from token");
  }

  const [people, config] = await Promise.all([
    // filterLive: a soft-deleted (tombstoned) person must NOT count as a member
    // or admin — otherwise removing an employee wouldn't revoke their access.
    readJson(`orgs/${orgCode}/people.json`).then(v => filterLive(v ?? [])).catch(() => []),
    readJson(`orgs/${orgCode}/config.json`).catch(() => null),
  ]);

  const me = (people || []).find(p => String(p.email || "").toLowerCase().trim() === email);
  const adminEmail = String(config?.adminEmail || "").toLowerCase().trim();
  const adminList = [adminEmail, ...((config?.adminEmails || []).map(e => String(e || "").toLowerCase().trim()))].filter(Boolean);
  const isOrgAdmin = adminList.includes(email);

  if (!me && !isOrgAdmin) {
    throw new AuthError(403, "Not a member of this organization");
  }

  const result = {
    email,
    personId: me?.id != null ? String(me.id) : null,
    isAdmin: (me?.userRole === "admin") || isOrgAdmin,
  };
  if (sub) _capAndSet(memberCache, MEMBER_MAX, `${sub}:${orgCode}`, { result, at: Date.now() });
  return { orgCode, ...result, payload };
}
