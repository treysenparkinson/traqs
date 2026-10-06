// What an UNAUTHENTICATED caller may see of a person (#385).
//
// `GET /people` stays open so the kiosk can draw its team-select roster before
// anyone signs in. It used to drop `pin`, `pushToken` and `timeOff` and return
// everything else — a DENY-LIST, which fails OPEN: every field added to a person
// record from then on was public until somebody remembered to deny it.
//
// Measured on MTX2026TRAQS with nothing but the org code, 18 live people and 21
// populated fields: email on all 18, `cap` and `role` on 18, canClockInOut 17,
// isEngineer 16, payType 10, noAutoSchedule 10, canSignOff 9, ADMINPERMS ON 4,
// phone 3, image 2. `adminPerms` tells an anonymous caller which four accounts
// are worth attacking.
//
// AND IT WAS NOT A FIELD THAT ARRIVED LATER. `adminPerms`, `canSignOff`,
// `isEngineer` and `noAutoSchedule` all date from the initial commit
// (2026-02-26) and `payType` from 2026-03-20 — every one of them was already in
// the records when the deny-list was written on 2026-06-15, and it denied three
// fields and let the rest through. That is worse than the usual story about a
// deny-list going stale, and it is the better argument for this shape: the
// author had them in front of them and still shipped them, because a deny-list
// asks "what must I hide?" when the only safe question is "what may I show?"
//
// SO THIS IS AN EXPLICIT PICK. A field added to a person record is private until
// someone adds it here on purpose.
//
// WHAT THE KIOSK READS, traced before anything was cut:
//   - the roster screen (App.jsx:1244-1300) reads id, name, color, department
//     and userRole, and derives a status pill from activeClockIn
//   - THE PIN-PAD CLOCK-IN FLOW READS NOTHING FROM THIS ENDPOINT. It POSTs
//     { action: "identify", pin } to /timeclock and gets { name, personId,
//     activeClockIn } back, then { action, personId, pin } to clock. The PIN is
//     verified server-side and never travels in a roster.
//
// `status` was in the first draft of this list and is deliberately NOT here: no
// live record carries it, so it contributed one undefined key and nothing else,
// and `clockStatus` below is the real answer to the question it was standing in
// for. If a person-level status is ever wanted it gets added here on purpose —
// which is exactly what an allow-list makes safe to do later.
export const PUBLIC_PERSON_FIELDS = ["id", "name", "color", "department", "userRole"];

/**
 * The roster's status pill, computed HERE instead of shipping the clock record.
 *
 * This is the kiosk's own `getStatus` (App.jsx:1250) moved server-side: same four
 * values, same precedence. What it replaces is `activeClockIn`, which carried the
 * session's start time, its whole event log and — through activeJobClock — which
 * job someone is on. The pill needed one word of that.
 *
 * @returns {"offline"|"online"|"lunch"|"break"}
 */
export function clockStatusOf(person) {
  const ci = person?.activeClockIn;
  if (!ci) return "offline";
  const events = Array.isArray(ci.events) ? ci.events : [];
  const lastLunch = [...events].reverse().find(e => e?.type === "lunchStart" || e?.type === "lunchEnd");
  if (lastLunch?.type === "lunchStart") return "lunch";
  const lastBreak = [...events].reverse().find(e => e?.type === "breakStart" || e?.type === "breakEnd");
  if (lastBreak?.type === "breakStart") return "break";
  return "online";
}

/** One person, reduced to the public projection. */
export function publicPerson(person) {
  const out = {};
  for (const f of PUBLIC_PERSON_FIELDS) {
    // Picked by key, not by truthiness: a person with no department still has the
    // key, so the shape does not change from row to row.
    out[f] = person?.[f];
  }
  out.clockStatus = clockStatusOf(person);
  return out;
}
