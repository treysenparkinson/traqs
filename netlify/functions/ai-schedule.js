// Netlify Functions v2 — streams the Anthropic SSE response straight back to the client.
// Why v2: the previous Lambda-style handler awaited the full response, so the connection
// went idle while Anthropic generated. Anthropic with tool_use can easily take 30–60s,
// which tripped Netlify's 10–26s sync-function timeout and the edge's inactivity timeout
// (the user-visible 504 with the "Inactivity Timeout" HTML page).
// With stream:true and a piped response, bytes flow continuously and the connection
// stays alive for as long as Anthropic is generating.

import { createRemoteJWKSet, jwtVerify } from "jose";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

let JWKS;
function getJWKS() {
  if (!JWKS) JWKS = createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`));
  return JWKS;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Code",
};
const jsonResp = (status, obj) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
});

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResp(405, { error: "Method not allowed" });

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return jsonResp(401, { error: "Missing or malformed Authorization header" });
  try {
    await jwtVerify(authHeader.slice(7), getJWKS(), { issuer: `https://${AUTH0_DOMAIN}/`, audience: AUTH0_AUDIENCE });
  } catch (e) {
    return jsonResp(401, { error: e.message || "Token validation failed" });
  }

  // ── Payload ─────────────────────────────────────────────────────────────
  let payload;
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

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    console.error("ai-schedule proxy error:", e);
    return jsonResp(502, { error: "Failed to reach Anthropic API" });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("Anthropic API error:", upstream.status, text);
    return jsonResp(upstream.status, { error: text || "Anthropic API error" });
  }

  // ── Pipe the SSE body straight back to the client ──────────────────────
  // Anthropic returns text/event-stream when stream:true. We forward the body unchanged
  // so the client can parse SSE events the same way it would talking to Anthropic directly.
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

// Mark this function as runnable on Netlify Edge if desired. By default Netlify will run
// it as a Node serverless function. Streaming via the standard Response works in both.
