// #125 — THE TIER LINE, CHECKED ON THE SERVER. Behind TIER_RULES_MODE (rule-mode.js),
// which defaults to `log`: the write goes through exactly as before and the server
// records, under the `tier-rule` tag in rule-events.json, what it WOULD have refused.
// Ruled 2026-10-16 (Trey): "build TIER_RULES_MODE in log mode only … I'd rather see
// what it catches before it refuses anything."
//
// THE TIER IS READ HERE, NEVER FROM THE CLIENT. billing.json's `tier`, and an org with
// no billing.json is Basic (org.js documents why absence means never provisioned).
// The browser seeds its own tier from localStorage before the real value arrives, so
// anything the client says about its tier is exactly what this exists not to trust.
//
// ONLY WHAT A SERVER CAN TELL APART (TIERS.md, "#125 — tier enforcement, rescoped"):
//   - THE JOB LAYER: a job that is a panel job (`jobType: "panel"`) or carries the
//     job → panel → op nesting (any sub with subs of its own). Basic's client writes
//     shifts as `jobType: "general"` with one level of subs, so neither shape can come
//     from it. Checked on the jobs a write CHANGES, so a Basic org holding old
//     Business-shaped data is not reported on every save of something else.
//   - THE JOB CLOCK: four actions whose name alone identifies the feature.
// Not here, by construction: automatic scheduling (the client's help, not a payload)
// and the view guard (navigation over data the org already owns).
import { readJson } from "./s3.js";

export const BUSINESS = "business";

/** The org's tier from billing.json. Absent, unreadable or unrecognised → "basic". */
export async function orgTier(orgCode) {
  let billing = null;
  try { billing = await readJson(`orgs/${orgCode}/billing.json`); } catch { billing = null; }
  return billing?.tier === BUSINESS ? BUSINESS : "basic";
}

// The canonical comparison for "did this write change that job": the record without
// its server stamp. Keys sorted so two clients that order fields differently agree.
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) if (k !== "lastModifiedAt") o[k] = canon(v[k]);
    return o;
  }
  return v;
};

/** Why `job` is job-layer work, or null when it is a shape Basic produces. */
export function jobLayerReason(job) {
  if (!job || typeof job !== "object") return null;
  if (job.jobType === "panel") return "panel-job";
  if ((job.subs || []).some(s => Array.isArray(s?.subs) && s.subs.length > 0)) return "nested-ops";
  return null;
}

/**
 * Jobs in `incoming` that a Basic org could not have written: new, or changed from
 * `existing`, AND job-layer shaped. Deletions and tombstones are never reported —
 * removing Business data is not using the Business feature.
 * @returns [{ jobId, reason, isNew }]
 */
export function jobLayerViolations(incoming, existing) {
  const prev = new Map();
  for (const r of Array.isArray(existing) ? existing : []) if (r && r.id != null) prev.set(String(r.id), r);
  const out = [];
  for (const job of Array.isArray(incoming) ? incoming : []) {
    if (!job || job.id == null || job.deletedAt) continue;
    const reason = jobLayerReason(job);
    if (!reason) continue;
    const was = prev.get(String(job.id));
    if (was && JSON.stringify(canon(was)) === JSON.stringify(canon(job))) continue;
    out.push({ jobId: String(job.id), reason, isNew: !was });
  }
  return out;
}

// The job clock's four actions. Only CLOCK-IN is refusable: the other three end or
// correct a session already running, and refusing them would strand a worker on the
// clock — the same reason canClockIn never blocks a clock-out (can.js).
export const JOB_CLOCK_ACTIONS = new Set(["jobClockIn", "jobClockOut", "updateJobSession", "releaseJobSession"]);
export const JOB_CLOCK_REFUSABLE = new Set(["jobClockIn"]);
