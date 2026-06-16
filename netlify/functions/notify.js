import { requireOrgMember } from "./_utils/auth.js";
import { readJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { sendWebPush } from "./_utils/webpush.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;

  // Membership required: previously any authenticated user could send a
  // push notification scoped to any org code, so an attacker could spam
  // pushes into a target org's devices.
  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

  const s3Key = `orgs/${member.orgCode}/people.json`;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return err(400, "Invalid JSON"); }

  const { type, jobTitle, panelTitle, stepLabel, jobTeamIds = [], newTeamIds = [], jobNumber, clientName, requestedByName, approvedByName } = body;
  if (!type) return err(400, "Missing type");

  // Bound user-supplied strings/arrays before they're reflected into push
  // payloads sent to every targeted device (anti-abuse / notification spam).
  for (const [k, v] of Object.entries({ jobTitle, panelTitle, stepLabel, jobNumber, clientName, requestedByName, approvedByName })) {
    if (typeof v === "string" && v.length > 300) return err(400, `${k} too long`);
  }
  if ((Array.isArray(jobTeamIds) && jobTeamIds.length > 1000) || (Array.isArray(newTeamIds) && newTeamIds.length > 1000)) {
    return err(400, "Too many recipients");
  }

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
    const approver = approvedByName || "Someone";
    heading = `🔧 ${stepLabel} Approved`;
    content = panelTitle
      ? `${approver} approved ${stepLabel} on ${panelTitle} — ${jobTitle || jobLabel}.`
      : `${approver} approved ${stepLabel} on ${jobTitle || jobLabel}.`;
  } else if (type === "ready") {
    const approver = approvedByName || "Someone";
    heading = `✅ Ready to Build: ${jobTitle || jobLabel}`;
    content = `${approver} signed off the final step — ${panelTitle} on ${jobTitle || jobLabel} is ready to build.`;
  } else if (type === "finish_request") {
    heading = `🏁 Finish Request: ${jobLabel}`;
    content = `${requestedByName || "Someone"} has requested to mark "${jobTitle}" as finished. Tap to approve or decline.`;
  } else {
    return err(400, "Unknown notification type");
  }

  // Web push → desktop browsers (works whether or not a tab is open).
  // Independent of OneSignal config so desktop notifications work even when
  // OneSignal isn't set up (e.g. local dev).
  const webResult = await sendWebPush(member.orgCode, targetIds, {
    title: heading,
    body: content,
    data: { kind: "event", type, jobNumber: jobNumber || null },
  }).catch(() => ({ sent: 0 }));

  // OneSignal → native iOS/Android. Skip cleanly when not configured.
  let oneSignalId = null;
  let osSent = 0;
  if (appId && apiKey) {
    const registeredIds = people
      .filter(p => p.pushToken && targetIds.includes(String(p.id)))
      .map(p => String(p.id));
    if (registeredIds.length > 0) {
      const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${apiKey}`,
        },
        body: JSON.stringify({
          app_id: appId,
          include_external_user_ids: registeredIds,
          channel_for_external_user_ids: "push",
          headings: { en: heading },
          contents: { en: content },
          data: { type, jobTitle, panelTitle, stepLabel, jobNumber },
        }),
      });
      const osBody = await osRes.json().catch(() => ({}));
      if (!osRes.ok) {
        console.error("OneSignal error:", osBody);
      } else {
        oneSignalId = osBody.id;
        osSent = registeredIds.length;
      }
    }
  }

  return json(200, { sent: osSent + (webResult?.sent || 0), web: webResult?.sent || 0, oneSignalId });
}
