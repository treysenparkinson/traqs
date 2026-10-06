// A fixed-window rate limit for the endpoints that answer WITHOUT a token (#385).
//
// `GET /people` and `GET /org?code=` are open by design — the kiosk needs the
// roster and the org lookup before anyone signs in. Open plus unlimited means a
// single org code enumerates the whole company as fast as the network allows.
// Narrowing the projection removes most of what was worth taking; this removes
// the ability to take it at speed.
//
// HONEST ABOUT WHAT THIS IS. Netlify Functions are serverless, so this counter
// lives in ONE WARM INSTANCE and a burst spread across instances gets a budget
// per instance. It is a speed bump, not a guarantee, and it is deliberately
// chosen over adding a datastore for a kiosk endpoint. A real limit belongs at
// the edge or in a shared store; this is what can be had without one, and it
// raises the cost of a scrape from "one loop" to "many, slowly, from many IPs".
// Said plainly here so nobody later reads its presence as a solved problem.

const buckets = new Map();

/** Test seam — the suite resets between cases; nothing in production calls it. */
export function _resetRateLimit() { buckets.clear(); }

/**
 * @param {{key: string, limit: number, windowMs: number, now?: number}} o
 * @returns {{ok: boolean, remaining: number, retryAfter: number}}
 *   retryAfter is SECONDS until the window rolls, for the Retry-After header.
 */
export function rateLimit({ key, limit, windowMs, now = Date.now() }) {
  const window = Math.floor(now / windowMs);
  const b = buckets.get(key);
  if (!b || b.window !== window) {
    // Swept on write rather than on a timer: a serverless instance may be frozen
    // between invocations, so an interval cannot be relied on to run. The map is
    // bounded by the number of distinct callers inside one window.
    if (buckets.size > 5000) buckets.clear();
    buckets.set(key, { window, count: 1 });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)) };
  }
  return { ok: true, remaining: limit - b.count, retryAfter: 0 };
}

/** The caller's address, as Netlify presents it. Falls back to a constant so a
 *  request with no usable address shares one bucket rather than escaping the
 *  limit entirely — failing CLOSED is the right direction here. */
export function callerIp(event) {
  const h = event?.headers || {};
  const fwd = h["x-nf-client-connection-ip"] || h["client-ip"] || h["x-forwarded-for"] || "";
  return String(fwd).split(",")[0].trim() || "unknown";
}
