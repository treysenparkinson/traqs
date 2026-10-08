// WHAT A COPIED NODE INHERITS, AND WHAT IT STARTS CLEAN (#466, #468).
//
// Three paths copy a node — duplicate a job, split an op, save and load a
// template — and before this file no two of them agreed. Measured on Matrix's
// live board at the time of writing: `loggedHours` (31 ops) was dropped by
// duplicate and split and CARRIED by template; `finishRequests` (14 ops) was
// dropped by duplicate and CARRIED by split and template; `moveLog` (34 ops)
// was CARRIED by duplicate and dropped by split; `finishedAt` was carried by
// all three. Not one field was handled the same way by all three, because there
// was no single answer anywhere to the question, so each path invented one.
//
// THE AXIS. Anything that records what HAPPENED to the original stays behind.
// Anything that describes the WORK ITSELF comes along. A third axis turned up
// in the measurement and is not reducible to either: ENGAGEMENT IDENTITY — the
// job number, the PO, the promised date — which neither records work nor
// describes it, but identifies the commercial engagement. Two jobs sharing a PO
// number is a billing problem, not a scheduling one.
//
// `notes` IS THE PLACE THE AXIS CANNOT BE READ OFF THE FIELD NAME. The name says
// description; the content is a log. 62 of 65 live jobs carry one and they read
// "PB. Status: Crated. Contact Riley. 100%. CFAT. Change order request" and
// "Still waiting for equipment." So a job's notes are a record and a duplicate
// must not inherit them — while a TEMPLATE's notes are a procedure somebody
// wrote down on purpose, and a template that forgets them is useless. The field
// is named for one thing and used for another, which is exactly why this rule
// cannot be derived from names and has to be written down. IF SOMEONE LATER ADDS
// A REAL DESCRIPTION FIELD, `notes` SHOULD MOVE and `TEMPLATE_KEEPS` should empty.

/**
 * Fields that record what happened to the original. Dropped by every copy path,
 * except that a template keeps `TEMPLATE_KEEPS`.
 *
 * `actHours` and `apprActivity` are here because they are what the org's
 * `acthours` and `activity` custom columns actually write — see
 * `recordColumnKeys`, which resolves them from settings rather than trusting
 * this list to stay complete.
 */
export const WORK_RECORD = [
  // hours produced
  "loggedHours", "actualHours", "actHours",
  // the finish handshake, both the deprecated singular pointer and the list
  "finishRequest", "finishRequests", "pendingFinish", "pendingSession", "finishedAt",
  // evidence and approvals. `attachments` is here because every one on the live
  // board is a dated progress photo (402006-01_2026-07-16.jpg, with uploadedAt
  // and uploadedByName) — evidence of work, not a specification. A spec PDF
  // would be indistinguishable, so the rule is "evidence of work", not "files".
  "attachments", "signOffs", "engineering", "apprChain", "apprComments", "apprLog", "apprActivity",
  // history and scheduling scratch
  "moveLog", "placedSubs", "splitFrom", "isReschedule", "scheduledLater",
  // the running log that is named like a description
  "notes",
  // lifecycle: a copy of a deleted thing is not deleted
  "deletedAt",
];

/** Identifies the engagement, not the work. A copy starts without one. */
export const ENGAGEMENT_IDENTITY = ["jobNumber", "poNumber", "dueDate"];

/**
 * When and by whom, as opposed to what. A template drops all of these.
 * `startHour` and `endHour` are here because leaving them while clearing `start`
 * and `end` strands an hour of day with no date — 241 live ops carry a
 * `startHour`, and a template built from one used to carry a value nothing could
 * use.
 */
export const SCHEDULE_FIELDS = ["start", "end", "startHour", "endHour", "team", "status", "qty"];

/** The one WORK_RECORD field a template keeps. See the header. */
export const TEMPLATE_KEEPS = ["notes"];

/**
 * Custom-column types whose VALUES are a record of work rather than a
 * description of it.
 *
 * TYPE IS A PROXY FOR INTENT AND IT IS NOT A PERFECT ONE. The org's "Comments"
 * column is `type: "text"` and holds "Rittal next Wednesday, 7th" — a record
 * wearing a descriptive name, which this gets wrong and will keep getting wrong
 * for any column somebody uses as a log. The correct answer is a per-column
 * "copies?" flag set by whoever defines the column, because only they know what
 * it is for. That is a settings surface for a problem nobody has hit yet, so
 * type is the answer for now and the flag is logged as the real one (#466).
 */
export const RECORD_COLUMN_TYPES = ["acthours", "activity"];

/**
 * The stored keys of every custom column whose type makes it a work record.
 *
 * Resolved the way the app resolves them — `fieldKey || "_cc_" + id` — because
 * a custom column does not necessarily store under a `_cc_` key. On Matrix the
 * `acthours` column writes to `actHours` and the `activity` column to
 * `apprActivity`, both plain field names; assuming the `_cc_` prefix would have
 * missed both. This is also why the lists above cannot be the whole answer: the
 * org adds columns whenever it likes, and a hardcoded list is stale that day.
 */
export function recordColumnKeys(settings) {
  return (settings?.customCols || [])
    .filter((c) => c && RECORD_COLUMN_TYPES.includes(String(c.type)))
    .map((c) => c.fieldKey || `_cc_${c.id}`);
}

/** Drop `keys` from `node`, returning the same object when nothing matched. */
function without(node, keys) {
  let out = node;
  for (const k of keys) {
    if (out === node) { if (!(k in node)) continue; out = { ...node }; }
    delete out[k];
  }
  return out;
}

/**
 * A node starting a NEW JOB: no history, no engagement identity.
 *
 * Does not touch ids, status, deps or structure — `duplicateJob` owns those,
 * because remapping deps needs the whole subtree and this works on one node.
 */
export function copyForDuplicate(node, { settings } = {}) {
  return without(node, [...WORK_RECORD, ...ENGAGEMENT_IDENTITY, ...recordColumnKeys(settings)]);
}

/**
 * The new half of a SPLIT op: the same work continuing, in the same job.
 *
 * So it keeps the engagement — a split does not create a new job — and it KEEPS
 * `deps`. The old code cleared them, which threw away predecessor constraints
 * that still hold: if the op depended on something before the split, the half
 * that continues it still does. That is a bug this rule exposes rather than a
 * case it fails to cover.
 */
export function copyForSplit(node, { settings } = {}) {
  return without(node, [...WORK_RECORD, ...recordColumnKeys(settings)]);
}

/**
 * An op as a TEMPLATE stores it: no history except the procedure in `notes`, no
 * engagement, no schedule.
 */
export function copyForTemplate(node, { settings } = {}) {
  const drop = [...WORK_RECORD, ...ENGAGEMENT_IDENTITY, ...SCHEDULE_FIELDS, ...recordColumnKeys(settings)]
    .filter((k) => !TEMPLATE_KEEPS.includes(k));
  return without(node, drop);
}

/**
 * What the Save-template modal stores for one op, including its sub-ops.
 * Titles lose a trailing "-001" so a template is not named after one instance.
 */
export function templateOpFromNode(op, { settings } = {}) {
  const out = copyForTemplate(op, { settings });
  const title = String(op.title || "").replace(/-\d+$/, "").trimEnd();
  const subs = (op.subs || []).map((s) => templateOpFromNode(s, { settings }));
  return { ...out, title, ...(op.subs ? { subs } : {}) };
}

/**
 * The ops a template load adds to a job: fresh ids throughout, DEPS REMAPPED
 * ONTO THEM, status reset, schedule blank.
 *
 * The remap is the fix. Both `loadTemplate`s used to mint fresh ids and then
 * write `deps: o.deps || []` verbatim, so every dependency still pointed at the
 * template's own op ids — ids that are not on this board at all.
 *
 * Returns the new ids as well, so the caller can flash them as new.
 */
export function nodesFromTemplate(tplOps, { uid, nextIndex = 0 }) {
  const idMap = new Map();
  const assign = (n) => { if (n?.id != null) idMap.set(String(n.id), uid()); (n?.subs || []).forEach(assign); };
  (tplOps || []).forEach(assign);

  const newIds = [];
  const build = (o, i, top) => {
    const id = o?.id != null ? idMap.get(String(o.id)) : uid();
    newIds.push(id);
    const out = {
      ...o,
      id,
      // The "Op-00n" fallback is for TOP-LEVEL ops only; a sub-op with no title
      // would otherwise be named as though it were one.
      title: o.title || (top ? "Op-" + String(nextIndex + i + 1).padStart(3, "0") : ""),
      team: o.team || [],
      status: "Not Started",
      start: "",
      end: "",
      notes: o.notes || "",
      deps: (o.deps || []).map((d) => idMap.get(String(d)) ?? d),
    };
    if (o.subs) out.subs = o.subs.map((s, j) => build(s, j, false));
    return out;
  };
  return { ops: (tplOps || []).map((o, i) => build(o, i, true)), newIds };
}
