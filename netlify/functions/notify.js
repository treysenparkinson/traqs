import { requireOrgMember } from "./_utils/auth.js";
import { readJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  // Graceful no-op when push isn't configured (e.g. local dev). Returning 500
  // here floods the browser console even though callNotify catches it; making
  // it a 200 with sent:0 keeps the console clean without changing behavior.
  if (!appId || !apiKey) return json(200, { sent: 0, message: "OneSignal not configured" });

  // Membership required: previously any authenticated user could send a
  // push notification scoped to any org code, so an attacker could spam
  // pushes into a target org's devices.
  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

  const s3Key = `orgs/${member.orgCode}/people.json`;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return err(400, "Invalid JSON"); }

  const { type, jobTitle, panelTitle, stepLabel, jobTeamIds = [], newTeamIds = [], jobNumber, clientName, requestedByName } = body;
  if (!type) return err(400, "Missing type");

  // Load people to get push tokens
  let people = [];
  try { people = await readJson(s3Key) || []; } catch { people = []; }

  const adminIds = people.filter(p => p.userRole === "admin").map(p => String(p.id));
  const teamIds  = (jobTeamIds || []).map(id => String(id));

  // Determine who to target based on notification type
  let targetIds;
  if (type === "new_job") {
    // Notify all admins + everyone on the job team
    targetIds = [...new Set([...adminIds, ...teamIds])];
  } else if (type === "assigned") {
    // Notify only the newly added team members (+ admins)
    const newIds = (newTeamIds || []).map(id => String(id));
    targetIds = [...new Set([...adminIds, ...newIds])];
  } else if (type === "finish_request") {
    // Admins only — they need to approve/decline
    targetIds = [...adminIds];
  } else {
    // step / ready — admins + full team
    targetIds = [...new Set([...adminIds, ...teamIds])];
  }

  // Only notify people who have registered a push token
  const registeredIds = people
    .filter(p => p.pushToken && targetIds.includes(String(p.id)))
    .map(p => String(p.id));

  if (registeredIds.length === 0) return json(200, { sent: 0, message: "No registered devices" });

  // Build notification content
  const jobLabel = jobNumber ? `Job #${jobNumber}` : jobTitle;
  let heading, content;

  if (type === "new_job") {
    heading = `📋 New Job: ${jobLabel}`;
    content = clientName
      ? `A new job for ${clientName} has been created.`
      : `A new job has been added to TRAQS.`;
  } else if (type === "assigned") {
    heading = `👷 You've Been Assigned`;
    content = `You've been added to ${jobLabel}.`;
  } else if (type === "step") {
    heading = `🔧 Engineering: ${stepLabel} Complete`;
    content = `${panelTitle} on ${jobLabel} has been signed off — ${stepLabel} done.`;
  } else if (type === "ready") {
    heading = `✅ Ready to Build: ${panelTitle}`;
    content = `All engineering steps complete for ${panelTitle} on ${jobLabel}. Shop can start!`;
  } else if (type === "finish_request") {
    heading = `🏁 Finish Request: ${jobLabel}`;
    content = `${requestedByName || "Someone"} has requested to mark "${jobTitle}" as finished. Tap to approve or decline.`;
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
