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
    }

    static func == (lhs: Operation, rhs: Operation) -> Bool { lhs.id == rhs.id }
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
    }

    // Explicit memberwise init (needed because init(from:) in struct body suppresses synthesis)
    init(id: String, title: String, jobNumber: String? = nil, poNumber: String? = nil,
         start: String, end: String, dueDate: String? = nil,
         status: JobStatus = .notStarted, pri: Priority = .medium,
         team: [String] = [], color: String = "#3d7fff", hpd: Double = 7.5,
         notes: String = "", clientId: String? = nil, deps: [String] = [],
         subs: [Panel] = [], moveLog: [MoveLogEntry]? = nil, jobType: String? = nil,
         loggedHours: Double? = nil) {
        self.id = id; self.title = title; self.jobNumber = jobNumber; self.poNumber = poNumber
        self.start = start; self.end = end; self.dueDate = dueDate
        self.status = status; self.pri = pri; self.team = team; self.color = color
        self.hpd = hpd; self.notes = notes; self.clientId = clientId
        self.deps = deps; self.subs = subs; self.moveLog = moveLog; self.jobType = jobType
        self.loggedHours = loggedHours
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
    }

    // Explicit memberwise init (needed because init(from:) in struct body suppresses synthesis)
    init(id: String, name: String, role: String, email: String, cap: Double,
         color: String, userRole: String, adminPerms: AdminPerms? = nil,
         isEngineer: Bool? = nil, isTeamLead: Bool? = nil,
         autoSchedule: Bool? = nil, teamNumber: Int? = nil,
         timeOff: [TimeOffEntry] = [], pushToken: String? = nil,
         activeClockIn: ActiveClockIn? = nil) {
        self.id = id; self.name = name; self.role = role; self.email = email
        self.cap = cap; self.color = color; self.userRole = userRole
        self.adminPerms = adminPerms; self.isEngineer = isEngineer
        self.isTeamLead = isTeamLead; self.autoSchedule = autoSchedule
        self.teamNumber = teamNumber; self.timeOff = timeOff; self.pushToken = pushToken
        self.activeClockIn = activeClockIn
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

struct Attachment: Codable, Identifiable {
    var id: String { key }
    var key: String
    var filename: String
    var mimeType: String
    var size: Int
}

// MARK: - Message

struct Message: Codable, Identifiable {
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

    init(id: String, threadKey: String, scope: String,
         jobId: String?, panelId: String?, opId: String?,
         text: String, authorId: String, authorName: String, authorColor: String,
         participantIds: [String], attachments: [Attachment], timestamp: String) {
        self.id = id; self.threadKey = threadKey; self.scope = scope
        self.jobId = jobId; self.panelId = panelId; self.opId = opId
        self.text = text; self.authorId = authorId; self.authorName = authorName
        self.authorColor = authorColor; self.participantIds = participantIds
        self.attachments = attachments; self.timestamp = timestamp
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
    }
}

// MARK: - ChatGroup

struct ChatGroup: Codable, Identifiable {
    var id: String
    var name: String
    var memberIds: [String]

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
}
