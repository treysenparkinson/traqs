import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

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

    const config = {
      name,
      domain: domain.toLowerCase().replace(/^@/, ""),
      adminEmail,
      createdAt: new Date().toISOString(),
    };

    try {
      await Promise.all([
        writeJson(configKey, config),
        writeJson(`orgs/${code}/tasks.json`, []),
        writeJson(`orgs/${code}/people.json`, []),
        writeJson(`orgs/${code}/clients.json`, []),
      ]);
      return json(200, { ok: true, code });
    } catch (e) {
      console.error("org POST error:", e);
      return err(500, "Failed to create organization");
    }
  }

  return err(405, "Method not allowed");
}
