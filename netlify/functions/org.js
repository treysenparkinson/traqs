import { readJson, writeJson, copyPrefix } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { requireOrgMember } from "./_utils/auth.js";
import { requirePerm } from "./_utils/can.js";
import { nowIso, stampObject } from "./_utils/timestamps.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendSilentPush } from "./_utils/push.js";
import { isValidOrgCode, generateOrgCode } from "./_utils/orgcode.js";

// isValidCode was a third copy of the org-code rule. It now comes from
// _utils/orgcode.js, which accepts both the legacy alphanumeric shape and the
// generated PREFIX.XXXX.XXXX one.
const isValidCode = isValidOrgCode;

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

    // THE CODE IS GENERATED HERE, NOT CHOSEN BY THE CALLER. Any `code` in the
    // body is ignored — accepting one lets a caller squat a prefix, pick a code
    // that impersonates another org, or probe which codes already exist by
    // watching for 409s.
    const { name, domain, adminEmail } = body ?? {};
    if (!name || !domain || !adminEmail) return err(400, "Missing required fields: name, domain, adminEmail");
    // Cap the free-form fields so the gate isn't a path to write giant
    // blobs to S3 even if SIGNUPS_ENABLED is left on.
    if (String(name).length > 80) return err(400, "Organization name too long (max 80 chars)");
    if (String(domain).length > 80) return err(400, "Domain too long (max 80 chars)");
    if (String(adminEmail).length > 200 || !adminEmail.includes("@")) return err(400, "Invalid adminEmail");

    // Generate, checking for collision. The random half is 31^8 wide per prefix,
    // so a clash is remote — but "remote" is not "impossible", and silently
    // writing into an existing org's prefix would hand a stranger its data. A
    // bounded retry, then refuse: never fall through to a create on an unknown
    // read failure, which is what the previous try/catch did.
    let code = null, configKey = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = generateOrgCode(name);
      const key = `orgs/${candidate}/config.json`;
      let existing;
      try {
        existing = await readJson(key);
      } catch (e) {
        console.error("org POST: collision check failed for", candidate, e);
        return err(503, "Could not verify organization code availability. Try again.");
      }
      if (!existing) { code = candidate; configKey = key; break; }
    }
    if (!code) return err(503, "Could not allocate an organization code. Try again.");

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
      try { requirePerm(member, "orgSettings"); } catch (e) { return err(e.statusCode, e.message); }
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

    // ── Rename the org code — DISABLED ──────────────────────────────────
    //
    // This path calls copyPrefix(), which copies objects verbatim. Attachment
    // keys are stored INSIDE the data — messages.json and tasks.json hold full
    // `orgs/{code}/attachments/...` strings, 25+ in messages.json alone on the
    // live bucket — and copyPrefix does not rewrite them. After a rename every
    // one of those still points at the old prefix.
    //
    // THE FAILURE IS DEFERRED, which is why this is disabled rather than left
    // with a warning. attachment.js GET validates only the key's SHAPE, with no
    // ownership check (the key is a documented unguessable bearer). So the stale
    // keys keep resolving while the old prefix exists and nothing looks wrong.
    // They break when the old prefix is deleted — a week later, by which point
    // nobody connects the two events.
    //
    // A rename run today therefore appears to succeed and silently arms a
    // failure for next week. Re-enabled in step 3 of ORG_ONBOARDING.md, once the
    // embedded references are rewritten AND every referenced key is verified to
    // resolve before success is reported. "The copy succeeded" is not proof.
    //
    // The Settings control is hidden too, but this is the guarantee: the API is
    // reachable without the UI.
    return err(503, "Changing the organization code is temporarily unavailable. It is being reworked so that attachments survive the change.");

    // eslint-disable-next-line no-unreachable
    try { requirePerm(member, "orgSettings"); } catch (e) { return err(e.statusCode, e.message); }
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
