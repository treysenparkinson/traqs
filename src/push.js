// push.js — desktop Web Push (browser) registration + subscription.
//
// Flow: register the service worker (public/sw.js) → request Notification
// permission → subscribe via PushManager with our VAPID public key → POST the
// subscription to the backend (orgs/{code}/push-subs.json, keyed by personId).
// The backend (messages.js / notify.js) then pushes to it. Native iOS/Android
// continue to use OneSignal — this path is desktop browsers only.
import { savePushSubscription, removePushSubscription } from "./api.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// True when the browser can do Web Push at all (excludes Capacitor native,
// older browsers, and iOS Safari tabs that aren't installed to home screen).
export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!VAPID_PUBLIC_KEY
  );
}

export function pushPermission() {
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}

// VAPID public key (base64url) → Uint8Array for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration() {
  return navigator.serviceWorker.register("/sw.js");
}

async function subscribeAndSave(reg, getToken, orgCode) {
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await savePushSubscription(sub.toJSON(), getToken, orgCode);
  return sub;
}

/**
 * Prompt for permission (if needed) and subscribe this browser. Call from a
 * user gesture (button click) so the permission prompt is allowed.
 * Returns { ok, reason } — reason is one of: "subscribed", "denied",
 * "unsupported", "error".
 */
export async function registerAndSubscribe(getToken, orgCode) {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const reg = await getRegistration();
    await subscribeAndSave(reg, getToken, orgCode);
    return { ok: true, reason: "subscribed" };
  } catch (e) {
    console.warn("registerAndSubscribe failed:", e);
    return { ok: false, reason: "error" };
  }
}

/**
 * Silent re-sync on app load: if the user already granted permission, make
 * sure the service worker is registered and the (possibly rotated)
 * subscription is stored on the server. Never prompts.
 */
export async function ensureSubscribed(getToken, orgCode) {
  if (!pushSupported() || pushPermission() !== "granted") return;
  try {
    const reg = await getRegistration();
    await subscribeAndSave(reg, getToken, orgCode);
  } catch (e) {
    console.warn("ensureSubscribed failed:", e);
  }
}

/** Unsubscribe this browser and remove the subscription server-side. */
export async function unsubscribePush(getToken, orgCode) {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await removePushSubscription(sub.endpoint, getToken, orgCode).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch (e) {
    console.warn("unsubscribePush failed:", e);
  }
}
