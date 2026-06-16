// push-subscribe.js — store/remove a browser's Web Push subscription for the
// authenticated person. Subscriptions live at orgs/{code}/push-subs.json,
// keyed by personId (see _utils/webpush.js). The personId is taken from the
// validated token, never from the request body — a member can only manage
// their own subscriptions.
import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { subsKey } from "./_utils/webpush.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
  if (!member.personId) return err(403, "No person record for this user");

  const key = subsKey(member.orgCode);
  const pid = String(member.personId);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return err(400, "Invalid JSON"); }

  // POST — save a subscription (de-duped by endpoint).
  if (event.httpMethod === "POST") {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return err(400, "Invalid subscription");
    }
    const store = (await readJson(key).catch(() => null)) || {};
    const list = Array.isArray(store[pid]) ? store[pid] : [];
    const others = list.filter(s => s?.endpoint !== sub.endpoint);
    // Cap per-person subscriptions so a user churning browsers can't grow the
    // file unbounded; keep the most recent few.
    store[pid] = [...others, sub].slice(-10);
    await writeJson(key, store);
    return json(200, { ok: true });
  }

  // DELETE — remove a subscription by endpoint (on unsubscribe / permission revoke).
  if (event.httpMethod === "DELETE") {
    const endpoint = body.endpoint || event.queryStringParameters?.endpoint;
    if (!endpoint) return err(400, "Missing endpoint");
    const store = (await readJson(key).catch(() => null)) || {};
    if (Array.isArray(store[pid])) {
      store[pid] = store[pid].filter(s => s?.endpoint !== endpoint);
      if (store[pid].length === 0) delete store[pid];
      await writeJson(key, store);
    }
    return json(200, { ok: true });
  }

  return err(405, "Method not allowed");
}
