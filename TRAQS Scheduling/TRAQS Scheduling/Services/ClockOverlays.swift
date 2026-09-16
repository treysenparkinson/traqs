import Foundation

/// Punched break / lunch spans, resolved for one day and one person.
///
/// The gantt already drew the *scheduled* lunch window (`LunchGhostBlock`, from
/// `orgSettings.lunch`). That is a plan, not a record — it sits at the same hour
/// every day whether or not anybody punched. This is the record: the spans a
/// worker actually took, laid over the timeline where they happened.
///
/// Pure by design (no AppState, no implicit `Date()`, no captured Calendar) for
/// the same reason as `SchedulePacker` and `HoursCalculator` — the pairing walk
/// is the part with edge cases (an unclosed punch, a duplicate event arriving
/// from two sources) and it should be testable without a rendered timeline.
enum ClockOverlays {

    /// One resolved span. `isOpen` means the worker punched in but not out yet,
    /// so `end` is "as of now" and will keep growing.
    struct Span: Identifiable, Equatable {
        enum Kind: String, Equatable {
            case lunch
            case rest   // "break" — `case break` is not a legal Swift identifier

            /// Event-type prefix as written by /timeclock: "lunchStart"/"lunchEnd",
            /// "breakStart"/"breakEnd".
            var eventPrefix: String { self == .lunch ? "lunch" : "break" }
            var label: String { self == .lunch ? "LUNCH" : "BREAK" }
        }

        let id: String
        let kind: Kind
        let start: Date
        let end: Date
        let isOpen: Bool

        var minutes: Int { max(0, Int((end.timeIntervalSince(start) / 60).rounded())) }
    }

    /// One punch, normalised out of whichever source carried it.
    private struct Punch {
        let kind: Span.Kind
        let isStart: Bool
        let at: Date
    }

    /// Resolve the spans to draw on `day`.
    ///
    /// Three sources, because no single one is complete:
    ///   • `entries` — the server's timeclock.json history. Authoritative, but a
    ///     punch made seconds ago may not be in the last fetch yet.
    ///   • `liveEvents` — `activeClockIn.events` on the OPEN pay shift. Carries
    ///     today's punches before the history refetch catches up.
    ///   • `activeBreak` — the optimistic local flag `startBreak()` sets before
    ///     the server has recorded a `breakStart` at all. Without it a break
    ///     wouldn't appear on the timeline until a round trip completed.
    ///
    /// They overlap heavily, so punches are de-duplicated on (kind, start/end,
    /// whole second) before pairing.
    static func spans(day: Date,
                      personId: String?,
                      entries: [TimeclockEntry],
                      liveEvents: [ClockEvent],
                      activeBreak: ActiveBreak?,
                      now: Date,
                      calendar: Calendar) -> [Span] {
        var punches: [Punch] = []

        if let personId {
            for e in entries where e.personId == personId {
                guard let type = e.eventType,
                      let ts = e.timestamp,
                      let p = punch(type: type, iso: ts) else { continue }
                punches.append(p)
            }
        }
        for e in liveEvents {
            if let p = punch(type: e.type, iso: e.ts) { punches.append(p) }
        }
        // The optimistic break — only a START; it ends when a real breakEnd
        // arrives or, until then, at `now`.
        if let b = activeBreak, let s = b.startDate {
            punches.append(Punch(kind: .rest, isStart: true, at: s))
        }

        // Same day only. Pairing across midnight would need the previous day's
        // punches too, and a shift that spans midnight has bigger problems than
        // this overlay.
        punches = punches.filter { calendar.isDate($0.at, inSameDayAs: day) }

        // De-dupe to the second: the same punch routinely arrives from both the
        // history and the live shift, and `activeBreak` duplicates its own
        // breakStart once the server round trip lands.
        var seen = Set<String>()
        punches = punches
            .sorted { $0.at < $1.at }
            .filter { p in
                let key = "\(p.kind.rawValue)/\(p.isStart)/\(Int(p.at.timeIntervalSince1970))"
                return seen.insert(key).inserted
            }

        return pair(punches, day: day, now: now, calendar: calendar)
    }

    /// Walk the sorted punches, closing each open start with the next end of the
    /// SAME kind. Lunch and break are tracked independently so an interleaved
    /// pair (break inside a lunch, or a missing punch) can't pair a lunchStart
    /// with a breakEnd.
    private static func pair(_ punches: [Punch], day: Date, now: Date, calendar: Calendar) -> [Span] {
        var open: [Span.Kind: Date] = [:]
        var out: [Span] = []

        func emit(_ kind: Span.Kind, from: Date, to: Date, isOpen: Bool) {
            // A zero/negative span is a double-punch, not a rest — drop it
            // rather than draw a hairline the user can't interpret.
            guard to.timeIntervalSince(from) >= 30 else { return }
            out.append(Span(id: "\(kind.rawValue)/\(Int(from.timeIntervalSince1970))",
                            kind: kind, start: from, end: to, isOpen: isOpen))
        }

        for p in punches {
            if p.isStart {
                // A second start with one already open means the end punch was
                // lost. Close the first at the second's timestamp rather than
                // dropping either.
                if let prior = open[p.kind] { emit(p.kind, from: prior, to: p.at, isOpen: false) }
                open[p.kind] = p.at
            } else if let start = open.removeValue(forKey: p.kind) {
                emit(p.kind, from: start, to: p.at, isOpen: false)
            }
            // An end with nothing open (started yesterday, or the start punch
            // was lost) is ignored — there is no span to draw.
        }

        // Whatever is still open runs to NOW on today, and to the last moment of
        // the day on any other day (a stale unclosed punch from last week must
        // not stretch to the present).
        let openEnd: Date = calendar.isDate(day, inSameDayAs: now)
            ? now
            : (calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: day))
                .map { $0.addingTimeInterval(-1) } ?? now)
        for (kind, start) in open { emit(kind, from: start, to: openEnd, isOpen: true) }

        return out.sorted { $0.start < $1.start }
    }

    private static func punch(type: String, iso: String) -> Punch? {
        guard let at = Date.fromFlexibleISO8601(iso) else { return nil }
        switch type {
        case "lunchStart": return Punch(kind: .lunch, isStart: true,  at: at)
        case "lunchEnd":   return Punch(kind: .lunch, isStart: false, at: at)
        case "breakStart": return Punch(kind: .rest,  isStart: true,  at: at)
        case "breakEnd":   return Punch(kind: .rest,  isStart: false, at: at)
        default:           return nil
        }
    }
}
