import Foundation

/// TEMPORARY launch profiling (2026-10-14) — "the first load is extremely
/// laggy, fine after". Debug builds only; prints `[launch] …` lines to the
/// Xcode console. Two kinds:
///
///   * stage timings — how long each launch step took and whether it ran on
///     the main thread (`main=yes` is time the UI could not draw);
///   * stalls — any time the main thread failed to answer a ping for >100ms in
///     the first 30s, with when it happened.
///
/// Delete this file and its call sites once the launch is fixed.
enum LaunchTrace {
    #if DEBUG
    nonisolated(unsafe) private static var t0 = CFAbsoluteTimeGetCurrent()
    nonisolated(unsafe) private static var watching = false

    private static func ms(_ s: CFAbsoluteTime) -> Int { Int((CFAbsoluteTimeGetCurrent() - s) * 1000) }

    static func log(_ text: String) {
        print("[launch] t+\(ms(t0))ms \(text)")
    }

    @discardableResult
    static func measure<T>(_ label: String, _ body: () throws -> T) rethrows -> T {
        let s = CFAbsoluteTimeGetCurrent()
        defer { log("\(label): \(ms(s))ms main=\(Thread.isMainThread ? "yes" : "no")") }
        return try body()
    }

    static func measure<T>(_ label: String, _ body: () async throws -> T) async rethrows -> T {
        let s = CFAbsoluteTimeGetCurrent()
        defer { log("\(label): \(ms(s))ms (async, wall)") }
        return try await body()
    }

    /// Pings the main thread every 50ms from a background thread for 30s and
    /// reports every reply that took longer than 100ms.
    static func startStallWatch() {
        guard !watching else { return }
        watching = true
        t0 = CFAbsoluteTimeGetCurrent()
        log("watch started")
        Thread.detachNewThread {
            let end = CFAbsoluteTimeGetCurrent() + 30
            while CFAbsoluteTimeGetCurrent() < end {
                let sent = CFAbsoluteTimeGetCurrent()
                let done = DispatchSemaphore(value: 0)
                DispatchQueue.main.async { done.signal() }
                done.wait()
                let waited = ms(sent)
                if waited > 100 { log("STALL main thread blocked \(waited)ms") }
                Thread.sleep(forTimeInterval: 0.05)
            }
            log("watch ended")
        }
    }
    #else
    static func log(_ text: String) {}
    @discardableResult static func measure<T>(_ label: String, _ body: () throws -> T) rethrows -> T { try body() }
    static func measure<T>(_ label: String, _ body: () async throws -> T) async rethrows -> T { try await body() }
    static func startStallWatch() {}
    #endif
}
