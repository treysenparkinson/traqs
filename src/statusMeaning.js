// #504 — WHAT A STATUS MEANS LIVES ON THE LIST ENTRY, NOT IN ITS SPELLING.
//
// Ruled 2026-10-13 (Trey): "add the flag. 73 comparisons breaking on a rename is worse than a
// schema addition." `statusOpts` is the ORG's list, editable in Settings, and two of its names
// carried meaning by spelling alone:
//
//   finished   credit no more hours to it, roll progress to 100%, setting it needs
//              approveCompletions, an approval writes it
//   active     what a job clock-in stamps on the op, its panel and its job
//
// Renaming "Finished" to "Complete" — one edit, no warning — silently stopped all of it.
//
// THE FLAGS: an entry may carry `isFinished: true` / `isActive: true`. For each flag
// separately, a list where NO entry carries it reads that meaning from the name ("finished",
// "in progress", normalised) — every org's list today — so nothing moves until the list is
// saved. The options editor loads the rows through `withMeanings`, so the flags are ON the row
// objects the admin edits: a rename carries the meaning with the row, and the next save
// persists it. (Several entries may be finished — Matrix carries "Finished" AND "finished";
// the name WRITTEN is the first.)
//
// This is not #440's "closed" (isClosedStatus, E-STRICT): closed is what the health dot treats
// as nothing-late, a wider and separately-ruled set. Finished is the narrower, load-bearing one.
//
// TWO FORMS. The explicit form takes the org's list and is the only one server code may use —
// one server process serves many orgs. The page-level form reads a list the web page sets once
// for its one org (`setOrgStatuses`), for module-scope code that has no list to hand.

import { normalizeStatus } from "./statusText.js";

const DEFAULT_FINISHED = "Finished";
const DEFAULT_ACTIVE = "In Progress";
const byName = { isFinished: normalizeStatus(DEFAULT_FINISHED), isActive: normalizeStatus(DEFAULT_ACTIVE) };

const list = (opts) => (Array.isArray(opts) ? opts.filter(o => o && typeof o === "object") : []);
const nameOf = (o) => String(o?.name ?? "");

/** The list with both flags attached: kept where any entry carries one, read from the name where none does. */
export function withMeanings(opts) {
  const l = list(opts);
  const has = (flag) => l.some(o => o[flag] === true);
  const fin = has("isFinished"), act = has("isActive");
  return l.map(o => ({
    ...o,
    isFinished: fin ? o.isFinished === true : normalizeStatus(nameOf(o)) === byName.isFinished,
    isActive: act ? o.isActive === true : normalizeStatus(nameOf(o)) === byName.isActive,
  }));
}

const means = (flag) => (status, opts) => {
  const s = normalizeStatus(status);
  const l = withMeanings(opts);
  const hit = l.filter(o => normalizeStatus(nameOf(o)) === s);
  if (hit.length) return hit.some(o => o[flag]);
  // Not in the list (or no list): the name decides, as everything did before the flag.
  return s === byName[flag];
};

/** Whether `status` means finished, under the org's list `opts` (null → by name). */
export const isFinishedStatus = means("isFinished");
/** Whether `status` means in progress, under the org's list `opts` (null → by name). */
export const isActiveStatus = means("isActive");

const nameFor = (flag, fallback) => (opts) => withMeanings(opts).find(o => o[flag])?.name || fallback;
/** The status an approval writes: the org's first finished entry, else "Finished". */
export const finishedStatusName = nameFor("isFinished", DEFAULT_FINISHED);
/** The status a clock-in writes: the org's first active entry, else "In Progress". */
export const activeStatusName = nameFor("isActive", DEFAULT_ACTIVE);

// ── Page-level forms (WEB ONLY — the page serves one org) ──────────────────────
let orgStatuses = null;
/** Called by the page whenever the org's list changes. Null clears it (meaning by name). */
export function setOrgStatuses(opts) { orgStatuses = list(opts).length ? withMeanings(opts) : null; }
export const isFinished = (status) => isFinishedStatus(status, orgStatuses);
export const isActive = (status) => isActiveStatus(status, orgStatuses);
export const FINISHED = () => finishedStatusName(orgStatuses);
export const ACTIVE = () => activeStatusName(orgStatuses);
