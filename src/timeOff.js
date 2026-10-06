// The one rule for whether a person.timeOff entry takes someone off the schedule.
//
// person.timeOff is meant to hold approved leave only: timeoff.js writes an entry on
// approve and removes it on cancel/undo, and manual entries come from an admin. But the
// entries are plain objects that travel through roster saves, so nothing in the shape
// stops a denied or cancelled one from arriving — and every guard used to test the date
// range alone, so such an entry would have blocked work. An entry carrying a status
// counts only when that status is "approved"; one without a status (manual entries, and
// every entry written before statuses existed) counts as it always has.
//
// Every schedule guard reads leave through here: schedulerAvailability, refuseDragMove,
// and TRAQS.jsx's isOff/getOffReason, conflict check, overload check and export.

export const countsAsLeave = (entry) => !!entry && (entry.status == null || entry.status === "approved");

export const leaveEntries = (timeOff) => (Array.isArray(timeOff) ? timeOff.filter(countsAsLeave) : []);

/** The first entry that counts as leave and covers any day of [start, end], or null. */
export const leaveOn = (timeOff, start, end = start) =>
  leaveEntries(timeOff).find(t => t.start <= end && t.end >= start) || null;
