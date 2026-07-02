import Ably from "ably";

// Ably realtime subscriber for the desktop app. Connection is deferred until
// connect() is called explicitly after auth completes (we need the org code +
// a way to fetch Auth0 tokens). The browser NEVER sees ABLY_ROOT_KEY — it
// authenticates via /.netlify/functions/ably-token, which issues a short-lived
// TokenRequest scoped to this org.
//
// Graceful degradation: if the token endpoint returns 503 (ABLY_ROOT_KEY not
// set server-side), we log once and never open a connection, so the app still
// works (the background deltaSync + any existing polling keep data fresh, just
// without ~200ms live updates).

let client = null;
let orgCode = null;
let degraded = false;
const channels = new Map();

export function isConnected() { return !!client && !degraded; }
export function isDegraded() { return degraded; }

// Connect after login. `getToken` returns a fresh Auth0 access token.
// Returns the Ably client, or null when real-time is unavailable/degraded.
export async function connect(ctx) {
  if (client || degraded) return client;
  orgCode = ctx.orgCode;
  const getToken = ctx.getToken;
  const onReconnect = ctx.onReconnect; // fired after a drop→reconnect to catch missed changes

  // One-shot probe so we can detect "real-time not configured" (503) WITHOUT
  // spinning Ably's auth-retry loop against an endpoint that will never succeed.
  try {
    const token = await getToken();
    const probe = await fetch("/.netlify/functions/ably-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "X-Org-Code": orgCode },
    });
    if (probe.status === 503) {
      degraded = true;
      console.warn("[ably] real-time disabled — server returned 503 (ABLY_ROOT_KEY not set). App runs without live updates.");
      return null;
    }
    if (!probe.ok) {
      console.warn(`[ably] token probe returned ${probe.status}; connecting anyway (Ably will retry auth).`);
    }
  } catch (e) {
    console.warn("[ably] token probe error:", e?.message || e, "— connecting anyway.");
  }

  client = new Ably.Realtime({
    // authCallback runs now and on every token refresh — always fetch a fresh
    // Auth0 token so a long-lived tab keeps a valid Ably token.
    authCallback: async (_tokenParams, callback) => {
      try {
        const token = await getToken();
        const res = await fetch("/.netlify/functions/ably-token", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "X-Org-Code": orgCode },
        });
        if (!res.ok) { callback(`ably-token ${res.status}`, null); return; }
        callback(null, await res.json());
      } catch (e) {
        callback(e?.message || "ably-token error", null);
      }
    },
  });

  let hasConnected = false;
  client.connection.on((change) => {
    // Surface state transitions for debugging reconnection (wifi off/on, etc.).
    console.log(`[ably] ${change.previous} → ${change.current}`, change.reason?.message || "");
    if (change.current === "connected") {
      // On a RE-connect (not the first connect), messages published while we
      // were offline may have been missed, so pull the delta immediately rather
      // than waiting for the next live event or the 30s poll.
      if (hasConnected && typeof onReconnect === "function") { try { onReconnect(); } catch {} }
      hasConnected = true;
    }
  });

  return client;
}

// Subscribe to org-{orgCode}:{entity} "changed" events. `cb` receives the
// payload { ids, serverTime, more }. Returns an unsubscribe function.
export function subscribe(entity, cb) {
  if (!client || degraded) return () => {};
  const name = `org-${orgCode}:${entity}`;
  let ch = channels.get(name);
  if (!ch) { ch = client.channels.get(name); channels.set(name, ch); }
  const handler = (msg) => { try { cb(msg?.data); } catch (e) { console.error(`[ably] handler error for ${entity}:`, e); } };
  ch.subscribe("changed", handler);
  return () => { try { ch.unsubscribe("changed", handler); } catch {} };
}

// Cleanly tear down on logout so the next login reconnects fresh.
export function disconnect() {
  try { client?.close(); } catch {}
  client = null;
  orgCode = null;
  degraded = false;
  channels.clear();
}
