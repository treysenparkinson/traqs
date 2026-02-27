import { validateToken } from "./_utils/auth.js";
import { readJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

function getOrgKey(event, file) {
  const orgCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!orgCode || !/^[a-zA-Z0-9]{3,20}$/.test(orgCode)) return null;
  return `orgs/${orgCode}/${file}`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!appId || !apiKey) return err(500, "OneSignal not configured");

  // Auth check
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return err(401, "Unauthorized");
  try { await validateToken(token); } catch { return err(401, "Invalid token"); }

  const s3Key = getOrgKey(event, "people.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return err(400, "Invalid JSON"); }

  const { type, jobTitle, panelTitle, stepLabel, jobTeamIds = [], jobNumber } = body;
  if (!type) return err(400, "Missing type");

  // Load people to get push tokens
  let people = [];
  try { people = await readJson(s3Key) || []; } catch { people = []; }

  // Collect external_user_ids for job team + all admins
  const adminIds = people.filter(p => p.userRole === "admin").map(p => String(p.id));
  const teamIds  = (jobTeamIds || []).map(id => String(id));
  const targetIds = [...new Set([...adminIds, ...teamIds])];

  // Only notify people who have registered a push token (externalUserId set)
  const registeredIds = people
    .filter(p => p.pushToken && targetIds.includes(String(p.id)))
    .map(p => String(p.id));

  if (registeredIds.length === 0) return json(200, { sent: 0, message: "No registered devices" });

  // Build notification content
  const jobLabel = jobNumber ? `Job #${jobNumber}` : jobTitle;
  let heading, content;

  if (type === "step") {
    heading = `🔧 Engineering: ${stepLabel} Complete`;
    content = `${panelTitle} on ${jobLabel} has been signed off — ${stepLabel} done.`;
  } else if (type === "ready") {
    heading = `✅ Ready to Build: ${panelTitle}`;
    content = `All engineering steps complete for ${panelTitle} on ${jobLabel}. Shop can start!`;
  } else {
    return err(400, "Unknown notification type");
  }

  // Send via OneSignal REST API
  const osPayload = {
    app_id: appId,
    include_external_user_ids: registeredIds,
    channel_for_external_user_ids: "push",
    headings: { en: heading },
    contents: { en: content },
    data: { type, jobTitle, panelTitle, stepLabel, jobNumber },
  };

  const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify(osPayload),
  });

  const osBody = await osRes.json();
  if (!osRes.ok) {
    console.error("OneSignal error:", osBody);
    return err(502, osBody.errors?.[0] || "OneSignal send failed");
  }

  return json(200, { sent: registeredIds.length, oneSignalId: osBody.id });
}
