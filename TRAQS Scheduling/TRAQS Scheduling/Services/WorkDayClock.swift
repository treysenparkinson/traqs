import Foundation

// MARK: - Where the hours in a working day actually go
//
// `buildDayWindows` and `walkProductiveHours` (TRAQS.jsx:~560). The Schedule
// page's geometry rests entirely on these two: a bar's width, its end hour, and
// whether it fits in the day it starts in are all this arithmetic.
//
// A working day is not `workEnd - workStart` hours of work. Lunch and breaks sit
// inside it, so a 9-hour day with a lunch and two breaks is 7.5 productive hours
// painted across the full 9 hours of width.
//
// THE TRAP THIS REPLACES, which the web's own comment records because it shipped:
// a flat pro-rate — `(prod / productivePerDay) * totalWorkH` — smears the whole
// day's unproductive time across every operation in proportion to its size. A
// one-hour task inherits about seven minutes of a lunch it never touches, which
// is enough to make it "not fit" a day it fits exactly: the bar gets clipped
// short, its span computes as two days, and a zero-width dashed tail lands on the
// next working day — across the weekend, for anything late on a Friday.
//
// So the walk STEPS OVER a break only when the work actually reaches it.
//
// Pure, and in the shared Services directory, so the rules are testable without a
// view and iOS can draw the same bars.

/// One stretch of the day nobody is producing in — a break, or lunch.
struct DeadWindow: Equatable {
    /// Hours since midnight, e.g. 12.5 for 12:30.
    var start: Double
    var duration: Double

    var end: Double { start + duration }
}

/// A working day, with the unproductive time placed in it.
struct DayWindow: Equatable {
    var workStart: Double
    var workEnd: Double
    /// Sorted by start, non-overlapping, clipped to the working day.
    var dead: [DeadWindow]

    /// Total unproductive hours inside the day.
    var deadHours: Double { dead.reduce(0) { $0 + $1.duration } }

    /// `totalWorkH` — the day's whole width in hours.
    var totalHours: Double { max(0, workEnd - workStart) }

    /// `productiveHoursPerDay`. Never below 1: a day configured with more break
    /// than day would otherwise make every bar infinitely long.
    var productiveHours: Double { max(1, totalHours - deadHours) }
}

enum WorkDayClock {

    /// `CLOCK_EPS` — a minute. Hours are Doubles and the walk compares against
    /// remaining time, so an exact fit must not leave a sliver that rolls the bar
    /// onto the next day.
    static let epsilon = 1.0 / 60.0

    /// `"HH:mm"` as hours since midnight. A malformed time reads as noon, which
    /// is what the web's `|| "12:00"` default does.
    static func hour(from time: String?) -> Double {
        let parts = (time ?? "12:00").split(separator: ":")
        let h = Double(parts.first ?? "12") ?? 12
        let m = parts.count > 1 ? (Double(parts[1]) ?? 0) : 0
        return h + m / 60
    }

    // MARK: Building the day

    /// `buildDayWindows`.
    ///
    /// PLACEMENT MATTERS, because it decides where in the day the unproductive
    /// time falls, which decides where a bar lands. An entry whose time is inside
    /// the working day is used where it sits. Anything left over — an entry timed
    /// outside working hours, or the part of one overrunning the day's end — is
    /// floating time and is banked at the START of the day.
    ///
    /// Start, not end, and the web says why: parking it at the end would stop a
    /// full-day operation short of quitting time and reopen the very gap this
    /// exists to close, while at the start it is already behind anything that
    /// begins later.
    static func day(workStart: Double, workEnd: Double,
                    breaks: [OrgBreak], lunch: OrgBreak?) -> DayWindow {
        var raw: [DeadWindow] = breaks
            .filter { $0.durationMinutes > 0 }
            .map { DeadWindow(start: hour(from: $0.time),
                              duration: Double($0.durationMinutes) / 60) }
        let lunchMinutes = lunch?.durationMinutes ?? 60
        if lunchMinutes > 0 {
            raw.append(DeadWindow(start: hour(from: lunch?.time),
                                  duration: Double(lunchMinutes) / 60))
        }

        // The total that MUST come off the day, however badly it is placed.
        // Capped so the day always keeps at least an hour of work in it.
        let configured = min(raw.reduce(0) { $0 + $1.duration },
                             max(0, (workEnd - workStart) - 1))

        // Clip to the working day, drop anything that falls outside it entirely,
        // and merge what overlaps.
        var merged = merge(raw
            .map { (start: max($0.start, workStart), end: min($0.end, workEnd)) }
            .filter { $0.end > $0.start }
            .sorted { $0.start < $1.start })

        let placed = merged.reduce(0) { $0 + ($1.end - $1.start) }
        var remaining = max(0, configured - placed)

        if remaining > 0 {
            // Bank the leftover at the start, filling the gaps before each placed
            // window first and then whatever is left after the last one.
            var out: [(start: Double, end: Double)] = []
            var cursor = workStart
            for window in merged {
                if remaining > 0, window.start > cursor {
                    let take = min(remaining, window.start - cursor)
                    out.append((cursor, cursor + take))
                    remaining -= take
                }
                out.append(window)
                cursor = max(cursor, window.end)
            }
            if remaining > 0, cursor < workEnd {
                out.append((cursor, cursor + min(remaining, workEnd - cursor)))
            }
            merged = merge(out.sorted { $0.start < $1.start })
        }

        return DayWindow(workStart: workStart, workEnd: workEnd,
                         dead: merged.map { DeadWindow(start: $0.start,
                                                       duration: $0.end - $0.start) })
    }

    /// From org settings, which is where every caller gets it.
    static func day(from settings: OrgSettings) -> DayWindow {
        day(workStart: hour(from: settings.workStart),
            workEnd: hour(from: settings.workEnd),
            breaks: settings.breaks,
            lunch: settings.lunch)
    }

    private static func merge(_ list: [(start: Double, end: Double)])
        -> [(start: Double, end: Double)] {
        var out: [(start: Double, end: Double)] = []
        for window in list {
            if var last = out.last, window.start <= last.end {
                last.end = max(last.end, window.end)
                out[out.count - 1] = last
            } else {
                out.append(window)
            }
        }
        return out
    }

    // MARK: Spending hours in it

    /// What a walk produced.
    struct Span: Equatable {
        /// Working days the work spans, always at least 1.
        var days: Int
        /// Wall-clock hour on the FINAL day where the work stops.
        var endHour: Double
        /// Width in DAY-COLUMN units — the same axis a bar's left offset uses, so
        /// `offset + columns` closes exactly on a day boundary.
        var columns: Double
    }

    /// `walkProductiveHours` — spend `hours` of productive time from `startHour`,
    /// stepping over each dead window only when the work reaches it and rolling to
    /// the next working day when the day runs out.
    static func walk(from startHour: Double, hours: Double, in day: DayWindow) -> Span {
        let dayLength = max(0.0001, day.workEnd - day.workStart)
        var clock = min(max(startHour, day.workStart), day.workEnd)
        let firstStart = clock
        var left = max(0, hours)
        var days = 1
        var guardCount = 0

        while left > epsilon && guardCount < 5000 {
            guardCount += 1

            for window in day.dead {
                // Behind us, or after hours: nothing to step over.
                if window.end <= clock + epsilon || window.start >= day.workEnd { continue }
                let productiveUntil = window.start - clock
                if productiveUntil > 0 {
                    if left <= productiveUntil + epsilon {
                        clock += left
                        left = 0
                        break
                    }
                    left -= productiveUntil
                }
                // Step OVER it without spending against it.
                clock = max(clock, window.end)
            }
            if left <= epsilon { break }

            let tail = day.workEnd - clock
            if left <= tail + epsilon {
                clock += left
                left = 0
                break
            }
            left -= tail
            days += 1
            clock = day.workStart
        }

        let columns: Double = days == 1
            ? (clock - firstStart) / dayLength
            : (day.workEnd - firstStart) / dayLength
                + Double(days - 2)
                + (clock - day.workStart) / dayLength

        return Span(days: days, endHour: clock, columns: max(0, columns))
    }
}
