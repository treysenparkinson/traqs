import Foundation

// MARK: - Flexible ID decoding (web app stores some IDs as Int, some as String)

extension KeyedDecodingContainer {
    /// Decodes a value that may be stored as either String or Int, returning a String.
    func decodeFlexID(forKey key: Key) throws -> String {
        if let s = try? decode(String.self, forKey: key) { return s }
        return String(try decode(Int.self, forKey: key))
    }

    /// Decodes an array where each element may be String or Int, returning [String].
    func decodeFlexIDs(forKey key: Key) -> [String] {
        if let arr = try? decode([String].self, forKey: key) { return arr }
        if let arr = try? decode([Int].self, forKey: key) { return arr.map { String($0) } }
        guard var u = try? nestedUnkeyedContainer(forKey: key) else { return [] }
        var result: [String] = []
        while !u.isAtEnd {
            if let s = try? u.decode(String.self) { result.append(s) }
            else if let i = try? u.decode(Int.self) { result.append(String(i)) }
            else { break }
        }
        return result
    }
}

// MARK: - Enums

enum JobStatus: String, Codable, CaseIterable {
    case notStarted = "Not Started"
    case pending = "Pending"
    case inProgress = "In Progress"
    case onHold = "On Hold"
    case finished = "Finished"
}

enum Priority: String, Codable, CaseIterable {
    case low = "Low"
    case medium = "Medium"
    case high = "High"
}

// MARK: - Engineering

struct EngineeringSignOff: Codable, Equatable {
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

struct Engineering: Codable, Equatable {
    var designed: EngineeringSignOff?
    var verified: EngineeringSignOff?
    var sentToPerforex: EngineeringSignOff?

    enum CodingKeys: String, CodingKey {
        case designed, verified, sentToPerforex
    }
}

// MARK: - Move Log

struct MoveLogEntry: Codable, Identifiable {
    var id: String { "\(date)-\(movedBy)" }
    var fromStart: String
    var fromEnd: String
    var toStart: String
    var toEnd: String
    var date: String
    var movedBy: String
    var reason: String?
}

// MARK: - Operation (Level 2)

struct Operation: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var start: String
    var end: String
    var status: JobStatus
    var pri: Priority
    var team: [String]
    var hpd: Double
    var notes: String
    var deps: [String]
    var locked: Bool?
    var moveLog: [MoveLogEntry]?
    var pid: String?
    var pendingFinish: Bool?
    /// Hours logged against this operation — written by the desktop's
    /// `jobClockOut` handler each time someone stops their timer on this op.
    var loggedHours: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id     = try c.decode(String.self, forKey: .id)
        title  = try c.decode(String.self, forKey: .title)
        start  = try c.decode(String.self, forKey: .start)
        end    = try c.decode(String.self, forKey: .end)
        status = (try? c.decode(JobStatus.self, forKey: .status)) ?? .notStarted
        pri    = (try? c.decode(Priority.self, forKey: .pri)) ?? .medium
        team   = c.decodeFlexIDs(forKey: .team)
        hpd    = (try? c.decode(Double.self, forKey: .hpd)) ?? 7.5
        notes  = (try? c.decode(String.self, forKey: .notes)) ?? ""
        deps   = (try? c.decode([String].self, forKey: .deps)) ?? []
        locked       = try? c.decodeIfPresent(Bool.self, forKey: .locked)
        moveLog      = try? c.decodeIfPresent([MoveLogEntry].self, forKey: .moveLog)
        pid          = try? c.decodeIfPresent(String.self, forKey: .pid)
        pendingFinish = try? c.decodeIfPresent(Bool.self, forKey: .pendingFinish)
        loggedHours  = try? c.decodeIfPresent(Double.self, forKey: .loggedHours)
    }

    static func == (lhs: Operation, rhs: Operation) -> Bool { lhs.id == rhs.id }
}

// MARK: - Panel Attachment

/// A file (usually a clock-out photo) attached to a panel. Shape mirrors the
/// web app's `panel.attachments` entries: the S3 `key` + `filename` come from
/// the attachment upload endpoint; the rest is provenance written client-side.
struct PanelAttachment: Codable, Identifiable, Equatable {
    var key: String
    var filename: String
    var mimeType: String?
    var size: Int?
    var uploadedById: String?
    var uploadedByName: String?
    var uploadedAt: String?
    var opId: String?

    var id: String { key }

    init(key: String, filename: String, mimeType: String? = nil, size: Int? = nil,
         uploadedById: String? = nil, uploadedByName: String? = nil,
         uploadedAt: String? = nil, opId: String? = nil) {
        self.key = key; self.filename = filename; self.mimeType = mimeType; self.size = size
        self.uploadedById = uploadedById; self.uploadedByName = uploadedByName
        self.uploadedAt = uploadedAt; self.opId = opId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key            = (try? c.decode(String.self, forKey: .key)) ?? ""
        filename       = (try? c.decode(String.self, forKey: .filename)) ?? ""
        mimeType       = try? c.decodeIfPresent(String.self, forKey: .mimeType)
        size           = try? c.decodeIfPresent(Int.self, forKey: .size)
        uploadedById   = try? c.decodeIfPresent(String.self, forKey: .uploadedById)
        uploadedByName = try? c.decodeIfPresent(String.self, forKey: .uploadedByName)
        uploadedAt     = try? c.decodeIfPresent(String.self, forKey: .uploadedAt)
        opId           = try? c.decodeIfPresent(String.self, forKey: .opId)
    }
}

// MARK: - Panel (Level 1)

struct Panel: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var start: String
    var end: String
    var status: JobStatus
    var pri: Priority
    var team: [String]
    var hpd: Double
    var notes: String
    var deps: [String]
    var engineering: Engineering?
    var subs: [Operation]
    /// Photos / files attached to this panel (e.g. the clock-out photo of the
    /// finished panel). Mirrors the web app's `panel.attachments`.
    var attachments: [PanelAttachment] = []

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id          = try c.decode(String.self, forKey: .id)
        title       = try c.decode(String.self, forKey: .title)
        start       = try c.decode(String.self, forKey: .start)
        end         = try c.decode(String.self, forKey: .end)
        status      = (try? c.decode(JobStatus.self, forKey: .status)) ?? .notStarted
        pri         = (try? c.decode(Priority.self, forKey: .pri)) ?? .medium
        team        = c.decodeFlexIDs(forKey: .team)
        hpd         = (try? c.decode(Double.self, forKey: .hpd)) ?? 7.5
        notes       = (try? c.decode(String.self, forKey: .notes)) ?? ""
        deps        = (try? c.decode([String].self, forKey: .deps)) ?? []
        engineering = try? c.decodeIfPresent(Engineering.self, forKey: .engineering)
        subs        = (try? c.decode([Operation].self, forKey: .subs)) ?? []
        attachments = (try? c.decode([PanelAttachment].self, forKey: .attachments)) ?? []
    }

    static func == (lhs: Panel, rhs: Panel) -> Bool { lhs.id == rhs.id }
}

// MARK: - Job (Level 0)

struct Job: Codable, Identifiable, Equatable, Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    var id: String
    var title: String
    var jobNumber: String?
    var poNumber: String?
    var start: String
    var end: String
    var dueDate: String?
    var status: JobStatus
    var pri: Priority
    var team: [String]
    var color: String
    var hpd: Double
    var notes: String
    var clientId: String?
    var deps: [String]
    var subs: [Panel]
    var moveLog: [MoveLogEntry]?
    var jobType: String?
    var loggedHours: Double?
    var projectManagerId: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id        = try c.decode(String.self, forKey: .id)
        title     = try c.decode(String.self, forKey: .title)
        start     = try c.decode(String.self, forKey: .start)
        end       = try c.decode(String.self, forKey: .end)
        status    = (try? c.decode(JobStatus.self, forKey: .status)) ?? .notStarted
        pri       = (try? c.decode(Priority.self, forKey: .pri)) ?? .medium
        team      = c.decodeFlexIDs(forKey: .team)
        color     = (try? c.decode(String.self, forKey: .color)) ?? "#7c3aed"
        hpd       = (try? c.decode(Double.self, forKey: .hpd)) ?? 7.5
        notes     = (try? c.decode(String.self, forKey: .notes)) ?? ""
        deps      = (try? c.decode([String].self, forKey: .deps)) ?? []
        subs      = (try? c.decode([Panel].self, forKey: .subs)) ?? []
        jobNumber = try? c.decodeIfPresent(String.self, forKey: .jobNumber)
        poNumber  = try? c.decodeIfPresent(String.self, forKey: .poNumber)
        dueDate   = try? c.decodeIfPresent(String.self, forKey: .dueDate)
        clientId  = try? c.decodeIfPresent(String.self, forKey: .clientId)
        moveLog   = try? c.decodeIfPresent([MoveLogEntry].self, forKey: .moveLog)
        jobType   = try? c.decodeIfPresent(String.self, forKey: .jobType)
        loggedHours = try? c.decodeIfPresent(Double.self, forKey: .loggedHours)
        projectManagerId = try? c.decodeFlexID(forKey: .projectManagerId)
    }

    // Explicit memberwise init (needed because init(from:) in struct body suppresses synthesis)
    init(id: String, title: String, jobNumber: String? = nil, poNumber: String? = nil,
         start: String, end: String, dueDate: String? = nil,
         status: JobStatus = .notStarted, pri: Priority = .medium,
         team: [String] = [], color: String = "#3d7fff", hpd: Double = 7.5,
         notes: String = "", clientId: String? = nil, deps: [String] = [],
         subs: [Panel] = [], moveLog: [MoveLogEntry]? = nil, jobType: String? = nil,
         loggedHours: Double? = nil, projectManagerId: String? = nil) {
        self.id = id; self.title = title; self.jobNumber = jobNumber; self.poNumber = poNumber
        self.start = start; self.end = end; self.dueDate = dueDate
        self.status = status; self.pri = pri; self.team = team; self.color = color
        self.hpd = hpd; self.notes = notes; self.clientId = clientId
        self.deps = deps; self.subs = subs; self.moveLog = moveLog; self.jobType = jobType
        self.loggedHours = loggedHours; self.projectManagerId = projectManagerId
    }

    static func == (lhs: Job, rhs: Job) -> Bool { lhs.id == rhs.id }

    var displayNumber: String {
        jobNumber.map { "#\($0)" } ?? ""
    }
}

// MARK: - Admin Permissions

struct AdminPerms: Codable, Equatable {
    var editJobs: Bool
    var moveJobs: Bool
    var reassign: Bool
    var lockJobs: Bool
    var manageTeam: Bool
    var manageClients: Bool
    var undoHistory: Bool
    var orgSettings: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        editJobs      = (try? c.decode(Bool.self, forKey: .editJobs)) ?? false
        moveJobs      = (try? c.decode(Bool.self, forKey: .moveJobs)) ?? false
        reassign      = (try? c.decode(Bool.self, forKey: .reassign)) ?? false
        lockJobs      = (try? c.decode(Bool.self, forKey: .lockJobs)) ?? false
        manageTeam    = (try? c.decode(Bool.self, forKey: .manageTeam)) ?? false
        manageClients = (try? c.decode(Bool.self, forKey: .manageClients)) ?? false
        undoHistory   = (try? c.decode(Bool.self, forKey: .undoHistory)) ?? false
        orgSettings   = (try? c.decode(Bool.self, forKey: .orgSettings)) ?? false
    }
}

// MARK: - Time Off

struct TimeOffEntry: Codable, Identifiable {
    var id: String { "\(start)-\(end)-\(type)" }
    var start: String
    var end: String
    var type: String   // "PTO" | "UTO"
    var reason: String?
}

// MARK: - Time Clock

struct ClockEvent: Codable, Equatable {
    var type: String   // "lunchStart" | "lunchEnd" | "breakStart" | "breakEnd"
    var ts: String     // ISO8601
}

struct JobRef: Codable, Equatable {
    var jobId: String
    var jobName: String
}

struct ActiveClockIn: Codable, Equatable {
    var clockIn: String
    var jobRefs: [JobRef]
    var events: [ClockEvent]

    init(clockIn: String, jobRefs: [JobRef], events: [ClockEvent]) {
        self.clockIn = clockIn; self.jobRefs = jobRefs; self.events = events
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        clockIn  = (try? c.decode(String.self,        forKey: .clockIn))  ?? ""
        jobRefs  = (try? c.decode([JobRef].self,      forKey: .jobRefs))  ?? []
        events   = (try? c.decode([ClockEvent].self,  forKey: .events))   ?? []
    }
}

/// One historical pay-clock entry from the server's timeclock.json. Each
/// entry is either a completed clock-in/out span (with hours) or a single
/// event row (lunchStart, lunchEnd, breakStart, breakEnd) — desktop's
/// admin view groups them. iOS needs the model to read them.
struct TimeclockEntry: Codable, Equatable, Identifiable {
    var id: String
    var personId: String
    var date: String?           // "YYYY-MM-DD"
    var clockIn: String?        // ISO8601 (may have ms)
    var clockOut: String?       // ISO8601 (may have ms)
    var hours: Double?
    var jobRefs: [JobRef]?
    var note: String?
    var eventType: String?      // present for lunchStart/lunchEnd/breakStart/breakEnd rows
    var timestamp: String?      // ISO8601 for event-type rows

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id         = (try? c.decodeFlexID(forKey: .id)) ?? ""
        personId   = (try? c.decodeFlexID(forKey: .personId)) ?? ""
        date       = try? c.decodeIfPresent(String.self, forKey: .date)
        clockIn    = try? c.decodeIfPresent(String.self, forKey: .clockIn)
        clockOut   = try? c.decodeIfPresent(String.self, forKey: .clockOut)
        hours      = try? c.decodeIfPresent(Double.self, forKey: .hours)
        jobRefs    = try? c.decodeIfPresent([JobRef].self, forKey: .jobRefs)
        note       = try? c.decodeIfPresent(String.self, forKey: .note)
        eventType  = try? c.decodeIfPresent(String.self, forKey: .eventType)
        timestamp  = try? c.decodeIfPresent(String.self, forKey: .timestamp)
    }
}

/// One completed job-clock session (timestamped) from the server's
/// jobsessions.json. Lets the app report job hours within a pay period —
/// the `loggedHours` totals on each job/op are cumulative (all-time) only.
struct JobSession: Codable, Equatable, Identifiable {
    var id: String
    var personId: String
    var jobId: String
    var panelId: String?
    var opId: String?
    var jobTitle: String?
    var panelTitle: String?
    var opTitle: String?
    var clockIn: String?
    var clockOut: String?
    var hours: Double?
    var date: String?           // "YYYY-MM-DD"

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id         = (try? c.decodeFlexID(forKey: .id)) ?? ""
        personId   = (try? c.decodeFlexID(forKey: .personId)) ?? ""
        jobId      = (try? c.decodeFlexID(forKey: .jobId)) ?? ""
        panelId    = try? c.decodeFlexID(forKey: .panelId)
        opId       = try? c.decodeFlexID(forKey: .opId)
        jobTitle   = try? c.decodeIfPresent(String.self, forKey: .jobTitle)
        panelTitle = try? c.decodeIfPresent(String.self, forKey: .panelTitle)
        opTitle    = try? c.decodeIfPresent(String.self, forKey: .opTitle)
        clockIn    = try? c.decodeIfPresent(String.self, forKey: .clockIn)
        clockOut   = try? c.decodeIfPresent(String.self, forKey: .clockOut)
        hours      = try? c.decodeIfPresent(Double.self, forKey: .hours)
        date       = try? c.decodeIfPresent(String.self, forKey: .date)
    }
}

// MARK: - Time Off Request (PTO/UTO approval workflow → person.timeOff on approve)

struct TimeOffRequest: Codable, Equatable, Identifiable {
    var id: String
    var personId: String
    var personName: String
    var type: String        // "PTO" (paid) | "UTO" (unpaid)
    var start: String       // "YYYY-MM-DD"
    var end: String         // "YYYY-MM-DD"
    var note: String
    var status: String      // "pending" | "approved" | "denied" | "cancelled"
    var createdAt: String?
    var decidedBy: String?
    var decidedByName: String?
    var decidedAt: String?
    var denialReason: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id            = (try? c.decodeFlexID(forKey: .id)) ?? ""
        personId      = (try? c.decodeFlexID(forKey: .personId)) ?? ""
        personName    = (try? c.decodeIfPresent(String.self, forKey: .personName)) ?? ""
        type          = (try? c.decodeIfPresent(String.self, forKey: .type)) ?? "PTO"
        start         = (try? c.decodeIfPresent(String.self, forKey: .start)) ?? ""
        end           = (try? c.decodeIfPresent(String.self, forKey: .end)) ?? ""
        note          = (try? c.decodeIfPresent(String.self, forKey: .note)) ?? ""
        status        = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? "pending"
        createdAt     = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        decidedBy     = try? c.decodeFlexID(forKey: .decidedBy)
        decidedByName = try? c.decodeIfPresent(String.self, forKey: .decidedByName)
        decidedAt     = try? c.decodeIfPresent(String.self, forKey: .decidedAt)
        denialReason  = try? c.decodeIfPresent(String.self, forKey: .denialReason)
    }
}

// MARK: - Active Job Clock (single in-progress job per person, separate from payroll clock)

struct ActiveJobClock: Codable, Equatable {
    var clockIn: String
    var jobId: String
    var panelId: String?
    var opId: String?
    var jobTitle: String?
    var panelTitle: String?
    var opTitle: String?
    var pausedAt: String?
    var totalPausedMs: Double?

    init(clockIn: String, jobId: String, panelId: String? = nil, opId: String? = nil,
         jobTitle: String? = nil, panelTitle: String? = nil, opTitle: String? = nil,
         pausedAt: String? = nil, totalPausedMs: Double? = nil) {
        self.clockIn = clockIn; self.jobId = jobId; self.panelId = panelId; self.opId = opId
        self.jobTitle = jobTitle; self.panelTitle = panelTitle; self.opTitle = opTitle
        self.pausedAt = pausedAt; self.totalPausedMs = totalPausedMs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        clockIn       = (try? c.decode(String.self, forKey: .clockIn)) ?? ""
        jobId         = (try? c.decodeFlexID(forKey: .jobId)) ?? ""
        panelId       = try? c.decodeFlexID(forKey: .panelId)
        opId          = try? c.decodeFlexID(forKey: .opId)
        jobTitle      = try? c.decodeIfPresent(String.self, forKey: .jobTitle)
        panelTitle    = try? c.decodeIfPresent(String.self, forKey: .panelTitle)
        opTitle       = try? c.decodeIfPresent(String.self, forKey: .opTitle)
        pausedAt      = try? c.decodeIfPresent(String.self, forKey: .pausedAt)
        totalPausedMs = try? c.decodeIfPresent(Double.self, forKey: .totalPausedMs)
    }

    var isPaused: Bool { pausedAt != nil }
}

// MARK: - Active Break (lightweight status, independent of the job/payroll clock)
//
// Set when a worker taps "Break". The job clock keeps running — this is purely
// a status + payroll log. `durationMinutes` is a snapshot of the configured
// break length at start time; it drives the reminder and the "time left / over
// by" display but does NOT auto-end the break (the worker ends it manually).

struct ActiveBreak: Codable, Equatable {
    var startedAt: String        // ISO8601
    var durationMinutes: Int

    init(startedAt: String, durationMinutes: Int) {
        self.startedAt = startedAt; self.durationMinutes = durationMinutes
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        startedAt       = (try? c.decode(String.self, forKey: .startedAt)) ?? ""
        durationMinutes = (try? c.decode(Int.self, forKey: .durationMinutes)) ?? 15
    }

    var startDate: Date? { Date.fromFlexibleISO8601(startedAt) }

    /// When the configured break window elapses. Used only for the reminder
    /// and "time left / over by" display — the break is NOT auto-ended.
    var endsAt: Date? { startDate.map { $0.addingTimeInterval(Double(durationMinutes) * 60) } }

    /// Seconds remaining (negative once over) relative to `now`.
    func secondsLeft(at now: Date = Date()) -> Int? {
        guard let e = endsAt else { return nil }
        return Int(e.timeIntervalSince(now))
    }
}

// MARK: - Person

struct Person: Codable, Identifiable, Equatable, Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    var id: String
    var name: String
    var role: String
    var email: String
    var cap: Double
    var color: String
    var userRole: String
    var adminPerms: AdminPerms?
    var isEngineer: Bool?
    var isTeamLead: Bool?
    var autoSchedule: Bool?   // false = excluded from AI scheduling
    var teamNumber: Int?
    var timeOff: [TimeOffEntry]
    var pushToken: String?
    var activeClockIn: ActiveClockIn?
    var activeJobClock: ActiveJobClock?
    var activeBreak: ActiveBreak?

    var isAdmin: Bool { userRole == "admin" }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id       = try c.decodeFlexID(forKey: .id)
        name     = (try? c.decode(String.self, forKey: .name)) ?? "Unknown"
        role     = (try? c.decode(String.self, forKey: .role)) ?? ""
        email    = (try? c.decode(String.self, forKey: .email)) ?? ""
        cap      = (try? c.decode(Double.self, forKey: .cap)) ?? 8.0
        color    = (try? c.decode(String.self, forKey: .color)) ?? "#7c3aed"
        userRole = (try? c.decode(String.self, forKey: .userRole)) ?? "user"
        timeOff  = (try? c.decode([TimeOffEntry].self, forKey: .timeOff)) ?? []
        adminPerms    = try? c.decodeIfPresent(AdminPerms.self, forKey: .adminPerms)
        isEngineer    = try? c.decodeIfPresent(Bool.self, forKey: .isEngineer)
        isTeamLead    = try? c.decodeIfPresent(Bool.self, forKey: .isTeamLead)
        autoSchedule  = try? c.decodeIfPresent(Bool.self, forKey: .autoSchedule)
        teamNumber    = try? c.decodeIfPresent(Int.self, forKey: .teamNumber)
        pushToken     = try? c.decodeIfPresent(String.self, forKey: .pushToken)
        activeClockIn = try? c.decodeIfPresent(ActiveClockIn.self, forKey: .activeClockIn)
        activeJobClock = try? c.decodeIfPresent(ActiveJobClock.self, forKey: .activeJobClock)
        activeBreak = try? c.decodeIfPresent(ActiveBreak.self, forKey: .activeBreak)
    }

    // Explicit memberwise init (needed because init(from:) in struct body suppresses synthesis)
    init(id: String, name: String, role: String, email: String, cap: Double,
         color: String, userRole: String, adminPerms: AdminPerms? = nil,
         isEngineer: Bool? = nil, isTeamLead: Bool? = nil,
         autoSchedule: Bool? = nil, teamNumber: Int? = nil,
         timeOff: [TimeOffEntry] = [], pushToken: String? = nil,
         activeClockIn: ActiveClockIn? = nil,
         activeJobClock: ActiveJobClock? = nil,
         activeBreak: ActiveBreak? = nil) {
        self.id = id; self.name = name; self.role = role; self.email = email
        self.cap = cap; self.color = color; self.userRole = userRole
        self.adminPerms = adminPerms; self.isEngineer = isEngineer
        self.isTeamLead = isTeamLead; self.autoSchedule = autoSchedule
        self.teamNumber = teamNumber; self.timeOff = timeOff; self.pushToken = pushToken
        self.activeClockIn = activeClockIn
        self.activeJobClock = activeJobClock
        self.activeBreak = activeBreak
    }

    static func == (lhs: Person, rhs: Person) -> Bool { lhs.id == rhs.id }
}

// MARK: - Client

struct Client: Codable, Identifiable, Equatable, Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    var id: String
    var name: String
    var contact: String
    var email: String
    var phone: String
    var color: String
    var notes: String

    static func == (lhs: Client, rhs: Client) -> Bool { lhs.id == rhs.id }
}

// MARK: - Attachment

struct Attachment: Codable, Identifiable, Equatable {
    var id: String { key }
    var key: String
    var filename: String
    var mimeType: String
    var size: Int
}

// MARK: - Message

struct Message: Codable, Identifiable, Equatable {
    var id: String
    var threadKey: String
    var scope: String
    var jobId: String?
    var panelId: String?
    var opId: String?
    var text: String
    var authorId: String
    var authorName: String
    var authorColor: String
    var participantIds: [String]
    var attachments: [Attachment]
    var timestamp: String
    // Extra fields the server attaches to special message types (e.g. a
    // time-off request delivered to admins). Optional so ordinary chat
    // messages decode/encode unchanged.
    var type: String?
    var timeOffRequestId: String?
    var toType: String?
    var toStart: String?
    var toEnd: String?
    var toNote: String?
    var toPersonName: String?

    init(id: String, threadKey: String, scope: String,
         jobId: String?, panelId: String?, opId: String?,
         text: String, authorId: String, authorName: String, authorColor: String,
         participantIds: [String], attachments: [Attachment], timestamp: String,
         type: String? = nil, timeOffRequestId: String? = nil,
         toType: String? = nil, toStart: String? = nil, toEnd: String? = nil,
         toNote: String? = nil, toPersonName: String? = nil) {
        self.id = id; self.threadKey = threadKey; self.scope = scope
        self.jobId = jobId; self.panelId = panelId; self.opId = opId
        self.text = text; self.authorId = authorId; self.authorName = authorName
        self.authorColor = authorColor; self.participantIds = participantIds
        self.attachments = attachments; self.timestamp = timestamp
        self.type = type; self.timeOffRequestId = timeOffRequestId
        self.toType = toType; self.toStart = toStart; self.toEnd = toEnd
        self.toNote = toNote; self.toPersonName = toPersonName
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id             = try c.decode(String.self, forKey: .id)
        threadKey      = (try? c.decode(String.self, forKey: .threadKey)) ?? ""
        scope          = (try? c.decode(String.self, forKey: .scope)) ?? "job"
        jobId          = try? c.decodeIfPresent(String.self, forKey: .jobId)
        panelId        = try? c.decodeIfPresent(String.self, forKey: .panelId)
        opId           = try? c.decodeIfPresent(String.self, forKey: .opId)
        text           = (try? c.decode(String.self, forKey: .text)) ?? ""
        authorId       = (try? c.decodeFlexID(forKey: .authorId)) ?? ""
        authorName     = (try? c.decode(String.self, forKey: .authorName)) ?? ""
        authorColor    = (try? c.decode(String.self, forKey: .authorColor)) ?? "#7c3aed"
        participantIds = (try? c.decode([String].self, forKey: .participantIds)) ?? c.decodeFlexIDs(forKey: .participantIds)
        attachments    = (try? c.decode([Attachment].self, forKey: .attachments)) ?? []
        timestamp      = (try? c.decode(String.self, forKey: .timestamp)) ?? ""
        type             = try? c.decodeIfPresent(String.self, forKey: .type)
        timeOffRequestId = try? c.decodeIfPresent(String.self, forKey: .timeOffRequestId)
        toType           = try? c.decodeIfPresent(String.self, forKey: .toType)
        toStart          = try? c.decodeIfPresent(String.self, forKey: .toStart)
        toEnd            = try? c.decodeIfPresent(String.self, forKey: .toEnd)
        toNote           = try? c.decodeIfPresent(String.self, forKey: .toNote)
        toPersonName     = try? c.decodeIfPresent(String.self, forKey: .toPersonName)
    }
}

// MARK: - ChatGroup

struct ChatGroup: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var memberIds: [String]

    init(id: String, name: String, memberIds: [String]) {
        self.id = id; self.name = name; self.memberIds = memberIds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id        = (try? c.decodeFlexID(forKey: .id)) ?? ""
        name      = (try? c.decode(String.self, forKey: .name)) ?? ""
        memberIds = c.decodeFlexIDs(forKey: .memberIds)
    }
}

// MARK: - Template

struct TemplateOp: Codable {
    var title: String
    var durationBD: Int
}

struct TemplatePanel: Codable {
    var title: String
    var ops: [TemplateOp]
}

struct Template: Codable, Identifiable {
    var id: String { title }
    var title: String
    var panels: [TemplatePanel]
}

// MARK: - Org Settings
// Mirrors the web's orgSettings shape (src/TRAQS.jsx ~line 1867). Stored on the
// server at orgs/{code}/settings.json and exposed by GET /api/settings (no auth
// needed for read; auth required for write).

struct OrgBreak: Codable, Equatable {
    var time: String              // "10:00"
    var durationMinutes: Int      // 15

    init(time: String, durationMinutes: Int) {
        self.time = time; self.durationMinutes = durationMinutes
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        time            = (try? c.decode(String.self, forKey: .time)) ?? "12:00"
        durationMinutes = (try? c.decode(Int.self,    forKey: .durationMinutes)) ?? 30
    }
}

struct OrgSettings: Codable, Equatable {
    var hpd: Double                       // hours per day (productive)
    var workStart: String                 // "07:00"
    var workEnd: String                   // "15:00"
    var workDays: [Int]                   // 0=Sun ... 6=Sat
    var holidays: [String]                // ISO date strings
    var roles: [String]                   // department list
    var approvalQueueLabel: String
    var approvalSteps: [String]
    var approverLabel: String
    var payDates: [Int]                   // e.g. [5, 20] for semimonthly
    var payMode: String                   // "setdate" | ...
    var payAnchor: String?                // ISO date
    var trackLunch: Bool
    var trackBreaks: Bool
    var payPeriodType: String             // "weekly" | "biweekly" | "semimonthly"
    var payPeriodStart: String?           // ISO date
    var payPeriodHourCap: Double          // soft cap of pay-clock hours per pay period (default 80); over = overtime
    var breaks: [OrgBreak]
    var lunch: OrgBreak

    static var `default`: OrgSettings {
        OrgSettings(
            hpd: 8.0,
            workStart: "07:00",
            workEnd: "15:00",
            workDays: [1, 2, 3, 4, 5],
            holidays: [],
            roles: [],
            approvalQueueLabel: "Approval Queue",
            approvalSteps: ["Review", "Approve", "Release"],
            approverLabel: "Approver",
            payDates: [5, 20],
            payMode: "setdate",
            payAnchor: nil,
            trackLunch: false,
            trackBreaks: false,
            payPeriodType: "biweekly",
            payPeriodStart: nil,
            payPeriodHourCap: 80,
            breaks: [OrgBreak(time: "10:00", durationMinutes: 15)],
            lunch: OrgBreak(time: "12:00", durationMinutes: 30)
        )
    }

    init(hpd: Double, workStart: String, workEnd: String, workDays: [Int],
         holidays: [String], roles: [String], approvalQueueLabel: String,
         approvalSteps: [String], approverLabel: String, payDates: [Int],
         payMode: String, payAnchor: String?, trackLunch: Bool, trackBreaks: Bool,
         payPeriodType: String, payPeriodStart: String?, payPeriodHourCap: Double,
         breaks: [OrgBreak], lunch: OrgBreak) {
        self.hpd = hpd; self.workStart = workStart; self.workEnd = workEnd
        self.workDays = workDays; self.holidays = holidays; self.roles = roles
        self.approvalQueueLabel = approvalQueueLabel
        self.approvalSteps = approvalSteps; self.approverLabel = approverLabel
        self.payDates = payDates; self.payMode = payMode; self.payAnchor = payAnchor
        self.trackLunch = trackLunch; self.trackBreaks = trackBreaks
        self.payPeriodType = payPeriodType; self.payPeriodStart = payPeriodStart
        self.payPeriodHourCap = payPeriodHourCap
        self.breaks = breaks; self.lunch = lunch
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = OrgSettings.default
        hpd                = (try? c.decode(Double.self,    forKey: .hpd))                ?? d.hpd
        workStart          = (try? c.decode(String.self,    forKey: .workStart))          ?? d.workStart
        workEnd            = (try? c.decode(String.self,    forKey: .workEnd))            ?? d.workEnd
        workDays           = (try? c.decode([Int].self,     forKey: .workDays))           ?? d.workDays
        holidays           = (try? c.decode([String].self,  forKey: .holidays))           ?? d.holidays
        roles              = (try? c.decode([String].self,  forKey: .roles))              ?? d.roles
        approvalQueueLabel = (try? c.decode(String.self,    forKey: .approvalQueueLabel)) ?? d.approvalQueueLabel
        approvalSteps      = (try? c.decode([String].self,  forKey: .approvalSteps))      ?? d.approvalSteps
        approverLabel      = (try? c.decode(String.self,    forKey: .approverLabel))      ?? d.approverLabel
        payDates           = (try? c.decode([Int].self,     forKey: .payDates))           ?? d.payDates
        payMode            = (try? c.decode(String.self,    forKey: .payMode))            ?? d.payMode
        payAnchor          = try? c.decodeIfPresent(String.self, forKey: .payAnchor)
        trackLunch         = (try? c.decode(Bool.self,      forKey: .trackLunch))         ?? d.trackLunch
        trackBreaks        = (try? c.decode(Bool.self,      forKey: .trackBreaks))        ?? d.trackBreaks
        payPeriodType      = (try? c.decode(String.self,    forKey: .payPeriodType))      ?? d.payPeriodType
        payPeriodStart     = try? c.decodeIfPresent(String.self, forKey: .payPeriodStart)
        payPeriodHourCap   = (try? c.decode(Double.self,    forKey: .payPeriodHourCap))   ?? d.payPeriodHourCap
        breaks             = (try? c.decode([OrgBreak].self,forKey: .breaks))             ?? d.breaks
        lunch              = (try? c.decode(OrgBreak.self,  forKey: .lunch))              ?? d.lunch
    }

    /// Productive hours per day = (workEnd - workStart) - lunch - breaks.
    var productiveHoursPerDay: Double {
        func parseT(_ t: String) -> Int {
            let parts = t.split(separator: ":").compactMap { Int($0) }
            guard parts.count == 2 else { return 8 * 60 }
            return parts[0] * 60 + parts[1]
        }
        let block = parseT(workEnd) - parseT(workStart)
        let lunchMin = lunch.durationMinutes
        let breakMin = breaks.reduce(0) { $0 + $1.durationMinutes }
        return max(1, Double(block - lunchMin - breakMin) / 60)
    }

    /// `workStart` parsed as decimal hours (e.g. "07:30" → 7.5).
    var workStartHour: Double {
        let p = workStart.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return 8.0 }
        return Double(p[0]) + Double(p[1]) / 60.0
    }

    var workEndHour: Double {
        let p = workEnd.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return 17.0 }
        return Double(p[0]) + Double(p[1]) / 60.0
    }

    var lunchStartHour: Double {
        let p = lunch.time.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return 12.0 }
        return Double(p[0]) + Double(p[1]) / 60.0
    }
}

// MARK: - Notification Payload

struct NotifyPayload: Codable {
    var type: String   // "step" | "ready" | "new_job" | "assigned"
    var jobTitle: String
    var jobNumber: String?
    var panelTitle: String
    var stepLabel: String
    var jobTeamIds: [String]
    var newTeamIds: [String]?
    var clientName: String?
    // notify.js reflects these into the push body. When omitted the server
    // falls back to "Someone"; passing the actual name (as the web app does)
    // makes "step"/"ready" pushes read "<name> approved …". nil optionals are
    // dropped by JSONEncoder, so older payloads stay byte-identical.
    var approvedByName: String? = nil
    var requestedByName: String? = nil
}
