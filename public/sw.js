/* TRAQS service worker — Web Push receiver for desktop browser notifications.
 * Registered from src/push.js. Shows a native OS toast on `push`, and on
 * `notificationclick` focuses an open TRAQS window (forwarding the payload so
 * the app can open the relevant thread/job) or opens a new one. */

/* Which thread the app currently has open, if any. The page posts this whenever it
 * changes (see src/push.js → setActiveThread), because a service worker can't read
 * the page's state and the push arrives out of band. Held in memory only: if the
 * worker is evicted this resets to null, which fails SAFE — we show the toast. */
let activeThreadKey = null;
let activeThreadAt = 0;

self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || d.type !== "tq-active-thread") return;
  activeThreadKey = d.threadKey || null;
  activeThreadAt = Date.now();
});

/* A window is only "watching" if it's genuinely visible AND focused. A background
 * tab sitting on a thread should still get the toast — that's the whole point of a
 * notification. */
async function hasFocusedWindow() {
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return wins.some(c => c.visibilityState === "visible" && c.focused);
}

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "TRAQS";
  const threadKey = payload.data?.threadKey;
  const options = {
    body: payload.body || "",
    // Icon is theme-chosen by the server (white logo on dark, dark on light);
    // fall back to the default logo if absent.
    icon: payload.icon || "/notif-icon.png",
    badge: payload.badge || payload.icon || "/notif-icon.png",
    data: payload.data || {},
    // Collapse repeat pushes for the same thread into a single toast.
    tag: threadKey || payload.data?.type || undefined,
    renotify: true,
  };
  event.waitUntil((async () => {
    // Don't interrupt someone with a message they're already looking at.
    // Requires ALL of: same thread, a focused visible window, and a recent
    // heartbeat — a stale key from a tab closed mid-thread must not silence
    // real notifications, so it expires.
    const fresh = Date.now() - activeThreadAt < 60_000;
    if (threadKey && activeThreadKey === threadKey && fresh && await hasFocusedWindow()) return;
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer an already-open TRAQS tab.
      const existing = all.find((c) => "focus" in c);
      if (existing) {
        await existing.focus();
        existing.postMessage({ source: "traqs-push", data });
        return;
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow("/");
      }
    })()
  );
});
