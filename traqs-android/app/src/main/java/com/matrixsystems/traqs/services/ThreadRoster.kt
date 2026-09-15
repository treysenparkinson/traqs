package com.matrixsystems.traqs.services

import com.matrixsystems.traqs.models.ChatGroup
import com.matrixsystems.traqs.models.Message
import com.matrixsystems.traqs.models.Person

// MARK: - Who is in a thread
//
// ONE answer to "which people does this thread involve", for every surface that
// draws an avatar stack — the inbox row, the thread header, the members popover.
// A straight port of iOS `ThreadRoster` (Services/ThreadRoster.swift), so the
// stack you tap in the inbox is the stack you land on in the header.
//
// It exists because there used to be two answers: the header resolved a group
// against `groups` and read its `memberIds`, while the row derived its list from
// message `authorId`s alone — so a four-person crew where only one person had
// posted rendered a single circle.
//
// Pure and fully injected (no AppState, no globals).
object ThreadRoster {

    /// Everyone in `threadKey`, in a stable order, with duplicates and unknown
    /// ids dropped.
    ///
    /// Resolution runs in tiers, most authoritative first:
    ///
    /// 1. `dm:` — both ids come straight out of the key, so a DM shows the other
    ///    person even before either side has said anything.
    /// 2. `group:` — the group's own `memberIds`, the roster the user actually
    ///    picked. Matched on id OR name: the web app keyed groups by name
    ///    historically and those threads are still in the data.
    /// 3. anything else, or a group that hasn't synced yet — the roster carried ON
    ///    the messages. A freshly created group routinely lands a beat after its
    ///    first message, and `job:` / `panel:` / `op:` threads have no membership
    ///    record of their own at all.
    ///
    /// Tier 3 reads `authorId` AND `participantIds`: the author alone is what made
    /// a quiet thread look like a one-person conversation.
    fun participants(
        threadKey: String,
        messages: List<Message>,
        people: List<Person>,
        groups: List<ChatGroup>
    ): List<Person> = resolve(ids(threadKey, messages, groups), people)

    /// The id list behind `participants`, before it's matched against `people`.
    private fun ids(threadKey: String, messages: List<Message>, groups: List<ChatGroup>): List<Int> {
        if (threadKey.startsWith("dm:")) {
            return threadKey.removePrefix("dm:").split("_").mapNotNull { it.trim().toIntOrNull() }
        }
        if (threadKey.startsWith("group:")) {
            val ref = threadKey.removePrefix("group:")
            val g = groups.firstOrNull { it.id == ref || it.name == ref }
            if (g != null) return g.memberIds
            // Falls through to the message roster — group not synced yet.
        }
        return messages.flatMap { listOf(it.authorId) + it.participantIds }
    }

    /// Map ids to people, keeping FIRST-APPEARANCE order and dropping blanks,
    /// repeats, and ids we have no person for.
    ///
    /// Order is not cosmetic: the participant stack shows the first three and
    /// turns the rest into "+N", so an unstable order would visibly reshuffle
    /// which faces are on screen between renders.
    private fun resolve(ids: List<Int>, people: List<Person>): List<Person> {
        val seen = mutableSetOf<Int>()
        val out = mutableListOf<Person>()
        for (id in ids) {
            if (id == 0 || !seen.add(id)) continue
            people.firstOrNull { it.id == id }?.let { out.add(it) }
        }
        return out
    }
}
