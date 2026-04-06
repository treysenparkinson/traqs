import { readJson, writeJson, copyPrefix } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { validateToken } from "./_utils/auth.js";

function isValidCode(code) {
  return typeof code === "string" && /^[a-zA-Z0-9]{3,20}$/.test(code);
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  // GET — public lookup of org config by code
  if (event.httpMethod === "GET") {
    const code = event.queryStringParameters?.code;
    if (!isValidCode(code)) return err(400, "Missing or invalid org code");
    try {
      const config = await readJson(`orgs/${code}/config.json`);
      if (!config) return err(404, "Organization not found");
      return json(200, config);
    } catch (e) {
      console.error("org GET error:", e);
      return err(500, "Failed to read org config");
    }
  }

  // POST — create a new org (no auth required — registration is open)
  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return err(400, "Invalid JSON body");
    }

    const { code, name, domain, adminEmail } = body ?? {};
    if (!isValidCode(code)) return err(400, "Invalid org code — must be 3–20 alphanumeric characters");
    if (!name || !domain || !adminEmail) return err(400, "Missing required fields: name, domain, adminEmail");

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
    }];

    try {
      await Promise.all([
        writeJson(configKey, config),
        writeJson(`orgs/${code}/tasks.json`, []),
        writeJson(`orgs/${code}/people.json`, seedPeople),
        writeJson(`orgs/${code}/clients.json`, []),
      ]);
      return json(200, { ok: true, code });
    } catch (e) {
      console.error("org POST error:", e);
      return err(500, "Failed to create organization");
    }
  }

  // PATCH — rename org code (admin only, migrates all S3 data)
  if (event.httpMethod === "PATCH") {
    try { await validateToken(event); } catch (e) { return err(401, e.message); }

    const currentCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"];
    if (!isValidCode(currentCode)) return err(400, "Missing or invalid X-Org-Code header");

    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON body"); }

    const { newCode } = body ?? {};
    if (!isValidCode(newCode)) return err(400, "Invalid new code — must be 3–20 alphanumeric characters");
    if (newCode.toUpperCase() === currentCode.toUpperCase()) return err(400, "New code is the same as current code");

    try {
      const taken = await readJson(`orgs/${newCode}/config.json`);
      if (taken) return err(409, "That org code is already taken");
    } catch {}

    try {
      await copyPrefix(`orgs/${currentCode}/`, `orgs/${newCode}/`);
      return json(200, { ok: true, newCode });
    } catch (e) {
      console.error("org PATCH error:", e);
      return err(500, "Failed to rename organization");
    }
  }

  return err(405, "Method not allowed");
}
