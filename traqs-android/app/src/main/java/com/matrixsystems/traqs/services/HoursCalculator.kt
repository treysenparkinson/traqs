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
 * clock. `frozenAtMs` is accepted and currently IGNORED — call sites pass it so
 * that teaching held sessions to stop accruing is a change to this function
 * alone, with no call site revisited.
 */
object HoursCalculator {

    // frozenAtMs is threaded through every call site and used by none of them
    // yet. Suppressed rather than dropped: dropping it would mean revisiting all
    // four call sites when held sessions learn to stop accruing, which is the
    // one thing this signature exists to avoid. Remove the suppression in the
    // same change that reads the parameter.
    @Suppress("UNUSED_PARAMETER")
    fun liveElapsedHours(
        clockIn: String?,
        pausedAt: String?,
        frozenAtMs: Double?,
        totalPausedMs: Double?,
        now: Long = System.currentTimeMillis(),
    ): Double {
        val started = parseFlexibleISO(clockIn) ?: return 0.0
        var ms = (now - started).toDouble() - (totalPausedMs ?: 0.0)
        val pausedSince = parseFlexibleISO(pausedAt)
        if (pausedSince != null) ms -= maxOf(0.0, (now - pausedSince).toDouble())
        return maxOf(0.0, ms) / 3_600_000.0
    }
}
