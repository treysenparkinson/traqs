// webpush.js — shared Web Push sender for desktop browser notifications.
//
// Subscriptions live at orgs/{code}/push-subs.json keyed by personId:
//   { "<personId>": [ <PushSubscription>, ... ], ... }
//
// Triggered from the existing server-side notification hooks (messages.js
// for chat, notify.js for job/engineering events) alongside OneSignal —
// OneSignal targets native iOS/Android, web push targets desktop browsers.
import webpush from "web-push";
import { readJson, writeJson } from "./s3.js";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:no-reply@matrixpci.com";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
  return true;
}

export function webPushConfigured() {
  return !!(PUBLIC_KEY && PRIVATE_KEY);
}

export function subsKey(orgCode) {
  return `orgs/${orgCode}/push-subs.json`;
}

/**
 * Send a web push to every browser subscription registered by the given
 * person IDs. Best-effort: never throws to the caller. Dead subscriptions
 * (404/410 from the push service) are pruned and the file rewritten.
 *
 * @param {string} orgCode
 * @param {string[]} personIds
 * @param {{ title: string, body: string, data?: object }} payload
 */
export async function sendWebPush(orgCode, personIds, { title, body, data = {} }) {
  if (!ensureConfigured()) return { sent: 0 };
  const ids = [...new Set((personIds || []).map(String))];
  if (ids.length === 0) return { sent: 0 };

  let store;
  try { store = await readJson(subsKey(orgCode)); } catch { store = null; }
  if (!store || typeof store !== "object") return { sent: 0 };

  const message = JSON.stringify({ title, body, data });
  const dead = []; // { personId, endpoint }
  let sent = 0;

  await Promise.all(
    ids.flatMap(pid =>
      (Array.isArray(store[pid]) ? store[pid] : []).map(async sub => {
        try {
          await webpush.sendNotification(sub, message);
          sent++;
        } catch (e) {
          // 404 Not Found / 410 Gone → subscription is permanently dead.
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            dead.push({ personId: pid, endpoint: sub?.endpoint });
          }
          // Other errors (timeouts, 5xx) are transient — leave the sub in place.
        }
      })
    )
  );

  if (dead.length > 0) {
    for (const { personId, endpoint } of dead) {
      if (Array.isArray(store[personId])) {
        store[personId] = store[personId].filter(s => s?.endpoint !== endpoint);
        if (store[personId].length === 0) delete store[personId];
      }
    }
    try { await writeJson(subsKey(orgCode), store); } catch { /* best-effort prune */ }
  }

  return { sent };
}
