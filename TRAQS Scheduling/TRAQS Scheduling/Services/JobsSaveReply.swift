import Foundation

/// What `POST /tasks` said back, read out of its body.
///
/// Pure: bytes in, strings out. APIService hands over the body and the status,
/// AppState decides what to show — which is what makes the reading testable
/// without a server.
///
/// Two replies matter here, and both used to be thrown away:
///
///   * A refusal — `{ "error": "<sentence>" }`, a 422 also carrying
///     `violations`. Every one of these surfaced as "check your connection",
///     which sent people chasing their Wi-Fi over a permission they lacked
///     (defect #294).
///   * A success with `{ "ok": true, "conflicts": [jobId, …] }` — the server
///     kept ITS copy of those jobs, so the local edit to them was not saved even
///     though the request succeeded.
enum JobsSaveReply {

    /// Reserved for a request that got no HTTP answer at all.
    static let connectionMessage = "Couldn't save — check your connection"

    // MARK: Refusals

    /// The server's own sentence for a refused save, or a generic one naming the
    /// status when the body has none (an HTML error page, an empty body, JSON
    /// without `error`).
    static func errorMessage(status: Int, body: Data) -> String {
        if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
           let message = (obj["error"] as? String)?
               .trimmingCharacters(in: .whitespacesAndNewlines),
           !message.isEmpty {
            return message
        }
        return "Couldn't save — server error \(status)"
    }

    // MARK: Conflicts

    /// The ids the server kept its own copy of. Absent, empty, or a body that is
    /// not JSON all mean none. Ids are read flexibly — a numeric id arrives as a
    /// number, the same leniency `decodeFlexID` gives every model.
    static func conflicts(in body: Data) -> [String] {
        guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let raw = obj["conflicts"] as? [Any] else { return [] }
        return raw.compactMap { v in
            if let s = v as? String { return s.isEmpty ? nil : s }
            if let n = v as? NSNumber { return n.stringValue }
            return nil
        }
    }

    static func conflictMessage(count: Int) -> String {
        count == 1
            ? "1 job changed on the server and wasn't saved"
            : "\(count) jobs changed on the server and weren't saved"
    }

    /// `local` with each conflicted job put back to the server's copy. Only
    /// those ids are touched, so an edit made while the save was in flight
    /// survives. A conflicted job the server still has but `local` dropped comes
    /// back; one the server no longer has goes.
    static func replacingConflicts(_ ids: [String], in local: [Job],
                                   from server: [Job]) -> [Job] {
        let wanted = Set(ids)
        let serverByID = Dictionary(server.filter { wanted.contains($0.id) }.map { ($0.id, $0) },
                                    uniquingKeysWith: { first, _ in first })
        var out: [Job] = local.compactMap { job in
            guard wanted.contains(job.id) else { return job }
            return serverByID[job.id]
        }
        let present = Set(out.map(\.id))
        out += server.filter { wanted.contains($0.id) && !present.contains($0.id) }
        return out
    }
}
