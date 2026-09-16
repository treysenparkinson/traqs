import Foundation

// MARK: - Who is in a thread
//
// ONE answer to "which people does this thread involve", for every surface that
// draws an avatar stack — the inbox row, the thread header, the members popover.
//
// It exists because there used to be two answers. The thread header resolved a
// group against `groups` and read its `memberIds`; the inbox row derived its
// list from message `authorId`s alone. So a group's row showed one avatar per
// person who had SPOKEN rather than one per member: a four-person crew where
// only one person had posted rendered a single circle, and one where the only
// speaker wasn't in `people` fell through to the generic "#" mark. Opening the
// thread then showed the full stack, because the header was asking a different
// question. This is that question, asked once.
//
// Pure and fully injected (no AppState, no globals) so it can be tested — see
// ThreadRosterTests.
enum ThreadRoster {

    /// Everyone in `threadKey`, in a stable order, with duplicates and unknown
    /// ids dropped.
    ///
    /// Resolution runs in tiers, most authoritative first:
    ///
    /// 1. `dm:` — both ids come straight out of the key, so a DM shows the
    ///    other person even before either side has said anything.
    /// 2. `group:` — the group's own `memberIds`, which is the roster the user
    ///    actually picked. Matched on id OR name: the web app keyed groups by
    ///    name historically and those threads are still in the data.
    /// 3. anything else, or a group that hasn't synced yet — the roster carried
    ///    ON the messages. A freshly created group routinely lands a beat after
    ///    its first message (see `MessagesView.canViewThread`, which has to make
    ///    the same allowance), and `job:` / `panel:` / `op:` threads have no
    ///    membership record of their own at all.
    ///
    /// Tier 3 reads `authorId` AND `participantIds`. The author alone is what
    /// made a quiet thread look like a one-person conversation; `participantIds`
    /// is the server's own list of everyone it addressed the message to.
    static func participants(threadKey: String,
                             messages: [Message],
                             people: [Person],
                             groups: [ChatGroup]) -> [Person] {
        resolve(ids: ids(threadKey: threadKey, messages: messages, groups: groups),
                people: people)
    }

    /// The id list behind `participants`, before it's matched against `people`.
    private static func ids(threadKey: String,
                            messages: [Message],
                            groups: [ChatGroup]) -> [String] {
        if threadKey.hasPrefix("dm:") {
            return String(threadKey.dropFirst(3)).components(separatedBy: "_")
        }
        if threadKey.hasPrefix("group:") {
            let ref = String(threadKey.dropFirst(6))
            if let g = groups.first(where: { $0.id == ref || $0.name == ref }) {
                return g.memberIds
            }
            // Falls through to the message roster — group not synced yet.
        }
        return messages.flatMap { [$0.authorId] + $0.participantIds }
    }

    /// Map ids to people, keeping FIRST-APPEARANCE order and dropping blanks,
    /// repeats, and ids we have no person for.
    ///
    /// Order is not cosmetic: `ParticipantStack` shows the first three and turns
    /// the rest into "+N", so an unstable order would visibly reshuffle which
    /// faces are on screen between renders.
    private static func resolve(ids: [String], people: [Person]) -> [Person] {
        var seen = Set<String>()
        var out: [Person] = []
        for id in ids where !id.isEmpty {
            guard seen.insert(id).inserted,
                  let p = people.first(where: { $0.id == id }) else { continue }
            out.append(p)
        }
        return out
    }
}
