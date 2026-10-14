import Foundation

// MARK: - What a status means
//
// `src/statusMeaning.js` (#504), ported. `statusOpts` is the ORG's list, editable in Settings,
// and two of its names carried meaning by spelling alone:
//
//   finished   credit no more hours to it, roll progress to 100%, setting it needs
//              approveCompletions, an approval writes it
//   active     what a job clock-in stamps (server-side); "In Progress" everywhere iOS counts work
//
// On the phone that spelling was `JobStatus(rawValue:)` — exact, case-sensitive — so an org that
// renamed "Finished" to "Complete" had no finished work on iOS at all, and Matrix's eleven jobs
// stored as lowercase "finished" were never finished here even before any rename.
//
// THE FLAGS: an entry may carry `isFinished: true` / `isActive: true`. For each flag separately,
// a list where NO entry carries it reads that meaning from the name ("finished", "in progress",
// normalised) — every org's list until the web's options editor saves it — so nothing moves
// until the list is saved. A status not in the list (or no list) is decided by its name, as
// everything was before the flag.
//
// iOS serves one org, so this is the web's PAGE-LEVEL form: AppState sets it whenever org
// settings change, and `Job` / `Panel` / `Operation.status` read through it. That is what moves
// every `status == .finished` and `status = .inProgress` in the app at once, rather than one
// call site at a time. Tests pin a list without touching the app's:
// `StatusMeaning.$override.withValue(meaning) { … }`.
struct StatusMeaning: Equatable, Sendable {

    struct Entry: Equatable, Sendable {
        let name: String
        let isFinished: Bool
        let isActive: Bool
    }

    /// The list with both flags resolved — `withMeanings`.
    let entries: [Entry]
    /// Exact stored name → meaning, so the common case (a status spelled as its list entry)
    /// costs one lookup, not a normalisation. `status` is read in every filter over every op.
    private let exact: [String: (fin: Bool, act: Bool)]
    private let normalized: [String: (fin: Bool, act: Bool)]

    static let defaultFinished = JobStatus.finished.rawValue
    static let defaultActive = JobStatus.inProgress.rawValue

    /// `normalizeStatus` (src/statusText.js): trimmed, inner runs collapsed, lowercased.
    static func normalize(_ s: String) -> String {
        s.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
    }

    private static let finishedKey = normalize(defaultFinished)
    private static let activeKey = normalize(defaultActive)

    /// From `orgSettings.statusOpts` as stored. Entries that are not objects are dropped, as the
    /// web's `list` drops them.
    init(statusOpts: [JSONValue]) {
        let rows: [(name: String, fin: Bool?, act: Bool?)] = statusOpts.compactMap {
            guard case .object(let o) = $0 else { return nil }
            let name: String
            switch o["name"] {
            case .string(let s): name = s
            case .some(let v):    name = v.text
            case .none:           name = ""
            }
            func flag(_ k: String) -> Bool { if case .bool(true) = o[k] { return true }; return false }
            return (name, flag("isFinished"), flag("isActive"))
        }
        let hasFin = rows.contains { $0.fin == true }
        let hasAct = rows.contains { $0.act == true }
        entries = rows.map { r in
            let key = Self.normalize(r.name)
            return Entry(name: r.name,
                         isFinished: hasFin ? r.fin == true : key == Self.finishedKey,
                         isActive: hasAct ? r.act == true : key == Self.activeKey)
        }
        // Several entries may share a name once normalised (Matrix: "Finished" AND "finished");
        // a status matching any of them means what ANY of them means — the web's `hit.some`.
        var ex: [String: (fin: Bool, act: Bool)] = [:]
        var nm: [String: (fin: Bool, act: Bool)] = [:]
        for e in entries {
            let k = Self.normalize(e.name)
            let n = nm[k] ?? (false, false)
            nm[k] = (n.fin || e.isFinished, n.act || e.isActive)
        }
        for e in entries { ex[e.name] = nm[Self.normalize(e.name)] }
        exact = ex
        normalized = nm
    }

    /// No list: every meaning read from the name.
    static let byName = StatusMeaning(statusOpts: [])

    private func meaning(_ status: String) -> (fin: Bool, act: Bool) {
        if let m = exact[status] { return m }
        let k = Self.normalize(status)
        if let m = normalized[k] { return m }
        return (k == Self.finishedKey, k == Self.activeKey)
    }

    /// `isFinishedStatus`.
    func isFinished(_ status: String) -> Bool { meaning(status).fin }
    /// `isActiveStatus`.
    func isActive(_ status: String) -> Bool { meaning(status).act }

    /// `finishedStatusName` — what an approval writes: the org's first finished entry.
    var finishedName: String { entries.first(where: \.isFinished)?.name ?? Self.defaultFinished }
    /// `activeStatusName` — the org's first in-progress entry.
    var activeName: String { entries.first(where: \.isActive)?.name ?? Self.defaultActive }

    /// The enum view of a stored status. `.finished` and `.inProgress` are the two MEANINGS and
    /// come from the list; the other three cases are names, outside #504's ruling, and match
    /// exactly as before. Anything else is `.notStarted`, as an unmodelled status always was.
    func status(of raw: String) -> JobStatus {
        known(raw) ?? .notStarted
    }

    /// As `status(of:)`, but nil for a status iOS has no case for.
    func known(_ raw: String) -> JobStatus? {
        let m = meaning(raw)
        if m.fin { return .finished }
        if m.act { return .inProgress }
        switch JobStatus(rawValue: raw) {
        case .finished?, .inProgress?, nil: return nil   // a name the list says means neither
        case let other?:                    return other
        }
    }

    /// What to store for an enum case: the org's own name for the two meanings.
    func raw(for status: JobStatus) -> String {
        switch status {
        case .finished:   return finishedName
        case .inProgress: return activeName
        default:          return status.rawValue
        }
    }

    static func == (a: StatusMeaning, b: StatusMeaning) -> Bool { a.entries == b.entries }

    // MARK: Which org

    private static let lock = NSLock()
    nonisolated(unsafe) private static var stored = StatusMeaning.byName

    @TaskLocal static var override: StatusMeaning?

    /// The list every status read goes through. By name until the org's settings load.
    static var current: StatusMeaning {
        if let o = override { return o }
        lock.lock(); defer { lock.unlock() }
        return stored
    }

    /// `setOrgStatuses` — AppState calls this whenever orgSettings change.
    static func set(org: OrgSettings) {
        let next = StatusMeaning(statusOpts: org.statusOpts)
        lock.lock(); defer { lock.unlock() }
        stored = next
    }
}

extension OrgSettings {
    /// `orgSettings.statusOpts` — the org's status list, kept in extras (the web owns it; the
    /// passthrough writes it back untouched). Empty when unset.
    var statusOpts: [JSONValue] {
        if case .array(let a) = extras["statusOpts"] { return a }
        return []
    }
}

// MARK: - The list a person picks from

/// One row of the org's status list, as a picker shows it.
struct StatusChoice: Equatable, Sendable {
    let name: String
    /// The org's colour and glyph for it, when the entry carries them.
    let color: String?
    let icon: String?
}

extension OrgSettings {
    /// The web's `statusOpts` memo (TRAQS.jsx:6040): the org's list in its order, or
    /// `DEFAULT_STATUSES` when it is unset or empty. What a status picker offers — all
    /// seventeen at Matrix, not the five `JobStatus` names (#544).
    var statusChoices: [StatusChoice] {
        let rows: [StatusChoice] = statusOpts.compactMap {
            guard case .object(let o) = $0, let name = o["name"]?.text else { return nil }
            func text(_ k: String) -> String? { o[k].map(\.text).flatMap { $0.isEmpty ? nil : $0 } }
            return StatusChoice(name: name, color: text("color"), icon: text("icon"))
        }
        return rows.isEmpty
            ? JobStatus.allCases.map { StatusChoice(name: $0.rawValue, color: nil, icon: nil) }
            : rows
    }
}
