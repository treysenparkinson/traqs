package com.matrixsystems.traqs.services

/**
 * Live job-clock hours.
 *
 * Mirrors `liveElapsedHours` in `statsMath.js` and `HoursCalculator.swift`; the
 * three platforms report the same hours only if they run the same algorithm.
 * They did not: the same arithmetic was written seventeen times in three
 * variants, and Android held two of them.
 *
 * Subtracts an OPEN pause as well as the closed `totalPausedMs` total. That
 * distinction is the whole point — `totalPausedMs` takes a pause in only when it
 * ENDS, so a version without `pausedAt` keeps counting straight through lunch.
 * `AppState.kt` had exactly that version, driving op-progress, and so did the
 * matching code on web and iOS; it was filed once as an iOS-only cosmetic gap
 * because nobody could see it had been written three times.
 *
 * The open pause is floored: a `pausedAt` AHEAD of `now` — phone/server clock
 * skew — would otherwise subtract a negative and ADD time. The screen-level
 * copies this replaces were all missing that floor.
 *
 * `now` is injectable so the cases worth testing are not races against the wall
 * clock.
 *
 * A HELD clock (`frozenAtMs`, a pending finish request) stops at the hold, and an
 * open pause is measured against that same instant — as the web's `openSessionEnd`
 * and iOS's `HoursCalculator.liveElapsedHours` do (#283; iOS's twin was #521). It was
 * threaded through every call site and ignored here, so a held session kept accruing.
 */
object HoursCalculator {

    fun liveElapsedHours(
        clockIn: String?,
        pausedAt: String?,
        frozenAtMs: Double?,
        totalPausedMs: Double?,
        now: Long = System.currentTimeMillis(),
    ): Double {
        val started = parseFlexibleISO(clockIn) ?: return 0.0
        // Held: the clock stops at the hold, never later than now.
        val effNow = if (frozenAtMs != null) minOf(now, frozenAtMs.toLong()) else now
        var ms = (effNow - started).toDouble() - (totalPausedMs ?: 0.0)
        val pausedSince = parseFlexibleISO(pausedAt)
        if (pausedSince != null) ms -= maxOf(0.0, (effNow - pausedSince).toDouble())
        return maxOf(0.0, ms) / 3_600_000.0
    }
}
