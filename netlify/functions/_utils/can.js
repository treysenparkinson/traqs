// Server-side permission checks.
//
// The web UI has always had `can(perm)`; the server had nothing, so every
// granular permission stopped at the browser. A restricted admin kept full
// power through iOS or a direct API call. This module is the server's copy of
// that check, and it is deliberately the SAME rule the web uses:
//
//     can(member, key) === isAdmin && (adminPerms == null || adminPerms[key] === true)
//
// `adminPerms == null` means unrestricted — legacy admins created before the
// toggles existed, and the bootstrap admin from config.adminEmail who may have
// no person record to carry perms. See requireOrgMember for where that is set.

import { AuthError } from "./auth.js";

/** The eight toggles shown on the settings page. lockJobs was removed — it had
 *  no UI on any surface and no call sites, so the toggle was retired rather
 *  than left as a switch that gated nothing. */
export const PERM_KEYS = [
  "editJobs",
  "moveJobs",
  "reassign",
  "manageTeam",
  "manageClients",
  "undoHistory",
  "orgSettings",
  "approveCompletions",
  "approveTimeOff",
  "manageTimeclock",
  "confirmTimesheet",
];

/** Plain-English names, used in the 403 bodies so a rejection says which
 *  toggle is missing rather than just "forbidden". */
const PERM_LABEL = {
  editJobs:      "create, edit & delete jobs",
  moveJobs:      "move & resize jobs",
  reassign:      "reassign operations to team members",
  manageTeam:    "add, edit & remove team members",
  manageClients: "add, edit & delete clients",
  undoHistory:   "undo schedule history changes",
  orgSettings:   "access organization settings",
  approveCompletions: "approve & decline job completion requests",
  approveTimeOff:     "approve & deny time-off requests",
  manageTimeclock:    "correct the time clock — clock people in and out, edit punches and breaks",
  confirmTimesheet:   "confirm & re-open timesheets",
};

// EMPTIED 2026-10-12 (#295), which is what this set was always for.
//
// It held keys added AFTER granular permissions shipped: the powers they gated
// were previously ungated, so a record written before them carried no entry and
// had to be granted anyway — ABSENT meant GRANTED. Its own comment said to
// empty it "once every live record carries the keys", and nobody ever did, so
// `approveCompletions` and `approveTimeOff` were DECORATIVE for their whole
// life: the UI showed them off, the server granted them.
//
// THE REASON IT COULD NEVER EMPTY ITSELF was `togglePerm` on the web, which
// wrote ONE key onto whatever object was there. A record missing a key never
// gained it unless that exact toggle was touched. It backfills the whole map
// now, promotion writes every key explicitly rather than `{}`, and all six live
// admin records were backfilled by scripts/backfill-admin-perms.mjs — so the
// three ways a record could lack a key are all closed.
//
// KEEP IT EMPTY. A new key that needs a grace period is a migration, not a
// permanent exemption: add it here, backfill, remove it in the same release.
// Two keys sat here for months because that last step has no deadline.
const GRANTED_WHEN_ABSENT = new Set([]);

export function can(member, key) {
  if (!member?.isAdmin) return false;
  const perms = member.adminPerms;
  if (perms == null) return true;          // unrestricted admin
  if (GRANTED_WHEN_ABSENT.has(key)) return perms[key] !== false;
  return perms[key] === true;
}

/** The same check against a raw PERSON record from people.json (`userRole` +
 *  `adminPerms`) rather than a membership from requireOrgMember.
 *
 *  Use it whenever an approval item picks its AUDIENCE. Every one of those
 *  audiences used to be `p.userRole === "admin"`, which silently ignored the
 *  toggles: an admin with approveCompletions switched off was still pushed
 *  every completion request and still added to the "Completion Requests" group,
 *  so the switch turned off their buttons and nothing else. The audience for an
 *  approval item is the admins who hold that toggle. */
export function personCan(person, key) {
  return can({ isAdmin: person?.userRole === "admin", adminPerms: person?.adminPerms }, key);
}

/** The 403 message for a missing toggle, for callers that RETURN rather than
 *  throw. Same words as requirePerm so a rejection reads the same wherever it
 *  comes from — the five timeclock sites answer with err(403, …). */
export function permDenied(key) {
  return `Your account does not have permission to ${PERM_LABEL[key] || key}`;
}

/** Throws a 403 carrying the toggle's plain-English name. */
export function requirePerm(member, key) {
  if (can(member, key)) return;
  const what = PERM_LABEL[key] || key;
  if (!member?.isAdmin) {
    throw new AuthError(403, `Admins only — you do not have permission to ${what}`);
  }
  throw new AuthError(403, `Your account does not have permission to ${what}`);
}

/** Sign-off / approval. Mirrors the web's `canApprove`: admins, anyone with
 *  sign-off access, and engineers. NOT gated on editJobs — approving work is a
 *  separate grant a non-admin can hold. */
export function canApprove(member) {
  return !!(member?.isAdmin || member?.canSignOff || member?.isEngineer);
}

/** Engineering steps (designed / verified / sent to Perforex). */
export function canEngineer(member) {
  return !!(member?.isAdmin || member?.isEngineer);
}

/** Clock-in access. Clock-OUT is deliberately never blocked: revoking access
 *  while someone is on the clock must not strand them mid-shift. */
export function canClockIn(member) {
  return member?.canClockInOut !== false;
}
