import { createRemoteJWKSet, jwtVerify } from "jose";
import { readJson, writeJson } from "./s3.js";
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

// Three caches:
//   - userinfoCache: JWT sub → email, populated from /userinfo when the access
//     token doesn't carry an email claim (Auth0 access tokens for custom APIs
//     don't by default). Bounded + TTL'd to avoid unbounded growth.
//   - the durable S3 cache (see authCacheKey below): the same sub → email
//     mapping, but persisted. In-memory caches die with the Lambda instance,
//     and Netlify cold-starts constantly — which is exactly when every request
//     in the app's parallel load burst raced to call /userinfo, tripped Auth0's
//     per-user rate limit, and turned a 429 into a bogus 401 for the user.
//     (Incident 2026-08-01: repeated "fetchTasks failed: 401" on production
//     reads; function logs showed "/userinfo returned 429" clustered right
//     after each cold start.) S3 survives cold starts and has no such limit.
//   - memberCache: (sub, orgCode) → membership result. Short TTL so a removed
//     user gets locked out within ~5min on every server instance.
const USERINFO_TTL_MS = 60 * 60 * 1000;  // 1h in-memory — sub→email is near-static
const USERINFO_MAX = 1000;
const MEMBER_TTL_MS = 5 * 60 * 1000;   // 5 min — still revokes removed users quickly
const MEMBER_MAX = 2000;
// How old a durable entry may get before we opportunistically refresh it from
// /userinfo (so an email change in Auth0 propagates). A stale entry is still
// served indefinitely when Auth0 is unreachable — see emailForToken step 5.
const DURABLE_REFRESH_MS = 24 * 60 * 60 * 1000;  // 24h

const userinfoCache = new Map();    // sub → { email, at }
const memberCache = new Map();      // `${sub}:${orgCode}` → { result, at }
const userinfoInflight = new Map(); // sub → in-flight Promise, to collapse bursts

// A JWT sub ("auth0|abc", "google-oauth2|123") contains characters that are
// awkward in an S3 key, so base64url it into a flat, collision-free name.
function authCacheKey(sub) {
  return `authcache/${Buffer.from(String(sub)).toString("base64url")}.json`;
}

async function readDurableEmail(sub) {
  if (!sub) return null;
  try {
    const v = await readJson(authCacheKey(sub));
    const email = String(v?.email || "").toLowerCase().trim();
    return email ? { email, at: Number(v?.at) || 0 } : null;
  } catch (e) {
    console.warn("[auth] durable email cache read failed:", e?.message || e);
    return null;
  }
}

async function writeDurableEmail(sub, email) {
  if (!sub || !email) return;
  try {
    await writeJson(authCacheKey(sub), { sub: String(sub), email, at: Date.now() });
  } catch (e) {
    // Non-fatal: we already have the email for this request, and the next
    // request just falls back to /userinfo again.
    console.warn("[auth] durable email cache write failed:", e?.message || e);
  }
}

/**
 * Call Auth0 /userinfo, retrying once on a transient failure.
 * Returns `{ email, transient }` — `transient` distinguishes "Auth0 is rate
 * limiting or down" (retryable, must NOT be reported as an auth failure) from
 * "this token genuinely has no email" (a real 401).
 */
async function fetchUserinfoEmail(authHeader) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(`https://${domain}/userinfo`, { headers: { Authorization: authHeader } });
    } catch (e) {
      console.warn("[auth] /userinfo fetch error:", e?.message || e);
      return { email: null, transient: true };
    }

    if (res.ok) {
      const body = await res.json().catch(() => null);
      const email = String(body?.email || "").toLowerCase().trim();
      return { email: email || null, transient: false };
    }

    // 429 = per-user rate limit, 5xx = Auth0 trouble. Both are retryable and
    // neither means the caller is unauthenticated.
    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt === 0) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400, 1500);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    console.warn(`[auth] /userinfo returned ${res.status} — email unresolvable. Add an Auth0 Post-Login Action to set the custom email claim on the access token.`);
    return { email: null, transient };
  }
  return { email: null, transient: true };
}

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

/**
 * Resolve the caller's email. Returns `{ email, transient }`:
 *   - `email` set          → resolved.
 *   - `transient: true`    → Auth0 is rate-limiting or down. The caller is NOT
 *                            unauthenticated; surface a retryable 503, not 401.
 *   - neither              → genuinely unresolvable (real auth failure).
 *
 * Resolution order is cheapest-and-most-durable first, so /userinfo — the only
 * rate-limited step — is reached as rarely as possible.
 */
export async function emailForToken(event, payload) {
  // 1. Token claims. The custom claim is what an Auth0 Post-Login Action would
  //    set; the bare `email` is what ID tokens carry. Access tokens for custom
  //    APIs usually carry neither, which is why the fallbacks below exist.
  //    Setting that Action makes every step after this one dead code.
  if (payload?.email) return { email: String(payload.email).toLowerCase().trim() };
  const customClaim = payload?.["https://traqs.matrixsystems.com/email"];
  if (customClaim) return { email: String(customClaim).toLowerCase().trim() };

  const sub = payload?.sub;

  // 2. In-memory cache — free, but dies with the Lambda instance.
  if (sub) {
    const cached = userinfoCache.get(sub);
    if (cached && Date.now() - cached.at < USERINFO_TTL_MS) return { email: cached.email };
    if (cached) userinfoCache.delete(sub);
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) return { email: null };
  if (!domain) return { email: null };

  // 3. Durable S3 cache — one cheap GET, and unlike the map above it survives
  //    the cold start that used to send the whole load burst to /userinfo.
  const durable = await readDurableEmail(sub);
  if (durable && Date.now() - durable.at < DURABLE_REFRESH_MS) {
    if (sub) _capAndSet(userinfoCache, USERINFO_MAX, sub, { email: durable.email, at: Date.now() });
    return { email: durable.email };
  }

  // 4. /userinfo — deduped per sub so concurrent requests on this instance
  //    share one upstream call instead of racing each other into the limiter.
  let inflight = sub ? userinfoInflight.get(sub) : null;
  if (!inflight) {
    inflight = fetchUserinfoEmail(authHeader);
    if (sub) {
      userinfoInflight.set(sub, inflight);
      inflight = inflight.finally(() => userinfoInflight.delete(sub));
    }
  }
  const { email, transient } = await inflight;

  if (email) {
    if (sub) {
      _capAndSet(userinfoCache, USERINFO_MAX, sub, { email, at: Date.now() });
      await writeDurableEmail(sub, email);
    }
    return { email };
  }

  // 5. Upstream failed. A stale durable entry is far better than locking a
  //    legitimate user out over someone else's rate limit.
  if (durable) {
    console.warn(`[auth] /userinfo unavailable — serving stale cached email for ${sub}`);
    return { email: durable.email };
  }

  return { email: null, transient };
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

  const { email, transient } = await emailForToken(event, payload);
  if (!email) {
    // A rate-limited or down identity provider is not an authentication
    // failure. 503 tells the client "retry shortly" instead of "your session
    // is dead", which is what made this look like a spurious 401.
    if (transient) {
      throw new AuthError(503, "Identity provider temporarily unavailable — please retry");
    }
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
