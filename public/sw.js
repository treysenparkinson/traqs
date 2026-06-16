/* TRAQS service worker — Web Push receiver for desktop browser notifications.
 * Registered from src/push.js. Shows a native OS toast on `push`, and on
 * `notificationclick` focuses an open TRAQS window (forwarding the payload so
 * the app can open the relevant thread/job) or opens a new one. */

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "TRAQS";
  const options = {
    body: payload.body || "",
    icon: "/notif-icon.png",
    badge: "/notif-icon.png",
    data: payload.data || {},
    // Collapse repeat pushes for the same thread into a single toast.
    tag: payload.data?.threadKey || payload.data?.type || undefined,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
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
