// CORS headers for all Netlify functions
// Fallback is the production domain that matches AUTH0_AUDIENCE; set
// ALLOWED_ORIGIN in Netlify env to override (e.g. for a preview deploy).
export const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://traqs.matrixsystems.com",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Code",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

// Return a preflight response for OPTIONS requests
export function preflight() {
  return { statusCode: 204, headers: CORS, body: "" };
}

// Wrap a JSON response with CORS headers
export function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Wrap an error response with CORS headers
export function err(statusCode, message) {
  return json(statusCode, { error: message });
}
