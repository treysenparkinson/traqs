// Scheduled sweep for forgotten clock-outs.
//
// Scheduled via netlify.toml `[functions."forgot-clockout"] schedule = "0 5 * * *"`.
// For every org, find people whose pay shift (person.activeClockIn) has been
// open for more than 12 hours and hasn't already been flagged. Push a reminder
// to the worker and an alert to the org's admins, then stamp
// activeClockIn.forgotNotifiedAt so we notify exactly once. This never
// auto-closes a shift — an admin corrects it manually.
//
// Plain scheduled handler modeled on backup-daily.js: exported `handler`
// returning { statusCode, body }, no exported config, no @netlify/functions.
import { readJson, writeJson, listOrgCodes } from "./_utils/s3.js";
import { filterLive } from "./_utils/entities.js";
import { sendVisiblePush } from "./_utils/push.js";
import { publishChange } from "./_utils/ably-publish.js";
import { stampArray, nowIso } from "./_utils/timestamps.js";

const STALE_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function handler() {
  const startedAt = Date.now();
  const now = Date.now();
  let orgsChecked = 0;
  let flagged = 0;
  let orgsWithErrors = 0;

  let codes = [];
  try {
    codes = await listOrgCodes();
  } catch (e) {
    console.error("forgot-clockout: failed to list orgs", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to list orgs" }) };
  }

  for (const orgCode of codes) {
    try {
      const peopleKey = `orgs/${orgCode}/people.json`;
      const [rawPeople, config] = await Promise.all([
        readJson(peopleKey).then(v => v ?? []),
        readJson(`orgs/${orgCode}/config.json`).then(v => v ?? null),
      ]);
      const people = filterLive(rawPeople) || [];
      orgsChecked++;

      // Admin recipients: union of userRole === "admin" and anyone whose email
      // matches config.adminEmail / config.adminEmails[]. Exclude nobody.
      const adminEmails = new Set();
      if (config?.adminEmail) adminEmails.add(String(config.adminEmail).toLowerCase().trim());
      for (const e of config?.adminEmails || []) adminEmails.add(String(e || "").toLowerCase().trim());
      adminEmails.delete("");
      const adminIds = people
        .filter(p => p.userRole === "admin" || (p.email && adminEmails.has(String(p.email).toLowerCase().trim())))
        .map(p => String(p.id));

      // Stale open shifts not yet flagged.
      const stale = people.filter(p => {
        const ac = p.activeClockIn;
        if (!ac || !ac.clockIn || ac.forgotNotifiedAt) return false;
        const t = new Date(ac.clockIn).getTime();
        if (Number.isNaN(t)) return false;
        return (now - t) > STALE_MS;
      });
      if (stale.length === 0) continue;

      // Notify each stale worker + the admins (best-effort, never throws).
      for (const worker of stale) {
        const wid = String(worker.id);
        await sendVisiblePush(orgCode, rawPeople, [wid], {
          heading: "You didn't clock out",
          content: "You didn't clock out — please review your time.",
          data: { type: "forgot-clockout", personId: wid },
          label: "forgot-clockout",
        }).catch(() => {});
        if (adminIds.length > 0) {
          await sendVisiblePush(orgCode, rawPeople, adminIds, {
            heading: `${worker.name || "Someone"} didn't clock out`,
            content: `${worker.name || "A team member"} didn't clock out — needs manual correction.`,
            data: { type: "forgot-clockout-admin", personId: wid },
            label: "forgot-clockout-admin",
          }).catch(() => {});
        }
      }

      // Stamp forgotNotifiedAt on the raw array (preserving tombstones) so the
      // same shift is never re-notified, then write + broadcast via the standard
      // stamped-write + publishChange('people') pattern.
      const staleIds = new Set(stale.map(p => String(p.id)));
      const stamp = nowIso();
      const next = rawPeople.map(p => {
        if (p && staleIds.has(String(p.id)) && p.activeClockIn) {
          return { ...p, activeClockIn: { ...p.activeClockIn, forgotNotifiedAt: stamp } };
        }
        return p;
      });
      await writeJson(peopleKey, stampArray(next, rawPeople));
      await publishChange(orgCode, "people", { ids: [...staleIds] });
      flagged += stale.length;
    } catch (e) {
      orgsWithErrors++;
      console.error(`forgot-clockout: org ${orgCode} failed`, e);
    }
  }

  const summary = { orgsChecked, flagged, orgsWithErrors, elapsedMs: Date.now() - startedAt };
  console.log("forgot-clockout complete:", summary);
  return { statusCode: 200, body: JSON.stringify(summary) };
}
