import Foundation
import Combine
import OneSignalFramework

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
    /// Org-level settings (hpd, workStart/End, lunch, breaks, payPeriod, …).
    /// Synced from the web; falls back to `OrgSettings.default` until first fetch.
    var orgSettings: OrgSettings = .default

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
    /// Persisted so a flaky people-fetch can't briefly blank out the
    /// current user and re-filter the entire app. The first auto-match sets
    /// it; subsequent matches only reassign if the value would change.
    var currentPersonId: String? = UserDefaults.standard.string(forKey: "traqs_currentPersonId") {
        didSet {
            if let id = currentPersonId, !id.isEmpty {
                UserDefaults.standard.set(id, forKey: "traqs_currentPersonId")
            }
        }
    }
    var orgCode: String = KeychainHelper.load(forKey: KeychainHelper.orgCodeKey) ?? ""
    /// Human-readable organization name (e.g. "Matrix Systems"). Looked up via
    /// `APIService.lookupOrg` once we have an org code, then persisted so the
    /// sidebar's profile footer can show it above the user's name.
    var orgName: String = UserDefaults.standard.string(forKey: "traqs_orgName") ?? "" {
        didSet { UserDefaults.standard.set(orgName, forKey: "traqs_orgName") }
    }

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
        // Resolve the org's display name (cached server-side) so the sidebar
        // can render it above the current user. Failure is non-fatal — we
        // fall back to whatever was previously persisted.
        Task {
            if let info = try? await APIService.lookupOrg(code: orgCode),
               let name = info.name, !name.isEmpty {
                await MainActor.run { self.orgName = name }
            }
        }
    }

    func startAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = Task {
            while !Task.isCancelled {
                // Poll every 15s. The previous 5s cadence visibly re-rendered
                // the screen three times per minute, which surfaced any
                // micro-difference in server payloads as a "switched data" blink.
                // Foreground transitions still call loadAll() directly for
                // immediate freshness, and user-driven pull-to-refresh works.
                try? await Task.sleep(nanoseconds: 15_000_000_000)
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

    /// Set every time we optimistically mutate the current user's activeJobClock,
    /// so the next loadAll() can preserve the local value while the server's
    /// eventual-consistency catches up.
    private var clockChangeAt: Date? = nil

    func loadAll() async {
        guard let api, !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        // Don't clobber existing in-memory data with an empty server response
        // — a momentary S3 / network blip would otherwise wipe a populated
        // list for the next render cycle ("split-second flash then gone").
        // Real "everything deleted" cases are handled by user-driven refreshes
        // and will catch up once the array is empty on both sides.
        if let r = try? await api.fetchJobs(), !r.isEmpty || jobs.isEmpty {
            jobs = r
        }
        if let r = try? await api.fetchPeople(), !r.isEmpty || people.isEmpty {
            // Capture the optimistic clock IMMEDIATELY before overwriting
            // `people`. Doing it here (not at the top of loadAll) handles
            // the race where the user taps START TIMER mid-fetch — by the
            // time we get the people response, the local mutation has
            // already happened and we can preserve it.
            let snap: (personId: String, clock: ActiveJobClock?)? = {
                guard let last = clockChangeAt, Date().timeIntervalSince(last) < 12,
                      let p = currentPerson else { return nil }
                return (p.id, p.activeJobClock)
            }()
            people = r
            if let snap, let idx = people.firstIndex(where: { $0.id == snap.personId }) {
                people[idx].activeJobClock = snap.clock
            }
        }
        if let r = try? await api.fetchClients(), !r.isEmpty || clients.isEmpty {
            clients = r
        }
        if let r = try? await api.fetchMessages(), !r.isEmpty || messages.isEmpty {
            messages = r
        }
        if let r = try? await api.fetchGroups(), !r.isEmpty || groups.isEmpty {
            groups = r
        }
        if let r = try? await api.fetchOrgSettings() { orgSettings = r }
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

        // Mirror the web app's notify side-effects: every sign-off fires a
        // "step" notification, and the final one (all three done) also fires
        // "ready". See src/TRAQS.jsx around the engineering-signoff handler.
        let jobTeamIds = job.team
        let jobTitle = job.title
        let jobNumber = job.jobNumber
        let panelTitle = panel.title
        let stepLabel = step.label
        let allDone = eng.designed != nil && eng.verified != nil && eng.sentToPerforex != nil
        Task { [api] in
            guard let api else { return }
            try? await api.sendNotification(NotifyPayload(
                type: "step",
                jobTitle: jobTitle, jobNumber: jobNumber,
                panelTitle: panelTitle, stepLabel: stepLabel,
                jobTeamIds: jobTeamIds, newTeamIds: nil, clientName: nil
            ))
            if allDone {
                try? await api.sendNotification(NotifyPayload(
                    type: "ready",
                    jobTitle: jobTitle, jobNumber: jobNumber,
                    panelTitle: panelTitle, stepLabel: stepLabel,
                    jobTeamIds: jobTeamIds, newTeamIds: nil, clientName: nil
                ))
            }
        }
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

    // MARK: - Thread Read State
    // Lightweight per-thread "last read at" timestamps backed by UserDefaults.
    // `unreadCount` in the inbox compares each thread's newest message
    // timestamp against the stored value to display the sky unread badge.
    private let readStateKey = "traqs_threadReadAt"

    var threadReadAt: [String: String] {
        UserDefaults.standard.dictionary(forKey: readStateKey) as? [String: String] ?? [:]
    }

    func markThreadRead(_ threadKey: String) {
        var map = threadReadAt
        map[threadKey] = ISO8601DateFormatter().string(from: Date())
        UserDefaults.standard.set(map, forKey: readStateKey)
    }

    func markAllThreadsRead() {
        let nowISO = ISO8601DateFormatter().string(from: Date())
        // Compute unique threadKeys from current messages, then stamp each.
        let keys = Set(messages.map { $0.threadKey })
        var map = threadReadAt
        for k in keys { map[k] = nowISO }
        UserDefaults.standard.set(map, forKey: readStateKey)
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

    // MARK: - Push token registration
    // notify.js filters pushes by `person.pushToken` truthiness — if iOS
    // doesn't write the OneSignal subscription ID back to the people roster,
    // the device never receives notifications even though OneSignal.login()
    // ran. Poll the SDK for up to ~10s post-login since the subscription ID
    // isn't always ready immediately after init.
    private var pushRegisterTask: Task<Void, Never>?

    func registerPushTokenIfNeeded() {
        pushRegisterTask?.cancel()
        pushRegisterTask = Task { [weak self] in
            guard let self else { return }
            for _ in 0..<20 {
                if Task.isCancelled { return }
                let id = OneSignal.User.pushSubscription.id
                if let id, !id.isEmpty {
                    await self.writePushToken(id)
                    return
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
    }

    private func writePushToken(_ token: String) async {
        guard let api,
              let personId = currentPersonId,
              let idx = people.firstIndex(where: { $0.id == personId }),
              people[idx].pushToken != token else { return }
        var updated = people
        updated[idx].pushToken = token
        people = updated
        try? await api.savePeople(updated)
    }

    // MARK: - Auto-match person by email

    func autoMatchPerson() {
        guard let email = matchEmail, !people.isEmpty else { return }
        if let match = people.first(where: { $0.email.lowercased() == email.lowercased() }) {
            // Only reassign when the value would actually change — otherwise
            // every loadAll triggers a redundant @Observable notification, which
            // re-runs TasksView's `myTasks` filter and churns the displayed list
            // (the "switched to a different set" symptom).
            if currentPersonId != match.id {
                currentPersonId = match.id
            }
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

    // MARK: - Job Clock (Bearer-only, no PIN; uses currentPersonId)

    var myActiveJobClock: ActiveJobClock? { currentPerson?.activeJobClock }

    /// Refresh JUST the jobs list (status / loggedHours updates) without
    /// clobbering the optimistic activeJobClock state on the current person.
    /// Same empty-payload guard as `loadAll()` so a flaky response can't wipe
    /// a populated list.
    private func refreshJobsQuietly() async {
        guard let api else { return }
        if let r = try? await api.fetchJobs(), !r.isEmpty || jobs.isEmpty {
            jobs = r
        }
    }

    func jobClockIn(jobId: String, panelId: String? = nil, opId: String? = nil,
                    jobTitle: String? = nil, panelTitle: String? = nil, opTitle: String? = nil) async {
        guard let api, let personId = currentPersonId else { return }

        // Optimistic update — replace the whole array so @Observable definitely
        // notices the change.
        let optimistic = ActiveJobClock(
            clockIn: ISO8601DateFormatter().string(from: Date()),
            jobId: jobId, panelId: panelId, opId: opId,
            jobTitle: jobTitle, panelTitle: panelTitle, opTitle: opTitle
        )
        if let idx = people.firstIndex(where: { $0.id == personId }) {
            var newPeople = people
            newPeople[idx].activeJobClock = optimistic
            people = newPeople
        }
        clockChangeAt = Date()

        do {
            try await api.jobClockIn(personId: personId, jobId: jobId, panelId: panelId, opId: opId,
                                     jobTitle: jobTitle, panelTitle: panelTitle, opTitle: opTitle)
            // Refresh jobs (op status → "In Progress" lands here) but skip
            // people — the grace-window snapshot inside loadAll preserves the
            // activeJobClock either way.
            await refreshJobsQuietly()
        } catch {
            clockError = error.localizedDescription
        }
    }

    func jobClockOut() async {
        guard let api, let personId = currentPersonId else { return }

        // Optimistic clear — whole-array assignment so @Observable always fires.
        if let idx = people.firstIndex(where: { $0.id == personId }) {
            var newPeople = people
            newPeople[idx].activeJobClock = nil
            people = newPeople
        }
        clockChangeAt = Date()

        do {
            try await api.jobClockOut(personId: personId)
            await refreshJobsQuietly()
        } catch {
            clockError = error.localizedDescription
        }
    }

    func jobPause() async {
        guard let api, let personId = currentPersonId else { return }
        do {
            try await api.jobPause(personId: personId)
            await loadAll()
        } catch {
            clockError = error.localizedDescription
        }
    }

    func jobResume() async {
        guard let api, let personId = currentPersonId else { return }
        do {
            try await api.jobResume(personId: personId)
            await loadAll()
        } catch {
            clockError = error.localizedDescription
        }
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

    // MARK: - Hours-weighted Progress
    // Mirrors the desktop's _opPct / _panelPct / _jobPct: progress is derived from
    // logged hours ÷ estimated hours (op.hpd), aggregated by *total* hours so a 40h
    // op at 8h counts proportionally more than a 4h op at 2h. Adds live elapsed
    // time for any worker currently clocked into the op so the bar creeps forward
    // between server polls.

    /// Returns (logged, est) for a single op. Logged is capped at est so an op
    /// can't push aggregate progress past 100%.
    func opHoursPair(_ op: Operation) -> (logged: Double, est: Double) {
        // Fall back to the org's default workday length when an op didn't store hpd.
        let est = max(0.0001, op.hpd > 0 ? op.hpd : orgSettings.hpd)
        if op.status == .finished { return (est, est) }
        if op.pendingFinish == true { return (est * 0.99, est) }
        let base = op.loggedHours ?? 0
        // Live elapsed for any worker currently clocked into this op (display only).
        var live: Double = 0
        if let activeP = people.first(where: { $0.activeJobClock?.opId == op.id && !($0.activeJobClock?.clockIn.isEmpty ?? true) }),
           let jc = activeP.activeJobClock,
           let started = ISO8601DateFormatter().date(from: jc.clockIn) {
            let elapsedH = Date().timeIntervalSince(started) / 3600
            let pausedH = (jc.totalPausedMs ?? 0) / 3_600_000
            live = max(0, elapsedH - pausedH)
        }
        return (min(est, base + live), est)
    }

    func opPct(_ op: Operation) -> Int {
        if op.status == .finished { return 100 }
        if op.pendingFinish == true { return 99 }
        let h = opHoursPair(op)
        if h.logged == 0 {
            switch op.status {
            case .inProgress: return 5
            case .onHold:     return 2
            default:          return 0
            }
        }
        return min(98, Int((h.logged / h.est * 100).rounded()))
    }

    /// Panel progress: total logged hours ÷ total estimated hours across child ops.
    func panelPct(_ panel: Panel) -> Int {
        let ops = panel.subs
        if ops.isEmpty { return panel.status == .finished ? 100 : 0 }
        var logged = 0.0, est = 0.0
        for op in ops { let h = opHoursPair(op); logged += h.logged; est += h.est }
        if est == 0 { return 0 }
        return min(100, Int((logged / est * 100).rounded()))
    }

    /// Job progress: total logged hours ÷ total estimated hours across all ops.
    func jobPct(_ job: Job) -> Int {
        let ops = job.subs.flatMap { $0.subs }
        if ops.isEmpty { return job.status == .finished ? 100 : 0 }
        var logged = 0.0, est = 0.0
        for op in ops { let h = opHoursPair(op); logged += h.logged; est += h.est }
        if est == 0 { return 0 }
        return min(100, Int((logged / est * 100).rounded()))
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
