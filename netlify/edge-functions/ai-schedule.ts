// Netlify Edge Function — streams Anthropic SSE to the client.
//
// Why Edge: regular Netlify Functions v2 streaming worked initially but the stream
// was being cut off mid-response by the function execution-time limit. Edge Functions
// run on Deno Deploy with a 50s default timeout (extendable to 240s) and have
// first-class streaming support, so Anthropic generations that take 30-60s complete
// reliably.
//
// This handler replaces the prior `netlify/functions/ai-schedule.js`. The Edge
// route below claims the same URL the client already calls, so no client change.

import { jwtVerify, createRemoteJWKSet } from "https://esm.sh/jose@5.9.6";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

const AUTH0_DOMAIN = Netlify.env.get("AUTH0_DOMAIN");
const AUTH0_AUDIENCE = Netlify.env.get("AUTH0_AUDIENCE");
const ANTHROPIC_API_KEY = Netlify.env.get("ANTHROPIC_API_KEY");

// Origin allowlist. ALLOWED_ORIGIN can be a single origin or a comma-separated
// list (e.g. "https://traqs.matrixsystems.com,https://traqs.netlify.app").
// Default matches the rest of the stack.
const ALLOWED_ORIGINS = (Netlify.env.get("ALLOWED_ORIGIN") || "https://traqs.matrixsystems.com")
  .split(",").map(s => s.trim()).filter(Boolean);

let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJWKS() {
  if (!JWKS) JWKS = createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`));
  return JWKS;
}

// Echo a request's Origin back if it's in the allowlist, otherwise echo the
// first allowed origin. Native apps (iOS/Android) don't send Origin and don't
// enforce CORS — they'll just ignore whatever we return — so this only
// affects browsers.
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Code",
    "Vary": "Origin",
  };
}

const jsonResp = (req: Request, status: number, obj: unknown) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", ...corsHeadersFor(req) },
});

// Per-user rate limit. Best-effort: edge function instances are stateless
// across cold starts and don't share memory, so a determined attacker could
// fan out across instances — but the wide majority of cost-abuse cases hit
// a single warm instance hard, and Anthropic's own rate limits cap the rest.
// Keyed by JWT `sub` so a single compromised token can't drain credits even
// at the per-instance level.
const RATE_LIMIT_MAX = 30;          // calls
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;  // per hour
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRate(sub: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = rateBuckets.get(sub);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(sub, bucket);
  }
  bucket.count++;
  if (rateBuckets.size > 5000) {
    // Drop expired entries when the map grows. Cheap sweep over keys.
    for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
  }
  return {
    ok: bucket.count <= RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - bucket.count),
    resetAt: bucket.resetAt,
  };
}

export default async (req: Request): Promise<Response> => {
  const CORS_HEADERS = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResp(req, 405, { error: "Method not allowed" });

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return jsonResp(req, 401, { error: "Missing or malformed Authorization header" });
  let payload: { sub?: string } = {};
  try {
    const v = await jwtVerify(authHeader.slice(7), getJWKS(), {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE,
      algorithms: ["RS256"],
    });
    payload = v.payload as { sub?: string };
  } catch (e) {
    return jsonResp(req, 401, { error: (e as Error).message || "Token validation failed" });
  }

  // ── Rate limit ──────────────────────────────────────────────────────────
  const sub = payload.sub || "";
  if (!sub) return jsonResp(req, 401, { error: "Token has no subject" });
  const rate = checkRate(sub);
  if (!rate.ok) {
    return new Response(JSON.stringify({
      error: `AI rate limit exceeded — try again after ${new Date(rate.resetAt).toLocaleTimeString()}.`,
    }), {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)),
        "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(rate.resetAt / 1000)),
      },
    });
  }

  // ── Payload ─────────────────────────────────────────────────────────────
  let payload2: any;
  try { payload2 = await req.json(); } catch { return jsonResp(req, 400, { error: "Invalid JSON body" }); }
  const { system, messages, max_tokens, tools, tool_choice } = payload2;
  if (!messages || !Array.isArray(messages)) return jsonResp(req, 400, { error: "messages array is required" });

  // Cap output tokens. With the output-128k beta header below, Sonnet 4 supports up to 128K.
  // Real-world Fast TRAQS extractions of full Excel schedules often need >8K output tokens
  // (the old default), which is why the user was hitting stop_reason: "max_tokens".
  const MAX_OUTPUT = 64000;
  const anthropicBody = {
    model: DEFAULT_MODEL,
    max_tokens: Math.min(Number(max_tokens) || 4000, MAX_OUTPUT),
    system: typeof system === "string" ? system : undefined,
    messages,
    stream: true,
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
  };

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        // Extended output (Sonnet 4): allows max_tokens up to 128K instead of 8K.
        "anthropic-beta": "output-128k-2025-02-19",
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    console.error("ai-schedule edge proxy error:", e);
    return jsonResp(req, 502, { error: "Failed to reach Anthropic API" });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("Anthropic API error:", upstream.status, text);
    return jsonResp(req, upstream.status, { error: text || "Anthropic API error" });
  }

  // ── Pipe the SSE body straight back to the client ──────────────────────
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
      "X-RateLimit-Remaining": String(rate.remaining),
      "X-RateLimit-Reset": String(Math.floor(rate.resetAt / 1000)),
    },
  });
};

// Route this edge function at the same URL the client already calls.
export const config = {
  path: "/.netlify/functions/ai-schedule",
};
