// Shop time: the wall clock of the org's timezone (root cause 6, #76 #77 #215).
//
// Everything about the SCHEDULE reads in shop time, whoever opens it: today, day
// columns, hour of day, the now-cursor, before-now, end of day, span placement, live
// hours. A viewer in New York looking at a Denver shop sees Denver's 08:00 as 08:00.
// Absolute timestamps shown to a person (chat, notifications, audit trails) stay in the
// viewer's zone and do not come through here.
//
// With no org timezone set, shop time IS the viewer's local time — every function here
// then answers exactly what the plain Date local methods answer, via the same methods.
//
// Hours are WALL-CLOCK hours: shopMs("2026-03-08", 8) is 08:00 on the clock that day,
// even though the day is 23 hours long. The old `midnight + h * 3600000` placed every
// window an hour off on both DST days (#77).
//
// The web sets the zone once per render (setShopZone). The server never does: it passes
// a zone explicitly where it needs one, and otherwise keeps its process-local (UTC) math.

const HOUR = 3600000;
let _zone = null;           // null → viewer-local
let _viewerZone = null;

function viewerZone() {
  if (_viewerZone === null) {
    try { _viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { _viewerZone = ""; }
  }
  return _viewerZone;
}

const _fmts = new Map();
function partsFormatter(tz) {
  if (_fmts.has(tz)) return _fmts.get(tz);
  let f;
  try {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { f = false; }      // unknown IANA name
  _fmts.set(tz, f);
  return f;
}

/** Normalise a zone: falsy, unknown, or the viewer's own zone → null (use Date local methods). */
function effectiveZone(tz) {
  if (!tz) return null;
  if (tz === viewerZone()) return null;
  return partsFormatter(tz) ? tz : null;
}

/** Set the shop's zone for this browser session. Returns true when it changed. */
export function setShopZone(tz) {
  const z = effectiveZone(tz);
  if (z === _zone) return false;
  _zone = z;
  _offCache.clear();
  return true;
}

/** The zone shop time is currently read in (null = viewer-local). */
export function shopZone() { return _zone; }

const resolve = (tz) => (tz === undefined ? _zone : effectiveZone(tz));

// Offset (wall clock minus UTC) at instant ms, cached per 15 minutes — every real
// transition lands on a quarter hour, so the cache can never straddle one.
const _offCache = new Map();
function offsetMs(ms, tz) {
  const key = tz + "|" + Math.floor(ms / 900000);
  const hit = _offCache.get(key);
  if (hit !== undefined) return hit;
  const p = {};
  for (const x of partsFormatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const off = asUtc - Math.floor(ms / 1000) * 1000;
  if (_offCache.size > 20000) _offCache.clear();
  _offCache.set(key, off);
  return off;
}

const pad = (n) => String(n).padStart(2, "0");

/** { ds, hour, dow } of instant ms in shop time. hour is fractional (08:30 → 8.5). */
export function shopParts(ms, tz) {
  const z = resolve(tz);
  if (!Number.isFinite(ms)) return null;
  if (!z) {
    const d = new Date(ms);
    return {
      ds: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      hour: d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / HOUR,
      dow: d.getDay(),
    };
  }
  const w = new Date(ms + offsetMs(ms, z));      // wall clock, read with the UTC getters
  return {
    ds: `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`,
    hour: w.getUTCHours() + w.getUTCMinutes() / 60 + w.getUTCSeconds() / 3600 + w.getUTCMilliseconds() / HOUR,
    dow: w.getUTCDay(),
  };
}

/** YYYY-MM-DD of instant ms (default: now) in shop time. */
export function shopDay(ms = Date.now(), tz) { return shopParts(ms, tz)?.ds ?? null; }

/** Fractional wall-clock hour of instant ms (default: now) in shop time. */
export function shopHour(ms = Date.now(), tz) { return shopParts(ms, tz)?.hour ?? NaN; }

/**
 * The instant the shop's wall clock reads hour h on day ds. h may be fractional, and may
 * run past 24 or below 0 (it rolls onto the neighbouring day's clock).
 */
export function shopMs(ds, h = 0, tz) {
  const z = resolve(tz);
  const [y, mo, d] = String(ds).slice(0, 10).split("-").map(Number);
  if (!z) {
    const base = new Date(y, mo - 1, d, 0, 0, 0, 0);
    if (!Number.isFinite(h) || h === 0) return base.getTime();
    const whole = Math.floor(h);
    base.setHours(whole);                          // wall-clock hour, DST-aware
    return base.getTime() + (h - whole) * HOUR;
  }
  const wall = Date.UTC(y, mo - 1, d) + (Number.isFinite(h) ? h : 0) * HOUR;
  let utc = wall - offsetMs(wall, z);
  utc = wall - offsetMs(utc, z);                   // second pass: the far side of a DST change
  return utc;
}

/** Shop midnight of day ds. */
export const shopMidnight = (ds, tz) => shopMs(ds, 0, tz);

/** Weekday (0=Sun) of a YYYY-MM-DD. Zone-independent. */
export const dowOf = (ds) => new Date(String(ds).slice(0, 10) + "T12:00:00Z").getUTCDay();

/** YYYY-MM-DD one calendar day after ds. Zone-independent. */
export const nextDayOf = (ds) => {
  const d = new Date(String(ds).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * #215 — THE end-of-day rule. The instant an open clock that started at clockInMs is
 * frozen and counts as unclosed:
 *   workEnd on the clock-in's shop day; if the clock-in is at or after that, workEnd on
 *   the next working day.
 * cfg: { workEndH, isWorkDay?(ds), timeZone? }. isWorkDay defaults to "every day".
 * Notifications add their own grace and backstop on top (after-hours.js); nothing else does.
 */
export function endOfDayFor(clockInMs, cfg = {}) {
  const { workEndH = 24, isWorkDay = null, timeZone } = cfg || {};
  if (!Number.isFinite(clockInMs)) return null;
  const day = shopDay(clockInMs, timeZone);
  let eod = shopMs(day, workEndH, timeZone);
  if (clockInMs >= eod) {
    let ds = nextDayOf(day);
    for (let g = 0; g < 400 && isWorkDay && !isWorkDay(ds); g++) ds = nextDayOf(ds);
    eod = shopMs(ds, workEndH, timeZone);
  }
  return eod;
}
