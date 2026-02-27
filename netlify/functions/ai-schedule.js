import { validateToken } from "./_utils/auth.js";
import { preflight, json, err } from "./_utils/cors.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Whitelist of allowed models — client cannot override this
const ALLOWED_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-5",
  "claude-haiku-4-5-20251001",
];
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  // Require valid Auth0 JWT
  try {
    await validateToken(event);
  } catch (e) {
    return err(401, e.message);
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return err(400, "Invalid JSON body");
  }

  const { system, messages, max_tokens } = payload;
  if (!messages || !Array.isArray(messages)) {
    return err(400, "messages array is required");
  }

  // Build the Anthropic request — whitelist safe fields only
  const anthropicBody = {
    model: DEFAULT_MODEL,
    max_tokens: Math.min(Number(max_tokens) || 4000, 8192),
    system: typeof system === "string" ? system : undefined,
    messages,
  };

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Anthropic API error:", data);
      return err(res.status, data?.error?.message ?? "Anthropic API error");
    }

    return json(200, data);
  } catch (e) {
    console.error("ai-schedule proxy error:", e);
    return err(502, "Failed to reach Anthropic API");
  }
}
