import Foundation

/// The jobs THIS DEVICE deleted and has not yet told the server about (#291).
///
/// iOS used to save by POSTing the whole jobs array, and the server reads a bare array as
/// the whole world: every stored job missing from it becomes a tombstone. So a phone that
/// loaded at 09:00 and saved at 09:30 deleted every job created anywhere in between. The save
/// is now the delta envelope the web sends (#339) — every job as an upsert, plus these ids —
/// and a job the phone never saw is simply not mentioned.
///
/// Fed ONLY from user edits (updateJobs, undo, redo, a failed save's rollback). A server
/// reload or sync that drops a job is the server's own deletion; it never lands here.
struct JobDeletions {
    private(set) var pending: Set<String> = []

    /// A user edit replaced `old` with `new`. Ids that left are deletions to send; ids that
    /// came back (undo, rollback) are not deletions any more.
    mutating func record(from old: [Job], to new: [Job]) {
        let newIds = Set(new.map(\.id))
        pending.formUnion(Set(old.map(\.id)).subtracting(newIds))
        pending.subtract(newIds)
    }

    /// The server accepted a save that listed `sent`. Only those are done: a delete made
    /// while the save was in flight is still owed.
    mutating func confirm(_ sent: Set<String>) { pending.subtract(sent) }

    /// Logout or an org switch empties the list; that is not the user deleting every job.
    mutating func reset() { pending = [] }
}

/// `POST /tasks` as a delta: `{ upsert: [...], delete: [...] }`. The server tells it from the
/// legacy bare array by shape, so both keys are always written.
struct JobsSaveEnvelope: Encodable {
    let upsert: [Job]
    let delete: [String]

    func encoded() throws -> Data { try JSONEncoder().encode(self) }
}
