// Scheduled sweep for forgotten clock-outs.
//
// Scheduled via netlify.toml `[functions."forgot-clockout"] schedule = "*/15 * * * *"`.
// Two passes per org, each notifying exactly once per shift/session:
//   • Pay shifts (person.activeClockIn) open > 12h — stamped with
//     activeClockIn.forgotNotifiedAt.
//   • Job clocks (person.activeJobClock) still running past the shop's end of
//     day (see _utils/after-hours.js) — tracked in jobclock-alerts.json.
// Pushes go to the worker and the org's admins. Neither pass ever auto-closes
// anything — an admin corrects it manually.
//
// Plain scheduled handler modeled on backup-daily.js: exported `handler`
// returning { statusCode, body }, no exported config, no @netlify/functions.
import { readJson, writeJson, listOrgCodes } from "./_utils/s3.js";
import { filterLive } from "./_utils/entities.js";
import { sendVisiblePush } from "./_utils/push.js";
import { publishChange } from "./_utils/ably-publish.js";
import { stampArray, nowIso } from "./_utils/timestamps.js";
import { afterHoursAlertAt } from "./_utils/after-hours.js";

const STALE_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function handler() {
  const startedAt = Date.now();
  const now = Date.now();
  let orgsChecked = 0;
  let flagged = 0;
  let jobFlagged = 0;
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
      if (stale.length > 0) {
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
      }

      // ── Job clocks running past end of day ─────────────────────────────
      // Push once per session to the worker and the admins. Never closes or
      // caps the session: people do work late on purpose, and if they forgot,
      // an admin walks the hours back with Set Worked Hours.
      //
      // "Already notified" lives in its own file, NOT on person.activeJobClock:
      // the web app rewrites activeJobClock whole from its local copy (drain
      // checkpoints, freezes), which would silently drop a flag stamped here
      // and re-send the push every 15 minutes. Keyed personId -> clockIn, so a
      // new session for the same person is a new key.
      const alertsKey = `orgs/${orgCode}/jobclock-alerts.json`;
      const running = people.filter(p => p.activeJobClock?.clockIn);
      if (running.length > 0) {
        const [settings, prevAlerts] = await Promise.all([
          readJson(`orgs/${orgCode}/settings.json`).then(v => v ?? {}).catch(() => ({})),
          readJson(alertsKey).then(v => (v && typeof v === "object" ? v : {})).catch(() => ({})),
        ]);
        const hoursCfg = { workEnd: settings.workEnd, timeZone: settings.timeZone || null };
        const alerts = {};
        let alertsChanged = false;
        for (const worker of running) {
          const wid = String(worker.id);
          const jc = worker.activeJobClock;
          if (prevAlerts[wid] === jc.clockIn) { alerts[wid] = jc.clockIn; continue; }
          const alertAt = afterHoursAlertAt(jc.clockIn, hoursCfg);
          if (alertAt == null || now < alertAt) continue;
          const what = [jc.opTitle, jc.panelTitle || jc.jobTitle].filter(Boolean).join(" · ") || "a job";
          const first = (worker.name || "").split(" ")[0] || "Someone";
          await sendVisiblePush(orgCode, rawPeople, [wid], {
            heading: "Still clocked into a job",
            content: `You're still clocked into ${what}. If you're done, clock out.`,
            data: { type: "jobclock-after-hours", personId: wid },
            label: "jobclock-after-hours",
          }).catch(() => {});
          const otherAdmins = adminIds.filter(id => id !== wid);
          if (otherAdmins.length > 0) {
            await sendVisiblePush(orgCode, rawPeople, otherAdmins, {
              heading: `${first} is still clocked in after hours`,
              content: `${worker.name || "A team member"} is still clocked into ${what}. If they forgot, correct it with Set Worked Hours.`,
              data: { type: "jobclock-after-hours-admin", personId: wid },
              label: "jobclock-after-hours-admin",
            }).catch(() => {});
          }
          alerts[wid] = jc.clockIn;
          alertsChanged = true;
          jobFlagged++;
        }
        // Entries for sessions that have since ended are dropped by rebuilding
        // from `running`; write only when the set actually changed.
        if (alertsChanged || Object.keys(prevAlerts).length !== Object.keys(alerts).length) {
          await writeJson(alertsKey, alerts);
        }
      }
      // No else-branch cleanup: a leftover entry is harmless (keyed by clockIn, so
      // it can never match a later session) and is pruned on the next run where
      // anyone is clocked in — cheaper than an extra S3 read per org every 15 min.
    } catch (e) {
      orgsWithErrors++;
      console.error(`forgot-clockout: org ${orgCode} failed`, e);
    }
  }

  const summary = { orgsChecked, flagged, jobFlagged, orgsWithErrors, elapsedMs: Date.now() - startedAt };
  console.log("forgot-clockout complete:", summary);
  return { statusCode: 200, body: JSON.stringify(summary) };
}
