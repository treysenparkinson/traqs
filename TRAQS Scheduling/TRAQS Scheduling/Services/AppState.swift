import Foundation
import Combine
import SwiftUI
import OneSignalFramework
import SwiftData
import Network

@MainActor
/// Describes the conversation currently on screen, for the overlay-window header.
/// The header is rendered in a separate UIWindow (see OverlayWindowController) so
/// the root UIHostingController's keyboard animation can't displace it; this is
/// how ThreadDetailView hands the header its title + back action.
struct ThreadContext: Equatable {
    let id: String
    let title: String
    let isDM: Bool
    let participants: [Person]   // for the avatar (1 = DM, N = group stack)
    let onBack: () -> Void
    /// Tapping the header identity (avatar/title/▾) toggles the members popover.
    let onTapIdentity: () -> Void
    // Compared by id only (closures/derived data aren't Equatable). Re-publishing
    // with the same id still fires @Observable, so the overlay refreshes.
    static func == (lhs: ThreadContext, rhs: ThreadContext) -> Bool { lhs.id == rhs.id }
}

@Observable
class AppState {
    /// Non-nil while a message thread is open. The overlay header window observes
    /// this to show/hide and to render the current thread's back button.
    var activeMessageThread: ThreadContext? = nil
    /// True while a full-screen attachment viewer is presented. The overlay header
    /// window sits above the app's normal window level, so it would otherwise
    /// float over the viewer and cover QuickLook's Done button — the controller
    /// hides the header while this is set, and restores it on dismiss.
    var attachmentViewerPresented = false
    /// Members popover open/close. Shared here (not @State) because the toggle
    /// comes from the header in the overlay WINDOW, while the popover renders in
    /// ThreadDetailView's own (main-window) view tree.
    var showThreadMembers = false
    /// Set by the overlay header's back button; MessagesView observes it and pops
    /// its own NavigationStack in-context (a captured dismiss/DismissAction called
    /// from a separate window degrades and stops working).
    var messagesPopRequested = false

    var matchEmail: String? = nil  // set from AuthManager after login
    // MARK: - Core Data
    var jobs: [Job] = []
    var people: [Person] = []
    var clients: [Client] = []
    var messages: [Message] = []
    var groups: [ChatGroup] = []
    /// Server-side read receipts: `[threadKey: [personId: ISO "read up to"]]`.
    /// Drives the Sent/Read status under my own message bubbles. Refreshed
    /// while a thread is open (poll + realtime "reads" channel).
    var readReceipts: [String: [String: String]] = [:]
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

    /// Transient toast text (Phase 6). Surfaced by the existing ErrorBanner via
    /// `errorMessage`; `showErrorToast` sets it. Kept as a separate entry point
    /// so optimistic-UI failures read as a friendly toast, not a raw error.

    // MARK: - Sync status (Phase 6)
    /// Network reachability (NWPathMonitor). Going offline is DEBOUNCED ~2s so a
    /// brief hiccup doesn't flash the indicator; coming back online is immediate.
    var isOnline = true
    /// True while a delta sync is applying — drives the faint "syncing" cue.
    var isSyncing = false
    /// Ably connection status, mapped from RealtimeService.
    private(set) var realtimeStatus: RealtimeStatus = .connecting
    /// True once Ably has connected at least once, so we don't show
    /// "reconnecting" during the very first connect on launch.
    private var realtimeEverConnected = false
    /// A recent save/sync FAILED — red error dot until the next success.
    var syncFailed = false
    /// Brief green "Reconnected" flash (2s) after Ably recovers from a drop.
    var reconnectedFlash = false

    /// Collapsed status the indicator renders. `.hidden` = quiet (all good).
    enum SyncBadge { case hidden, syncing, reconnecting, offline, error, reconnected }
    var syncBadge: SyncBadge {
        if reconnectedFlash { return .reconnected }
        if !isOnline { return .offline }
        if syncFailed { return .error }
        // Only nag "reconnecting" once Ably HAS connected and isn't degraded
        // (degraded = real-time disabled; the app just polls — no alarm needed).
        if realtimeEverConnected && realtimeStatus != .connected && realtimeStatus != .degraded { return .reconnecting }
        if isSyncing { return .syncing }
        return .hidden
    }

    // NWPathMonitor plumbing.
    private let netMonitor = NWPathMonitor()
    private var netMonitorStarted = false
    private var offlineDebounce: Task<Void, Never>?
    private var reconnectedFlashTask: Task<Void, Never>?

    // MARK: - Time Clock State
    var clockedInPersonId: String?
    var clockedInPersonName: String?
    var clockedInPin: String?          // RAM only — never persisted
    var activeClockIn: ActiveClockIn?
    var isClockingIn = false
    var clockError: String?

    // Pay-clock (Bearer-only iOS clock-in/out) observable state. Canonical
    // values are derived from currentPerson.activeClockIn (clockIn/source) via
    // reconcilePayClock(), but they are ALSO set optimistically on tap and the
    // clockChangeAt trigger is bumped so the always-mounted Hours view flips on
    // the same frame (the nested currentPerson→people chain doesn't reliably
    // re-fire it — see clockChangeAt).
    var payClockInActive = false
    var payClockInStart: Date?
    var payClockInSource: String?
    var isPayClocking = false          // in-flight guard for the CTA spinner
    var clockActionLabel: String? = nil   // non-nil drives the full-screen TRAQS loading overlay ("Clocking In…"/"Clocking Out…")

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
    /// Fallback poll task — runs ONLY while Ably realtime is not connected (see
    /// updateDegradedPoll). Replaces the old always-on 15s loop.
    private var degradedPollTask: Task<Void, Never>?
    /// Delayed stale-foreground safety-net task (see handleForeground).
    private var staleForegroundTask: Task<Void, Never>?
    /// Whether the app is currently foregrounded — gates the degraded poll.
    private var isForeground = true
    private var api: APIService?

    // Live sync (Phase 4): SwiftData cache + Ably realtime — the primary refresh
    // path. loadAll() is now reserved for cold launch, pull-to-refresh, and the
    // stale-foreground safety net; a degraded-only poll covers Ably outages.
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
        // The primary refresh path: paint from cache instantly, delta-sync in the
        // background, then subscribe to Ably for ~1s live updates. loadAll() and
        // the degraded-only poll below are fallbacks.
        realtime.disconnect()                 // drop any previous org's connection
        auth.onLogout = { [weak self] in self?.clearForLogout() }  // full-logout cleanup (runs before the Auth0 session ends)
        let cache = LocalCache()
        cache.initialize(orgCode: orgCode)
        self.localCache = cache
        let sync = SyncService(api: apiInstance, cache: cache)
        self.syncService = sync
        if cache.hasCachedData() { rehydrateFromCache() }   // instant paint from cache
        startNetworkMonitoring()              // Phase 6: reachability for the sync indicator
        Task {
            _ = await self.runDeltaSync()     // seed/refresh cache + cursor (flips isSyncing)
            self.rehydrateFromCache()         // apply anything that changed
            await self.realtime.connect(orgCode: orgCode, api: apiInstance,
                                   onChange: { [weak self] in self?.onRealtimeChange() },
                                   onReconnect: { [weak self] in self?.onRealtimeChange() },
                                   onStatus: { [weak self] s in self?.setRealtimeStatus(s) },
                                   onTimeoff: { [weak self] in Task { await self?.refreshTimeOffRequests() } },
                                   onReads: { [weak self] in Task { await self?.refreshReadReceipts() } })
        }

        updateDegradedPoll()   // starts the fallback poll until Ably connects
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
        // Pick up a pay clock-in/out that landed via realtime (e.g. a kiosk
        // punch) — grace-guarded so a recent optimistic iOS tap isn't clobbered.
        reconcilePayClock()
    }

    // Ably "changed" → pull the delta, then rehydrate. deltaSync coalesces bursts.
    private func onRealtimeChange() {
        Task { [weak self] in
            guard let self else { return }
            // Rehydrate ONLY when the delta actually wrote something. A coalesced
            // or empty sync (e.g. a re-send of already-cached records) writes
            // nothing → skipping avoids re-assigning unchanged arrays, which was
            // resetting SwiftUI's render debounce and delaying the real update.
            let didWrite = await self.runDeltaSync()   // flips isSyncing for the indicator
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

    /// Full-logout cleanup. Wired to `AuthManager.onLogout`, which fires at the
    /// START of logout() — BEFORE the Auth0 session/tokens are cleared — so the
    /// next account to log in on this device can't inherit the previous user's
    /// identity or see their cached threads/data. Without this, a stale
    /// `currentPersonId` (persisted in UserDefaults, never cleared) drove the
    /// chat ACL for the wrong person, and the SwiftData cache surfaced a prior
    /// account's messages/groups. Clears, in order: realtime, the persisted +
    /// in-memory identity, the local cache (rows AND the sync cursor, so the
    /// next login full-resyncs), the in-memory synced collections (loadAll /
    /// rehydrate's empty-guards otherwise keep a populated list, letting old
    /// data linger), and the configure() idempotency guard (so re-login
    /// re-runs configure()).
    func clearForLogout() {
        teardownRealtime()
        currentPersonId = nil
        UserDefaults.standard.removeObject(forKey: "traqs_currentPersonId")
        localCache?.clearAll()
        jobs = []; people = []; clients = []; messages = []; groups = []
        configuredOrgCode = nil
    }

    // MARK: - Sync status & optimistic UI (Phase 6)

    /// Rollback snapshot for the debounced job save: the jobs state as of the
    /// last confirmed save, captured before the first edit of a debounce batch.
    private var rollbackSnapshot: [Job]?

    /// Start NWPathMonitor once. Offline is DEBOUNCED ~2s (a brief hiccup
    /// shouldn't flash the indicator — adversarial #6); coming back online is
    /// applied immediately.
    func startNetworkMonitoring() {
        guard !netMonitorStarted else { return }
        netMonitorStarted = true
        netMonitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                if satisfied {
                    self.offlineDebounce?.cancel(); self.offlineDebounce = nil
                    self.isOnline = true
                } else if self.isOnline {
                    self.offlineDebounce?.cancel()
                    self.offlineDebounce = Task { [weak self] in
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                        guard let self, !Task.isCancelled else { return }
                        self.isOnline = false
                    }
                }
            }
        }
        netMonitor.start(queue: DispatchQueue(label: "traqs.netmonitor"))
    }

    /// Map RealtimeService status → indicator state, flashing a 2s green
    /// "Reconnected" when Ably recovers after a drop (STEP 5.1).
    private func setRealtimeStatus(_ status: RealtimeStatus) {
        let wasDown = realtimeEverConnected && realtimeStatus != .connected
        realtimeStatus = status
        if status == .connected {
            if wasDown { flashReconnected() }
            realtimeEverConnected = true
        }
        // Flip the fallback poll on/off to match realtime: it runs only while
        // NOT connected. On connect it stops (Ably drives updates); on drop it
        // starts (15s deltaSync until reconnect).
        updateDegradedPoll()
    }

    private func flashReconnected() {
        reconnectedFlashTask?.cancel()
        reconnectedFlash = true
        reconnectedFlashTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, !Task.isCancelled else { return }
            self.reconnectedFlash = false
        }
    }

    /// Delta-sync wrapper that flips `isSyncing` for the indicator and clears the
    /// error state on a successful write. Returns whether anything was written.
    @discardableResult
    private func runDeltaSync() async -> Bool {
        guard let sync = syncService else { return false }
        isSyncing = true
        defer { isSyncing = false }
        let didWrite = await sync.deltaSync()
        if didWrite { syncFailed = false }
        return didWrite
    }

    /// Show a transient error toast. Reuses the existing ErrorBanner (which reads
    /// `errorMessage` and auto-dismisses). Separate entry point so optimistic-UI
    /// failures read as a friendly toast.
    func showErrorToast(_ message: String) {
        errorMessage = message
    }

    /// Minimal optimistic-UI helper (Phase 6 STEP 1). Applies `optimisticUpdate`
    /// immediately — it returns a rollback closure — fires `serverCall`, and on
    /// failure invokes the rollback + shows a toast + runs `onFail` (e.g. a
    /// shake). No offline queueing: the action still needs the network. Each
    /// call captures its OWN rollback, so overlapping optimistic updates don't
    /// interfere (adversarial #2). On success, nothing further — the Ably event
    /// eventually confirms.
    func performOptimistic(
        _ optimisticUpdate: () -> (() -> Void),
        serverCall: () async throws -> Void,
        onFail: (() -> Void)? = nil
    ) async {
        let rollback = optimisticUpdate()
        do {
            try await serverCall()
        } catch {
            rollback()
            showErrorToast("Couldn't save — try again")
            onFail?()
        }
    }

    /// Degraded-mode fallback poll. When Ably realtime is CONNECTED, live
    /// updates arrive via the "changed" channels + silent push, so no polling is
    /// needed. This 15s poll runs ONLY while realtime is NOT connected
    /// (disconnected / suspended / failed, the 503-degraded case, or the
    /// not-yet-connected startup window) AND the app is foregrounded. It calls
    /// deltaSync — NEVER loadAll (loadAll is reserved for cold launch,
    /// pull-to-refresh, and the stale-foreground safety net). Idempotent: safe to
    /// call on every realtime-status change; it starts or stops the timer to
    /// match the current state.
    private func updateDegradedPoll() {
        let shouldPoll = isForeground && api != nil && realtimeStatus != .connected
        if shouldPoll {
            guard degradedPollTask == nil else { return }   // already polling
            print("[poll] realtime=\(realtimeStatus) — starting degraded 15s deltaSync poll")
            degradedPollTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    guard let self, !Task.isCancelled else { break }
                    guard !self.isLoading else { continue }
                    if await self.runDeltaSync() { self.deferRehydrate() }
                }
            }
        } else {
            if degradedPollTask != nil {
                print("[poll] realtime connected/backgrounded — stopping degraded poll")
            }
            degradedPollTask?.cancel()
            degradedPollTask = nil
        }
    }

    /// App entered the foreground. Immediately delta-syncs (cheap catch-up),
    /// re-evaluates the degraded poll, and arms a stale-foreground safety net:
    /// if we haven't synced in >5 min, wait ~4s for Ably to reconnect + its
    /// catch-up delta to land; only if realtime is STILL not connected and no
    /// fresh sync arrived do we fall back to a heavy loadAll.
    func handleForeground() {
        isForeground = true
        foregroundSync()          // immediate deltaSync + rehydrate
        updateDegradedPoll()      // start the fallback poll if realtime is down
        let last = syncService?.lastSuccessfulSyncAt
        let stale = last == nil || Date().timeIntervalSince(last!) > 300   // 5 min
        guard stale else { return }
        staleForegroundTask?.cancel()
        staleForegroundTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)   // give Ably reconnect a beat
            guard let self, !Task.isCancelled else { return }
            if self.realtimeStatus == .connected { return }     // Ably caught us up
            if let l = self.syncService?.lastSuccessfulSyncAt,
               Date().timeIntervalSince(l) < 300 { return }      // a fresh delta already landed
            print("[foreground] stale >5min and realtime not connected — running loadAll() safety net")
            await self.loadAll()
        }
    }

    /// App went to the background: stop the fallback poll and cancel any pending
    /// safety-net fetch so nothing runs while suspended.
    func handleBackground() {
        isForeground = false
        staleForegroundTask?.cancel(); staleForegroundTask = nil
        updateDegradedPoll()   // shouldPoll is now false → cancels the timer
    }

    /// Public awaitable delta-sync + rehydrate for views that want an explicit
    /// refresh cadence (e.g. the Admin presence board) WITHOUT the heavy full-GET
    /// loadAll. Ably already pushes changes live; this is for a deliberate poll.
    func deltaSyncNow() async {
        if await runDeltaSync() { rehydrateFromCache() }
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
        if let data = try? await api.fetchMessagesData() {
            applyServerMessages(data)
        }
        if let r = try? await api.fetchGroups(), !r.isEmpty || groups.isEmpty {
            withoutAnimation { groups = r }
        }
        if let r = try? await api.fetchOrgSettings() { withoutAnimation { orgSettings = r } }
        withoutAnimation { autoMatchPerson() }

        // Race guard: if a live delta (Ably) advanced the sync cursor WHILE we were
        // fetching, this network snapshot is stale relative to the cache. The
        // cache is authoritative, so re-hydrate from it (no extra network) to let
        // the fresh data win instead of the old fetch clobbering it.
        //
        // NOTE: post-mutation loadAll calls (the COMMON trigger for this race) were
        // retired in Sprint 0 — loadAll now runs only on cold launch, pull-to-
        // refresh, and the stale-foreground safety net. The guard is KEPT because
        // those callers can still overlap an inbound Ably delta; removing it would
        // reintroduce a "pull-to-refresh clobbers a concurrent live update" bug.
        if let cache = localCache, cache.cursor() != startCursor {
            rehydrateFromCache()
        }
        // Reconcile the observable pay-clock flags from the (now-refreshed)
        // canonical activeClockIn — grace-guarded so a very recent optimistic
        // pay tap still wins.
        reconcilePayClock()
    }

    // MARK: - Jobs

    func updateJobs(_ newJobs: [Job], pushUndo: Bool = true) {
        if pushUndo {
            undoStack.append(jobs)
            if undoStack.count > maxUndoSize { undoStack.removeFirst() }
            redoStack.removeAll()
        }
        // Phase 6 optimism: snapshot the pre-batch state ONCE per debounce window
        // so a failed save can revert the whole batch to the last confirmed
        // state. Cleared on the next successful persist. Rapid edits coalesce
        // into one save (adversarial #5) and share this one snapshot.
        if rollbackSnapshot == nil { rollbackSnapshot = jobs }
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
            // Optimistic in-memory update above; the server publishes a "people"
            // Ably change → delta-sync reconciles the cache. Post-save loadAll
            // was redundant work.
            try? await api?.savePeople(newPeople)
        }
    }

    // MARK: - Clients

    func updateClients(_ newClients: [Client]) {
        clients = newClients
        Task {
            // Optimistic above; server publishes a "clients" Ably change →
            // delta-sync reconciles. Post-save loadAll was redundant.
            try? await api?.saveClients(newClients)
        }
    }

    // MARK: - Thread Read State
    // Lightweight per-thread "last read at" timestamps backed by UserDefaults.
    // `unreadCount` in the inbox compares each thread's newest message
    // timestamp against the stored value to display the sky unread badge.
    private let readStateKey = "traqs_threadReadAt"

    /// Per-thread "last read at" timestamps. This is a STORED property (seeded
    /// from UserDefaults, written back on every change) rather than a computed
    /// UserDefaults read — so @Observable tracks it and the inbox unread badge
    /// refreshes the instant a thread is marked read. As a computed property it
    /// never notified observers, so the badge only ever cleared by luck on the
    /// next unrelated re-render.
    var threadReadAt: [String: String] = (UserDefaults.standard.dictionary(forKey: "traqs_threadReadAt") as? [String: String]) ?? [:] {
        didSet { UserDefaults.standard.set(threadReadAt, forKey: readStateKey) }
    }

    func markThreadRead(_ threadKey: String) {
        threadReadAt[threadKey] = Date.nowISO()
    }

    func markAllThreadsRead() {
        let nowISO = Date.nowISO()
        // Compute unique threadKeys from current messages, then stamp each.
        var map = threadReadAt
        for k in Set(messages.map { $0.threadKey }) { map[k] = nowISO }
        threadReadAt = map
    }

    /// Total unread text messages across every thread I'm in — any message newer
    /// than the thread's last-read stamp that I didn't send. `messages` is already
    /// ACL-filtered server-side, so iterating it only counts threads I can see.
    /// Drives the Messages-tab count and the sidebar notification dot.
    var totalUnreadMessages: Int {
        guard let myId = currentPersonId else { return 0 }
        var total = 0
        for (key, msgs) in Dictionary(grouping: messages, by: { $0.threadKey }) {
            let readAt = threadReadAt[key].flatMap { Date.fromFlexibleISO8601($0) } ?? .distantPast
            for m in msgs where m.authorId != myId {
                if (Date.fromFlexibleISO8601(m.timestamp) ?? .distantPast) > readAt { total += 1 }
            }
        }
        return total
    }
    /// Whether there's anything unread worth surfacing (sidebar pulsing dot).
    var hasUnreadNotifications: Bool { totalUnreadMessages > 0 }

    // MARK: - Approval queue

    /// Who may open the Approval Queue — mirrors desktop's
    /// `canSeeApprovalQueue = admin || canSignOff`.
    var canViewApprovalQueue: Bool {
        guard let p = currentPerson else { return false }
        return p.isAdmin || p.canSignOff == true
    }

    /// Count of panels awaiting an engineering sign-off step — drives the Jobs-tab
    /// approval badge. A panel counts when it has an engineering block whose chain
    /// isn't fully signed off. Computed from `jobs` (@Observable), so it stays live
    /// via delta-sync and updates instantly after an optimistic signOff.
    var pendingApprovalCount: Int {
        var n = 0
        for job in jobs {
            for panel in job.subs {
                guard let eng = panel.engineering else { continue }
                if eng.designed == nil || eng.verified == nil || eng.sentToPerforex == nil { n += 1 }
            }
        }
        return n
    }

    /// Update the current user's editable profile (name/email/phone/color/image),
    /// optimistically then via the granular people PATCH. Returns success.
    @discardableResult
    func updateMyProfile(name: String, email: String, phone: String, color: String, image: String?) async -> Bool {
        guard let api, let personId = currentPersonId else { return false }
        let prev = people
        if let idx = people.firstIndex(where: { $0.id == personId }) {
            var p = people[idx]
            p.name = name; p.email = email; p.phone = phone; p.color = color
            p.image = image   // nil clears the photo
            var newPeople = people; newPeople[idx] = p; people = newPeople
        }
        var fields: [String: Any] = ["name": name, "email": email, "phone": phone, "color": color]
        // Always send image so removing a photo (nil → JSON null) clears it too.
        fields["image"] = image ?? NSNull()
        do {
            try await api.patchPerson(personId: personId, fields: fields)
            return true
        } catch {
            people = prev            // revert optimistic change
            return false
        }
    }

    // MARK: - AI

    /// One-line plain-English summary for the availability quick-check. Returns
    /// nil if the AI proxy is unreachable/unconfigured so the caller can show its
    /// templated fallback instead.
    func availabilitySummary(system: String, userJSON: String) async -> String? {
        guard let api else { return nil }
        let text = try? await api.aiScheduleText(system: system, userJSON: userJSON, maxTokens: 120)
        guard let text, !text.isEmpty else { return nil }
        return text
    }

    // MARK: - Completion requests

    /// Worker/admin requests that a whole job be marked complete. Stamps the job
    /// (so the request card shows Pending and can be resolved) and posts a
    /// `finish_request` message into the shared "Completion Requests" admin group.
    func requestJobCompletion(jobId: String) async {
        guard let me = currentPerson, let idx = jobs.firstIndex(where: { $0.id == jobId }) else { return }
        let members = Array(Set(people.filter { $0.isAdmin }.map(\.id) + [me.id]))
        guard let created = await createGroup(name: "Completion Requests", memberIds: members) else { return }
        await addGroupMembers(groupName: "Completion Requests", add: members)   // ensure new admins/requester are in
        let group = groups.first(where: { $0.id == created.id }) ?? created

        let reqId = UUID().uuidString
        let now = Date.nowISO()
        var job = jobs[idx]
        job.finishRequest = FinishRequestStamp(requestId: reqId, by: me.id, byName: me.name, at: now)
        var reqs = job.finishRequests ?? []
        reqs.append(FinishRequestEntry(id: reqId, by: me.id, byName: me.name, at: now,
                                       status: "pending", resolvedBy: nil, resolvedByName: nil,
                                       resolvedAt: nil, declineReason: nil))
        job.finishRequests = reqs
        updateJob(job)

        let jobNumTxt = job.jobNumber.map { "Job #\($0) — " } ?? ""
        let msg = Message(
            id: UUID().uuidString, threadKey: "group:\(group.id)", scope: "group",
            jobId: jobId, panelId: nil, opId: nil,
            text: "Completion requested by \(me.name) for \(jobNumTxt)\(job.title)",
            authorId: me.id, authorName: me.name, authorColor: me.color,
            participantIds: group.memberIds, attachments: [], timestamp: Date.nowISO(),
            type: "finish_request", finishRequestId: reqId)
        _ = try? await sendMessageThrowing(msg)
    }

    /// Admin approves a completion request → finish the WHOLE job (job + panels + ops).
    func approveJobCompletion(jobId: String, requestId: String) async {
        guard let me = currentPerson, me.isAdmin, let idx = jobs.firstIndex(where: { $0.id == jobId }) else { return }
        let now = Date.nowISO()
        var job = jobs[idx]
        job.status = .finished
        job.subs = job.subs.map { p in
            var p = p; p.status = .finished
            p.subs = p.subs.map { o in var o = o; o.status = .finished; return o }
            return p
        }
        job.finishRequest = nil
        job.finishRequests = (job.finishRequests ?? []).map { e in
            guard e.id == requestId else { return e }
            var e = e; e.status = "approved"; e.resolvedBy = me.id; e.resolvedByName = me.name; e.resolvedAt = now
            return e
        }
        updateJob(job)
        await postCompletionResolution(jobId: jobId, job: job, approved: true)
    }

    /// Admin denies a completion request → job stays active/overdue.
    func denyJobCompletion(jobId: String, requestId: String) async {
        guard let me = currentPerson, me.isAdmin, let idx = jobs.firstIndex(where: { $0.id == jobId }) else { return }
        let now = Date.nowISO()
        var job = jobs[idx]
        job.finishRequest = nil
        job.finishRequests = (job.finishRequests ?? []).map { e in
            guard e.id == requestId else { return e }
            var e = e; e.status = "declined"; e.resolvedBy = me.id; e.resolvedByName = me.name; e.resolvedAt = now
            return e
        }
        updateJob(job)
        await postCompletionResolution(jobId: jobId, job: job, approved: false)
    }

    /// Admin undoes an approved completion → reopen the whole job (best-effort:
    /// finished panels/ops go back to In Progress since prior statuses aren't
    /// stored) and return the request to pending so it can be re-approved.
    func undoJobCompletion(jobId: String, requestId: String) async {
        guard let me = currentPerson, me.isAdmin, let idx = jobs.firstIndex(where: { $0.id == jobId }) else { return }
        var job = jobs[idx]
        job.status = .inProgress
        job.subs = job.subs.map { p in
            var p = p
            if p.status == .finished { p.status = .inProgress }
            p.subs = p.subs.map { o in var o = o; if o.status == .finished { o.status = .inProgress }; return o }
            return p
        }
        job.finishRequests = (job.finishRequests ?? []).map { e in
            guard e.id == requestId else { return e }
            var e = e; e.status = "pending"; e.resolvedBy = nil; e.resolvedByName = nil; e.resolvedAt = nil
            return e
        }
        if let entry = job.finishRequests?.first(where: { $0.id == requestId }) {
            job.finishRequest = FinishRequestStamp(requestId: entry.id, by: entry.by, byName: entry.byName, at: entry.at)
        }
        // If the whole job is in the past (overdue), pull it forward so it lands
        // back on the current schedule — a reopened past-dated job is otherwise
        // culled behind the gantt's visible window. Detect overdue from ALL dates
        // in the tree (job.end alone can be empty/stale) and shift by aligning the
        // earliest date to the next work day from today.
        let cal = Calendar.current
        let todayStart = cal.startOfDay(for: Date())
        var allDates: [Date] = []
        for s in [job.start, job.end] { if let d = s.asDate { allDates.append(d) } }
        for p in job.subs {
            for s in [p.start, p.end] { if let d = s.asDate { allDates.append(d) } }
            for o in p.subs { for s in [o.start, o.end] { if let d = s.asDate { allDates.append(d) } } }
        }
        if let maxEnd = allDates.max(), let minStart = allDates.min(), maxEnd < todayStart {
            func isWork(_ d: Date) -> Bool { orgSettings.workDays.contains(cal.component(.weekday, from: d) - 1) }
            var target = todayStart
            var g = 0
            while !isWork(target) && g < 14 { target = cal.date(byAdding: .day, value: 1, to: target) ?? target; g += 1 }
            let delta = cal.dateComponents([.day], from: minStart, to: target).day ?? 0
            if delta > 0 {
                let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
                func shift(_ s: String) -> String { guard let dt = s.asDate else { return s }; return f.string(from: cal.date(byAdding: .day, value: delta, to: dt) ?? dt) }
                job.start = shift(job.start); job.end = shift(job.end)
                job.subs = job.subs.map { p in
                    var p = p
                    if !p.start.isEmpty { p.start = shift(p.start) }
                    if !p.end.isEmpty { p.end = shift(p.end) }
                    p.subs = p.subs.map { o in
                        var o = o
                        if !o.start.isEmpty { o.start = shift(o.start) }
                        if !o.end.isEmpty { o.end = shift(o.end) }
                        return o
                    }
                    return p
                }
            }
        }
        updateJob(job)
        guard let grp = groups.first(where: { $0.name == "Completion Requests" }) else { return }
        let jobNumTxt = job.jobNumber.map { " #\($0)" } ?? ""
        let msg = Message(
            id: UUID().uuidString, threadKey: "group:\(grp.id)", scope: "group",
            jobId: jobId, panelId: nil, opId: nil,
            text: "Completion undone by \(me.name) — \"\(job.title)\(jobNumTxt)\" reopened.",
            authorId: me.id, authorName: me.name, authorColor: me.color,
            participantIds: grp.memberIds, attachments: [], timestamp: Date.nowISO())
        _ = try? await sendMessageThrowing(msg)
    }

    private func postCompletionResolution(jobId: String, job: Job, approved: Bool) async {
        guard let me = currentPerson,
              let grp = groups.first(where: { $0.name == "Completion Requests" }) else { return }
        let jobNumTxt = job.jobNumber.map { " #\($0)" } ?? ""
        let verb = approved ? "approved" : "declined"
        let tail = approved ? " is now Finished." : "."
        let msg = Message(
            id: UUID().uuidString, threadKey: "group:\(grp.id)", scope: "group",
            jobId: jobId, panelId: nil, opId: nil,
            text: "Completion request \(verb) by \(me.name). \"\(job.title)\(jobNumTxt)\"\(tail)",
            authorId: me.id, authorName: me.name, authorColor: me.color,
            participantIds: grp.memberIds, attachments: [], timestamp: Date.nowISO())
        _ = try? await sendMessageThrowing(msg)
    }

    // MARK: - Messages

    // Returns the server-assigned message ID so callers can track ownership.
    func sendMessageThrowing(_ message: Message) async throws -> String {
        messages.append(message)   // optimistic: bubble appears instantly
        guard let api else { return message.id }
        do {
            let serverMsg = try await api.sendMessage(message)
            // Swap the optimistic local message for the canonical server message.
            if let i = messages.firstIndex(where: { $0.id == message.id }) {
                messages[i] = serverMsg
            }
            return serverMsg.id
        } catch {
            // Phase 6 rollback: drop the optimistic bubble so a failed send
            // doesn't leave a ghost message stuck in the thread.
            messages.removeAll { $0.id == message.id }
            throw error
        }
    }

    func refreshMessages() async {
        guard let api else { return }
        if let data = try? await api.fetchMessagesData() {
            applyServerMessages(data)
        }
    }

    /// Apply the authoritative /messages GET (raw bytes) to BOTH the in-memory
    /// list and the SwiftData cache. Writing the cache is the fix for messages
    /// that never load: the GET carries the viewer's full history (incl. group/
    /// job messages from before they joined), but that history was previously
    /// held only in memory — the delta-only cache never had it, so the next
    /// rehydrate-from-cache (a race in loadAll, or any later Ably "changed")
    /// silently wiped it. Folding the GET into the cache keeps it complete, so
    /// rehydrate stays correct. Empty-guarded so a transient empty GET (e.g. a
    /// momentary auth blip resolving no viewer) can't blank a populated list.
    private func applyServerMessages(_ data: Data) {
        let r = (try? JSONDecoder().decode([Message].self, from: data)) ?? []
        guard !r.isEmpty || messages.isEmpty else { return }
        withoutAnimation { messages = r }
        syncService?.mergeFullMessages(data)
    }

    // MARK: - Read receipts

    /// Pull the read-cursor map for every thread I'm in. Cheap (a small map);
    /// called while a thread is open and on the realtime "reads" signal.
    func refreshReadReceipts() async {
        guard let api else { return }
        if let map = try? await api.fetchReadReceipts() {
            withoutAnimation { readReceipts = map }
        }
    }

    /// Mark a thread read up to `at` (usually its newest message's timestamp).
    /// Optimistically advances my own cursor locally so the UI reacts instantly,
    /// then persists to the server. Monotonic on both sides.
    func markThreadReadServer(_ threadKey: String, at: String) async {
        guard let api, let myId = currentPersonId else { return }
        var map = readReceipts
        var cursors = map[threadKey] ?? [:]
        if let prev = cursors[myId], prev >= at { /* already read this far */ }
        else {
            cursors[myId] = at
            map[threadKey] = cursors
            withoutAnimation { readReceipts = map }
        }
        try? await api.postReadReceipt(threadKey: threadKey, at: at)
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

    /// Edit an existing request's dates/type/note. Editing dates on an approved
    /// request re-opens it for approval; a type/note change syncs in place.
    /// Throws so the sheet can surface the error. The schedule side (person.timeOff)
    /// is published by the server on "timeoff"/"people" channels → delta-sync
    /// reconciles it; the request list is refreshed directly below.
    @discardableResult
    func editTimeOff(id: String, type: String, start: String, end: String, note: String) async throws -> TimeOffRequest {
        guard let api else { throw APIError.noOrgCode }
        let updated = try await api.editTimeOff(id: id, start: start, end: end, type: type, note: note)
        await refreshTimeOffRequests()
        return updated
    }

    /// Approve/deny a request from the Time Off page or a chat bubble (admin
    /// only). On approve the server also writes person.timeOff, so reload
    /// everything afterward. Returns whether the decision was saved — the caller
    /// surfaces a retry affordance on failure rather than silently doing nothing.
    @discardableResult
    func decideTimeOff(id: String, action: String, reason: String = "") async -> Bool {
        guard let api else { return false }
        do {
            _ = try await api.decideTimeOff(id: id, action: action, reason: reason)
            await refreshTimeOffRequests()
            // Approve writes person.timeOff; the server publishes "people"/"timeoff"
            // Ably changes → delta-sync reconciles the schedule. loadAll removed.
            return true
        } catch {
            // Keep local state in sync with the server (in case it partially
            // changed) and report failure so the UI can show a retry.
            await refreshTimeOffRequests()
            clockError = "Couldn't \(action == "approve" ? "approve" : "deny") the request: \(error.localizedDescription)"
            return false
        }
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
    /// Returns the created (or already-existing same-named) group so the caller
    /// can navigate to `group:<id>`. Thread keys are keyed by group ID to match
    /// the web app (`group:${group.id}`) — keying by name diverged from web, so a
    /// group chat created on one platform never converged with the other.
    @discardableResult
    func createGroup(name: String, memberIds: [String]) async -> ChatGroup? {
        guard let api else { return nil }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // Reuse an existing same-named group instead of creating a duplicate —
        // and hand its id back so navigation targets the real thread.
        if let existing = groups.first(where: { $0.name == trimmed }) { return existing }
        let group = ChatGroup(id: UUID().uuidString, name: trimmed, memberIds: memberIds)
        // Optimistic local update so the inbox surfaces the new group
        // immediately. The server save runs in the background.
        var updated = groups
        updated.append(group)
        groups = updated
        do {
            try await api.saveGroups(updated)
        } catch {
            errorMessage = "Failed to create group: \(error.localizedDescription)"
        }
        return group
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
            rollbackSnapshot = nil        // batch confirmed on the server
            syncFailed = false
            saveStatus = .saved
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if case .saved = saveStatus { saveStatus = .idle }
            // jobs already reflect the edit in memory; the server publishes a
            // "tasks" Ably change → delta-sync reconciles the cache. loadAll removed.
        } catch {
            // Phase 6 optimistic rollback: revert the whole failed batch to the
            // last confirmed state so the edit visibly returns (not silently
            // kept), flag the error dot, and toast. Assigning `jobs` directly
            // (not via updateJobs) avoids re-triggering a save loop.
            if let snap = rollbackSnapshot { jobs = snap; rollbackSnapshot = nil }
            syncFailed = true
            saveStatus = .error(error.localizedDescription)
            showErrorToast("Couldn't save — check your connection")
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
        } else {
            // Phase 6 STEP 5.2 diagnostic (Phase-5 Fix C follow-up): the Auth0
            // email resolved to no person in this org, so the SERVER's
            // email→person resolution will also fail — chat/writes will 403 for
            // this account. Log-only aid for debugging email-alignment issues.
            print("[identity] currentPersonId=\(currentPersonId ?? "nil") not found in people — possible email mismatch (login=\(email))")
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
            // Server publishes the change → delta-sync reconciles. loadAll removed.
        } catch {
            clockError = error.localizedDescription
        }
    }

    func timeclockClockOut() async {
        guard let api, let personId = clockedInPersonId, let pin = clockedInPin else { return }
        do {
            try await api.timeclockClockOut(personId: personId, pin: pin)
            clearClockSession()
            // Server publishes the change → delta-sync reconciles. loadAll removed.
        } catch {
            clockError = error.localizedDescription
        }
    }

    func timeclockSendEvent(action: String) async {
        guard let api, let personId = clockedInPersonId, let pin = clockedInPin else { return }
        let event = ClockEvent(type: action, ts: ISO8601DateFormatter().string(from: Date()))
        activeClockIn?.events.append(event)
        try? await api.timeclockEvent(action: action, personId: personId, pin: pin)
        // Server publishes the change → delta-sync reconciles. loadAll removed.
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

    /// On the pay clock (clocked in for wages) — via the optimistic flag or the
    /// synced shift (which also reflects a kiosk/desktop clock-in).
    var isClockedInForPay: Bool { payClockInActive || (currentPerson?.activeClockIn != nil) }
    /// May start/work a job right now: clocked in, or salaried (salaried
    /// employees don't punch the pay clock, so they're exempt). When the
    /// clock/job dependency flag is off, always allowed.
    var canWorkOnJobs: Bool {
        guard AppConfig.enforceClockJobDependency else { return true }
        return (currentPerson?.isSalary ?? false) || isClockedInForPay
    }
    /// Currently logged into a job.
    var isOnJobClock: Bool { myActiveJobClock != nil }
    /// Pay clock-out is blocked because a job is still running (flag-gated).
    var clockOutBlockedByJob: Bool { AppConfig.enforceClockJobDependency && isOnJobClock }

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
        // You can only work on a job while clocked in (server enforces this too).
        guard canWorkOnJobs else {
            clockError = "You must clock in before working on a job."
            return
        }

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
            // rare, but we still treat it as success. A 409 doesn't change
            // server state (so no Ably event fires) — delta-sync to align to the
            // existing shift rather than a heavy loadAll.
            await deltaSyncNow()
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

    /// Synchronous clear of the PAY clock's canonical in-memory field, mirroring
    /// `markJobClockedOutLocally`. `payClockOut` clears only the observable
    /// `payClockIn*` flags; but the Home screen's shift card reads
    /// `currentPerson.activeClockIn` DIRECTLY (`myShiftStatus`/`liveShiftHours`),
    /// as do `payOnLunch`, `isClockedInForPay`, and the admin presence board. The
    /// success path used to refresh in-memory `people` via a post-mutation
    /// `loadAll()` GET, but that was retired (cache-only `persistClockChangeToCache`
    /// replaced it), so nothing cleared this field — leaving a finished shift
    /// "stuck" clocked-in with a climbing timer until a pull-to-refresh/cold
    /// launch. Clearing it here keeps every direct-field reader honest.
    func markPayClockedOutLocally() {
        guard let personId = currentPersonId else { return }
        if let idx = people.firstIndex(where: { $0.id == personId }),
           people[idx].activeClockIn != nil {
            var newPeople = people
            newPeople[idx].activeClockIn = nil
            people = newPeople
        }
        clockChangeAt = Date()
    }

    /// Optimistically set the PAY clock's canonical in-memory field on clock-in,
    /// mirroring markPayClockedOutLocally. payClockIn only flipped the payClockIn*
    /// flags; the Home shift card reads currentPerson.activeClockIn DIRECTLY
    /// (myShiftStatus/liveShiftHours), so without this the card showed "offline"
    /// for the first moments after a clock-in — until a background rehydrate
    /// filled the field — which read as a frozen/glitchy screen. The server
    /// reconciles the exact clockIn shortly after; this makes the flip instant
    /// and consistent with the flags.
    func markPayClockedInLocally(at start: Date) {
        guard let personId = currentPersonId,
              let idx = people.firstIndex(where: { $0.id == personId }) else { return }
        var newPeople = people
        newPeople[idx].activeClockIn = ActiveClockIn(
            clockIn: ISO8601DateFormatter().string(from: start),
            jobRefs: [], events: [], source: "ios-app")
        people = newPeople
        clockChangeAt = Date()
    }

    /// Restore the pay clock's in-memory field to a prior value — undoes the
    /// optimistic clock-in mark when the server call fails.
    private func restorePayClockField(_ prev: ActiveClockIn?) {
        guard let personId = currentPersonId,
              let idx = people.firstIndex(where: { $0.id == personId }) else { return }
        var newPeople = people
        newPeople[idx].activeClockIn = prev
        people = newPeople
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

    // MARK: - Pay Clock (Bearer-only, no PIN; uses currentPersonId)

    /// Sync the observable pay-clock flags from the server's canonical
    /// person.activeClockIn. Skipped inside the grace window right after an
    /// optimistic pay mutation so eventually-consistent server data can't flip
    /// the UI back before the write propagates (mirrors loadAll's clock snap).
    /// The per-field `!=` guards avoid needless @Observable churn.
    func reconcilePayClock(force: Bool = false) {
        if !force, let last = clockChangeAt, Date().timeIntervalSince(last) < 12 { return }
        if let c = currentPerson?.activeClockIn, !c.clockIn.isEmpty {
            let start = Date.fromFlexibleISO8601(c.clockIn)
            if !payClockInActive { payClockInActive = true }
            if payClockInStart != start { payClockInStart = start }
            if payClockInSource != c.source { payClockInSource = c.source }
        } else {
            if payClockInActive { payClockInActive = false }
            if payClockInStart != nil { payClockInStart = nil }
            if payClockInSource != nil { payClockInSource = nil }
        }
    }

    /// Write the just-made pay-clock change through to the local SwiftData
    /// cache. payClockIn/Out refresh in-memory `people` via loadAll()'s direct
    /// GETs, which BYPASS the delta cache — so without this the cache keeps the
    /// pre-change person and the next launch's instant cache-paint shows a stale
    /// open shift (clocked-in since the old time) that then "auto clocks out"
    /// once the background delta sync reconciles. A deltaSync here pulls the
    /// server's fresh person/payhours (S3 is read-after-write consistent, so the
    /// punch is already visible) into the cache. No rehydrate: in-memory state
    /// is already correct from loadAll(), and this only refreshes the cache so
    /// the NEXT launch paints the right state.
    private func persistClockChangeToCache() async {
        _ = await runDeltaSync()
    }

    /// Clock the current user IN for pay from iOS. Optimistic: flips the CTA
    /// immediately, then reconciles to the server. 409 = already clocked in
    /// (treat as success, reconcile to truth); 401 = revert.
    /// `pin` is passed through when the person has a PIN set; the server verifies
    /// it (and auto-accepts when they have none). A wrong PIN comes back as 401
    /// and reverts the optimistic flip with an "Invalid PIN" error.
    @discardableResult
    func payClockIn(pin: String? = nil) async -> Bool {
        guard let api, let personId = currentPersonId, !isPayClocking else { return false }
        guard canClockInOut else { return false }   // worker permission gate
        let prevActive = payClockInActive, prevStart = payClockInStart, prevSource = payClockInSource
        let prevClock = currentPerson?.activeClockIn
        isPayClocking = true
        clockActionLabel = "Clocking In…"
        defer { isPayClocking = false; clockActionLabel = nil }
        // Optimistic — flip the flags AND the canonical activeClockIn field on the
        // same frame so every reader (TimeClockView's flag-based CTA and the Home
        // card's field-based status/timer) shows clocked-in instantly instead of
        // flickering "offline" for the duration of the request.
        let now = Date()
        payClockInActive = true
        payClockInStart = now
        payClockInSource = "ios-app"
        markPayClockedInLocally(at: now)
        clockChangeAt = Date()
        do {
            try await api.payClockIn(personId: personId, pin: pin)
            // Optimistic state already set; server publishes a "people" Ably change
            // → delta-sync reconciles the exact clockIn. Just persist to cache.
            await persistClockChangeToCache()
        } catch APIError.httpError(409) {
            // Already clocked in (possibly via kiosk). Pull the real shift and
            // align — the optimistic mark is replaced by the server's truth.
            await deltaSyncNow()
            await persistClockChangeToCache()
            reconcilePayClock(force: true)
        } catch APIError.httpError(401) {
            payClockInActive = prevActive; payClockInStart = prevStart; payClockInSource = prevSource
            restorePayClockField(prevClock)
            clockChangeAt = Date()
            // When a PIN was supplied, a 401 means the PIN was wrong (not an auth
            // expiry) — surface that instead of the generic session message.
            clockError = pin != nil ? "Invalid PIN. Please try again."
                                    : APIError.httpError(401).localizedDescription
            return false
        } catch APIError.httpError(400) {
            // Server rejected the request — most likely "PIN required".
            payClockInActive = prevActive; payClockInStart = prevStart; payClockInSource = prevSource
            restorePayClockField(prevClock)
            clockChangeAt = Date()
            clockError = "PIN required."
            return false
        } catch {
            payClockInActive = prevActive; payClockInStart = prevStart; payClockInSource = prevSource
            restorePayClockField(prevClock)
            clockChangeAt = Date()
            clockError = "Failed to clock in for pay: \(error.localizedDescription)"
            return false
        }
        return true
    }

    /// Clock the current user OUT for pay from iOS. Optimistic clear; 409 =
    /// already clocked out (align to server); 401 = revert.
    func payClockOut() async {
        guard let api, let personId = currentPersonId, !isPayClocking else { return }
        guard canClockInOut else { return }   // worker permission gate
        // Must log out of the current job before clocking out (server enforces too).
        guard !clockOutBlockedByJob else {
            clockError = "Log out of your job before clocking out."
            return
        }
        let prevActive = payClockInActive, prevStart = payClockInStart, prevSource = payClockInSource
        isPayClocking = true
        clockActionLabel = "Clocking Out…"
        defer { isPayClocking = false; clockActionLabel = nil }
        payClockInActive = false
        payClockInStart = nil
        payClockInSource = nil
        clockChangeAt = Date()
        do {
            try await api.payClockOut(personId: personId)
            // Clear the canonical in-memory activeClockIn too — not just the
            // payClockIn* flags — so the Home screen's shift card (which reads
            // currentPerson.activeClockIn directly) flips to clocked-out instead
            // of sticking on a live shift. See markPayClockedOutLocally.
            markPayClockedOutLocally()
            // Optimistic clear already applied; server publishes a "people" Ably
            // change → delta-sync reconciles. Persist the optimistic state to cache.
            await persistClockChangeToCache()
            // The completed punch now exists — refresh the pay-hours history (not a
            // delta-sync entity) so the period total reflects it.
            await refreshTimeclock(personId: personId)
        } catch APIError.httpError(409) {
            // Server says already clocked out — align local truth to it.
            await deltaSyncNow()
            await persistClockChangeToCache()
            markPayClockedOutLocally()
            reconcilePayClock(force: true)
        } catch APIError.httpError(401) {
            payClockInActive = prevActive; payClockInStart = prevStart; payClockInSource = prevSource
            clockChangeAt = Date()
            clockError = APIError.httpError(401).localizedDescription
        } catch {
            payClockInActive = prevActive; payClockInStart = prevStart; payClockInSource = prevSource
            clockChangeAt = Date()
            clockError = "Failed to clock out for pay: \(error.localizedDescription)"
        }
    }

    // MARK: - Pay Lunch (Bearer) — pauses the pay clock for lunch

    /// True if the current pay shift is on lunch (its last lunch event is a
    /// start). Read straight off the canonical activeClockIn so it reflects both
    /// optimistic taps and server truth.
    var payOnLunch: Bool {
        guard let events = currentPerson?.activeClockIn?.events else { return false }
        return events.last(where: { $0.type == "lunchStart" || $0.type == "lunchEnd" })?.type == "lunchStart"
    }

    /// Optimistically append a clock event to the current person's activeClockIn
    /// so the Lunch pill flips on the first tap; grace-guarded like the others.
    private func appendLocalClockEvent(personId: String, _ event: ClockEvent) {
        guard let idx = people.firstIndex(where: { $0.id == personId }),
              var clock = people[idx].activeClockIn else { return }
        clock.events.append(event)
        var newPeople = people
        newPeople[idx].activeClockIn = clock
        people = newPeople
        clockChangeAt = Date()
    }

    /// Undo the most recent optimistic event of `type` (used to revert a failed
    /// lunch toggle before the server has recorded it).
    private func removeLastLocalClockEvent(personId: String, type: String) {
        guard let idx = people.firstIndex(where: { $0.id == personId }),
              var clock = people[idx].activeClockIn,
              let last = clock.events.lastIndex(where: { $0.type == type }) else { return }
        clock.events.remove(at: last)
        var newPeople = people
        newPeople[idx].activeClockIn = clock
        people = newPeople
        clockChangeAt = Date()
    }

    /// Toggle lunch on the pay shift. Optimistically appends the event, calls the
    /// server, then reconciles. 409 = server already in that state (align, no error).
    func payLunchToggle() async {
        guard let api, let personId = currentPersonId, !isPayClocking else { return }
        let starting = !payOnLunch
        isPayClocking = true
        defer { isPayClocking = false }
        let evt = ClockEvent(type: starting ? "lunchStart" : "lunchEnd",
                             ts: ISO8601DateFormatter().string(from: Date()))
        appendLocalClockEvent(personId: personId, evt)
        do {
            if starting { try await api.payLunchStart(personId: personId) }
            else        { try await api.payLunchEnd(personId: personId) }
            // Optimistic event already appended; server publishes "people" → delta-sync.
        } catch APIError.httpError(409) {
            await deltaSyncNow()            // server already in the target state
            reconcilePayClock(force: true)
        } catch {
            removeLastLocalClockEvent(personId: personId, type: evt.type)   // revert
            clockChangeAt = Date()
            clockError = "Failed to \(starting ? "start" : "end") lunch: \(error.localizedDescription)"
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
    /// Worker permission: may the current person clock in/out? Opt-out default.
    var canClockInOut: Bool { currentPerson?.canClockInOut ?? true }

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
        // Orgs configure pay periods via explicit days-of-month (payDates, e.g.
        // [5, 20]) in "setdate" mode — the semi-monthly model the desktop
        // payroll table actually uses (getPayPeriodFromDates). Prefer it whenever
        // payDates is present or payMode is "setdate"; otherwise fall back to the
        // legacy biweekly/weekly/semimonthly rolling logic below.
        if s.payMode == "setdate" || !s.payDates.isEmpty {
            return Self.payPeriodFromDates(s.payDates, now: now)
        }
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

    /// Semi-monthly pay period from an explicit day-of-month pair (Swift port of
    /// the desktop `getPayPeriodFromDates`). e.g. [5, 20] → periods are 5th–19th
    /// and 20th–4th of each month. Boundaries are computed in local time.
    static func payPeriodFromDates(_ payDates: [Int], now: Date) -> (start: Date, end: Date) {
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        let sorted = (payDates.isEmpty ? [5, 20] : payDates).sorted()
        let d1 = sorted[0]
        let d2 = sorted.count > 1 ? sorted[1] : sorted[0]
        let comps = cal.dateComponents([.year, .month, .day], from: today)
        let y = comps.year ?? 2020, m = comps.month ?? 1, day = comps.day ?? 1  // m is 1-based
        // Calendar.date(from:) normalizes out-of-range day/month components
        // (day 0 → last day of previous month, month 13 → next January), matching
        // JS `new Date(y, m, d)` semantics used by the desktop helper.
        func make(monthOffset: Int, day: Int) -> Date {
            var c = DateComponents(); c.year = y; c.month = m + monthOffset; c.day = day
            return cal.startOfDay(for: cal.date(from: c) ?? today)
        }
        if day >= d1 && day < d2 {
            return (make(monthOffset: 0, day: d1), make(monthOffset: 0, day: d2 - 1))
        } else if day >= d2 {
            return (make(monthOffset: 0, day: d2), make(monthOffset: 1, day: d1 - 1))
        } else {
            return (make(monthOffset: -1, day: d2), make(monthOffset: 0, day: d1 - 1))
        }
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
