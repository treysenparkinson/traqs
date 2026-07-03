import Foundation
import Combine
import SwiftUI
import OneSignalFramework
import SwiftData

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
    /// Historical pay-clock entries (per-person, lifetime) from the
    /// server's timeclock.json. Loaded on demand because the dataset
    /// can be large; views that need it call `refreshTimeclock()`.
    var timeclockEntries: [TimeclockEntry] = []
    /// Timestamped per-session job-clock log (per-person) from the server's
    /// jobsessions.json. Loaded on demand via `refreshJobSessions()` for the
    /// Hours page's JOB HOURS section.
    var jobSessions: [JobSession] = []
    /// This person's time-off requests (PTO/UTO) with approval status. Loaded
    /// on the Hours page via `refreshTimeOffRequests()`. The member endpoint
    /// returns only the caller's own requests.
    var timeOffRequests: [TimeOffRequest] = []
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

    // Live sync (Phase 4): SwiftData cache + Ably realtime, layered on top of
    // loadAll()/startAutoRefresh() (which remain the fallback).
    private var localCache: LocalCache?
    private var syncService: SyncService?
    private let realtime = RealtimeService()
    private var configuredOrgCode: String?   // guards configure() against duplicate login-time calls

    /// Weak process-wide handle so the UIApplicationDelegate's silent-push
    /// (content-available) handler can reach the live AppState to run a
    /// background delta-sync. Set in configure(); weak so it never keeps a
    /// torn-down AppState alive.
    static weak var shared: AppState?

    enum SaveStatus {
        case idle, saving, saved, error(String)
    }

    // MARK: - Setup

    func configure(auth: AuthManager, orgCode: String) {
        AppState.shared = self   // expose to the silent-push background handler
        // Idempotent: ContentView.handleAuthState fires from BOTH the
        // isAuthenticated AND userEmail onChange handlers (plus applyOrg after the
        // email→org lookup), so configure() is called 2–3× on login with the same
        // org. Without this guard each call spun up another Ably client → duplicate
        // subscriptions + doubled downstream work. Re-configuring for a DIFFERENT
        // org still proceeds (org switch).
        if configuredOrgCode == orgCode, api != nil { return }
        configuredOrgCode = orgCode
        self.orgCode = orgCode
        let apiInstance = APIService(auth: auth, orgCode: orgCode)
        self.api = apiInstance
        KeychainHelper.save(orgCode, forKey: KeychainHelper.orgCodeKey)

        // ── Live sync (Phase 4): SwiftData cache + Ably realtime ──
        // Layered ON TOP of loadAll()/startAutoRefresh() below (the fallback):
        // paint from cache instantly, delta-sync in the background, then
        // subscribe to Ably for ~1s live updates.
        realtime.disconnect()                 // drop any previous org's connection
        auth.onLogout = { [weak self] in self?.teardownRealtime() }  // disconnect Ably on full logout
        let cache = LocalCache()
        cache.initialize(orgCode: orgCode)
        self.localCache = cache
        let sync = SyncService(api: apiInstance, cache: cache)
        self.syncService = sync
        if cache.hasCachedData() { rehydrateFromCache() }   // instant paint from cache
        Task {
            _ = await sync.deltaSync()        // seed/refresh cache + cursor
            rehydrateFromCache()              // apply anything that changed
            await realtime.connect(orgCode: orgCode, api: apiInstance,
                                   onChange: { [weak self] in self?.onRealtimeChange() },
                                   onReconnect: { [weak self] in self?.onRealtimeChange() })
        }

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

    // Push the cached snapshot into @Observable state, mirroring loadAll()'s
    // exact live lists + empty-guard (a momentarily-empty cache slice must not
    // blank populated state). timeclock/jobSessions/timeOffRequests + orgConfig
    // keep their existing on-demand paths and are not applied here.
    private func rehydrateFromCache() {
        guard let cache = localCache else { return }
        let dec = JSONDecoder()
        let j = cache.readAll(SyncedJob.self).compactMap { try? dec.decode(Job.self, from: $0.payload) }
        let p = cache.readAll(SyncedPerson.self).compactMap { try? dec.decode(Person.self, from: $0.payload) }
        let c = cache.readAll(SyncedClient.self).compactMap { try? dec.decode(Client.self, from: $0.payload) }
        let m = cache.readAll(SyncedMessage.self).compactMap { try? dec.decode(Message.self, from: $0.payload) }
        let g = cache.readAll(SyncedGroup.self).compactMap { try? dec.decode(ChatGroup.self, from: $0.payload) }
        let s = cache.readAll(SyncedSettings.self).first.flatMap { try? dec.decode(OrgSettings.self, from: $0.payload) }
        // Assign directly on the main actor, and ONLY when the entity's content
        // actually changed. @Observable fires on EVERY assignment regardless of
        // value, so re-assigning an unchanged array churns observers — and each
        // such churn resets SwiftUI's render debounce, so a burst of coalesced
        // syncs stretched the real update out to many seconds. Job/Person/Client/
        // Message/ChatGroup/OrgSettings are Equatable, so `!=` is the guard. The
        // empty-guard (|| current.isEmpty) still blocks blanking populated state
        // with a momentarily-empty cache slice.
        if j != jobs, !j.isEmpty || jobs.isEmpty { jobs = j }
        if p != people, !p.isEmpty || people.isEmpty { people = p }
        if c != clients, !c.isEmpty || clients.isEmpty { clients = c }
        if m != messages, !m.isEmpty || messages.isEmpty { messages = m }
        if g != groups, !g.isEmpty || groups.isEmpty { groups = g }
        if let s, s != orgSettings { orgSettings = s }
        autoMatchPerson()
    }

    // Ably "changed" → pull the delta, then rehydrate. deltaSync coalesces bursts.
    private func onRealtimeChange() {
        Task { [weak self] in
            guard let self else { return }
            // Rehydrate ONLY when the delta actually wrote something. A coalesced
            // or empty sync (e.g. a re-send of already-cached records) writes
            // nothing → skipping avoids re-assigning unchanged arrays, which was
            // resetting SwiftUI's render debounce and delaying the real update.
            let didWrite = await self.syncService?.deltaSync() ?? false
            if didWrite { self.deferRehydrate() }
        }
    }

    /// Rehydrate on a FRESH main-queue turn. Mutating @Observable state directly
    /// inside the awaited Task continuation above (Ably → deltaSync → here) marks
    /// the view dirty but does NOT drive SwiftUI's update flush until the next
    /// run-loop event fires — an idle app showed a ~10s lag before TasksView.body
    /// re-ran. Re-dispatching the mutation as a queued main-queue block gives the
    /// run loop the turn it needs to invoke the body immediately.
    private func deferRehydrate() {
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { self?.rehydrateFromCache() }
        }
    }

    /// Foreground catch-up (scenePhase .active): delta-sync + rehydrate so we
    /// reconcile even when Ably is degraded or was suspended in the background.
    func foregroundSync() {
        onRealtimeChange()
    }

    /// Awaitable background delta-sync for silent ("content-available") pushes.
    /// Returns true when something was written (→ iOS `.newData`). Mirrors
    /// onRealtimeChange (delta-sync, then rehydrate) but is awaitable so the push
    /// handler can call iOS's completion handler only AFTER the sync finishes.
    /// deltaSync coalesces, so this is safe alongside a concurrent Ably-driven
    /// sync. Safe to call before configure() has wired the sync service — returns
    /// false (e.g. a cold background launch where SwiftUI's .task hasn't run).
    func backgroundSync() async -> Bool {
        guard let sync = syncService else { return false }
        let didWrite = await sync.deltaSync()
        if didWrite { deferRehydrate() }
        return didWrite
    }

    /// Tear down the Ably connection on full logout (org switch already
    /// disconnects via configure()). Wired to AuthManager.onLogout in configure().
    func teardownRealtime() {
        realtime.disconnect()
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

    /// Set every time we optimistically mutate the current user's activeJobClock
    /// or activeBreak, so the next loadAll() can preserve the local value while
    /// the server's eventual-consistency catches up. Readable (not private) so
    /// views can observe it as a reliable "clock/break changed" trigger — the
    /// nested computed chain (myActiveJobClock → currentPerson → people) doesn't
    /// always re-fire an always-mounted child view, but this stored property
    /// does.
    private(set) var clockChangeAt: Date? = nil

    /// Apply a state change WITHOUT animating the resulting view update. Used by
    /// the data-load paths so values arriving after the first render (fresh
    /// launch once the splash fades, or returning from background) snap in
    /// cleanly instead of animating / "stretching" into place.
    private func withoutAnimation(_ work: () -> Void) {
        var txn = Transaction()
        txn.disablesAnimations = true
        withTransaction(txn, work)
    }

    func loadAll() async {
        guard let api, !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        let startCursor = localCache?.cursor()  // race guard — see the end of this method

        // Don't clobber existing in-memory data with an empty server response
        // — a momentary S3 / network blip would otherwise wipe a populated
        // list for the next render cycle ("split-second flash then gone").
        // Real "everything deleted" cases are handled by user-driven refreshes
        // and will catch up once the array is empty on both sides.
        if let r = try? await api.fetchJobs(), !r.isEmpty || jobs.isEmpty {
            withoutAnimation { jobs = r }
        }
        if let r = try? await api.fetchPeople(), !r.isEmpty || people.isEmpty {
            // Capture the optimistic clock IMMEDIATELY before overwriting
            // `people`. Doing it here (not at the top of loadAll) handles
            // the race where the user taps START TIMER mid-fetch — by the
            // time we get the people response, the local mutation has
            // already happened and we can preserve it.
            let snap: (personId: String, clock: ActiveJobClock?, brk: ActiveBreak?)? = {
                guard let last = clockChangeAt, Date().timeIntervalSince(last) < 12,
                      let p = currentPerson else { return nil }
                return (p.id, p.activeJobClock, p.activeBreak)
            }()
            withoutAnimation {
                people = r
                if let snap, let idx = people.firstIndex(where: { $0.id == snap.personId }) {
                    people[idx].activeJobClock = snap.clock
                    people[idx].activeBreak = snap.brk
                }
            }
        }
        if let r = try? await api.fetchClients(), !r.isEmpty || clients.isEmpty {
            withoutAnimation { clients = r }
        }
        if let r = try? await api.fetchMessages(), !r.isEmpty || messages.isEmpty {
            withoutAnimation { messages = r }
        }
        if let r = try? await api.fetchGroups(), !r.isEmpty || groups.isEmpty {
            withoutAnimation { groups = r }
        }
        if let r = try? await api.fetchOrgSettings() { withoutAnimation { orgSettings = r } }
        withoutAnimation { autoMatchPerson() }

        // Race fix: if a live delta (Ably) advanced the sync cursor WHILE we were
        // fetching, this network snapshot is stale relative to the cache. The
        // cache is authoritative, so re-hydrate from it (no extra network) to let
        // the fresh data win instead of the old fetch clobbering it.
        if let cache = localCache, cache.cursor() != startCursor {
            rehydrateFromCache()
        }
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
            // Only the "new job created" heads-up (→ admins) is client-invoked.
            // "Assigned" pushes are now fired SERVER-SIDE by tasks.js, which
            // diffs op/panel team membership on every write — client-agnostic
            // and can't double-fire with a client call — so the former client
            // `assigned` notify was removed here (Phase 5 consolidation).
            guard existing == nil else { return }
            do {
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
                jobTeamIds: jobTeamIds, newTeamIds: nil, clientName: nil,
                approvedByName: personName
            ))
            if allDone {
                try? await api.sendNotification(NotifyPayload(
                    type: "ready",
                    jobTitle: jobTitle, jobNumber: jobNumber,
                    panelTitle: panelTitle, stepLabel: stepLabel,
                    jobTeamIds: jobTeamIds, newTeamIds: nil, clientName: nil,
                    approvedByName: personName
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
            withoutAnimation { messages = msgs }
        }
    }

    /// Pull historical timeclock entries. Pass `personId` to filter on the
    /// server side (the only practical option for non-admins). Admins on
    /// the desktop pull the whole org's history; iOS can do the same by
    /// passing nil, but that's a heavy fetch.
    func refreshTimeclock(personId: String? = nil) async {
        guard let api else { return }
        if let entries = try? await api.fetchTimeclock(personId: personId) {
            withoutAnimation { timeclockEntries = entries }
        }
    }

    /// Pull the timestamped job-clock sessions (per-person) for the Hours
    /// page's JOB HOURS section. Same scoping as `refreshTimeclock`.
    func refreshJobSessions(personId: String? = nil) async {
        guard let api else { return }
        if let sessions = try? await api.fetchJobSessions(personId: personId) {
            withoutAnimation { jobSessions = sessions }
        }
    }

    /// Pull this person's time-off requests for the Hours page Time Off section.
    func refreshTimeOffRequests() async {
        guard let api else { return }
        if let reqs = try? await api.fetchTimeOffRequests() {
            withoutAnimation { timeOffRequests = reqs }
        }
    }

    /// Submit a new PTO/UTO request, then refresh the list so it appears as
    /// pending. Throws on failure so the sheet can surface the error.
    @discardableResult
    func submitTimeOff(type: String, start: String, end: String, note: String) async throws -> TimeOffRequest {
        guard let api else { throw APIError.noOrgCode }
        let created = try await api.submitTimeOff(type: type, start: start, end: end, note: note)
        await refreshTimeOffRequests()
        return created
    }

    /// Withdraw a request (any status — "cancel anytime"). If it was already
    /// approved, the server also pulls the entry back out of person.timeOff.
    func cancelTimeOff(id: String) async {
        guard let api else { return }
        _ = try? await api.cancelTimeOff(id: id)
        await refreshTimeOffRequests()
    }

    /// Approve/deny a request from the chat bubble (admin only). On approve the
    /// server also writes person.timeOff, so reload everything afterward.
    func decideTimeOff(id: String, action: String, reason: String = "") async {
        guard let api else { return }
        _ = try? await api.decideTimeOff(id: id, action: action, reason: reason)
        await refreshTimeOffRequests()
        await loadAll()
    }

    /// Pull just the org settings. Views like the Schedule and Tasks
    /// tabs call this on appear so changes the admin makes on the
    /// Netlify desktop (workdays, holidays, hpd, etc.) show up
    /// immediately on iOS instead of waiting up to 15s for the next
    /// global auto-refresh.
    func refreshOrgSettings() async {
        guard let api else { return }
        if let s = try? await api.fetchOrgSettings() { withoutAnimation { orgSettings = s } }
    }

    /// Create a new chat group and persist it to the server. Before this
    /// existed, the New Group sheet was decorative — it only changed
    /// local navigation state. Other devices (and the same device after
    /// a relaunch) never saw the group.
    func createGroup(name: String, memberIds: [String]) async {
        guard let api else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let group = ChatGroup(id: UUID().uuidString, name: trimmed, memberIds: memberIds)
        // Optimistic local update so the inbox surfaces the new group
        // immediately. The server save runs in the background.
        var updated = groups
        if !updated.contains(where: { $0.name == trimmed }) {
            updated.append(group)
            groups = updated
        }
        do {
            try await api.saveGroups(updated)
        } catch {
            errorMessage = "Failed to create group: \(error.localizedDescription)"
        }
    }

    /// Add people to an existing group and persist. Optimistic local update so
    /// the thread's participant list reflects it immediately; the server save
    /// runs in the background. No-op if the group is missing or everyone named
    /// is already a member.
    func addGroupMembers(groupName: String, add ids: [String]) async {
        guard let api else { return }
        guard let idx = groups.firstIndex(where: { $0.name == groupName || $0.id == groupName }) else { return }
        let newIds = ids.filter { !groups[idx].memberIds.contains($0) }
        guard !newIds.isEmpty else { return }
        var updated = groups
        updated[idx].memberIds.append(contentsOf: newIds)
        groups = updated
        do {
            try await api.saveGroups(updated)
        } catch {
            errorMessage = "Failed to add to group: \(error.localizedDescription)"
        }
    }

    /// Delete an entire message thread (DM, job, panel, op, or group).
    /// Server removes every message with that threadKey from messages.json.
    func deleteThread(threadKey: String) async {
        guard let api else { return }
        // Optimistic local removal so the inbox doesn't keep showing the
        // thread while the network call is in flight.
        let snapshot = messages
        messages.removeAll { $0.threadKey == threadKey }
        do {
            try await api.deleteThread(threadKey: threadKey)
        } catch {
            messages = snapshot   // restore on failure
            errorMessage = "Failed to delete thread: \(error.localizedDescription)"
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
            // 1s debounce matches the desktop. Previously 3s meant a
            // user editing on iOS could lose up to 3 seconds of work on
            // a crash, and another device's poll cycle (15-30s) could
            // run between the edit and the sync.
            try? await Task.sleep(nanoseconds: 1_000_000_000)
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

        // Try the granular PATCH first — it avoids the savePeople race
        // that could clobber a concurrent server-side jobClockIn. If the
        // server doesn't speak PATCH yet (older Netlify deploy, returns
        // 405), fall back to the whole-array POST so push tokens still
        // land in people.json. Without this fallback, the chat
        // notifications break the moment the iOS client races ahead of
        // the Netlify deploy.
        do {
            try await api.patchPerson(personId: personId, fields: ["pushToken": token])
        } catch APIError.httpError(405), APIError.httpError(404) {
            try? await api.savePeople(updated)
        } catch {
            // Any other error: also fall back, since we'd rather have
            // push working with the legacy race than not working at all.
            try? await api.savePeople(updated)
        }
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
        // Optimistic update so the user sees "Finish Requested" immediately.
        if let ji = jobs.firstIndex(where: { $0.id == jobId }),
           let pi = jobs[ji].subs.firstIndex(where: { $0.id == panelId }),
           let oi = jobs[ji].subs[pi].subs.firstIndex(where: { $0.id == opId }) {
            jobs[ji].subs[pi].subs[oi].pendingFinish = true
        }
        do {
            try await api.timeclockFinishRequest(personId: personId, pin: pin,
                                                 jobId: jobId, panelId: panelId, opId: opId)
            // Server updates pendingFinish in tasks.json. Refetch so the
            // local jobs array matches the canonical server state — if we
            // don't, the flag lives only in memory and any subsequent
            // saveJobs (from another mutation) could clobber it.
            await refreshJobsQuietly()
        } catch {
            // Revert the optimistic flip so the user doesn't see a phantom
            // "Finish Requested" state that the server never recorded.
            if let ji = jobs.firstIndex(where: { $0.id == jobId }),
               let pi = jobs[ji].subs.firstIndex(where: { $0.id == panelId }),
               let oi = jobs[ji].subs[pi].subs.firstIndex(where: { $0.id == opId }) {
                jobs[ji].subs[pi].subs[oi].pendingFinish = false
            }
            if case APIError.httpError(401) = error {
                clockError = APIError.httpError(401).localizedDescription
            } else {
                clockError = "Failed to request finish: \(error.localizedDescription)"
            }
        }
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
            withoutAnimation { jobs = r }
        }
    }

    /// Synchronously set/clear the current person's active job clock so the UI
    /// reorders on the SAME frame (no MainActor hop). Mirrors setLocalBreak /
    /// markJobClockedOutLocally.
    private func setLocalJobClock(personId: String, _ value: ActiveJobClock?) {
        guard let idx = people.firstIndex(where: { $0.id == personId }) else { return }
        var newPeople = people
        newPeople[idx].activeJobClock = value
        people = newPeople
        clockChangeAt = Date()
    }

    func jobClockIn(jobId: String, panelId: String? = nil, opId: String? = nil,
                    jobTitle: String? = nil, panelTitle: String? = nil, opTitle: String? = nil) async {
        guard let api, let personId = currentPersonId else { return }

        // Optimistically set the active job clock BEFORE the network round-trip
        // so the card slides up to the hero slot IMMEDIATELY instead of waiting
        // on the server. The STARTING… button already signals the tap; a 409
        // means we're already in (= success), and a genuine failure reverts.
        let previousClock = people.first(where: { $0.id == personId })?.activeJobClock
        let optimistic = ActiveJobClock(
            clockIn: ISO8601DateFormatter().string(from: Date()),
            jobId: jobId, panelId: panelId, opId: opId,
            jobTitle: jobTitle, panelTitle: panelTitle, opTitle: opTitle
        )
        setLocalJobClock(personId: personId, optimistic)

        do {
            try await api.jobClockIn(personId: personId, jobId: jobId, panelId: panelId, opId: opId,
                                     jobTitle: jobTitle, panelTitle: panelTitle, opTitle: opTitle)

            // Refresh jobs (op status → "In Progress" lands here) and
            // pick up the server's canonical clockIn timestamp via the
            // grace-window snapshot in loadAll. refreshJobsQuietly only
            // touches jobs so it can't blow away our local activeJobClock.
            await refreshJobsQuietly()
        } catch APIError.httpError(409) {
            // Server says "already clocked in" — that's effectively the
            // state we wanted to reach. The most common cause was the
            // user tapping LOG TIME multiple times because the first tap
            // had no visible feedback: the first request succeeded, the
            // second got 409. The STARTING… indicator should make this
            // rare, but we still treat it as success.
            await loadAll()
        } catch APIError.httpError(401) {
            // Genuine failure → undo the optimistic clock so the card slides
            // back. Use the bare 401 message rather than the "Failed to start:"
            // prefix so the banner reads "Error: 401 (Log out, and log
            // back in)" instead of stacking labels.
            setLocalJobClock(personId: personId, previousClock)
            clockError = APIError.httpError(401).localizedDescription
        } catch {
            setLocalJobClock(personId: personId, previousClock)
            clockError = "Failed to start: \(error.localizedDescription)"
        }
    }

    /// Synchronous optimistic clear. Call this from the STOP button BEFORE
    /// kicking off the async network call — it nukes the active job clock
    /// on the current frame so the card flips from "TRACKING / STOP" to
    /// "LOG TIME" instantly, instead of waiting for the Task to be
    /// scheduled, hop into MainActor, run the mutation, and only then
    /// notify SwiftUI. That hop is what was making STOP feel laggy.
    func markJobClockedOutLocally() {
        guard let personId = currentPersonId else { return }
        if let idx = people.firstIndex(where: { $0.id == personId }),
           people[idx].activeJobClock != nil {
            var newPeople = people
            newPeople[idx].activeJobClock = nil
            people = newPeople
        }
        clockChangeAt = Date()
    }

    func jobClockOut() async {
        guard let api, let personId = currentPersonId else { return }

        do {
            try await api.jobClockOut(personId: personId)
            // Clear locally ONLY after the server confirms. Keeping the
            // active clock visible during the network call lets the STOP
            // button show its "STOPPING…" state without the counter
            // collapsing to "—" mid-flight.
            markJobClockedOutLocally()
            await refreshJobsQuietly()
        } catch APIError.httpError(409) {
            // Server says we're not clocked into any job — a race between
            // an optimistic local clock-in and a concurrent savePeople
            // (e.g. push-token registration) can land us here with local
            // showing active but the server's people.json showing null.
            // The user tapped STOP intending to be clocked out; align
            // local to the server's truth so the card flips correctly
            // instead of "glitching back" to STOP.
            markJobClockedOutLocally()
            await refreshJobsQuietly()
        } catch {
            clockError = error.localizedDescription
        }
    }

    // MARK: - Panel attachments

    /// Upload a photo/file and attach it to a panel's `attachments`, then
    /// persist the job. Used by the clock-out photo prompt. Mirrors the web
    /// app's `uploadPhotoToPanel`: the S3 key/filename come from the upload
    /// endpoint, provenance (who/when/which op) is stamped client-side.
    /// Throws on upload failure so the caller can surface an error and let the
    /// worker retry; the panel isn't mutated unless the upload succeeds.
    func attachPanelPhoto(jobId: String, panelId: String, opId: String?,
                          filename: String, mimeType: String, data: Data) async throws {
        guard let api else {
            throw APIError.unknown(NSError(domain: "TRAQS", code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Service unavailable — try again."]))
        }
        let result = try await api.uploadAttachment(filename: filename, mimeType: mimeType, data: data)
        let meta = PanelAttachment(
            key: result.key,
            filename: result.filename,
            mimeType: result.mimeType,
            size: result.size,
            uploadedById: currentPersonId,
            uploadedByName: currentPerson?.name,
            uploadedAt: ISO8601DateFormatter().string(from: Date()),
            opId: opId
        )
        // Re-find the job at append time — jobs may have refreshed since the
        // clock-out. updateJob persists via saveJobs (sendNotification stays
        // false, so this doesn't fire a push).
        guard var job = jobs.first(where: { $0.id == jobId }),
              let pi = job.subs.firstIndex(where: { $0.id == panelId }) else { return }
        job.subs[pi].attachments.append(meta)
        updateJob(job)
    }

    /// Upload a photo/file for a chat message and return its attachment
    /// metadata (to drop into `Message.attachments`). Throws on failure so the
    /// composer can surface an error and keep the pending attachment for retry.
    func uploadMessageAttachment(filename: String, mimeType: String, data: Data) async throws -> Attachment {
        guard let api else {
            throw APIError.unknown(NSError(domain: "TRAQS", code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Service unavailable — try again."]))
        }
        let r = try await api.uploadAttachment(filename: filename, mimeType: mimeType, data: data)
        return Attachment(key: r.key, filename: r.filename, mimeType: r.mimeType, size: r.size)
    }

    /// Count of files already attached to a panel whose names start with
    /// `stem` — used to disambiguate same-day clock-out photos (`_2`, `_3`).
    func panelAttachmentCount(jobId: String, panelId: String, stemPrefix: String) -> Int {
        guard let job = jobs.first(where: { $0.id == jobId }),
              let panel = job.subs.first(where: { $0.id == panelId }) else { return 0 }
        return panel.attachments.filter { $0.filename.hasPrefix(stemPrefix) }.count
    }

    // MARK: - Break (lightweight status; job clock keeps running)

    var myActiveBreak: ActiveBreak? { currentPerson?.activeBreak }
    /// Presence-only — a break stays "on" until the worker ends it manually,
    /// even past its configured duration (overruns stay visible to admins).
    var isOnBreak: Bool { myActiveBreak != nil }

    /// Optimistically set/clear the current person's `activeBreak` so the UI
    /// flips on the FIRST tap. `clockChangeAt` is set so loadAll's grace
    /// window preserves the optimistic value until the server catches up.
    private func setLocalBreak(personId: String, _ value: ActiveBreak?) {
        guard let idx = people.firstIndex(where: { $0.id == personId }) else { return }
        var newPeople = people
        newPeople[idx].activeBreak = value
        people = newPeople
        clockChangeAt = Date()
    }

    /// Start a break using the configured break length. Job clock is left
    /// running. Schedules the local "ending soon" reminder.
    func startBreak() async {
        guard let api, let personId = currentPersonId else { return }
        let minutes = orgSettings.breaks.first?.durationMinutes ?? 15
        let optimistic = ActiveBreak(startedAt: ISO8601DateFormatter().string(from: Date()),
                                     durationMinutes: minutes)
        setLocalBreak(personId: personId, optimistic)
        BreakReminder.schedule(durationMinutes: minutes)
        do {
            try await api.breakBegin(personId: personId, durationMinutes: minutes)
            await refreshJobsQuietly()
        } catch APIError.httpError(409) {
            await refreshJobsQuietly()   // already on break server-side — fine
        } catch {
            setLocalBreak(personId: personId, nil)   // revert
            BreakReminder.cancel()
            clockError = error.localizedDescription
        }
    }

    /// End the break. The ONLY way a break ends — there is no auto-expiry.
    func endBreak() async {
        guard let api, let personId = currentPersonId else { return }
        let previous = myActiveBreak
        setLocalBreak(personId: personId, nil)
        BreakReminder.cancel()
        do {
            try await api.breakEnd(personId: personId)
            await refreshJobsQuietly()
        } catch APIError.httpError(409) {
            await refreshJobsQuietly()   // already cleared server-side — fine
        } catch {
            setLocalBreak(personId: personId, previous)   // revert
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
        return (min(est, base + liveElapsedHours(for: op)), est)
    }

    /// Live (not-yet-clocked-out) hours for whoever is currently clocked into
    /// this op — display only, so progress/worked visuals creep forward between
    /// server polls. 0 when nobody is on the op's clock.
    private func liveElapsedHours(for op: Operation) -> Double {
        guard let activeP = people.first(where: { $0.activeJobClock?.opId == op.id && !($0.activeJobClock?.clockIn.isEmpty ?? true) }),
              let jc = activeP.activeJobClock,
              let started = Date.fromFlexibleISO8601(jc.clockIn) else { return 0 }
        let elapsedH = Date().timeIntervalSince(started) / 3600
        let pausedH = (jc.totalPausedMs ?? 0) / 3_600_000
        return max(0, elapsedH - pausedH)
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

    /// Number of full op-days (fractional) recorded against an op from its
    /// lifetime `loggedHours` total — used to fill the op's schedule tiles
    /// front-to-back (one tile per `hpd` logged) for already-clocked-out work.
    /// Live, in-progress time is NOT included here; it's attributed to the
    /// actual day it's happening on via `liveHours(forOp:on:)` so a worker's
    /// current session shows up on today's bar immediately. A finished op fills
    /// all of its tiles.
    func opLoggedDays(_ op: Operation) -> Double {
        if op.status == .finished { return .greatestFiniteMagnitude }
        let hpd = max(0.0001, op.hpd > 0 ? op.hpd : orgSettings.hpd)
        return (op.loggedHours ?? 0) / hpd
    }

    /// Live (not-yet-clocked-out) hours for an op, attributed to the calendar
    /// day its session STARTED on (normally today). The server only folds a
    /// session into `loggedHours` at clock-out, so without this a worker sees
    /// nothing on the bar while they're actively working. Sums all workers
    /// currently on the op (an op can have more than one).
    func liveHours(forOp op: Operation, on day: Date) -> Double {
        let cal = Calendar.current
        return people.reduce(0.0) { acc, p in
            guard let jc = p.activeJobClock, jc.opId == op.id, !jc.clockIn.isEmpty,
                  let started = Date.fromFlexibleISO8601(jc.clockIn),
                  cal.isDate(started, inSameDayAs: day) else { return acc }
            let elapsedH = Date().timeIntervalSince(started) / 3600
            let pausedH = (jc.totalPausedMs ?? 0) / 3_600_000
            return acc + max(0, elapsedH - pausedH)
        }
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

// MARK: - Home / pay-clock helpers
// Shared math for the Home and Hours screens, computed per the current person.
// The pay-period window comes from the org's time-clock settings. `now` is
// passed in so the caller's 1s ticker drives live values. (Hours/TimeClockView
// still keep their own copies for now; these power the Home screen.)
extension AppState {

    /// Pay-period boundaries from the time-clock settings (weekly / biweekly /
    /// semimonthly), matching TimeClockView's `periodWindow`.
    func payPeriodWindow(now: Date) -> (start: Date, end: Date) {
        let s = orgSettings
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        let anchor = s.payPeriodStart.flatMap(Self.fullISODate) ?? today
        switch s.payPeriodType {
        case "weekly":
            let weekday = cal.component(.weekday, from: today)
            let toMonday = weekday == 1 ? -6 : -(weekday - 2)
            let start = cal.date(byAdding: .day, value: toMonday, to: today) ?? today
            let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
            return (start, end)
        case "semimonthly":
            let day = cal.component(.day, from: today)
            let comps = cal.dateComponents([.year, .month], from: today)
            let monthStart = cal.date(from: comps) ?? today
            if day <= 15 {
                let end = cal.date(byAdding: .day, value: 14, to: monthStart) ?? today
                return (monthStart, end)
            } else {
                let start = cal.date(byAdding: .day, value: 15, to: monthStart) ?? today
                let nextMonth = cal.date(byAdding: .month, value: 1, to: monthStart) ?? today
                let end = cal.date(byAdding: .day, value: -1, to: nextMonth) ?? today
                return (start, end)
            }
        default: // biweekly
            let days = cal.dateComponents([.day], from: anchor, to: today).day ?? 0
            let cycles = days / 14
            let start = cal.date(byAdding: .day, value: cycles * 14, to: anchor) ?? today
            let end = cal.date(byAdding: .day, value: 13, to: start) ?? today
            return (start, end)
        }
    }

    private static func fullISODate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    /// The pay-period hours cap (soft limit) configured in the desktop's Time
    /// Clock settings — the denominator the period ring fills toward, and the
    /// threshold past which hours count as overtime. Mirrors the web's
    /// `orgSettings.payPeriodHourCap || 80`. Falls back to 80 if unset.
    func payPeriodTarget(now: Date) -> Double {
        let cap = orgSettings.payPeriodHourCap
        return cap > 0 ? cap : 80
    }

    /// My completed pay-clock spans (any date).
    private var myCompletedPayEntries: [TimeclockEntry] {
        timeclockEntries.filter { e in
            e.eventType == nil && e.clockIn != nil && e.clockOut != nil
                && (currentPersonId == nil || e.personId == currentPersonId)
        }
    }

    /// Total pay-clock hours this period (completed spans, already net of
    /// lunch/break) + the live current shift.
    func payPeriodHours(now: Date) -> Double {
        let w = payPeriodWindow(now: now)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: w.end) ?? w.end
        let completed = myCompletedPayEntries.reduce(0.0) { acc, e in
            guard let d = e.clockIn.flatMap(Date.fromFlexibleISO8601) ?? e.date.flatMap(Self.fullISODate)
            else { return acc }
            return (d >= w.start && d < end) ? acc + (e.hours ?? 0) : acc
        }
        return completed + liveShiftHours(now: now)
    }

    /// Today's clocked-in pay hours: completed spans dated today + the live
    /// shift if it started today.
    func hoursToday(now: Date) -> Double {
        let cal = Calendar.current
        let completed = myCompletedPayEntries.reduce(0.0) { acc, e in
            guard let d = e.clockIn.flatMap(Date.fromFlexibleISO8601) else { return acc }
            return cal.isDate(d, inSameDayAs: now) ? acc + (e.hours ?? 0) : acc
        }
        var live = 0.0
        if let c = currentPerson?.activeClockIn,
           let s = Date.fromFlexibleISO8601(c.clockIn),
           cal.isDate(s, inSameDayAs: now) {
            live = liveShiftHours(now: now)
        }
        return completed + live
    }

    /// Live hours for the current pay shift — counts while clocked in, pauses
    /// for lunch/break (mirrors the server's hoursElapsedMinusPauses).
    func liveShiftHours(now: Date) -> Double {
        guard let c = currentPerson?.activeClockIn,
              let s = Date.fromFlexibleISO8601(c.clockIn) else { return 0 }
        let totalMs = now.timeIntervalSince(s) * 1000
        return max(0, (totalMs - Self.payPausedMs(c.events, end: now)) / 3_600_000)
    }

    private static func payPausedMs(_ events: [ClockEvent], end: Date) -> Double {
        var paused = 0.0
        var lunchOpen: Date?
        var breakOpen: Date?
        for ev in events {
            guard let t = Date.fromFlexibleISO8601(ev.ts) else { continue }
            switch ev.type {
            case "lunchStart": lunchOpen = t
            case "lunchEnd":   if let l = lunchOpen { paused += max(0, t.timeIntervalSince(l) * 1000); lunchOpen = nil }
            case "breakStart": breakOpen = t
            case "breakEnd":   if let b = breakOpen { paused += max(0, t.timeIntervalSince(b) * 1000); breakOpen = nil }
            default: break
            }
        }
        if let l = lunchOpen { paused += max(0, end.timeIntervalSince(l) * 1000) }
        if let b = breakOpen { paused += max(0, end.timeIntervalSince(b) * 1000) }
        return paused
    }

    /// Current user's shift status from their time-clock (offline / clocked in
    /// / lunch / break). Same derivation the drawer status pill uses.
    var myShiftStatus: ShiftStatus {
        guard let clock = currentPerson?.activeClockIn else { return .offline }
        switch clock.events.last?.type {
        case "lunchStart": return .lunch
        case "breakStart": return .onBreak
        default:           return .clockedIn
        }
    }

    // ── Assigned tasks (mirrors TasksView.myTasks, no search filter) ──

    /// Every (job → panel → op) the current user is on the team for.
    var myAssignments: [TaskAssignment] {
        guard let me = currentPersonId else { return [] }
        var out: [TaskAssignment] = []
        for job in jobs {
            for panel in job.subs {
                let myOps = panel.subs.filter { $0.team.contains(me) }
                if !myOps.isEmpty {
                    for op in myOps { out.append(TaskAssignment(job: job, panel: panel, op: op)) }
                } else if panel.team.contains(me) {
                    out.append(TaskAssignment(job: job, panel: panel, op: nil))
                }
            }
        }
        return out
    }

    /// My assignments whose date range overlaps `range`, sorted by start.
    func assignments(in range: Range<Date>) -> [TaskAssignment] {
        myAssignments.filter {
            guard let s = $0.startDate, let e = $0.endDate else { return false }
            return s < range.upperBound && e >= range.lowerBound
        }
        .sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
    }

    /// My assignments scheduled for today.
    func todayTasks(now: Date) -> [TaskAssignment] {
        let cal = Calendar.current
        let start = cal.startOfDay(for: now)
        let end = cal.date(byAdding: .day, value: 1, to: start) ?? start
        return assignments(in: start..<end)
    }

    /// The task the current user is actively clocked into, resolved to a
    /// TaskAssignment (mirrors TasksView.activeTask).
    var activeTaskAssignment: TaskAssignment? {
        guard let jc = myActiveJobClock,
              let job = jobs.first(where: { $0.id == jc.jobId }),
              let panel = job.subs.first(where: { $0.id == jc.panelId }) else { return nil }
        let op = jc.opId.flatMap { oid in panel.subs.first(where: { $0.id == oid }) }
        return TaskAssignment(job: job, panel: panel, op: op)
    }
}
