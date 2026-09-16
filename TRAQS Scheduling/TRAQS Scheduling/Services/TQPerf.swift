import Foundation
import os

// MARK: - Where the frame went
//
// Added because "the Jobs page is slow" cost several rounds of guessing. Two of
// the three costs found so far were provable from a benchmark — the approval and
// activity indexes at 808 ms per redraw, and a cache write that rewrote every job
// in the table on every cell edit — but the numbers that mattered were always the
// ones from the real dataset on the real machine, and there was no way to get
// them.
//
// This is that way. It costs nothing when off, prints only what actually exceeds
// a threshold, and also emits Instruments signposts so a Time Profiler trace can
// be read without the printing.
//
// TURN IT ON: set `TRAQS_PERF=1` in the scheme's environment (Product ▸ Scheme ▸
// Edit Scheme ▸ Run ▸ Arguments ▸ Environment Variables). `TRAQS_PERF_MS`
// overrides the 2 ms report threshold.
//
// Deliberately NOT a build-configuration flag: the interesting case is a release
// build over a real org's data, which is exactly where `#if DEBUG` would compile
// it out.

enum TQPerf {

    /// Off unless `TRAQS_PERF` is set. Read once — `ProcessInfo.environment`
    /// builds a whole dictionary per access, which is not something to do inside
    /// the thing being measured.
    static let enabled: Bool = {
        let v = ProcessInfo.processInfo.environment["TRAQS_PERF"] ?? ""
        return v == "1" || v.lowercased() == "true"
    }()

    /// Only report spans at least this long, so an idle redraw does not fill the
    /// log with 0.1 ms lines.
    static let thresholdMs: Double = {
        Double(ProcessInfo.processInfo.environment["TRAQS_PERF_MS"] ?? "") ?? 2
    }()

    private static let log = Logger(subsystem: "com.traqs.perf", category: "frame")
    private static let signposter = OSSignposter(subsystem: "com.traqs.perf",
                                                 category: "frame")

    /// Time `work`, report it if it is slow, and return whatever it returns.
    ///
    /// `detail` is an autoclosure so building the string costs nothing when the
    /// span is fast or the switch is off — it is only evaluated to print.
    @discardableResult
    static func measure<T>(_ name: StaticString,
                           _ detail: @autoclosure () -> String = "",
                           _ work: () -> T) -> T {
        guard enabled else { return work() }

        let state = signposter.beginInterval(name)
        let start = DispatchTime.now().uptimeNanoseconds
        let result = work()
        let ms = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        signposter.endInterval(name, state)

        if ms >= thresholdMs {
            let extra = detail()
            log.notice("\(String(describing: name), privacy: .public) \(ms, format: .fixed(precision: 1)) ms \(extra, privacy: .public)")
            // Also to stdout: the Xcode console is where somebody chasing this
            // will actually be looking, and `Logger` alone does not land there.
            print("[perf] \(name) \(String(format: "%.1f", ms)) ms \(extra)")
        }
        return result
    }

    /// How big the page actually is, for the report line. Cheap: three counts,
    /// no allocation beyond the string itself.
    static func shape(_ jobs: [Job]) -> String {
        var panels = 0, ops = 0
        for job in jobs {
            panels += job.subs.count
            for panel in job.subs { ops += panel.subs.count }
        }
        return "(\(jobs.count) jobs, \(panels) panels, \(ops) ops)"
    }
}
