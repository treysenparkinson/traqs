import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgCodeFromHeader } from "./_utils/org.js";
import { stampObject } from "./_utils/timestamps.js";
import { mergePrefs, wouldEmptyPrefs } from "./_utils/merge-prefs.js";

// Per-user appearance + personal view preferences (theme, colors, background,
// saved presets, sidebar mode, job-list column layout, status/priority options).
//
// Keyed by the AUTHENTICATED user's email — derived server-side from the token,
// never taken from client input — so a user can only ever read/write their OWN
// settings, and the same account looks + behaves identically on every device.
//
// This is deliberately separate from settings.js (org-wide, admin-gated): those
// are workday/break/payroll settings shared by the whole team. These are personal.

function userSettingsKey(orgCode, email) {
  // Emails are already lowercased/trimmed by the auth layer. Reduce to a safe,
  // stable S3 path segment (no "/" so it can't escape the folder).
  const safe = String(email).toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return `orgs/${orgCode}/user-settings/${safe}.json`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const orgCode = orgCodeFromHeader(event);
  if (!orgCode) return err(400, "Missing or invalid X-Org-Code header");

  // Membership check also gives us the caller's email — the key to their blob.
  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
  const s3Key = userSettingsKey(orgCode, member.email);

  // GET — read the caller's own settings (empty object if they have none yet).
  if (event.httpMethod === "GET") {
    try {
      const data = await readJson(s3Key);
      return json(200, data ?? {});
    } catch (e) {
      console.error("user-settings GET error:", e);
      return err(500, "Failed to read user settings");
    }
  }

  // POST — write the caller's own settings. No admin gate: a user owns their
  // personal appearance/view preferences.
  if (event.httpMethod === "POST") {
    try {
      let settings;
      try { settings = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
        return err(400, "Body must be an object");
      }

      const existing = await readJson(s3Key);

      // MERGED, NOT REPLACED (#441). The body is a PATCH of the keys that
      // changed; anything it does not mention keeps its stored value. Before
      // this, a write from a tab that had been open since the morning rewrote
      // every key with its load-time copy, so toggling a theme silently reverted
      // a column layout set in another tab an hour earlier.
      //
      // A bare full bundle still works unchanged — it is simply a patch that
      // mentions everything — so an older client, and the seeding write of a new
      // account, need no special case.
      const merged = mergePrefs(existing, settings);

      // The guard moved from the request's SHAPE to the write's INTENT, the same
      // way the tasks guard did (#339). "Is the body empty" was a question about
      // the request; under a patch an empty body is a legitimate no-op, and the
      // question worth asking is whether the ACCOUNT ends up with nothing. A
      // merge can only add keys, so this cannot fire — structurally, not by
      // exemption — and it is kept because it is what stands between this
      // endpoint and the 2026-06-03 shape if the semantics ever change back.
      const force = event.queryStringParameters?.force === "1";
      if (!force && wouldEmptyPrefs(merged, existing)) {
        return err(409, "Refusing to overwrite non-empty user settings with empty object");
      }

      await writeJson(s3Key, stampObject(merged, existing));
      return json(200, { ok: true });
    } catch (e) {
      console.error("user-settings POST error:", e);
      return err(500, "Failed to save user settings");
    }
  }

  return err(405, "Method not allowed");
}
