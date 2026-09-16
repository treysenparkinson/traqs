import Foundation

// MARK: - The approval state behind the Approval and Activity columns
//
// `apprStateFor` (TRAQS.jsx:11200) and `apprActivityFor` (:11272), plus the four
// writers they drive — `signOffEngineering` (:9771), `revertEngineering` (:9802),
// `signChainStep` (:9831), `signOffStep` (:9846) — and the chain editors
// `setPanelChain` / `removePanelChain` (:9827).
//
// This replaced the web's old Approval Queue page: the same approval shapes the
// queue used to flatten into rows are read per grid row instead.
//
// WHERE IT LIVES. None of `apprChain`, `signOffs` or `apprLog` is a modelled
// property on `Panel`; all three ride in `Panel.extras`, which is what kept them
// alive through the unmodelled-field bug. They stay there deliberately rather
// than being promoted to stored properties:
//
//   * Promoting one means adding it to `CodingKeys` AND to `encode(to:)`, with
//     nothing enforcing the pair at compile time. That is the single documented
//     footgun in this model layer and the way the approval data was destroyed the
//     first time.
//   * The passthrough already round-trips them losslessly, including any key the
//     web adds next week that this file does not know about.
//
// So this file is the typed VIEW over those three keys, and the only place that
// knows how they are shaped. Reading decodes; writing encodes back into `extras`
// under the same key.
//
// Pure — a Job in, a Job out, every lookup passed in. Same convention as
// `JobsEdit`, `JobsQuery` and `JobsProgress`, and here for the strongest version
// of the usual reason: a wrong write in this file forges somebody's signature.

// MARK: One signature

/// `{ by, byName, at }` — what a signed step records. The same shape the
/// modelled `EngineeringSignOff` has, and deliberately a separate type: this one
/// is decoded out of untyped JSON and has to survive a missing or numeric `by`.
struct ApprovalRecord: Codable, Equatable {
    var by: String
    var byName: String
    var at: String

    init(by: String, byName: String, at: String) {
        self.by = by; self.byName = byName; self.at = at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        by     = (try? c.decodeFlexID(forKey: .by)) ?? ""
        byName = (try? c.decode(String.self, forKey: .byName)) ?? ""
        at     = (try? c.decode(String.self, forKey: .at)) ?? ""
    }
}

// MARK: One step of a custom chain
//
// `panel.apprChain[i]` — `{ label, done, by, byName, at, assigneeId }`. Note the
// signature is FLAT on the step here rather than nested in a record, which is why
// this cannot reuse `ApprovalRecord` for storage even though it reads as one.

struct ApprovalChainStep: Codable, Equatable {
    var label: String
    var done: Bool
    var by: String?
    var byName: String?
    var at: String?
    var assigneeId: String?

    /// Anything the web keeps on a step that is not named above. Same rule as the
    /// models: rewriting a chain must not drop a key somebody else wrote.
    var extras = JSONExtras()

    enum CodingKeys: String, CodingKey, CaseIterable {
        case label, done, by, byName, at, assigneeId
    }

    static var knownKeys: Set<String> { Set(CodingKeys.allCases.map(\.rawValue)) }

    init(label: String, done: Bool = false, by: String? = nil, byName: String? = nil,
         at: String? = nil, assigneeId: String? = nil) {
        self.label = label; self.done = done; self.by = by
        self.byName = byName; self.at = at; self.assigneeId = assigneeId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        extras     = JSONExtras(from: decoder, known: Self.knownKeys)
        label      = (try? c.decode(String.self, forKey: .label)) ?? ""
        done       = (try? c.decode(Bool.self, forKey: .done)) ?? false
        by         = c.decodeFlexIDIfPresent(forKey: .by)
        byName     = try? c.decodeIfPresent(String.self, forKey: .byName)
        at         = try? c.decodeIfPresent(String.self, forKey: .at)
        assigneeId = c.decodeFlexIDIfPresent(forKey: .assigneeId)
    }

    /// `extras` FIRST — see `JSONExtras.encode(to:)`.
    func encode(to encoder: Encoder) throws {
        try extras.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(label, forKey: .label)
        try c.encode(done, forKey: .done)
        try c.encodeIfPresent(by, forKey: .by)
        try c.encodeIfPresent(byName, forKey: .byName)
        try c.encodeIfPresent(at, forKey: .at)
        try c.encodeIfPresent(assigneeId, forKey: .assigneeId)
    }

    /// The signature on this step, or nil while it is unsigned. `done` is what the
    /// web tests, not the presence of `at` — a step can be marked done by an edit
    /// that carries no timestamp.
    var record: ApprovalRecord? {
        guard done else { return nil }
        return ApprovalRecord(by: by ?? "", byName: byName ?? "", at: at ?? "")
    }
}

// MARK: One entry in the trail
//
// `panel.apprLog` (TRAQS.jsx:9739). Append-only, capped at 20.
//
// It cannot be derived from the step records, and the web's comment says why: a
// signature lives ON the step, so reverting one erases it and a derived "latest"
// would silently fall back to an OLDER signature and read as though nothing
// happened. Editing the step list leaves no step record at all.

struct ApprovalLogEntry: Codable, Equatable {
    /// The stored key — `set` / `cleared` / `signed` / `reverted` / `steps` /
    /// `removed`. Kept separate from the wording so the wording can change
    /// without rewriting history in tasks.json.
    var action: String
    var step: String
    var by: String?
    var byName: String
    var at: String

    init(action: String, step: String, by: String?, byName: String, at: String) {
        self.action = action; self.step = step; self.by = by
        self.byName = byName; self.at = at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        action = (try? c.decode(String.self, forKey: .action)) ?? ""
        step   = (try? c.decode(String.self, forKey: .step)) ?? ""
        by     = c.decodeFlexIDIfPresent(forKey: .by)
        byName = (try? c.decode(String.self, forKey: .byName)) ?? ""
        at     = (try? c.decode(String.self, forKey: .at)) ?? ""
    }

    /// `APPR_VERB` (TRAQS.jsx:107) — what the Activity cell prints for an action.
    var verb: String {
        switch action {
        case "set":      return "Set to"
        case "cleared":  return "Approval cleared"
        case "signed":   return "Signed"
        case "reverted": return "Reverted"
        case "steps":    return "Steps changed"
        case "removed":  return "Approval removed"
        // The web falls back to the raw action, then to "Changed".
        default:         return action.isEmpty ? "Changed" : action
        }
    }

    /// `APPR_VERB_COLOR` — green for a signature, amber for a reversion, and the
    /// body colour for everything else. nil means "use `T.text`", which this file
    /// cannot name because it has no SwiftUI.
    var verbHex: String? {
        switch action {
        case "signed":   return "#10b981"
        case "reverted": return "#f59e0b"
        default:         return nil
        }
    }
}

// MARK: A sign-off template
//
// `orgSettings.signOffTemplates` — `{ id, name, steps: [String] }`. Unmodelled on
// `OrgSettings`, so it is read out of its passthrough the same way.

struct SignOffTemplate: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var steps: [String]

    init(id: String, name: String, steps: [String]) {
        self.id = id; self.name = name; self.steps = steps
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id    = (try? c.decodeFlexID(forKey: .id)) ?? ""
        name  = (try? c.decode(String.self, forKey: .name)) ?? ""
        steps = (try? c.decode([String].self, forKey: .steps)) ?? []
    }
}

// MARK: What one row's Approval cell shows

/// One step as the CELL sees it — a label, whether it is signed, and by whom.
/// Flattened from whichever of the three shapes is behind it, so the cell needs
/// to know only this.
struct ApprovalStepView: Equatable {
    var label: String
    var record: ApprovalRecord?
    var assigneeId: String?

    var isSigned: Bool { record != nil }
}

/// Which of the three shapes a panel is running. A panel carries AT MOST ONE, in
/// this precedence (TRAQS.jsx:11193):
///
///   1. `apprChain[]`          — a custom per-panel chain, supersedes the rest
///   2. `signOffs[templateId]` — one chain per enabled sign-off template
///   3. `engineering.{…}`      — the default chain, seeded on panel creation,
///                               which is why the cell populates on its own
enum ApprovalKind: Equatable {
    case chain
    case signOff(templateID: String)
    case engineering
    /// A JOB row. It has no approval of its own and rolls its panels up.
    case rollup
}

struct ApprovalState: Equatable {
    var kind: ApprovalKind
    /// Empty for a rollup — a job row prints counts, not chips.
    var steps: [ApprovalStepView] = []
    var done: Int = 0
    var total: Int = 0
    /// The newest signature across `steps`, for the Activity column's fallback.
    var latest: ApprovalStepView?
    /// How many panels the rollup covers. 1 for a panel's own state.
    var panelCount: Int = 1

    var allDone: Bool { total > 0 && done == total }

    /// The index of the first unsigned step — the ACTIVE one, and the only one an
    /// approver can click. nil once every step is signed.
    var activeIndex: Int? { steps.firstIndex { !$0.isSigned } }
}

/// What the Activity cell prints for one row.
struct ApprovalActivity: Equatable {
    var verb: String
    var step: String
    var byName: String
    var at: String
    /// nil = the theme's body colour.
    var verbHex: String?
}

// MARK: - Reading these off the JSON tree directly
//
// `JSONValue.decoded(_:)` round-trips through `JSONEncoder` + `JSONDecoder`, which
// is the right tool for something read once. It is the wrong tool here, and
// measurably so: the grid reads every panel's chain AND its whole activity trail
// on every redraw, so one round-trip per step and per log entry is thousands of
// encoder allocations per frame.
//
//   240 panels, 3 chain steps and 20 log entries each, release build:
//
//     approval index   45.3 ms   ->   0.9 ms
//     activity index  762.7 ms   ->   1.1 ms
//
//   against a 16 ms frame budget. The page took several seconds to show an edit.
//
// So the hot path reads fields off the tree by hand. Encoding still goes through
// Codable — a write happens once per click, not once per row per frame.

extension ApprovalRecord {
    init?(json: JSONValue?) {
        guard case .object(let o)? = json else { return nil }
        // `.text` already flattens a numeric `by`, which is what `decodeFlexID`
        // was doing on the Codable path.
        self.init(by: o["by"]?.text ?? "",
                  byName: o["byName"]?.text ?? "",
                  at: o["at"]?.text ?? "")
    }
}

extension ApprovalChainStep {
    init?(json: JSONValue) {
        guard case .object(let o) = json else { return nil }
        self.init(label: o["label"]?.text ?? "",
                  done: JSONValue.truth(o["done"]),
                  by: o["by"].map(\.text),
                  byName: o["byName"].map(\.text),
                  at: o["at"].map(\.text),
                  assigneeId: o["assigneeId"].map(\.text))
        // The same passthrough the Codable path captured: rewriting a chain must
        // not drop a key somebody else wrote.
        for (key, value) in o where !Self.knownKeys.contains(key) {
            extras[key] = value
        }
    }
}

extension ApprovalLogEntry {
    init?(json: JSONValue) {
        guard case .object(let o) = json else { return nil }
        self.init(action: o["action"]?.text ?? "",
                  step: o["step"]?.text ?? "",
                  by: o["by"].map(\.text),
                  byName: o["byName"]?.text ?? "",
                  at: o["at"]?.text ?? "")
    }
}

extension SignOffTemplate {
    init?(json: JSONValue) {
        guard case .object(let o) = json else { return nil }
        guard case .array(let rawSteps)? = o["steps"] else {
            self.init(id: o["id"]?.text ?? "", name: o["name"]?.text ?? "", steps: [])
            return
        }
        self.init(id: o["id"]?.text ?? "",
                  name: o["name"]?.text ?? "",
                  steps: rawSteps.map(\.text))
    }
}

extension JSONValue {
    /// The web writes booleans as booleans and, from a checkbox cell, as the
    /// strings "true"/"false".
    static func truth(_ value: JSONValue?) -> Bool {
        switch value {
        case .bool(let b):   return b
        case .string(let s): return s == "true"
        case .number(let d): return d != 0
        default:             return false
        }
    }
}

// MARK: - The org half, resolved once
//
// `signOffTemplates` and the three engineering labels come out of org settings,
// and `state(of:)` needs both. Reading them per panel meant decoding the whole
// template list once for every panel on the page, every redraw.

struct ApprovalContext {
    let templates: [SignOffTemplate]
    /// `approvalSteps` — the three engineering keys with their org labels.
    let engineeringSteps: [(key: String, label: String)]

    init(_ settings: OrgSettings) {
        if case .array(let raw)? = settings.extras["signOffTemplates"] {
            templates = raw.compactMap { SignOffTemplate(json: $0) }
        } else {
            templates = []
        }
        let labels = settings.approvalSteps
        engineeringSteps = [
            ("designed",       labels.count > 0 ? labels[0] : "Review"),
            ("verified",       labels.count > 1 ? labels[1] : "Approve"),
            ("sentToPerforex", labels.count > 2 ? labels[2] : "Release"),
        ]
    }
}

// MARK: -

enum JobsApproval {

    /// The web caps the trail so tasks.json cannot grow without bound. It is a
    /// recent-activity feed, not an audit archive.
    static let logCap = 20

    /// The three engineering steps and their org-configurable labels.
    /// `approvalSteps` (TRAQS.jsx:9820).
    static func engineeringSteps(_ settings: OrgSettings) -> [(key: String, label: String)] {
        let labels = settings.approvalSteps
        return [
            ("designed",       labels.count > 0 ? labels[0] : "Review"),
            ("verified",       labels.count > 1 ? labels[1] : "Approve"),
            ("sentToPerforex", labels.count > 2 ? labels[2] : "Release"),
        ]
    }

    /// `orgSettings.signOffTemplates || []`, out of the passthrough.
    ///
    /// Convenience. Anything walking more than one panel should build an
    /// `ApprovalContext` once instead — see the note on it.
    static func templates(_ settings: OrgSettings) -> [SignOffTemplate] {
        ApprovalContext(settings).templates
    }

    // MARK: Reading a panel

    static func chain(of panel: Panel) -> [ApprovalChainStep]? {
        guard case .array(let raw)? = panel.extras["apprChain"] else { return nil }
        return raw.compactMap { ApprovalChainStep(json: $0) }
    }

    /// `panel.signOffs` — `{ templateId: { "0": record|null, … } }`.
    static func signOffs(of panel: Panel) -> [String: JSONValue] {
        guard case .object(let o)? = panel.extras["signOffs"] else { return [:] }
        return o
    }

    /// One node's activity trail. Takes the passthrough rather than a `Panel`,
    /// because a JOB can carry one too — `apprActivityFor` reads `item`'s own log
    /// first at every level, and only THEN walks the panels.
    static func log(in extras: JSONExtras) -> [ApprovalLogEntry] {
        guard case .array(let raw)? = extras["apprLog"] else { return [] }
        return raw.compactMap { ApprovalLogEntry(json: $0) }
    }

    static func log(of panel: Panel) -> [ApprovalLogEntry] { log(in: panel.extras) }

    /// The newest entry on a trail, WITHOUT building the rest.
    ///
    /// The Activity column wants one entry out of twenty, and the cap means every
    /// panel on the page carries twenty. Scanning the raw array and converting
    /// only the winner is the difference between one conversion per panel and
    /// twenty.
    static func newestLogEntry(in extras: JSONExtras) -> ApprovalLogEntry? {
        guard case .array(let raw)? = extras["apprLog"] else { return nil }
        var best: JSONValue?
        var bestKey = -Double.greatestFiniteMagnitude
        for entry in raw {
            guard case .object(let o) = entry else { continue }
            let key = ApprovalDate.sortKey(o["at"]?.text) ?? -Double.greatestFiniteMagnitude
            // `>=`, so a TIE goes to the later element. The trail is append-only,
            // so array order is the real order and the timestamp is only a hint —
            // two entries can share a millisecond, and sign-then-revert in one
            // gesture routinely does. With a strict `>` the trail reported
            // "Signed" for an approval that had just been reverted, which is the
            // exact failure the log exists to prevent.
            if best == nil || key >= bestKey { best = entry; bestKey = key }
        }
        return best.flatMap { ApprovalLogEntry(json: $0) }
    }

    /// The single chain a panel is actually running — `forPanel` (:11209).
    ///
    /// Precedence, and it is exclusive: a panel with an `apprChain` never shows
    /// its engineering steps, even if it has both.
    static func state(of panel: Panel, settings: OrgSettings) -> ApprovalState? {
        state(of: panel, context: ApprovalContext(settings))
    }

    static func state(of panel: Panel, context: ApprovalContext) -> ApprovalState? {
        if let chain = chain(of: panel) {
            let steps = chain.map {
                ApprovalStepView(label: $0.label, record: $0.record,
                                 assigneeId: $0.assigneeId)
            }
            return finish(kind: .chain, steps: steps)
        }

        // The FIRST template this panel has a non-null entry for. A panel can only
        // run one, so the web takes the first match rather than merging them.
        let so = signOffs(of: panel)
        if let template = context.templates.first(where: {
            if let entry = so[$0.id] { return entry != .null }
            return false
        }) {
            let entry: [String: JSONValue]
            if case .object(let o)? = so[template.id] { entry = o } else { entry = [:] }
            let steps = template.steps.enumerated().map { index, label in
                ApprovalStepView(label: label,
                                 record: ApprovalRecord(json: entry[String(index)]),
                                 assigneeId: nil)
            }
            return finish(kind: .signOff(templateID: template.id), steps: steps)
        }

        // `panel.engineering !== undefined` on the web — the KEY being present,
        // not the value being truthy. Every place the web seeds it writes an
        // OBJECT (`{ designed: null, verified: null, sentToPerforex: null }`) and
        // never a literal null, so a non-nil `Engineering?` here is the same test:
        // absent decodes to nil, and a seeded-but-unsigned chain decodes to an
        // instance with three nil steps.
        if let engineering = panel.engineering {
            let steps = context.engineeringSteps.map { key, label in
                ApprovalStepView(label: label,
                                 record: engineering.record(for: key),
                                 assigneeId: nil)
            }
            return finish(kind: .engineering, steps: steps)
        }

        return nil
    }

    /// A JOB row — `apprStateFor` with `level === 0`. Sums every panel's chain and
    /// reports the newest signature across them. nil when no panel has a chain, so
    /// the cell draws nothing rather than "0/0".
    static func rollup(of job: Job, settings: OrgSettings) -> ApprovalState? {
        rollup(of: job, context: ApprovalContext(settings))
    }

    static func rollup(of job: Job, context: ApprovalContext) -> ApprovalState? {
        rollup(panelStates: job.subs.compactMap { state(of: $0, context: context) })
    }

    /// From states already computed, so an index pass that needs both a job's
    /// rollup and each of its panels' chains walks the panels ONCE.
    static func rollup(panelStates: [ApprovalState]) -> ApprovalState? {
        guard !panelStates.isEmpty else { return nil }

        var result = ApprovalState(kind: .rollup, panelCount: panelStates.count)
        for panel in panelStates {
            result.done += panel.done
            result.total += panel.total
            if let latest = panel.latest, isNewer(latest.record?.at, than: result.latest?.record?.at) {
                result.latest = latest
            }
        }
        return result
    }

    private static func finish(kind: ApprovalKind, steps: [ApprovalStepView]) -> ApprovalState {
        var state = ApprovalState(kind: kind, steps: steps)
        state.done = steps.filter(\.isSigned).count
        state.total = steps.count
        state.latest = steps.reduce(nil) { best, step in
            guard step.record?.at.isEmpty == false else { return best }
            return isNewer(step.record?.at, than: best?.record?.at) ? step : best
        }
        return state
    }

    /// Whether `lhs` is the more recent stamp. An unparseable one loses to
    /// anything parseable.
    static func isNewer(_ lhs: String?, than rhs: String?) -> Bool {
        let a = ApprovalDate.sortKey(lhs), b = ApprovalDate.sortKey(rhs)
        guard let a else { return false }
        guard let b else { return true }
        return a > b
    }

    static func millis(_ stamp: String?) -> Double? {
        guard let stamp, !stamp.isEmpty else { return nil }
        return ApprovalDate.parse(stamp)?.timeIntervalSince1970
    }

    // MARK: The Activity cell
    //
    // `apprActivityFor` (:11272). Three sources, newest wins:
    //   1. the row's OWN apprLog — an Approval-dropdown change, or a chain action
    //      recorded on that panel
    //   2. for a job row, the newest entry across its panels, so a collapsed job
    //      still reports what happened underneath it
    //   3. a legacy fallback: the newest signature still sitting on the steps, for
    //      panels signed before the log existed

    static func activity(ofPanel panel: Panel, settings: OrgSettings) -> ApprovalActivity? {
        let context = ApprovalContext(settings)
        return activity(ofPanel: panel, state: state(of: panel, context: context))
    }

    /// The panel's state is passed IN rather than recomputed. It is only the
    /// fallback — used when the panel has no trail at all — and deriving it again
    /// meant the Activity pass repeated everything the Approval pass had just
    /// done, for every panel, every redraw.
    static func activity(ofPanel panel: Panel,
                         state: ApprovalState?) -> ApprovalActivity? {
        activity(from: newestLogEntry(in: panel.extras), fallback: state)
    }

    static func activity(ofJob job: Job, settings: OrgSettings) -> ApprovalActivity? {
        let context = ApprovalContext(settings)
        let states = job.subs.compactMap { state(of: $0, context: context) }
        return activity(ofJob: job, panelStates: states)
    }

    /// `apprActivityFor` at level 0: the job's OWN trail first — that read runs at
    /// every level, and only the panel walk is level-0 only — then the newest
    /// entry across its panels, so a collapsed job still reports what happened
    /// underneath it.
    static func activity(ofJob job: Job,
                         panelStates: [ApprovalState]) -> ApprovalActivity? {
        var best = newestLogEntry(in: job.extras)
        for panel in job.subs {
            if let entry = newestLogEntry(in: panel.extras),
               isNewer(entry.at, than: best?.at) { best = entry }
        }
        return activity(from: best, fallback: rollup(panelStates: panelStates))
    }

    private static func activity(from entry: ApprovalLogEntry?,
                                 fallback: ApprovalState?) -> ApprovalActivity? {
        if let entry {
            return ApprovalActivity(verb: entry.verb, step: entry.step,
                                    byName: entry.byName, at: entry.at,
                                    verbHex: entry.verbHex)
        }
        guard let latest = fallback?.latest, let record = latest.record else { return nil }
        return ApprovalActivity(verb: "Signed", step: latest.label,
                                byName: record.byName, at: record.at,
                                verbHex: "#10b981")
    }

    /// `newestApprLog` — the newest entry on one node's own trail.
    ///
    /// NOT simply the last element: the log is appended to in order, but two
    /// clients writing concurrently can interleave, so the timestamp decides.
    /// On a TIE the later element wins — see `newestLogEntry`, which explains why
    /// that is not a detail.
    static func newest(in log: [ApprovalLogEntry]) -> ApprovalLogEntry? {
        log.reduce(nil) { best, entry in
            guard let best else { return entry }
            return isNewer(best.at, than: entry.at) ? best : entry
        }
    }
}

// MARK: - Reading an engineering record by its key

extension Engineering {
    /// The three steps are stored as named properties but addressed by key
    /// everywhere the approval system touches them.
    func record(for key: String) -> ApprovalRecord? {
        let signOff: EngineeringSignOff?
        switch key {
        case "designed":       signOff = designed
        case "verified":       signOff = verified
        case "sentToPerforex": signOff = sentToPerforex
        default:               signOff = nil
        }
        guard let signOff else { return nil }
        return ApprovalRecord(by: signOff.by, byName: signOff.byName, at: signOff.at)
    }

    mutating func set(_ key: String, _ record: ApprovalRecord?) {
        let value = record.map {
            EngineeringSignOff(by: $0.by, byName: $0.byName, at: $0.at)
        }
        switch key {
        case "designed":       designed = value
        case "verified":       verified = value
        case "sentToPerforex": sentToPerforex = value
        default:               break
        }
    }
}

// MARK: - Parsing what the web wrote
//
// `new Date(iso).getTime()`. The stamps are `new Date().toISOString()`, so they
// are always `…Z` with milliseconds — but tasks.json is old enough to hold
// records written by earlier code, so both forms are tried.

enum ApprovalDate {

    /// A key that orders stamps, WITHOUT building a `Date`.
    ///
    /// `ISO8601DateFormatter.date(from:)` costs a few microseconds, and the
    /// Activity column asks "is this one newer" once per log entry per panel per
    /// redraw — thousands of times a frame. It also fails on the fractional form
    /// before the second formatter succeeds, so the common case paid for two.
    ///
    /// Every stamp this app writes is `new Date().toISOString()` — always UTC,
    /// always `yyyy-MM-ddTHH:mm:ss(.SSS)Z`. For those the digits ARE the order, so
    /// this reads them straight out by position and returns them as one number.
    /// Anything else falls back to the formatter, which is correct for a stamp
    /// carrying a real offset (`+02:00`) where a digit scan would not be.
    static func sortKey(_ stamp: String?) -> Double? {
        guard let stamp, !stamp.isEmpty else { return nil }
        if let fast = fastKey(stamp) { return fast }
        return parse(stamp)?.timeIntervalSince1970
    }

    /// `yyyy-MM-ddTHH:mm:ss` plus an optional `.SSS`, and a trailing `Z`.
    /// Returns nil — not a wrong answer — for anything else.
    private static func fastKey(_ stamp: String) -> Double? {
        let u = stamp.utf8
        guard u.count >= 20, u.last == UInt8(ascii: "Z") else { return nil }
        var digits: [Int] = []
        digits.reserveCapacity(7)
        var value = 0
        var count = 0

        for byte in u {
            switch byte {
            case UInt8(ascii: "0")...UInt8(ascii: "9"):
                value = value * 10 + Int(byte - UInt8(ascii: "0"))
                count += 1
            case UInt8(ascii: "-"), UInt8(ascii: ":"), UInt8(ascii: "T"),
                 UInt8(ascii: "."), UInt8(ascii: "Z"):
                if count > 0 { digits.append(value); value = 0; count = 0 }
            default:
                return nil          // an offset, a space, anything unexpected
            }
        }
        if count > 0 { digits.append(value) }
        // year, month, day, hour, minute, second, and optionally milliseconds.
        guard digits.count == 6 || digits.count == 7 else { return nil }
        let (y, mo, d, h, mi, sec) = (digits[0], digits[1], digits[2],
                                      digits[3], digits[4], digits[5])
        guard (1...12).contains(mo), (1...31).contains(d),
              h < 24, mi < 60, sec <= 60 else { return nil }
        let ms = digits.count == 7 ? digits[6] : 0

        // REAL epoch seconds, not a packed digit key.
        //
        // A packed key was the first version and it was wrong twice over: digits
        // concatenated to about 2e16, past the 2^53 where a Double still counts in
        // ones, so milliseconds fell off the end — and it put the fast path on a
        // completely different scale from the formatter fallback, so comparing one
        // of each always said the packed one was newer.
        return Double(epochDays(year: y, month: mo, day: d) * 86_400
                      + h * 3600 + mi * 60 + sec) + Double(ms) / 1000
    }

    /// Days since 1970-01-01 for a proleptic Gregorian date — Howard Hinnant's
    /// `days_from_civil`. Integer arithmetic, no `Calendar`, no time zone.
    private static func epochDays(year: Int, month: Int, day: Int) -> Int {
        let y = year - (month <= 2 ? 1 : 0)
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400                                   // 0...399
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy           // 0...146096
        return era * 146_097 + doe - 719_468
    }

    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ stamp: String) -> Date? {
        withFraction.date(from: stamp) ?? plain.date(from: stamp)
    }
}

// MARK: - Writing
//
// `signOffEngineering` (:9771), `revertEngineering` (:9802), `signChainStep`
// (:9831), `signOffStep` (:9846), `setPanelChain` and `removePanelChain` (:9827).
//
// Every one is pure: a Job in, a Job out, and the caller persists. Notifications
// are the caller's business too — `signOffEngineering` fires two of them, and a
// function that both computes and notifies cannot be tested.
//
// All six go through `mutating(panel:in:)`, so the apprLog append happens in
// exactly one place. The web has it in one place as well (`withApprLog`), and it
// is the reason the trail is trustworthy: a writer that forgets to log leaves an
// approval change that the Activity column reports as the PREVIOUS one.

extension JobsApproval {

    /// Who is signing. Passed in rather than read, so the rules stay pure.
    struct Actor: Equatable {
        var id: String
        var name: String
        /// `canApprove` — admin, `canSignOff`, or engineer (TRAQS.jsx:9736).
        var canApprove: Bool

        init(id: String, name: String, canApprove: Bool) {
            self.id = id; self.name = name; self.canApprove = canApprove
        }
    }

    /// Apply a change to one panel and append its log entry, or return the job
    /// untouched when the panel is gone — an inbound sync between the click and
    /// the commit must not throw away the rest of the tree.
    private static func mutating(panel panelID: String, in job: Job,
                                 action: String, step: String, by actor: Actor,
                                 at now: Date,
                                 _ change: (inout Panel) -> Void) -> Job {
        guard let index = job.subs.firstIndex(where: { $0.id == panelID }) else { return job }
        var job = job
        change(&job.subs[index])
        append(&job.subs[index], action: action, step: step, by: actor, at: now)
        return job
    }

    /// `apprLogAppend` — append one entry and keep the last `logCap`.
    private static func append(_ panel: inout Panel, action: String, step: String,
                               by actor: Actor, at now: Date) {
        var entries = log(of: panel)
        entries.append(ApprovalLogEntry(action: action, step: step,
                                        by: actor.id.isEmpty ? nil : actor.id,
                                        byName: actor.name,
                                        at: stamp(now)))
        if entries.count > logCap { entries.removeFirst(entries.count - logCap) }
        panel.extras.set("apprLog", .encoding(entries))
    }

    /// `new Date().toISOString()` — the format every stamp in tasks.json is in.
    static func stamp(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: date)
    }

    // MARK: Signing

    /// Sign the step at `index` of whatever chain the panel is running.
    ///
    /// ONE entry point for all three shapes, because the cell has one click and
    /// should not have to know which shape it is looking at. The web has three
    /// functions and the cell picks between them via `st.sign(i)`; this dispatches
    /// on the state's own `kind` instead, which cannot get out of step with the
    /// state that produced the chips.
    ///
    /// Returns the job untouched when the actor may not sign. `canApprove` gates
    /// all three on the web, with one exception it spells out in `signChainStep`:
    /// a step ASSIGNED to you is yours to sign even without the general
    /// permission.
    static func signing(step index: Int, panelID: String, in job: Job,
                        settings: OrgSettings, by actor: Actor,
                        at now: Date = Date()) -> Job {
        guard let panel = job.subs.first(where: { $0.id == panelID }),
              let state = state(of: panel, settings: settings),
              state.steps.indices.contains(index)
        else { return job }

        let step = state.steps[index]
        let mine = step.assigneeId.map { !$0.isEmpty && $0 == actor.id } ?? false
        guard actor.canApprove || mine else { return job }
        // Already signed. Re-signing would overwrite somebody else's signature
        // with yours, which is the one outcome this must never produce.
        guard !step.isSigned else { return job }

        let record = ApprovalRecord(by: actor.id, byName: actor.name, at: stamp(now))

        switch state.kind {
        case .chain:
            return mutating(panel: panelID, in: job, action: "signed",
                            step: step.label, by: actor, at: now) { panel in
                guard var steps = chain(of: panel), steps.indices.contains(index) else { return }
                steps[index].done = true
                steps[index].by = record.by
                steps[index].byName = record.byName
                steps[index].at = record.at
                panel.extras.set("apprChain", .encoding(steps))
            }

        case .signOff(let templateID):
            return mutating(panel: panelID, in: job, action: "signed",
                            step: step.label, by: actor, at: now) { panel in
                var all = signOffs(of: panel)
                var entry: [String: JSONValue]
                if case .object(let o)? = all[templateID] { entry = o } else { entry = [:] }
                entry[String(index)] = .encoding(record)
                all[templateID] = .object(entry)
                panel.extras.set("signOffs", .object(all))
            }

        case .engineering:
            let key = engineeringSteps(settings)[index].key
            return mutating(panel: panelID, in: job, action: "signed",
                            step: step.label, by: actor, at: now) { panel in
                // Seeded whole, not patched: the web writes
                // `{ designed: null, verified: null, sentToPerforex: null,
                //    ...(panel.engineering || {}), [step]: record }`, so a panel
                // whose object is missing a key gets all three.
                var engineering = panel.engineering ?? Engineering()
                engineering.set(key, record)
                panel.engineering = engineering
            }

        case .rollup:
            // A job row's chips are not clickable — signing happens on the panel
            // row that owns the step.
            return job
        }
    }

    // MARK: Reverting

    /// Un-sign a step AND every step after it.
    ///
    /// The cascade is not tidiness: `revertEngineering` slices `stepOrder` from
    /// the reverted step to the end, because a chain whose second step is signed
    /// and whose first is not describes an approval that never happened. The same
    /// rule is applied to all three shapes here — the web only implements it for
    /// the engineering one, and `revertStep` does the same for a template
    /// (`Number(k) >= stepIdx ? null : v`). A custom chain had no revert at all;
    /// this gives it the same behaviour rather than a fourth rule.
    static func reverting(step index: Int, panelID: String, in job: Job,
                          settings: OrgSettings, by actor: Actor,
                          at now: Date = Date()) -> Job {
        guard actor.canApprove,
              let panel = job.subs.first(where: { $0.id == panelID }),
              let state = state(of: panel, settings: settings),
              state.steps.indices.contains(index)
        else { return job }

        let label = state.steps[index].label

        switch state.kind {
        case .chain:
            return mutating(panel: panelID, in: job, action: "reverted",
                            step: label, by: actor, at: now) { panel in
                guard var steps = chain(of: panel) else { return }
                for i in steps.indices where i >= index {
                    steps[i].done = false
                    steps[i].by = nil
                    steps[i].byName = nil
                    steps[i].at = nil
                }
                panel.extras.set("apprChain", .encoding(steps))
            }

        case .signOff(let templateID):
            return mutating(panel: panelID, in: job, action: "reverted",
                            step: label, by: actor, at: now) { panel in
                var all = signOffs(of: panel)
                guard case .object(let entry)? = all[templateID] else { return }
                var next = entry
                for (key, value) in entry {
                    next[key] = (Int(key).map { $0 >= index } ?? false) ? .null : value
                }
                all[templateID] = .object(next)
                panel.extras.set("signOffs", .object(all))
            }

        case .engineering:
            let keys = engineeringSteps(settings).map(\.key)
            return mutating(panel: panelID, in: job, action: "reverted",
                            step: label, by: actor, at: now) { panel in
                var engineering = panel.engineering ?? Engineering()
                for (i, key) in keys.enumerated() where i >= index {
                    engineering.set(key, nil)
                }
                panel.engineering = engineering
            }

        case .rollup:
            return job
        }
    }

    // MARK: Editing the chain

    /// `setPanelChain` — replace the panel's custom chain outright.
    ///
    /// This is what "Edit Steps" saves, and it PROMOTES the panel to a custom
    /// chain whatever it was running before: the web writes `apprChain` and the
    /// precedence in `state(of:)` then makes it win over `signOffs` and
    /// `engineering`. That is intended — the menu seeds the editor from whichever
    /// chain was showing, so the steps carry over.
    static func settingChain(_ steps: [ApprovalChainStep], panelID: String,
                             in job: Job, by actor: Actor,
                             at now: Date = Date()) -> Job {
        guard actor.canApprove else { return job }
        let note = "to \(steps.count) step\(steps.count == 1 ? "" : "s")"
        return mutating(panel: panelID, in: job, action: "steps",
                        step: note, by: actor, at: now) { panel in
            panel.extras.set("apprChain", .encoding(steps))
        }
    }

    /// `removePanelChain` — drop the custom chain.
    ///
    /// Only the `apprChain` key goes. Whatever the panel had underneath it —
    /// a template's sign-offs, or its engineering steps — comes back, because the
    /// precedence in `state(of:)` falls through to it. The web does the same:
    /// `const { apprChain, ...rest } = p`.
    static func removingChain(panelID: String, in job: Job, by actor: Actor,
                              at now: Date = Date()) -> Job {
        guard actor.canApprove else { return job }
        return mutating(panel: panelID, in: job, action: "removed",
                        step: "", by: actor, at: now) { panel in
            panel.extras.set("apprChain", nil)
        }
    }
}

// MARK: - Seeding the editor
//
// The steps a panel is running, as EDITABLE chain steps.
//
// A custom chain is already in this shape. The other two are not, and converting
// them is what carries the signatures across: a template's records live in
// `signOffs[templateId]["0"]` and the engineering ones in
// `panel.engineering.designed`, but both become `done`/`by`/`byName`/`at` on a
// step here — which is exactly the shape the web's `seed` builds (:12222).

extension JobsApproval {
    static func editableSteps(of panel: Panel, settings: OrgSettings) -> [ApprovalChainStep] {
        // The custom chain, verbatim, including any per-step key this file does
        // not model — see `ApprovalChainStep.extras`.
        if let chain = chain(of: panel) { return chain }

        guard let state = state(of: panel, settings: settings) else { return [] }
        return state.steps.map { step in
            ApprovalChainStep(label: step.label,
                              done: step.isSigned,
                              by: step.record?.by,
                              byName: step.record?.byName,
                              at: step.record?.at,
                              assigneeId: step.assigneeId)
        }
    }
}
