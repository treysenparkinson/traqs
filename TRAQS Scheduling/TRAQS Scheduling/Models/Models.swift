import Foundation

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
    var by: Int
    var byName: String
    var at: String
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
    var team: [Int]
    var hpd: Double
    var notes: String
    var deps: [String]
    var locked: Bool?
    var moveLog: [MoveLogEntry]?
    var pid: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id     = try c.decode(String.self, forKey: .id)
        title  = try c.decode(String.self, forKey: .title)
        start  = try c.decode(String.self, forKey: .start)
        end    = try c.decode(String.self, forKey: .end)
        status = (try? c.decode(JobStatus.self, forKey: .status)) ?? .notStarted
        pri    = (try? c.decode(Priority.self, forKey: .pri)) ?? .medium
        team   = (try? c.decode([Int].self, forKey: .team)) ?? []
        hpd    = (try? c.decode(Double.self, forKey: .hpd)) ?? 7.5
        notes  = (try? c.decode(String.self, forKey: .notes)) ?? ""
        deps   = (try? c.decode([String].self, forKey: .deps)) ?? []
        locked   = try? c.decodeIfPresent(Bool.self, forKey: .locked)
        moveLog  = try? c.decodeIfPresent([MoveLogEntry].self, forKey: .moveLog)
        pid      = try? c.decodeIfPresent(String.self, forKey: .pid)
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
    var team: [Int]
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
        team        = (try? c.decode([Int].self, forKey: .team)) ?? []
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
    var team: [Int]
    var color: String
    var hpd: Double
    var notes: String
    var clientId: String?
    var deps: [String]
    var subs: [Panel]
    var moveLog: [MoveLogEntry]?
    var jobType: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id        = try c.decode(String.self, forKey: .id)
        title     = try c.decode(String.self, forKey: .title)
        start     = try c.decode(String.self, forKey: .start)
        end       = try c.decode(String.self, forKey: .end)
        status    = (try? c.decode(JobStatus.self, forKey: .status)) ?? .notStarted
        pri       = (try? c.decode(Priority.self, forKey: .pri)) ?? .medium
        team      = (try? c.decode([Int].self, forKey: .team)) ?? []
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
    }

    // Explicit memberwise init (needed because init(from:) in struct body suppresses synthesis)
    init(id: String, title: String, jobNumber: String? = nil, poNumber: String? = nil,
         start: String, end: String, dueDate: String? = nil,
         status: JobStatus = .notStarted, pri: Priority = .medium,
         team: [Int] = [], color: String = "#3d7fff", hpd: Double = 7.5,
         notes: String = "", clientId: String? = nil, deps: [String] = [],
         subs: [Panel] = [], moveLog: [MoveLogEntry]? = nil, jobType: String? = nil) {
        self.id = id; self.title = title; self.jobNumber = jobNumber; self.poNumber = poNumber
        self.start = start; self.end = end; self.dueDate = dueDate
        self.status = status; self.pri = pri; self.team = team; self.color = color
        self.hpd = hpd; self.notes = notes; self.clientId = clientId
        self.deps = deps; self.subs = subs; self.moveLog = moveLog; self.jobType = jobType
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

// MARK: - Person

struct Person: Codable, Identifiable, Equatable, Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    var id: Int
    var name: String
    var role: String
    var email: String
    var cap: Double
    var color: String
    var userRole: String
    var adminPerms: AdminPerms?
    var isEngineer: Bool?
    var isTeamLead: Bool?
    var teamNumber: Int?
    var timeOff: [TimeOffEntry]
    var pushToken: String?

    var isAdmin: Bool { userRole == "admin" }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id       = try c.decode(Int.self, forKey: .id)
        name     = (try? c.decode(String.self, forKey: .name)) ?? "Unknown"
        role     = (try? c.decode(String.self, forKey: .role)) ?? ""
        email    = (try? c.decode(String.self, forKey: .email)) ?? ""
        cap      = (try? c.decode(Double.self, forKey: .cap)) ?? 8.0
        color    = (try? c.decode(String.self, forKey: .color)) ?? "#7c3aed"
        userRole = (try? c.decode(String.self, forKey: .userRole)) ?? "user"
        timeOff  = (try? c.decode([TimeOffEntry].self, forKey: .timeOff)) ?? []
        adminPerms  = try? c.decodeIfPresent(AdminPerms.self, forKey: .adminPerms)
        isEngineer  = try? c.decodeIfPresent(Bool.self, forKey: .isEngineer)
        isTeamLead  = try? c.decodeIfPresent(Bool.self, forKey: .isTeamLead)
        teamNumber  = try? c.decodeIfPresent(Int.self, forKey: .teamNumber)
        pushToken   = try? c.decodeIfPresent(String.self, forKey: .pushToken)
    }

    // Explicit memberwise init (needed because init(from:) in struct body suppresses synthesis)
    init(id: Int, name: String, role: String, email: String, cap: Double,
         color: String, userRole: String, adminPerms: AdminPerms? = nil,
         isEngineer: Bool? = nil, isTeamLead: Bool? = nil, teamNumber: Int? = nil,
         timeOff: [TimeOffEntry] = [], pushToken: String? = nil) {
        self.id = id; self.name = name; self.role = role; self.email = email
        self.cap = cap; self.color = color; self.userRole = userRole
        self.adminPerms = adminPerms; self.isEngineer = isEngineer
        self.isTeamLead = isTeamLead; self.teamNumber = teamNumber
        self.timeOff = timeOff; self.pushToken = pushToken
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
    var scope: String   // "job" | "panel" | "op" | "group"
    var jobId: String?
    var panelId: String?
    var opId: String?
    var text: String
    var authorId: Int
    var authorName: String
    var authorColor: String
    var participantIds: [Int]
    var attachments: [Attachment]
    var timestamp: String
}

// MARK: - ChatGroup

struct ChatGroup: Codable, Identifiable {
    var id: String
    var name: String
    var memberIds: [Int]
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
    var jobTeamIds: [Int]
    var newTeamIds: [Int]?
    var clientName: String?
}
