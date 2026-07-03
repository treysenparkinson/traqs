// Shared OneSignal push helpers — VISIBLE (lock-screen) and SILENT (background
// sync) — for the v5 user model.
//
// Targeting: OneSignal v5 sets an `external_id` alias per user via
// OneSignal.login(personId) on the client, so we target
//   include_aliases: { external_id: [...personIds] }, target_channel: "push"
// The legacy include_external_user_ids field is deprecated and silently resolves
// zero recipients on new apps (that was the Phase-4 push bug).
//
// Both helpers are BEST-EFFORT: env-gated (no-op when ONESIGNAL_* is unset, e.g.
// local dev), and they never throw — a push failure must never fail the S3 write
// that triggered it. Failures are logged with a status + body so a targeting /
// auth problem is visible in the function logs (the old messages.js path
// swallowed everything).
//
// Recipients are always filtered to people who actually registered a device
// (person.pushToken, written by the iOS client on login). Targeting a person
// with no subscription is a harmless no-op on OneSignal's side, but filtering
// keeps the payload small and avoids an all-unsubscribed "no recipients" error.
//
// NOTE ON THE FILE NAME: the Phase-5 brief asked for `silent-push.js`. Visible
// pushes needed the exact same v5-alias + auth + error-handling plumbing (and
// notify.js/messages.js/timeoff.js each had their own copy), so both live here
// in one `push.js` module instead of a silent-only file.

import { readJson } from "./s3.js";
import { filterLive } from "./entities.js";

const OS_URL = "https://onesignal.com/api/v1/notifications";

function creds() {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  return appId && apiKey ? { appId, apiKey } : null;
}

// Keep only ids that belong to a person with a registered push subscription.
function registeredIdsFrom(people, personIds) {
  const want = new Set((personIds || []).map(String));
  const out = new Set();
  for (const p of people || []) {
    if (p && p.pushToken && want.has(String(p.id))) out.add(String(p.id));
  }
  return [...out];
}

async function postOneSignal(appId, apiKey, body, label) {
  try {
    const res = await fetch(OS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${apiKey}` },
      body: JSON.stringify({ app_id: appId, ...body }),
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`OneSignal error (${label}):`, res.status, parsed);
    return res.ok ? parsed : null;
  } catch (e) {
    console.error(`OneSignal request failed (${label}):`, e?.message || e);
    return null;
  }
}

/**
 * VISIBLE push (lock-screen alert) to `personIds`, filtered to registered
 * devices. `content_available` is also set so the app wakes to background-sync
 * (deltaSync) before the user even taps — the data is fresh when they open it.
 *
 * `data` becomes the notification's additionalData, read by the iOS click
 * handler for deep-linking (keys: jobNumber / threadKey / requestId).
 *
 * (Only `content_available` is sent — despite the brief mentioning
 * `ios_content_available`, that is not a real OneSignal field; `content_available`
 * IS the documented iOS silent/background flag.)
 */
export async function sendVisiblePush(orgCode, people, personIds, { heading, content, data = {}, label = "visible" }) {
  const c = creds();
  if (!c) return;
  const ids = registeredIdsFrom(people, personIds);
  if (ids.length === 0) return;
  await postOneSignal(c.appId, c.apiKey, {
    include_aliases: { external_id: ids },
    target_channel: "push",
    headings: { en: heading },
    contents: { en: content },
    data,
    content_available: true,
  }, label);
}

/**
 * SILENT push (no alert / sound / badge) that wakes the iOS app in the
 * background to run deltaSync so SwiftData is fresh by the time the user opens
 * the app. Carries `{ type: "sync", entity, serverTime }` so the client knows
 * this is a sync trigger and not a user-facing event.
 *
 * Resolves recipients from `orgs/<orgCode>/people.json` unless a `people` array
 * (and/or explicit `personIds`) is supplied — that lets callers that already
 * loaded people avoid a second S3 read. `excludePersonId` drops the actor whose
 * write triggered this (their originating device already applied the change).
 */
export async function sendSilentPush(orgCode, { entity = "tasks", serverTime, people, personIds, excludePersonId } = {}) {
  const c = creds();
  if (!c) return;

  let roster = people;
  if (!Array.isArray(roster)) {
    try { roster = filterLive((await readJson(`orgs/${orgCode}/people.json`)) || []); }
    catch { roster = []; }
  }
  const targetIds = Array.isArray(personIds)
    ? personIds
    : roster.map((p) => p && p.id).filter((v) => v != null);

  let ids = registeredIdsFrom(roster, targetIds);
  if (excludePersonId != null) ids = ids.filter((id) => id !== String(excludePersonId));
  if (ids.length === 0) return;

  await postOneSignal(c.appId, c.apiKey, {
    include_aliases: { external_id: ids },
    target_channel: "push",
    // Data-only: content_available wakes the app for a background fetch; no
    // headings/contents means nothing is shown on the lock screen.
    content_available: true,
    data: { type: "sync", entity, serverTime: serverTime || new Date().toISOString() },
  }, `silent:${entity}`);
}
