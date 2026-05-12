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

let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJWKS() {
  if (!JWKS) JWKS = createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`));
  return JWKS;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Code",
};
const jsonResp = (status: number, obj: unknown) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
});

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResp(405, { error: "Method not allowed" });

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return jsonResp(401, { error: "Missing or malformed Authorization header" });
  try {
    await jwtVerify(authHeader.slice(7), getJWKS(), { issuer: `https://${AUTH0_DOMAIN}/`, audience: AUTH0_AUDIENCE });
  } catch (e) {
    return jsonResp(401, { error: (e as Error).message || "Token validation failed" });
  }

  // ── Payload ─────────────────────────────────────────────────────────────
  let payload: any;
  try { payload = await req.json(); } catch { return jsonResp(400, { error: "Invalid JSON body" }); }
  const { system, messages, max_tokens, tools, tool_choice } = payload;
  if (!messages || !Array.isArray(messages)) return jsonResp(400, { error: "messages array is required" });

  const anthropicBody = {
    model: DEFAULT_MODEL,
    max_tokens: Math.min(Number(max_tokens) || 4000, 8192),
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
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    console.error("ai-schedule edge proxy error:", e);
    return jsonResp(502, { error: "Failed to reach Anthropic API" });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("Anthropic API error:", upstream.status, text);
    return jsonResp(upstream.status, { error: text || "Anthropic API error" });
  }

  // ── Pipe the SSE body straight back to the client ──────────────────────
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
};

// Route this edge function at the same URL the client already calls.
export const config = {
  path: "/.netlify/functions/ai-schedule",
};
