import Ably from "ably";

// Server-side publisher for real-time change signals.
//
// We publish only a tiny "something changed" event (ids + serverTime), NEVER the
// changed records themselves — so a message is always well under Ably's 64KB
// limit and clients pull the actual data via /sync (or a targeted fetch by id).
// REST (not Realtime) is the right SDK for one-off publishes from short-lived
// serverless functions.
//
// Requires ABLY_ROOT_KEY (server-only secret). If it is unset — local dev, or
// Ably not configured yet — every publish is a silent no-op so writes still
// succeed. Any publish failure is logged and swallowed: real-time is a
// best-effort enhancement and must NEVER break the underlying S3 write.

let _rest; // memoized; `null` means "checked, not configured"

function rest() {
  if (_rest !== undefined) return _rest;
  const key = process.env.ABLY_ROOT_KEY;
  _rest = key ? new Ably.Rest({ key }) : null;
  if (!_rest) console.warn("[ably] ABLY_ROOT_KEY not set — real-time publishes are disabled");
  return _rest;
}

/**
 * Publish a change signal for `entity` within `orgCode`'s channel namespace.
 *   channel: `org-{orgCode}:{entity}`   event: "changed"
 *
 * changePayload:
 *   ids?:        record ids created/updated/tombstoned in this write. A HINT for
 *                targeted refetch — clients still /sync as the source of truth.
 *                Capped so the signal stays tiny; `more:true` flags truncation.
 *   serverTime?: ISO stamp of the change; defaults to now.
 *
 * Never throws — a real-time failure must not surface to the write handler.
 */
export async function publishChange(orgCode, entity, changePayload = {}) {
  try {
    const client = rest();
    if (!client || !orgCode || !entity) return;
    const ids = Array.isArray(changePayload.ids) ? changePayload.ids.map(String) : [];
    const payload = {
      ids: ids.slice(0, 100),          // hint only; clients still /sync
      more: ids.length > 100,          // "more changed than listed" → definitely /sync
      serverTime: changePayload.serverTime || new Date().toISOString(),
    };
    await client.channels.get(`org-${orgCode}:${entity}`).publish("changed", payload);
  } catch (e) {
    console.error(`[ably] publishChange failed for ${entity} in ${orgCode}:`, e?.message || e);
  }
}
