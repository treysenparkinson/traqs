import { readJson, writeJson, copyPrefix } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { requireOrgMember } from "./_utils/auth.js";
import { nowIso, stampObject } from "./_utils/timestamps.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendSilentPush } from "./_utils/push.js";

function isValidCode(code) {
  return typeof code === "string" && /^[a-zA-Z0-9]{3,20}$/.test(code);
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  // GET — public lookup of org config by code.
  // Returns ONLY the fields the unauthenticated login screen needs (name,
  // domain, optional SSO connection). adminEmail / adminEmails / createdAt
  // used to be returned here, which leaked PII to anyone who walked the
  // 3–20 char code space. Authenticated callers (App.jsx after Auth0
  // login, the iOS app) should call `/org-config` instead — that endpoint
  // is gated behind org membership and returns the full config plus
  // server-derived isAdmin/isMember booleans.
  if (event.httpMethod === "GET") {
    const code = event.queryStringParameters?.code;
    if (!isValidCode(code)) return err(400, "Missing or invalid org code");
    try {
      const config = await readJson(`orgs/${code}/config.json`);
      if (!config) return err(404, "Organization not found");
      return json(200, {
        name: config.name,
        domain: config.domain,
        ...(config.connection ? { connection: config.connection } : {}),
      });
    } catch (e) {
      console.error("org GET error:", e);
      return err(500, "Failed to read org config");
    }
  }

  // POST — create a new org. Gated behind SIGNUPS_ENABLED env var because
  // open registration without auth/captcha/rate-limit lets anyone seed
  // unlimited S3 prefixes, which is a cost and DoS vector. Flip the env
  // var in Netlify when you want to onboard a new org, then flip it back
  // off afterwards. The UI button is also disabled in App.jsx, so this is
  // belt-and-suspenders for the API surface itself.
  if (event.httpMethod === "POST") {
    if (process.env.SIGNUPS_ENABLED !== "true") {
      return err(403, "Organization signups are currently disabled. Contact your TRAQS administrator.");
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return err(400, "Invalid JSON body");
    }

    const { code, name, domain, adminEmail } = body ?? {};
    if (!isValidCode(code)) return err(400, "Invalid org code — must be 3–20 alphanumeric characters");
    if (!name || !domain || !adminEmail) return err(400, "Missing required fields: name, domain, adminEmail");
    // Cap the free-form fields so the gate isn't a path to write giant
    // blobs to S3 even if SIGNUPS_ENABLED is left on.
    if (String(name).length > 80) return err(400, "Organization name too long (max 80 chars)");
    if (String(domain).length > 80) return err(400, "Domain too long (max 80 chars)");
    if (String(adminEmail).length > 200 || !adminEmail.includes("@")) return err(400, "Invalid adminEmail");

    const configKey = `orgs/${code}/config.json`;
    try {
      const existing = await readJson(configKey);
      if (existing) return err(409, "Organization code already taken");
    } catch {
      // If readJson throws (unexpected), fall through to creation attempt
    }

    const cleanDomain = domain.toLowerCase().replace(/^@/, "");
    const config = {
      name,
      domain: cleanDomain,
      adminEmail,
      createdAt: new Date().toISOString(),
      // Brand-new object → seed its delta-sync stamp now so the first /sync
      // after creation sees a lastModifiedAt (rather than treating a fresh
      // config as un-timestamped legacy data).
      lastModifiedAt: nowIso(),
    };

    // Seed the org creator as the first admin person
    const adminName = adminEmail.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const seedPeople = [{
      id: 1,
      name: adminName,
      email: adminEmail.toLowerCase(),
      role: "Admin",
      userRole: "admin",
      cap: 8,
      color: "#6366f1",
      timeOff: [],
      // Stamp the seed admin like the config above — without this the record
      // has no lastModifiedAt, so /sync's changedSince treats it as always-new
      // and re-sends the admin in every delta pull for the life of the org.
      lastModifiedAt: nowIso(),
    }];

    try {
      await Promise.all([
        writeJson(configKey, config),
        writeJson(`orgs/${code}/tasks.json`, []),
        writeJson(`orgs/${code}/people.json`, seedPeople),
        writeJson(`orgs/${code}/clients.json`, []),
      ]);
      await publishChange(code, "orgConfig", { ids: ["*"] });
      await sendSilentPush(code, { entity: "orgConfig" });
      return json(200, { ok: true, code });
    } catch (e) {
      console.error("org POST error:", e);
      return err(500, "Failed to create organization");
    }
  }

  // PATCH — rename org code / display name. Org-member required; if it's a
  // code rename (which migrates all S3 data), admin is also required —
  // a non-admin shouldn't be able to relocate the org's S3 prefix.
  if (event.httpMethod === "PATCH") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    const currentCode = member.orgCode;

    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON body"); }

    const { newCode, newName } = body ?? {};

    // ── Update the display name only (no S3 prefix migration) ──
    if (newName && !newCode) {
      if (!member.isAdmin) return err(403, "Admin only");
      const trimmed = String(newName).trim();
      if (!trimmed) return err(400, "Name cannot be empty");
      if (trimmed.length > 80) return err(400, "Name too long (max 80 chars)");
      const configKey = `orgs/${currentCode}/config.json`;
      try {
        const existing = await readJson(configKey);
        if (!existing) return err(404, "Organization not found");
        // Stamp against the prior config so lastModifiedAt only advances when
        // the name actually changed (a no-op rename keeps the old stamp and
        // won't re-broadcast the org config to every syncing client).
        const stamped = stampObject({ ...existing, name: trimmed }, existing);
        await writeJson(configKey, stamped);
        await publishChange(currentCode, "orgConfig", { ids: ["*"] });
        await sendSilentPush(currentCode, { entity: "orgConfig" });
        return json(200, { ok: true, config: stamped });
      } catch (e) {
        console.error("org PATCH name error:", e);
        return err(500, "Failed to update organization name");
      }
    }

    // ── Rename the org code (existing path; optionally also update name) ──
    if (!member.isAdmin) return err(403, "Admin only");
    if (!isValidCode(newCode)) return err(400, "Invalid new code — must be 3–20 alphanumeric characters");
    if (newCode.toUpperCase() === currentCode.toUpperCase()) return err(400, "New code is the same as current code");

    try {
      const taken = await readJson(`orgs/${newCode}/config.json`);
      if (taken) return err(409, "That org code is already taken");
    } catch {}

    try {
      await copyPrefix(`orgs/${currentCode}/`, `orgs/${newCode}/`);
      if (newName) {
        const newConfigKey = `orgs/${newCode}/config.json`;
        const cfg = await readJson(newConfigKey);
        // Stamp the post-rename name update against the copied config so the
        // migrated config's lastModifiedAt advances only if the name changed.
        if (cfg) await writeJson(newConfigKey, stampObject({ ...cfg, name: String(newName).trim() }, cfg));
      }
      // Config now lives under the new code; signal there. Clients reconnect to
      // the new org channel in a later phase, so this is a no-op until then.
      await publishChange(newCode, "orgConfig", { ids: ["*"] });
      await sendSilentPush(newCode, { entity: "orgConfig" });
      return json(200, { ok: true, newCode });
    } catch (e) {
      console.error("org PATCH error:", e);
      return err(500, "Failed to rename organization");
    }
  }

  return err(405, "Method not allowed");
}
