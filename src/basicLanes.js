// Overlap lanes for a Basic org's team row.
//
// Basic lets two assignments share a time range on one person's row — there is no packing and
// no push, by design, because "pushed, pulled, switched" is the Business behaviour. Painting
// both bars at full row height in the same place hides one behind the other, so the row's
// vertical space is split between whatever overlaps on a given day.
//
// Lifted out of an IIFE inside the team render (#119-#123). It was unreachable from a test
// there, which is why five defects in one small block went unnoticed; this is the same move
// rowPushHours got, for the same stated reason — pure, and therefore testable.
//
// ── WHAT THE OLD VERSION GOT WRONG ──────────────────────────────────────────────────────
//
// #121/#123  It measured each bar as `walkProductiveHours(startHour, share(hpd))` — the
//            STORED estimate. The bar is PAINTED at barLengthHours(), which adds
//            `max(0, worked - est) / teamSize` once an op runs past its estimate. So a bar
//            that had overrun was laned as if it were shorter than it is drawn, and two bars
//            that only collide once one has grown were given the same lane and painted on top
//            of each other. The comment above the old block asserted the opposite — "computed
//            straight from each bar's own stored start/hpd, which is exactly where a Basic bar
//            paints since nothing pushes or re-anchors it". Nothing pushes it; growth is not a
//            push. The lane range now comes from the painted length.
//
// #120       `b.task.startHour != null` dropped every bar without a stored start hour, and
//            `byDay[b.task.start]` keyed on the op's START day. A bar with no startHour is
//            drawn from the start of the working day, and a bar that spans days is drawn on
//            every one of them — both were excluded from laning and so overlapped freely.
//
// #119       Lanes were returned per OP id and applied to the head segment only, so the tail
//            of a multi-day bar, its ghost and its dot stayed full height and kept overlapping
//            on every day after the first. The key is now (opId, day), so each day's segment
//            gets its own lane, and the caller can look one up for any segment it draws.
//
// Returns Map<"opId\u0000day", { lane, lanesTotal }>. Use laneKey() to read it.

import { walkProductiveHours, personShareHours, barLengthHours } from "./statsMath.js";

export const laneKey = (opId, day) => `${opId}\u0000${day}`;

/**
 * @param bars  [{ id, task }] as the row render has them — `task` carries start/end/startHour/
 *              hpd/team, and `worked` is the hours already shown on it (what barLengthHours
 *              is given), so the lane measures the bar as it is PAINTED.
 * @param cfg   { dayWindowCfg, workStartH, workEndH, productiveHoursPerDay, workDays, holidays,
 *                nextDay } — nextDay(ds) advances one calendar day, injected so this module
 *              does not need the app's date helpers.
 */
export function basicLanes(bars, cfg) {
  const { dayWindowCfg, workStartH = 8, workEndH = 17, productiveHoursPerDay = 7.5, nextDay } = cfg || {};
  const out = new Map();
  if (!Array.isArray(bars) || !bars.length || typeof nextDay !== "function") return out;

  // Every (day, bar) pair this row paints, with the range the bar actually occupies on that
  // day. A bar with no stored startHour begins at the start of the working day — that is where
  // it is drawn, so that is where it is laned (#120).
  const byDay = new Map();
  for (const b of bars) {
    const t = b?.task;
    if (!t || b.type !== "task" || !t.start) continue;
    const teamSize = Math.max(1, (t.team || []).length);
    // The PAINTED length, not the stored estimate (#121/#123).
    const share = barLengthHours({
      hpd: t.hpd, workedHoursShown: b.worked || 0, isFullyWorked: !!b.isFullyWorked,
      teamSize, fallbackH: productiveHoursPerDay,
    });
    if (!(share > 0)) continue;
    const startH = t.startHour != null ? t.startHour : workStartH;

    // Walk the bar across days, so every day it is drawn on gets a segment (#119).
    let day = t.start, hoursLeft = share, startOnDay = startH, guard = 0;
    while (hoursLeft > 0.0001 && guard++ < 400) {
      const w = walkProductiveHours(startOnDay, hoursLeft, dayWindowCfg);
      const endOnDay = w.days > 1 ? workEndH : w.endHour;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ id: String(t.id), s: startOnDay, e: endOnDay });
      if (w.days <= 1) break;
      // Spent on this day, carried to the next. productiveHoursBetween is not needed: the
      // walk already told us the day ran out, so what it consumed is the day's remainder.
      const spent = Math.max(0, endOnDay - startOnDay) - deadInside(startOnDay, endOnDay, dayWindowCfg);
      hoursLeft -= spent;
      day = nextDay(day);
      startOnDay = workStartH;
    }
  }

  for (const [day, list] of byDay) {
    // Greedy interval colouring, lowest free lane first. Sorting by start then end keeps the
    // assignment stable: the same input always produces the same lanes, so a re-render does
    // not shuffle bars between rows.
    const sorted = [...list].sort((a, b) => a.s - b.s || a.e - b.e || String(a.id).localeCompare(String(b.id)));
    const laneEnds = [];
    const placed = sorted.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.s + 0.0001);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.e); }
      else laneEnds[lane] = item.e;
      return { ...item, lane };
    });
    // lanesTotal is how many lanes the row must be divided into WHERE THIS BAR SITS, not how
    // many the day used overall — a bar alone at 16:00 should be full height even if three
    // others shared the morning.
    for (const item of placed) {
      let lanesTotal = 1;
      for (const other of placed) {
        if (other === item) continue;
        if (other.s < item.e - 0.0001 && other.e > item.s + 0.0001) {
          lanesTotal = Math.max(lanesTotal, other.lane + 1, item.lane + 1);
        }
      }
      out.set(laneKey(item.id, day), { lane: item.lane, lanesTotal });
    }
  }
  return out;
}

// How much of [a, b) falls inside a configured dead window (lunch, breaks). Used to convert a
// clock span back into the productive hours it consumed.
function deadInside(a, b, cfg) {
  let dead = 0;
  for (const w of (cfg?.deadWindows || [])) {
    const s = Math.max(a, w.start), e = Math.min(b, w.start + w.dur);
    if (e > s) dead += e - s;
  }
  return dead;
}
