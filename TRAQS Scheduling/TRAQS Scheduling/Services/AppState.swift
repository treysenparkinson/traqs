import Foundation
import Combine

@MainActor
@Observable
class AppState {
    var matchEmail: String? = nil  // set from AuthManager after login
    // MARK: - Core Data
    var jobs: [Job] = []
    var people: [Person] = []
    var clients: [Client] = []
    var messages: [Message] = []
    var groups: [ChatGroup] = []

    // MARK: - UI State
    var isLoading = false
    var saveStatus: SaveStatus = .idle
    var errorMessage: String?

    // MARK: - Time Clock State
    var clockedInPersonId: String?
    var clockedInPersonName: String?
    var clockedInPin: String?          // RAM only — never persisted
    var activeClockIn: ActiveClockIn?
    var isClockingIn = false
    var clockError: String?

    // MARK: - Auth / Org
    var currentPersonId: String?
    var orgCode: String = KeychainHelper.load(forKey: KeychainHelper.orgCodeKey) ?? ""

    // MARK: - Undo/Redo
    private var undoStack: [[Job]] = []
    private var redoStack: [[Job]] = []
    private let maxUndoSize = 50

    // MARK: - Auto-save / Auto-refresh
    private var saveTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var api: APIService?

    enum SaveStatus {
        case idle, saving, saved, error(String)
    }

    // MARK: - Setup

    func configure(token: String, orgCode: String) {
        self.orgCode = orgCode
        self.api = APIService(token: token, orgCode: orgCode)
        KeychainHelper.save(orgCode, forKey: KeychainHelper.orgCodeKey)
        startAutoRefresh()
        Task { await loadAll() }
    }

    func startAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled, !isLoading else { continue }
                await loadAll()
            }
        }
    }

    func stopAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    // MARK: - Load

    func loadAll() async {
        guard let api, !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        if let r = try? await api.fetchJobs()     { jobs     = r }
        if let r = try? await api.fetchPeople()   { people   = r }
        if let r = try? await api.fetchClients()  { clients  = r }
        if let r = try? await api.fetchMessages() { messages = r }
        if let r = try? await api.fetchGroups()   { groups   = r }
        autoMatchPerson()
    }

    // MARK: - Jobs

    func updateJobs(_ newJobs: [Job], pushUndo: Bool = true) {
        if pushUndo {
            undoStack.append(jobs)
            if undoStack.count > maxUndoSize { undoStack.removeFirst() }
            redoStack.removeAll()
        }
        jobs = newJobs
        scheduleSave()
    }

    func updateJob(_ job: Job, sendNotification: Bool = false, clientName: String? = nil) {
        let existing = jobs.first(where: { $0.id == job.id })
        var updated = jobs
        if let i = updated.firstIndex(where: { $0.id == job.id }) {
            updated[i] = job
        } else {
            updated.append(job)
        }
        updateJobs(updated)

        guard sendNotification else { return }
        Task {
            guard let api else { return }
            do {
                if existing == nil {
                    try await api.sendNotification(NotifyPayload(
                        type: "new_job",
                        jobTitle: job.title,
                        jobNumber: job.jobNumber,
                        panelTitle: "",
                        stepLabel: "",
                        jobTeamIds: job.team,
                        newTeamIds: nil,
                        clientName: clientName
                    ))
                } else {
                    let newMembers = job.team.filter { !(existing!.team.contains($0)) }
                    if !newMembers.isEmpty {
                        try await api.sendNotification(NotifyPayload(
                            type: "assigned",
                            jobTitle: job.title,
                            jobNumber: job.jobNumber,
                            panelTitle: "",
                            stepLabel: "",
                            jobTeamIds: job.team,
                            newTeamIds: newMembers,
                            clientName: nil
                        ))
                    }
                }
            } catch { /* best-effort */ }
        }
    }

    func deleteJob(id: String) {
        updateJobs(jobs.filter { $0.id != id })
    }

    // MARK: - Engineering Sign-Off

    func signOff(jobId: String, panelId: String, step: EngStep, personId: String, personName: String) {
        guard var job = jobs.first(where: { $0.id == jobId }),
              let pi = job.subs.firstIndex(where: { $0.id == panelId }) else { return }
        let signOff = EngineeringSignOff(by: personId, byName: personName, at: ISO8601DateFormatter().string(from: Date()))
        var panel = job.subs[pi]
        var eng = panel.engineering ?? Engineering()
        switch step {
        case .designed:     eng.designed = signOff
        case .verified:     eng.verified = signOff
        case .sentToPerforex: eng.sentToPerforex = signOff
        }
        panel.engineering = eng
        job.subs[pi] = panel
        updateJob(job)
    }

    func revertSignOff(jobId: String, panelId: String, step: EngStep) {
        guard var job = jobs.first(where: { $0.id == jobId }),
              let pi = job.subs.firstIndex(where: { $0.id == panelId }) else { return }
        var panel = job.subs[pi]
        var eng = panel.engineering ?? Engineering()
        switch step {
        case .designed:
            eng.designed = nil
            eng.verified = nil
            eng.sentToPerforex = nil
        case .verified:
            eng.verified = nil
            eng.sentToPerforex = nil
        case .sentToPerforex:
            eng.sentToPerforex = nil
        }
        panel.engineering = eng
        job.subs[pi] = panel
        updateJob(job)
    }

    // MARK: - People

    func updatePeople(_ newPeople: [Person]) {
        people = newPeople
        Task {
            try? await api?.savePeople(newPeople)
            await loadAll()
        }
    }

    // MARK: - Clients

    func updateClients(_ newClients: [Client]) {
        clients = newClients
        Task {
            try? await api?.saveClients(newClients)
            await loadAll()
        }
    }

    // MARK: - Messages

    func sendMessage(_ message: Message) async {
        messages.append(message)
        try? await api?.sendMessage(message)
    }

    // Returns the server-assigned message ID so callers can track ownership.
    func sendMessageThrowing(_ message: Message) async throws -> String {
        messages.append(message)
        guard let api else { return message.id }
        let serverMsg = try await api.sendMessage(message)
        // Swap the optimistic local message for the canonical server message
        if let i = messages.firstIndex(where: { $0.id == message.id }) {
            messages[i] = serverMsg
        }
        return serverMsg.id
    }

    func refreshMessages() async {
        guard let api else { return }
        if let msgs = try? await api.fetchMessages() {
            messages = msgs
        }
    }

    // MARK: - Undo / Redo

    func undo() {
        guard !undoStack.isEmpty else { return }
        redoStack.append(jobs)
        jobs = undoStack.removeLast()
        scheduleSave()
    }

    func redo() {
        guard !redoStack.isEmpty else { return }
        undoStack.append(jobs)
        jobs = redoStack.removeLast()
        scheduleSave()
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    // MARK: - Auto-save

    private func scheduleSave() {
        saveTask?.cancel()
        saveStatus = .saving
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            await persistJobs()
        }
    }

    private func persistJobs() async {
        guard let api else { return }
        do {
            try await api.saveJobs(jobs)
            saveStatus = .saved
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if case .saved = saveStatus { saveStatus = .idle }
            await loadAll()
        } catch {
            saveStatus = .error(error.localizedDescription)
        }
    }

    // MARK: - Auto-match person by email

    func autoMatchPerson() {
        guard let email = matchEmail, !people.isEmpty else { return }
        if let match = people.first(where: { $0.email.lowercased() == email.lowercased() }) {
            currentPersonId = match.id
        }
    }

    // MARK: - Time Clock Methods

    func timeclockIdentify(pin: String) async {
        guard let api else { return }
        isClockingIn = true
        clockError = nil
        defer { isClockingIn = false }
        do {
            let result = try await api.timeclockIdentify(pin: pin)
            clockedInPersonId = result.personId
            clockedInPersonName = result.name
            clockedInPin = pin
            activeClockIn = result.activeClockIn
        } catch {
            clockError = error.localizedDescription
        }
    }

    func timeclockClockIn(jobRefs: [JobRef]) async {
        guard let api, let personId = clockedInPersonId, let pin = clockedInPin else { return }
        do {
            let clockIn = try await api.timeclockClockIn(personId: personId, pin: pin, jobRefs: jobRefs)
            activeClockIn = ActiveClockIn(clockIn: clockIn, jobRefs: jobRefs, events: [])
            Task { await loadAll() }
        } catch {
            clockError = error.localizedDescription
        }
    }

    func timeclockClockOut() async {
        guard let api, let personId = clockedInPersonId, let pin = clockedInPin else { return }
        do {
            try await api.timeclockClockOut(personId: personId, pin: pin)
            clearClockSession()
            Task { await loadAll() }
        } catch {
            clockError = error.localizedDescription
        }
    }

    func timeclockSendEvent(action: String) async {
        guard let api, let personId = clockedInPersonId, let pin = clockedInPin else { return }
        let event = ClockEvent(type: action, ts: ISO8601DateFormatter().string(from: Date()))
        activeClockIn?.events.append(event)
        try? await api.timeclockEvent(action: action, personId: personId, pin: pin)
        Task { await loadAll() }  // sync server state so currentPerson?.activeClockIn updates
    }

    func timeclockFinishRequest(jobId: String, panelId: String, opId: String) async {
        guard let api, let personId = clockedInPersonId, let pin = clockedInPin else { return }
        // Optimistic update
        if let ji = jobs.firstIndex(where: { $0.id == jobId }),
           let pi = jobs[ji].subs.firstIndex(where: { $0.id == panelId }),
           let oi = jobs[ji].subs[pi].subs.firstIndex(where: { $0.id == opId }) {
            jobs[ji].subs[pi].subs[oi].pendingFinish = true
        }
        try? await api.timeclockFinishRequest(personId: personId, pin: pin, jobId: jobId, panelId: panelId, opId: opId)
    }

    func clearClockSession() {
        clockedInPersonId = nil
        clockedInPersonName = nil
        clockedInPin = nil
        activeClockIn = nil
        clockError = nil
    }

    // MARK: - Color Helpers

    func nextAutoColor() -> String {
        let key = "traqs_lastHue"
        var hue = UserDefaults.standard.integer(forKey: key)
        hue = (hue + 137) % 360
        UserDefaults.standard.set(hue, forKey: key)
        return hslToHex(h: hue, s: 0.70, l: 0.55)
    }

    private func hslToHex(h: Int, s: Double, l: Double) -> String {
        let hf = Double(h) / 360.0
        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs(fmod(hf * 6, 2) - 1))
        let m = l - c / 2
        var r, g, b: Double
        switch Int(hf * 6) {
        case 0: (r, g, b) = (c, x, 0)
        case 1: (r, g, b) = (x, c, 0)
        case 2: (r, g, b) = (0, c, x)
        case 3: (r, g, b) = (0, x, c)
        case 4: (r, g, b) = (x, 0, c)
        default: (r, g, b) = (c, 0, x)
        }
        let ri = Int((r + m) * 255)
        let gi = Int((g + m) * 255)
        let bi = Int((b + m) * 255)
        return String(format: "#%02X%02X%02X", ri, gi, bi)
    }

    // MARK: - Computed

    var currentPerson: Person? {
        guard let id = currentPersonId else { return nil }
        return people.first { $0.id == id }
    }

    var isAdmin: Bool     { currentPerson?.isAdmin ?? false }
    var isEngineer: Bool  { isAdmin || (currentPerson?.isEngineer ?? false) }

    var isClocked: Bool { activeClockIn != nil }

    var currentClockEvent: String? {
        guard let lastEvent = activeClockIn?.events.last else { return nil }
        return ["lunchStart", "breakStart"].contains(lastEvent.type) ? lastEvent.type : nil
    }

    var engineeringQueue: [(job: Job, panel: Panel)] {
        jobs.flatMap { job in
            job.subs.compactMap { panel -> (Job, Panel)? in
                let e = panel.engineering
                let allDone = e?.designed != nil && e?.verified != nil && e?.sentToPerforex != nil
                if allDone { return nil }
                return (job, panel)
            }
        }
    }

    var engineeringFinished: [(job: Job, panel: Panel)] {
        jobs.flatMap { job in
            job.subs.compactMap { panel -> (Job, Panel)? in
                let e = panel.engineering
                guard e?.designed != nil && e?.verified != nil && e?.sentToPerforex != nil else { return nil }
                return (job, panel)
            }
        }
    }

    func client(for job: Job) -> Client? {
        guard let cid = job.clientId else { return nil }
        return clients.first { $0.id == cid }
    }

    func person(id: String) -> Person? {
        people.first { $0.id == id }
    }
}

// MARK: - Engineering Step

enum EngStep: String, CaseIterable {
    case designed = "Designed"
    case verified = "Verified"
    case sentToPerforex = "Sent to Perforex"

    var label: String { rawValue }
    var index: Int {
        switch self { case .designed: return 0; case .verified: return 1; case .sentToPerforex: return 2 }
    }
    static func from(index: Int) -> EngStep? {
        switch index { case 0: return .designed; case 1: return .verified; case 2: return .sentToPerforex; default: return nil }
    }
}
