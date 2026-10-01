// Durable rule events: the same records logRule writes, kept somewhere readable.
//
// The whole rollout strategy in rule-mode.js is "ship every refusal in `log` first, so the
// logs show what live clients actually trip before anything is turned on." That rested on
// console.warn into the Netlify function log, which cannot be read back after the fact —
// `netlify logs:function` only streams live, and the Netlify API exposes no method for
// function logs at all. So the evidence four env flags were waiting on was never being
// collected (#327). This is where it goes instead.
//
// Design notes, because each one is load-bearing:
//
//   APPEND-ONLY, and through updateJson, so two POSTs landing together cannot lose each
//   other's records — the same read-modify-write with contention retry every other shared
//   file uses.
//
//   NEVER FAILS THE REQUEST. A rule event is diagnostics; a write that throws here must not
//   turn a working save into a 500. Every call is caught and swallowed.
//
//   ONLY ON AN EVENT. The file is written when there is something to record, which on
//   Matrix is roughly 18 writes in two days, so the extra round trip is not on the hot path.
//
//   BOUNDED PER TAG. Append-only forever is a file that eventually cannot be read. It keeps
//   the most recent MAX_PER_TAG of EACH tag and reports what it dropped, per tag, so a
//   truncated history says so rather than looking complete.
//
//   NO BEHAVIOUR CHANGE. Nothing here decides anything. It records what the caller already
//   decided, which is the point: it has to be safe to switch on while the flags stay in log.
import { updateJson } from "./update-json.js";

// ONE file, not one per tag: the reader does a single GET and groups, instead of seven
// fetches that can disagree about which window they cover.
//
// The cap is PER TAG, which is the part that matters. A global cap would let the noisy tags
// starve the valuable ones — hpd-default-write fires on every save from an old iOS build and
// server-owned-field on every clock-out that races an autosave, while task-conflict fires
// maybe eighteen times in two days. One global 5,000 and the rare events are gone by morning,
// which is the same failure as logging to a place nobody can read: the data looks collected
// and the thing you needed is missing.
const MAX_PER_TAG = 1500;
const KEY = (orgCode) => `orgs/${orgCode}/rule-events.json`;

/**
 * Append rule events for one org.
 *
 * Every record gets the same base — tag, timestamp, mode, refused, caller — and whatever the
 * rule's own decision turned on. `refused` is what the server ACTUALLY did, not what the mode
 * is called, so a record always says whether the write went through.
 *
 * @param orgCode  the org whose file to write
 * @param events   [{ tag, mode, refused, ...ruleSpecific }]
 * @param who      { personId, isAdmin, email } — so a pattern can be traced to one client
 */
export async function recordRuleEvents(orgCode, events, who = {}) {
  if (!orgCode || !Array.isArray(events) || !events.length) return;
  const at = new Date().toISOString();
  const rows = events
    .filter((e) => e && e.tag)
    .map((e) => ({
      at,
      tag: e.tag,
      mode: e.mode ?? null,
      refused: e.refused === true,
      by: who.personId ?? null,
      isAdmin: !!who.isAdmin,
      email: who.email ?? null,
      ...e,
    }));
  if (!rows.length) return;
  try {
    await updateJson(KEY(orgCode), (stored) => {
      const prev = Array.isArray(stored) ? stored : (stored && Array.isArray(stored.records) ? stored.records : []);
      const droppedPrev = (stored && !Array.isArray(stored) && stored.dropped && typeof stored.dropped === "object") ? stored.dropped : {};
      const next = [...prev, ...rows];
      // Trim per tag, oldest first, preserving the overall chronological order of what's left.
      const counts = new Map();
      for (const r of next) counts.set(r.tag, (counts.get(r.tag) || 0) + 1);
      const dropped = { ...droppedPrev };
      const over = new Map();
      for (const [tag, n] of counts) if (n > MAX_PER_TAG) over.set(tag, n - MAX_PER_TAG);
      if (!over.size) return { value: { dropped, records: next } };
      const keep = [];
      for (const r of next) {
        const o = over.get(r.tag) || 0;
        if (o > 0) { over.set(r.tag, o - 1); dropped[r.tag] = (dropped[r.tag] || 0) + 1; continue; }
        keep.push(r);
      }
      return { value: { dropped, records: keep } };
    });
  } catch { /* diagnostics must never fail the write they describe */ }
}

/**
 * Every field that differs between two nodes and their whole subtrees, as a flat list.
 *
 * The conflict check only ever knew THAT a job differed. Which fields differed is the part
 * that decides whether turning enforce on would refuse something legitimate — a job whose
 * `status` reverts is a clobber, one whose `start` reverts might be a person moving a bar —
 * and without it the record is no better than the count we already could not get.
 *
 * `omit` skips the fields that differ on every write and mean nothing (the stamps).
 */
export function diffFields(a, b, omit = new Set(["lastModifiedAt", "updatedAt"])) {
  const out = [];
  const walk = (x, y, level, path) => {
    if (!x || !y || typeof x !== "object" || typeof y !== "object") return;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)].filter((k) => k !== "subs" && !omit.has(k)));
    for (const k of keys) {
      let xs, ys;
      try { xs = JSON.stringify(x[k]); ys = JSON.stringify(y[k]); } catch { continue; }
      if (xs === ys) continue;
      out.push({
        id: String(x.id ?? y.id ?? path), level, field: k,
        incoming: clip(xs), stored: clip(ys),
      });
    }
    const xa = Array.isArray(x.subs) ? x.subs : [], ya = Array.isArray(y.subs) ? y.subs : [];
    const yById = new Map(ya.filter((n) => n && n.id != null).map((n) => [String(n.id), n]));
    const sub = level === "job" ? "panel" : "op";
    for (const n of xa) {
      if (!n || n.id == null) continue;
      const m = yById.get(String(n.id));
      if (m) walk(n, m, sub, path + "/" + n.id);
      else out.push({ id: String(n.id), level: sub, field: "(added)", incoming: null, stored: null });
    }
    const xIds = new Set(xa.filter((n) => n && n.id != null).map((n) => String(n.id)));
    for (const n of ya) if (n && n.id != null && !xIds.has(String(n.id)))
      out.push({ id: String(n.id), level: sub, field: "(removed)", incoming: null, stored: null });
  };
  walk(a, b, "job", String(a?.id ?? ""));
  return out;
}

// Values go in so a reader can see WHAT reverted, not just which key. Clipped because a
// moveLog or a sessionSnapshot would otherwise be most of the file.
function clip(s, max = 160) {
  if (s == null) return null;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export { MAX_PER_TAG };
