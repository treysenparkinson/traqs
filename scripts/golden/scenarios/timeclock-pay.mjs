// Goldens: the pay clock in timeclock.js — kiosk PIN actions, the iOS pay clock, admin
// corrections, lunch/break events, confirm / re-open timesheet, and the GET.
//
// Clock: the default "now" is 2026-10-14T15:30Z = 09:30 in America/Denver (UTC-6 in October).
// Kiosk actions are sent with no token (auth: null) and the plaintext fixture pins
// ("4321" Ada, "1111" Wendy). The PIN limiter is module state keyed by client IP, so every
// scenario that FAILS a PIN sends its own x-nf-client-connection-ip and they all sit at the end.
import { AUTH, orgSeed, ORG } from "../fixture-org.mjs";

const K = (f) => `orgs/${ORG}/${f}`;
const seedWith = (fn) => () => { const s = orgSeed(); fn(s); return s; };
const personOf = (s, id) => s[K("people.json")].find((p) => String(p.id) === String(id));
const payOf = (s) => s[K("payhours.json")];
const open = (clockIn = "2026-10-14T13:00:00.000Z", extra = {}) => ({ clockIn, jobRefs: [], events: [], source: "kiosk", ...extra });
const ip = (n) => ({ "x-nf-client-connection-ip": `10.0.0.${n}` });

const TC = (body, extra = {}) => ({ fn: "timeclock", method: "POST", body, ...extra });
const GET = (query, extra = {}) => ({ fn: "timeclock", method: "GET", query, ...extra });

// Wendy: a completed, UNconfirmed shift on 10-13 with lunch and break rows inside it.
const wendyShift = (s) => {
  payOf(s).push(
    { id: "tc_c", personId: "7", date: "2026-10-13", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T21:30:00.000Z", hours: 8, jobRefs: [{ jobId: "j1", panelId: "p1", opId: "o2" }], note: "", source: "kiosk", lastModifiedAt: "2026-10-13T21:30:00.000Z" },
    { id: "tce_c1", personId: "7", date: "2026-10-13", eventType: "breakStart", timestamp: "2026-10-13T16:00:00.000Z", lastModifiedAt: "2026-10-13T16:00:00.000Z" },
    { id: "tce_c2", personId: "7", date: "2026-10-13", eventType: "breakEnd", timestamp: "2026-10-13T16:15:00.000Z", lastModifiedAt: "2026-10-13T16:15:00.000Z" },
    { id: "tce_c3", personId: "7", date: "2026-10-13", eventType: "lunchStart", timestamp: "2026-10-13T18:00:00.000Z", lastModifiedAt: "2026-10-13T18:00:00.000Z" },
    { id: "tce_c4", personId: "7", date: "2026-10-13", eventType: "lunchEnd", timestamp: "2026-10-13T18:30:00.000Z", lastModifiedAt: "2026-10-13T18:30:00.000Z" },
  );
};
// Wendy on the clock since 07:00 local, with a persisted lunch row (and cache event) and a break row.
const wendyOpenWithLunch = (s) => {
  personOf(s, "7").activeClockIn = open("2026-10-14T13:00:00.000Z", { events: [{ type: "lunchStart", ts: "2026-10-14T18:00:00.000Z" }] });
  payOf(s).push(
    { id: "tce_o1", personId: "7", date: "2026-10-14", eventType: "lunchStart", timestamp: "2026-10-14T18:00:00.000Z", lastModifiedAt: "2026-10-14T18:00:00.000Z" },
    { id: "tce_o2", personId: "7", date: "2026-10-14", eventType: "breakStart", timestamp: "2026-10-14T16:00:00.000Z", lastModifiedAt: "2026-10-14T16:00:00.000Z" },
  );
};
// Sam: a punch from 17:00 local on 10-13 to 01:30 local on 10-14 — crosses local midnight.
const samOvernight = (s) => {
  payOf(s).push({ id: "tc_night", personId: 99, date: "2026-10-13", clockIn: "2026-10-13T23:00:00.000Z", clockOut: "2026-10-14T07:30:00.000Z", hours: 8.5, jobRefs: [], note: "", source: "kiosk", lastModifiedAt: "2026-10-14T07:30:00.000Z" });
};

const ritaConfirmer = { ...AUTH.rita, adminPerms: { ...AUTH.rita.adminPerms, confirmTimesheet: true } };

export default [
  // ── GET ────────────────────────────────────────────────────
  { name: "timeclock GET as admin: every live payhours row", auth: AUTH.ada, steps: [GET({})] },
  { name: "timeclock GET as worker: only own rows", auth: AUTH.wendy, steps: [GET({})] },
  { name: "timeclock GET ?personId=99 as admin: filtered to Sam", auth: AUTH.ada, steps: [GET({ personId: "99" })] },
  { name: "timeclock GET ?personId=99 as worker: still self-scoped", auth: AUTH.wendy, steps: [GET({ personId: "99" })] },
  { name: "timeclock GET hides tombstoned rows", auth: AUTH.ada,
    seed: seedWith((s) => { payOf(s).push({ id: "tce_dead", personId: "7", date: "2026-10-12", eventType: "breakStart", timestamp: "2026-10-12T16:00:00.000Z", deletedAt: "2026-10-13T00:00:00.000Z", lastModifiedAt: "2026-10-13T00:00:00.000Z" }); }),
    steps: [GET({})] },
  { name: "timeclock GET ?dataset=productionhours as worker: own rows whole, others field-scoped", auth: AUTH.wendy,
    seed: seedWith((s) => { s[K("productionhours.json")].push({ id: "js_sam", personId: 99, jobId: "j1", panelId: "p2", opId: "o4", jobTitle: "Lift Station 4", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T15:00:00.000Z", hours: 2, date: "2026-10-13", source: "kiosk", note: "private", lastModifiedAt: "2026-10-13T15:00:00.000Z" }); }),
    steps: [GET({ dataset: "productionhours" })] },
  { name: "timeclock GET with no token: 401", auth: null, steps: [GET({})] },

  // ── POST basics ────────────────────────────────────────────
  { name: "timeclock POST: invalid JSON, missing action, missing pin, unknown action", auth: null, steps: [
    TC("{not json"),
    TC({ personId: "7" }),
    TC({ action: "clockIn", personId: "7" }),
    TC({ action: "doTheThing", personId: "7", pin: "1111" }),
  ] },

  // ── identify ───────────────────────────────────────────────
  { name: "identify: good pin returns Ada, not clocked in", auth: null, steps: [TC({ action: "identify", pin: "4321" })] },
  { name: "identify: Wendy while on the clock returns her activeClockIn", auth: null,
    seed: seedWith((s) => { personOf(s, "7").activeClockIn = open(); }),
    steps: [TC({ action: "identify", pin: "1111" })] },

  // ── kiosk PIN flow ─────────────────────────────────────────
  { name: "kiosk: Wendy's full day — in, break, lunch, out", auth: null, steps: [
    TC({ action: "clockIn", personId: "7", pin: "1111" }, { now: "2026-10-14T13:00:00.000Z" }),
    TC({ action: "breakStart", personId: "7", pin: "1111" }, { now: "2026-10-14T16:00:00.000Z" }),
    TC({ action: "breakEnd", personId: "7", pin: "1111" }, { now: "2026-10-14T16:15:00.000Z" }),
    TC({ action: "lunchStart", personId: "7", pin: "1111" }, { now: "2026-10-14T18:00:00.000Z" }),
    TC({ action: "lunchEnd", personId: "7", pin: "1111" }, { now: "2026-10-14T18:30:00.000Z" }),
    TC({ action: "clockOut", personId: "7", pin: "1111", note: "done" }, { now: "2026-10-14T21:30:00.000Z" }),
  ] },
  { name: "kiosk: clockIn with source ios-app and jobRefs, then a second clockIn is 409", auth: null, steps: [
    TC({ action: "clockIn", personId: "7", pin: "1111", source: "ios-app", jobRefs: [{ jobId: "j1", panelId: "p1", opId: "o2" }] }),
    TC({ action: "clockIn", personId: "7", pin: "1111" }, { now: "2026-10-14T15:35:00.000Z" }),
  ] },
  { name: "kiosk: salaried Ada cannot clock in", auth: null, steps: [TC({ action: "clockIn", personId: 1, pin: "4321" })] },
  { name: "kiosk: guards when not clocked in / not on lunch / not on break", auth: null, steps: [
    TC({ action: "clockOut", personId: "7", pin: "1111" }),
    TC({ action: "lunchStart", personId: "7", pin: "1111" }),
    TC({ action: "breakStart", personId: "7", pin: "1111" }),
    TC({ action: "clockIn", personId: "7", pin: "1111" }, { now: "2026-10-14T15:31:00.000Z" }),
    TC({ action: "lunchEnd", personId: "7", pin: "1111" }, { now: "2026-10-14T15:32:00.000Z" }),
    TC({ action: "breakEnd", personId: "7", pin: "1111" }, { now: "2026-10-14T15:33:00.000Z" }),
    TC({ action: "lunchStart", personId: "7", pin: "1111" }, { now: "2026-10-14T15:34:00.000Z" }),
    TC({ action: "lunchStart", personId: "7", pin: "1111" }, { now: "2026-10-14T15:35:00.000Z" }),
    TC({ action: "breakStart", personId: "7", pin: "1111" }, { now: "2026-10-14T15:36:00.000Z" }),
    TC({ action: "breakStart", personId: "7", pin: "1111" }, { now: "2026-10-14T15:37:00.000Z" }),
  ] },
  { name: "kiosk: clockOut while still on lunch excludes the open lunch", auth: null,
    seed: seedWith((s) => { personOf(s, "7").activeClockIn = open("2026-10-14T13:00:00.000Z", { events: [{ type: "lunchStart", ts: "2026-10-14T18:00:00.000Z" }] }); }),
    now: "2026-10-14T19:00:00.000Z",
    steps: [TC({ action: "clockOut", personId: "7", pin: "1111" })] },
  { name: "kiosk: clockOut closes an open activeBreak and carries forgotNotifiedAt", auth: null,
    seed: seedWith((s) => {
      const w = personOf(s, "7");
      w.activeClockIn = open("2026-10-14T01:00:00.000Z", { forgotNotifiedAt: "2026-10-14T13:05:00.000Z", jobRefs: [{ jobId: "j1" }] });
      w.activeBreak = { startedAt: "2026-10-14T15:00:00.000Z", durationMinutes: 15 };
    }),
    steps: [TC({ action: "clockOut", personId: "7", pin: "1111" })] },
  { name: "kiosk: canClockInOut=false does not stop a PIN clock-in", auth: null,
    seed: seedWith((s) => { personOf(s, 99).pin = "2222"; }),
    steps: [TC({ action: "clockIn", personId: 99, pin: "2222" })] },
  { name: "kiosk: missing personId and unknown person", auth: null, steps: [
    TC({ action: "clockIn", pin: "1111" }),
    TC({ action: "clockIn", personId: "404", pin: "1111" }),
  ] },
  { name: "kiosk: works on a Basic-tier org", auth: null,
    seed: seedWith((s) => { s[K("billing.json")].tier = "basic"; }),
    steps: [TC({ action: "clockIn", personId: "7", pin: "1111" })] },

  // ── iOS pay clock ──────────────────────────────────────────
  { name: "pay clock: Wendy in (PIN), lunch, out (PIN)", auth: AUTH.wendy, steps: [
    TC({ action: "payClockIn", personId: "7", pin: "1111" }, { now: "2026-10-14T13:00:00.000Z" }),
    TC({ action: "payLunchStart", personId: "7" }, { now: "2026-10-14T18:00:00.000Z" }),
    TC({ action: "payLunchStart", personId: "7" }, { now: "2026-10-14T18:01:00.000Z" }),
    TC({ action: "payLunchEnd", personId: "7" }, { now: "2026-10-14T18:45:00.000Z" }),
    TC({ action: "payLunchEnd", personId: "7" }, { now: "2026-10-14T18:46:00.000Z" }),
    TC({ action: "payClockOut", personId: "7", pin: "1111", note: "ios" }, { now: "2026-10-14T21:45:00.000Z" }),
  ] },
  { name: "pay clock: disabled org refuses clock-in but still allows clock-out", auth: AUTH.wendy,
    seed: seedWith((s) => {
      s[K("settings.json")].iosPayClockEnabled = false;
      personOf(s, "7").activeClockIn = open("2026-10-14T13:00:00.000Z", { source: "ios-app" });
    }),
    steps: [
      TC({ action: "payClockIn", personId: "7", pin: "1111" }),
      TC({ action: "payClockOut", personId: "7", pin: "1111" }),
    ] },
  { name: "pay clock: setting absent counts as disabled", auth: AUTH.wendy,
    seed: seedWith((s) => { delete s[K("settings.json")].iosPayClockEnabled; }),
    steps: [TC({ action: "payClockIn", personId: "7", pin: "1111" })] },
  { name: "pay clock: PIN set but not sent is 400 on both directions", auth: AUTH.wendy,
    steps: [
      TC({ action: "payClockIn", personId: "7" }),
      TC({ action: "payClockIn", personId: "7", pin: "1111" }),
      TC({ action: "payClockOut", personId: "7" }, { now: "2026-10-14T16:30:00.000Z" }),
    ] },
  { name: "pay clock: no PIN set is auto-accepted", auth: AUTH.wendy,
    seed: seedWith((s) => { personOf(s, "7").pin = ""; }),
    steps: [
      TC({ action: "payClockIn", personId: "7" }),
      TC({ action: "payClockOut", personId: "7" }, { now: "2026-10-14T17:00:00.000Z" }),
    ] },
  { name: "pay clock: canClockInOut=false refused on clock-in; clock-out with no shift is 409", auth: AUTH.sam,
    steps: [
      TC({ action: "payClockIn", personId: "99" }),
      TC({ action: "payClockOut", personId: "99" }),
    ] },
  { name: "pay clock: canClockInOut=false worker can close an open shift", auth: AUTH.sam,
    seed: seedWith((s) => { personOf(s, 99).activeClockIn = open("2026-10-14T13:00:00.000Z", { source: "ios-app" }); }),
    steps: [TC({ action: "payClockOut", personId: "99" })] },
  { name: "pay clock: salaried admin refused, worker cannot clock someone else", steps: [
    TC({ action: "payClockIn", personId: "1", pin: "4321" }, { auth: AUTH.ada }),
    TC({ action: "payClockIn", personId: "99" }, { auth: AUTH.wendy }),
    TC({ action: "payLunchStart", personId: "99" }, { auth: AUTH.wendy }),
    TC({ action: "payClockIn" }, { auth: AUTH.wendy }),
  ] },
  { name: "pay clock: admin clocking Wendy in still needs her PIN; clocking her out does not", auth: AUTH.ada, steps: [
    TC({ action: "payClockIn", personId: "7" }),
    TC({ action: "payClockIn", personId: "7", pin: "1111" }),
    TC({ action: "payClockOut", personId: "7" }, { now: "2026-10-14T17:30:00.000Z" }),
  ] },
  { name: "pay clock: not clocked in — clock-out 409, lunch 400", auth: AUTH.wendy, steps: [
    TC({ action: "payClockOut", personId: "7", pin: "1111" }),
    TC({ action: "payLunchStart", personId: "7" }),
    TC({ action: "payLunchEnd", personId: "7" }),
  ] },
  { name: "pay clock: already on the kiosk clock is 409", auth: AUTH.wendy,
    seed: seedWith((s) => { personOf(s, "7").activeClockIn = open(); }),
    steps: [TC({ action: "payClockIn", personId: "7", pin: "1111" })] },
  { name: "pay clock: no token is 401", auth: null, steps: [TC({ action: "payClockIn", personId: "7", pin: "1111" })] },
  { name: "pay clock: works on a Basic-tier org", auth: AUTH.wendy,
    seed: seedWith((s) => { s[K("billing.json")].tier = "basic"; }),
    steps: [TC({ action: "payClockIn", personId: "7", pin: "1111" })] },

  // ── admin clock in / out / lunch / break ───────────────────
  { name: "admin: clock Wendy in at a set time, lunch, break, clock out at a set time", auth: AUTH.ada, now: "2026-10-14T22:00:00.000Z", steps: [
    TC({ action: "adminClockIn", personId: "7", clockInTime: "2026-10-14T13:00:00.000Z" }),
    TC({ action: "adminLunchStart", personId: "7", ts: "2026-10-14T18:00:00.000Z" }),
    TC({ action: "adminLunchStart", personId: "7", ts: "2026-10-14T18:05:00.000Z" }),
    TC({ action: "adminLunchEnd", personId: "7", ts: "2026-10-14T18:30:00.000Z" }),
    TC({ action: "adminBreakStart", personId: "7" }),
    TC({ action: "adminBreakStart", personId: "7" }),
    TC({ action: "adminBreakEnd", personId: "7" }, { now: "2026-10-14T22:10:00.000Z" }),
    TC({ action: "adminClockOut", personId: "7", clockOutTime: "2026-10-14T21:30:00.000Z", note: "admin out" }, { now: "2026-10-14T22:15:00.000Z" }),
  ] },
  { name: "admin: clock in / out guards", auth: AUTH.ada, steps: [
    TC({ action: "adminClockIn" }),
    TC({ action: "adminClockIn", personId: "7", clockInTime: "yesterday" }),
    TC({ action: "adminClockIn", personId: "404" }),
    TC({ action: "adminClockOut", personId: "7" }),
    TC({ action: "adminClockOut", personId: "7", clockOutTime: "1999-01-01T00:00:00.000Z" }),
    TC({ action: "adminLunchEnd", personId: "7" }),
    TC({ action: "adminLunchStart" }),
    TC({ action: "adminClockIn", personId: "7" }),
    TC({ action: "adminClockIn", personId: "7" }),
    TC({ action: "adminLunchEnd", personId: "7" }),
    TC({ action: "adminBreakEnd", personId: "7" }),
    TC({ action: "adminLunchStart", personId: "7", ts: "not a time" }),
  ] },
  { name: "admin: clock-out with no clockOutTime, closing an open activeBreak", auth: AUTH.ada,
    seed: seedWith((s) => {
      const w = personOf(s, "7");
      w.activeClockIn = open("2026-10-14T13:00:00.000Z", { events: [{ type: "lunchStart", ts: "2026-10-14T14:00:00.000Z" }, { type: "lunchEnd", ts: "2026-10-14T14:30:00.000Z" }] });
      w.activeBreak = { startedAt: "2026-10-14T15:20:00.000Z", durationMinutes: 15 };
    }),
    steps: [TC({ action: "adminClockOut", personId: "7" })] },
  { name: "admin: edit an open clock-in, future refused, not clocked in 409", auth: AUTH.ada,
    seed: seedWith((s) => { personOf(s, "7").activeClockIn = open("2026-10-14T14:00:00.000Z"); }),
    steps: [
      TC({ action: "adminEditActiveClockIn", personId: "7", clockIn: "2026-10-14T13:00:00.000Z" }),
      TC({ action: "adminEditActiveClockIn", personId: "7", clockIn: "2026-10-14T16:00:00.000Z" }),
      TC({ action: "adminEditActiveClockIn", personId: "99", clockIn: "2026-10-14T13:00:00.000Z" }),
      TC({ action: "adminEditActiveClockIn", personId: "7" }),
    ] },

  // ── adminEditEntry ─────────────────────────────────────────
  { name: "adminEditEntry: Sam's punch retimed, hours recomputed", auth: AUTH.ada,
    steps: [TC({ action: "adminEditEntry", entryId: "tc_b", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T21:30:00.000Z" })] },
  { name: "adminEditEntry: hours stay net of the lunch rows inside the window", auth: AUTH.ada, seed: seedWith(wendyShift),
    steps: [TC({ action: "adminEditEntry", entryId: "tc_c", clockIn: "2026-10-13T12:30:00.000Z", clockOut: "2026-10-13T22:00:00.000Z" })] },
  { name: "adminEditEntry: confirmed punch is 409; missing, invalid, not found", auth: AUTH.ada, steps: [
    TC({ action: "adminEditEntry", entryId: "tc_a", clockIn: "2026-10-12T12:00:00.000Z", clockOut: "2026-10-12T21:30:00.000Z" }),
    TC({ action: "adminEditEntry", entryId: "tc_b", clockIn: "2026-10-13T13:00:00.000Z" }),
    TC({ action: "adminEditEntry", entryId: "tc_b", clockIn: "garbage", clockOut: "2026-10-13T21:30:00.000Z" }),
    TC({ action: "adminEditEntry", entryId: "tc_zzz", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T21:30:00.000Z" }),
  ] },

  // ── lunch / break row corrections ──────────────────────────
  { name: "adminAddEvent: lunch into Sam's completed shift recomputes hours", auth: AUTH.ada, steps: [
    TC({ action: "adminAddEvent", personId: 99, eventType: "lunchStart", timestamp: "2026-10-13T18:00:00.000Z" }),
    TC({ action: "adminAddEvent", personId: 99, eventType: "lunchEnd", timestamp: "2026-10-13T18:30:00.000Z" }, { now: "2026-10-14T15:31:00.000Z" }),
  ] },
  { name: "adminAddEvent: refusals (confirmed, outside a punch, bad type, missing)", auth: AUTH.ada, steps: [
    TC({ action: "adminAddEvent", personId: "7", eventType: "breakStart", timestamp: "2026-10-12T16:00:00.000Z" }),
    TC({ action: "adminAddEvent", personId: "7", eventType: "lunchStart", timestamp: "2026-10-10T18:00:00.000Z" }),
    TC({ action: "adminAddEvent", personId: "7", eventType: "nap", timestamp: "2026-10-12T16:00:00.000Z" }),
    TC({ action: "adminAddEvent", personId: "7", eventType: "lunchStart" }),
  ] },
  { name: "adminAddEvent: open shift — lunch synced into activeClockIn, break refused", auth: AUTH.ada, now: "2026-10-14T19:00:00.000Z",
    seed: seedWith((s) => { personOf(s, "7").activeClockIn = open("2026-10-14T13:00:00.000Z", { events: [{ type: "breakStart", ts: "2026-10-14T16:00:00.000Z" }, { type: "breakEnd", ts: "2026-10-14T16:15:00.000Z" }] }); }),
    steps: [
      TC({ action: "adminAddEvent", personId: "7", eventType: "lunchStart", timestamp: "2026-10-14T18:00:00.000Z" }),
      TC({ action: "adminAddEvent", personId: "7", eventType: "lunchEnd", timestamp: "2026-10-14T18:30:00.000Z" }, { now: "2026-10-14T19:01:00.000Z" }),
      TC({ action: "adminAddEvent", personId: "7", eventType: "breakStart", timestamp: "2026-10-14T17:00:00.000Z" }),
      TC({ action: "adminAddEvent", personId: "7", eventType: "lunchStart", timestamp: "2026-10-14T20:00:00.000Z" }),
    ] },
  { name: "adminEditEvent: move a lunch row in a completed shift", auth: AUTH.ada, seed: seedWith(wendyShift),
    steps: [TC({ action: "adminEditEvent", eventId: "tce_c4", timestamp: "2026-10-13T19:00:00.000Z" })] },
  { name: "adminEditEvent: refusals (confirmed, into confirmed, not found, missing)", auth: AUTH.ada, seed: seedWith(wendyShift), steps: [
    TC({ action: "adminEditEvent", eventId: "tce_a1", timestamp: "2026-10-12T18:10:00.000Z" }),
    TC({ action: "adminEditEvent", eventId: "tce_c3", timestamp: "2026-10-12T18:10:00.000Z" }),
    TC({ action: "adminEditEvent", eventId: "tc_c", timestamp: "2026-10-13T18:10:00.000Z" }),
    TC({ action: "adminEditEvent", eventId: "tce_c3" }),
  ] },
  { name: "adminEditEvent: open shift — lunch moved and synced, out-of-shift and break refused", auth: AUTH.ada, now: "2026-10-14T19:00:00.000Z", seed: seedWith(wendyOpenWithLunch), steps: [
    TC({ action: "adminEditEvent", eventId: "tce_o1", timestamp: "2026-10-14T17:45:00.000Z" }),
    TC({ action: "adminEditEvent", eventId: "tce_o1", timestamp: "2026-10-14T12:00:00.000Z" }),
    TC({ action: "adminEditEvent", eventId: "tce_o1", timestamp: "2026-10-14T21:00:00.000Z" }),
    TC({ action: "adminEditEvent", eventId: "tce_o2", timestamp: "2026-10-14T16:05:00.000Z" }),
  ] },
  { name: "adminDeleteEvent: completed shift tombstones the row and recomputes", auth: AUTH.ada, seed: seedWith(wendyShift), steps: [
    TC({ action: "adminDeleteEvent", eventId: "tce_c3" }),
    TC({ action: "adminDeleteEvent", eventId: "tce_c3" }, { now: "2026-10-14T15:31:00.000Z" }),
    TC({ action: "adminDeleteEvent", eventId: "tce_a2" }),
    TC({ action: "adminDeleteEvent" }),
  ] },
  { name: "adminDeleteEvent: open shift — lunch removed from the cache, break refused", auth: AUTH.ada, now: "2026-10-14T19:00:00.000Z", seed: seedWith(wendyOpenWithLunch), steps: [
    TC({ action: "adminDeleteEvent", eventId: "tce_o1" }),
    TC({ action: "adminDeleteEvent", eventId: "tce_o2" }),
  ] },
  { name: "adminDeleteEntry: shift and its lunch/break rows tombstoned; refusals", auth: AUTH.ada,
    seed: seedWith((s) => { wendyShift(s); payOf(s).push({ id: "tc_open", personId: "7", date: "2026-10-14", clockIn: "2026-10-14T13:00:00.000Z", clockOut: null, hours: 0, jobRefs: [], source: "kiosk" }); }),
    steps: [
      TC({ action: "adminDeleteEntry", entryId: "tc_c" }),
      TC({ action: "adminDeleteEntry", entryId: "tc_c" }),
      TC({ action: "adminDeleteEntry", entryId: "tc_a" }),
      TC({ action: "adminDeleteEntry", entryId: "tce_a1" }),
      TC({ action: "adminDeleteEntry", entryId: "tc_open" }),
      TC({ action: "adminDeleteEntry" }),
    ] },
  { name: "adminReopenEntry: Sam's shift reopened, second click is alreadyOpen", auth: AUTH.ada, steps: [
    TC({ action: "adminReopenEntry", entryId: "tc_b" }),
    TC({ action: "adminReopenEntry", entryId: "tc_b" }, { now: "2026-10-14T15:31:00.000Z" }),
  ] },
  { name: "adminReopenEntry: reopened shift carries its rows, then kiosk clock-out", auth: AUTH.ada, seed: seedWith(wendyShift), steps: [
    TC({ action: "adminReopenEntry", entryId: "tc_c" }),
    TC({ action: "clockOut", personId: "7", pin: "1111" }, { auth: null, now: "2026-10-14T15:35:00.000Z" }),
  ] },
  { name: "adminReopenEntry: refusals (confirmed, other session open, not found)", auth: AUTH.ada,
    seed: seedWith((s) => { personOf(s, 99).activeClockIn = open(); }),
    steps: [
      TC({ action: "adminReopenEntry", entryId: "tc_a" }),
      TC({ action: "adminReopenEntry", entryId: "tc_b" }),
      TC({ action: "adminReopenEntry", entryId: "tc_zzz" }),
      TC({ action: "adminReopenEntry" }),
    ] },

  // ── confirm / re-open timesheet ────────────────────────────
  { name: "confirmTimesheet: range confirms both punches (re-stamps the confirmed one)", auth: AUTH.ada,
    steps: [TC({ action: "confirmTimesheet", start: "2026-10-12", end: "2026-10-13" })] },
  { name: "confirmTimesheet: overnight punch needs acknowledgement, bogus ids ignored, then acknowledged", auth: AUTH.ada, seed: seedWith(samOvernight), steps: [
    TC({ action: "confirmTimesheet", start: "2026-10-12", end: "2026-10-14" }),
    TC({ action: "confirmTimesheet", start: "2026-10-12", end: "2026-10-14", acknowledge: ["tc_b", "nope"] }),
    TC({ action: "confirmTimesheet", start: "2026-10-12", end: "2026-10-14", acknowledge: ["tc_night"] }, { now: "2026-10-14T15:40:00.000Z" }),
    TC({ action: "confirmTimesheet", start: "2026-10-13", end: "2026-10-13" }, { now: "2026-10-14T15:45:00.000Z" }),
  ] },
  { name: "unconfirmTimesheet: never gated, strips the confirmation", auth: AUTH.ada, seed: seedWith(samOvernight), steps: [
    TC({ action: "unconfirmTimesheet", start: "2026-10-12", end: "2026-10-14" }),
  ] },
  { name: "confirmTimesheet: bad dates, reversed range, empty range", auth: AUTH.ada, steps: [
    TC({ action: "confirmTimesheet", start: "10/12/2026", end: "2026-10-13" }),
    TC({ action: "confirmTimesheet", start: "2026-10-14", end: "2026-10-12" }),
    TC({ action: "confirmTimesheet", start: "2025-01-01", end: "2025-01-02" }),
    TC({ action: "unconfirmTimesheet", start: "2025-01-01", end: "2025-01-02" }),
  ] },

  // ── permission refusals ────────────────────────────────────
  { name: "restricted admin: refused manageTimeclock and confirmTimesheet actions", auth: AUTH.rita, steps: [
    TC({ action: "adminClockIn", personId: "7" }),
    TC({ action: "adminEditEntry", entryId: "tc_b", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T21:30:00.000Z" }),
    TC({ action: "adminAddEvent", personId: 99, eventType: "lunchStart", timestamp: "2026-10-13T18:00:00.000Z" }),
    TC({ action: "adminDeleteEntry", entryId: "tc_b" }),
    TC({ action: "adminLunchStart", personId: "7" }),
    TC({ action: "confirmTimesheet", start: "2026-10-12", end: "2026-10-13" }),
    TC({ action: "unconfirmTimesheet", start: "2026-10-12", end: "2026-10-13" }),
  ] },
  { name: "restricted admin with only confirmTimesheet: confirms, still cannot correct", auth: ritaConfirmer, steps: [
    TC({ action: "confirmTimesheet", start: "2026-10-13", end: "2026-10-13" }),
    TC({ action: "adminReopenEntry", entryId: "tc_b" }),
  ] },
  { name: "null-adminPerms admin (Nora) is unrestricted", auth: { personId: "14", isAdmin: true, adminPerms: null, email: "nora@testpanels.example", orgCode: ORG, canClockInOut: true },
    steps: [TC({ action: "adminClockIn", personId: "99", clockInTime: "2026-10-14T13:00:00.000Z" })] },
  { name: "worker refused on admin actions", auth: AUTH.wendy, steps: [
    TC({ action: "adminClockIn", personId: "7" }),
    TC({ action: "adminClockOut", personId: "7" }),
    TC({ action: "adminEditActiveClockIn", personId: "7", clockIn: "2026-10-14T13:00:00.000Z" }),
    TC({ action: "adminEditEvent", eventId: "tce_a1", timestamp: "2026-10-12T18:10:00.000Z" }),
    TC({ action: "adminDeleteEvent", eventId: "tce_a1" }),
    TC({ action: "adminReopenEntry", entryId: "tc_a" }),
    TC({ action: "adminBreakStart", personId: "7" }),
    TC({ action: "confirmTimesheet", start: "2026-10-12", end: "2026-10-13" }),
  ] },
  { name: "admin actions with no token are 401", auth: null, steps: [
    TC({ action: "adminClockIn", personId: "7" }),
    TC({ action: "adminDeleteEntry", entryId: "tc_b" }),
    TC({ action: "confirmTimesheet", start: "2026-10-12", end: "2026-10-13" }),
    TC({ action: "adminLunchStart", personId: "7" }),
  ] },

  // ── failing PINs (own IP each, kept last) ──────────────────
  { name: "identify: bad pin is 401", auth: null, steps: [TC({ action: "identify", pin: "0000" }, { headers: ip(1) })] },
  { name: "identify: a tombstoned person's pin does not match", auth: null,
    seed: seedWith((s) => { personOf(s, "15").pin = "5555"; }),
    steps: [TC({ action: "identify", pin: "5555" }, { headers: ip(2) })] },
  { name: "kiosk: wrong pin, and a person with no pin, are 401", auth: null, steps: [
    TC({ action: "clockIn", personId: "7", pin: "9999" }, { headers: ip(3) }),
    TC({ action: "clockIn", personId: "12", pin: "1111" }, { headers: ip(4) }),
  ] },
  { name: "pay clock: wrong pin is 401", auth: AUTH.wendy,
    steps: [TC({ action: "payClockIn", personId: "7", pin: "9999" }, { headers: ip(5) })] },
  { name: "PIN limiter: five failures lock the IP, even a good pin then gets 429", auth: null, steps: [
    ...[1, 2, 3, 4, 5].map(() => TC({ action: "identify", pin: "0000" }, { headers: ip(9) })),
    TC({ action: "identify", pin: "4321" }, { headers: ip(9) }),
    TC({ action: "clockIn", personId: "7", pin: "1111" }, { headers: ip(9) }),
    TC({ action: "identify", pin: "4321" }, { headers: ip(10) }),
  ] },
];
