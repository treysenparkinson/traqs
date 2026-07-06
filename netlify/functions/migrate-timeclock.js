// Admin-gated, one-time HTTP trigger for the timeclock → payhours/productionhours
// migration. POST only, requires org admin, and refuses to run without an
// explicit ?confirm=1 so it can never fire by accident. Never auto-runs.
import { requireOrgMember } from "./_utils/auth.js";
import { preflight, json, err } from "./_utils/cors.js";
import { migrateTimeclock } from "./_utils/migrate-timeclock.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
  if (!member.isAdmin) return err(403, "Admin only");

  if (event.queryStringParameters?.confirm !== "1") {
    return err(400, "Refusing to migrate without confirmation. Re-send POST with ?confirm=1 to run the one-time timeclock → payhours/productionhours migration for this org.");
  }

  try {
    const result = await migrateTimeclock(member.orgCode);
    return json(200, result);
  } catch (e) {
    console.error("migrate-timeclock error:", e);
    return err(500, e.message || "Migration failed");
  }
}
