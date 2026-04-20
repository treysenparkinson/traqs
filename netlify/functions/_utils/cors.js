const origin = process.env.ALLOWED_ORIGIN || "*";

export const CORS = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Code",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

export function preflight() {
  return { statusCode: 204, headers: CORS, body: "" };
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function err(statusCode, message) {
  return json(statusCode, { error: message });
}
