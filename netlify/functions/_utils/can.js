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
};

export function can(member, key) {
  if (!member?.isAdmin) return false;
  const perms = member.adminPerms;
  if (perms == null) return true;          // unrestricted admin
  return perms[key] === true;
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
