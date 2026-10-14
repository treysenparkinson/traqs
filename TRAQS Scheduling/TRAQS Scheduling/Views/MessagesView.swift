import SwiftUI
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import QuickLook

// MARK: - Chat V1 (Inbox) · TRAQS Light
// Inbox / channel list. DMs + group threads.

// `ChatFilter` lives in Services/NavigationTypes — AppNav stores it.

struct MessagesView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav
    @State private var showNewGroup = false
    @State private var showNewDM = false
    /// Header-driven state lives in AppNav: these controls are drawn by
    /// HeaderControlsHost, above the TabView, and a host can't reach a page's
    /// private @State. See HeaderControls.swift.
    private var showNewMessage: Bool {
        get { appNav.showNewMessage } nonmutating set { appNav.showNewMessage = newValue }
    }
    private var filter: ChatFilter { appNav.chatFilter }
    @State private var navigationPath = NavigationPath()
    private var searchText: String {
        get { appNav.chatSearchText } nonmutating set { appNav.chatSearchText = newValue }
    }
    private var showSearch: Bool {
        get { appNav.chatSearchOpen } nonmutating set { appNav.chatSearchOpen = newValue }
    }
    /// Focus stays HERE even though the search button no longer does — a
    /// @FocusState binding isn't safe to capture in an escaping closure, so the
    /// hoisted button only flips `showSearch` and this page reacts.
    @FocusState private var searchFocused: Bool

    // Bulk-select / delete state. When `selectMode` is on, rows render
    // a checkbox indicator instead of navigating on tap, and the top
    // bar swaps its icons for [Done, Delete].
    private var selectMode: Bool {
        get { appNav.chatSelectMode } nonmutating set { appNav.chatSelectMode = newValue }
    }
    private var selectedKeys: Set<String> {
        get { appNav.chatSelectedKeys } nonmutating set { appNav.chatSelectedKeys = newValue }
    }
    private var showDeleteConfirm: Bool {
        get { appNav.showDeleteThreads } nonmutating set { appNav.showDeleteThreads = newValue }
    }

    var allThreads: [MessageThread] {
        let myId = appState.currentPersonId
        let readMap = appState.threadReadAt
        // Drop threads the current user isn't a participant in BEFORE
        // building MessageThread values. The server now also enforces
        // this on GET, so in normal operation appState.messages will
        // already be scoped — this is defense-in-depth for stale caches
        // (a session that loaded before the server fix shipped, or a
        // dev/test environment still hitting an unfiltered endpoint).
        return Dictionary(grouping: appState.messages, by: \.threadKey)
            .filter { key, msgs in
                Self.canViewThread(key,
                                   myId: myId,
                                   jobs: appState.jobs,
                                   groups: appState.groups,
                                   messages: msgs)
            }
            .map { key, msgs in
                MessageThread(
                    key: key,
                    messages: msgs.sorted { $0.timestamp < $1.timestamp },
                    resolvedTitle: resolveTitle(key: key, myId: myId),
                    lastReadAt: readMap[key],
                    myId: myId
                )
            }
            .sorted { ($0.messages.last?.timestamp ?? "") > ($1.messages.last?.timestamp ?? "") }
    }

    /// Mirrors the server's `canViewThread` so a stale or unfiltered
    /// `appState.messages` array can't expose threads the user shouldn't
    /// see. Closed by default — unrecognized threadKey prefixes are
    /// hidden, matching the server.
    ///
    /// `messages` is the thread's own delivered messages. When the entity a
    /// scoped thread references (group/job/panel/op) isn't loaded into
    /// `appState` yet, we can't verify membership against it — but the server
    /// already authorized delivery, so rather than HIDE the thread we fall back
    /// to the message's own participant roster. This is what fixes freshly
    /// created threads vanishing: a time-off request (and any completion
    /// request) spins up a brand-new group and drops its bubble in the SAME
    /// instant, so the message routinely arrives a beat before the group syncs
    /// into `appState.groups`. Without the fallback the whole thread — and its
    /// Approve/Deny actions — disappears until the next full groups sync.
    /// The fallback is safe (not a hole in the ACL): `participantIds` only ever
    /// lists genuine recipients the server addressed, so a thread we're truly
    /// not part of never carries our id here.
    static func canViewThread(_ threadKey: String,
                              myId: String?,
                              jobs: [Job],
                              groups: [ChatGroup],
                              messages: [Message] = []) -> Bool {
        guard let myId, !myId.isEmpty else { return false }
        if threadKey.hasPrefix("dm:") {
            return threadKey.dropFirst(3)
                .components(separatedBy: "_")
                .contains(myId)
        }
        if threadKey.hasPrefix("group:") {
            let ref = String(threadKey.dropFirst(6))
            guard let g = groups.first(where: { $0.name == ref || $0.id == ref })
            else { return inMessageRoster(myId, messages) }   // group not synced yet
            return g.memberIds.contains(myId)
        }
        if threadKey.hasPrefix("job:") {
            let jobId = String(threadKey.dropFirst(4))
            guard let j = jobs.first(where: { $0.id == jobId })
            else { return inMessageRoster(myId, messages) }   // job not synced yet
            return userInJob(myId, j)
        }
        if threadKey.hasPrefix("panel:") {
            let panelId = String(threadKey.dropFirst(6))
            guard let j = jobs.first(where: { j in j.subs.contains(where: { $0.id == panelId }) })
            else { return inMessageRoster(myId, messages) }
            return userInJob(myId, j)
        }
        if threadKey.hasPrefix("op:") {
            let opId = String(threadKey.dropFirst(3))
            for j in jobs {
                for p in j.subs where p.subs.contains(where: { $0.id == opId }) {
                    return userInJob(myId, j)
                }
            }
            return inMessageRoster(myId, messages)             // op's job not synced yet
        }
        return false
    }

    /// Fallback authorization for a scoped thread whose backing entity isn't
    /// loaded yet: trust the server-set participant roster on the thread's own
    /// messages. Only genuine recipients appear in `participantIds`, so this
    /// never reveals a thread the user isn't actually part of.
    private static func inMessageRoster(_ myId: String, _ messages: [Message]) -> Bool {
        messages.contains { $0.participantIds.contains(myId) }
    }

    private static func userInJob(_ myId: String, _ j: Job) -> Bool {
        if j.team.contains(myId) { return true }
        for p in j.subs {
            if p.team.contains(myId) { return true }
            for o in p.subs where o.team.contains(myId) { return true }
        }
        return false
    }

    var filteredThreads: [MessageThread] {
        let base: [MessageThread]
        switch filter {
        case .all:      base = allThreads
        case .unread:   base = allThreads.filter { $0.unreadCount > 0 }
        case .dms:      base = allThreads.filter { $0.isDM }
        case .groups:   base = allThreads.filter { !$0.isDM }
        case .mentions: base = allThreads.filter { _ in false }   // no mention metadata yet
        }
        // Apply free-text search across the resolved title + last-message preview.
        guard !searchText.isEmpty else { return base }
        let q = searchText.lowercased()
        return base.filter {
            let title = ($0.resolvedTitle ?? $0.key).lowercased()
            let last = ($0.lastMessage?.text ?? "").lowercased()
            return title.contains(q) || last.contains(q)
        }
    }

    private func resolveTitle(key: String, myId: String?) -> String? {
        if key.hasPrefix("dm:") {
            let ids = String(key.dropFirst(3)).components(separatedBy: "_")
            let otherId = ids.first(where: { $0 != myId }) ?? ids.first
            return appState.people.first(where: { $0.id == otherId })?.name
        }
        // Group threads are keyed by id (web parity); resolve id OR name — legacy
        // iOS threads were keyed by name — to the group's display name.
        if key.hasPrefix("group:") {
            let ref = String(key.dropFirst(6))
            return appState.groups.first(where: { $0.id == ref || $0.name == ref })?
                .displayName(people: appState.people, myId: appState.currentPersonId)
        }
        return nil
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack {
                PageBackground()

                VStack(spacing: 0) {
                    // Sticky header.
                    // Logo and row height only — the controls are published
                    // to HeaderControlsHost (registered at the bottom of this
                    // view) so their glass can morph across a tab switch.
                    // No header here — the shell owns the one persistent GlassHeader
                    // (§2). The spacer reserves its height so content starts below it and
                    // still SCROLLS UNDER it, which is what gives the glass something live
                    // to refract (§8 — glass over a static background renders flat).
                    Color.clear.frame(height: GlassHeader.height)

                    RvTitle(title: "Messages", meta: unreadMeta)

                    // The inbox's own filter switch — the SAME `appNav.chatFilter`
                    // the header's filter menu writes, so the two always agree.
                    // DMs / Mentions stay reachable from that menu; while one of
                    // them is on, no tab is underlined.
                    RvTabs(options: [(value: ChatFilter.all, label: ChatFilter.all.label),
                                     (value: ChatFilter.unread, label: ChatFilter.unread.label),
                                     (value: ChatFilter.groups, label: ChatFilter.groups.label)],
                           selection: Bindable(appNav).chatFilter)
                        .padding(.horizontal, Rv.side)

                    if showSearch {
                        SearchBar(text: Bindable(appNav).chatSearchText,
                                  placeholder: "Search conversations…",
                                  focused: $searchFocused,
                                  onCancel: {
                                      withAnimation(.easeInOut(duration: 0.18)) {
                                          showSearch = false
                                          searchText = ""
                                      }
                                  })
                            .padding(.horizontal, Rv.side)
                            .padding(.top, 10)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    ScrollView {
                        // Evaluate the thread pipeline ONCE per render (it groups,
                        // authorizes, and sorts all messages — previously run twice:
                        // once for the emptiness check and again for the ForEach).
                        let threads = filteredThreads
                        VStack(spacing: 0) {
                            if threads.isEmpty {
                                ChatEmptyState(filter: filter)
                                    .padding(.top, 80)
                            } else {
                                // Cardless rows straight on the canvas, a hairline
                                // between each (none under the last). Order is the
                                // existing newest-first sort.
                                //
                                // Lazy: only on-screen rows build (each row pays
                                // an avatar decode).
                                LazyVStack(spacing: 0) {
                                    ForEach(threads) { t in
                                        threadRow(t, divider: t.id != threads.last?.id)
                                    }
                                }
                                .padding(.horizontal, Rv.side)
                                .padding(.top, 4)
                                .padding(.bottom, listBottomClearance)
                            }
                        }
                        .animation(.easeInOut(duration: 0.18), value: filter)
                    }
                    .scrollIndicators(.visible)
                    .topFadeMask()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    // The list runs under the floating tab pill and the home
                    // indicator; `listBottomClearance` keeps the last row reachable.
                    .ignoresSafeArea(.container, edges: .bottom)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { key in
                ThreadDetailView(threadKey: key, onOpenThread: { navigationPath.append($0) })
                    // Re-enable the native left-edge swipe-back (the thread hides
                    // the nav bar, which would otherwise disable it).
                    .background(SwipeBackEnabler())
            }
            .sheet(isPresented: $showNewGroup) {
                NewGroupSheet { name, memberIds in
                    // Persist the group server-side so other devices see it, then
                    // navigate to it by ID (matches the web app's group:<id> key —
                    // keying by name diverged and split cross-platform group chats).
                    Task {
                        guard let g = await appState.createGroup(name: name, memberIds: memberIds) else { return }
                        await MainActor.run { navigationPath.append("group:\(g.id)") }
                    }
                }
            }
            .sheet(isPresented: $showNewDM) {
                NewDMSheet { personId in
                    guard let myId = appState.currentPersonId else { return }
                    let ids = [myId, personId].sorted()
                    navigationPath.append("dm:\(ids.joined(separator: "_"))")
                }
            }
            // Unified compose: exactly ONE recipient opens a DM, TWO OR MORE
            // create a group (auto-named unless the user typed a name).
            // A COVER, not a sheet: the popup draws its own scrim and glass card,
            // so it needs the whole screen with a clear background rather than a
            // system sheet's card and dimming. `modalBlur` blurs the inbox behind
            // it — the popup can't do that itself, being its own presentation.
            .fullScreenCover(isPresented: Bindable(appNav).showNewMessage) {
                NewMessageSheet { recipientIds, groupName in
                    guard let myId = appState.currentPersonId, !recipientIds.isEmpty else { return }
                    if recipientIds.count == 1 {
                        let ids = [myId, recipientIds[0]].sorted()
                        navigationPath.append("dm:\(ids.joined(separator: "_"))")
                    } else {
                        var members = recipientIds
                        if !members.contains(myId) { members.insert(myId, at: 0) }
                        // "" and not "Group": storing that literal made a group
                        // genuinely NAMED "Group", which then deduped onto every
                        // other unnamed group. Empty means "derive from members".
                        let name = groupName ?? ""
                        Task {
                            guard let g = await appState.createGroup(name: name, memberIds: members) else { return }
                            await MainActor.run { navigationPath.append("group:\(g.id)") }
                        }
                    }
                }
                // No drag indicator: that was a SHEET affordance, and this is a
                // clear cover holding a floating card — there is no sheet edge to
                // grab. Tapping the scrim or the X closes it.
                //
                // Clearing the blur here rather than at each exit covers all three:
                // the X, a scrim tap, and a successful Create (which dismisses
                // itself once the thread is queued).
                .onDisappear { appNav.modalBlur = false }
            }
            .alert("Delete \(selectedKeys.count) conversation\(selectedKeys.count == 1 ? "" : "s")?",
                   isPresented: Bindable(appNav).showDeleteThreads) {
                Button("Cancel", role: .cancel) { }
                Button("Delete", role: .destructive) {
                    let keys = selectedKeys
                    exitSelectMode()
                    Task {
                        for key in keys {
                            await appState.deleteThread(threadKey: key)
                        }
                    }
                }
            } message: {
                Text("This can't be undone. The selected thread\(selectedKeys.count == 1 ? "" : "s") and all of \(selectedKeys.count == 1 ? "its" : "their") messages will be gone forever.")
            }
        }
        .task { await appState.refreshMessages() }
        .refreshable { await appState.refreshMessages() }
        // Open the thread a tapped chat / finish-request push points at.
        // ThreadDetailView loads its own messages, so we can navigate
        // immediately without waiting on a refresh. `initial: true` handles a
        // tap that's already pending when the Chat tab first appears.
        .onChange(of: appNav.pendingDeepLink, initial: true) { _, _ in consumeThreadDeepLink() }
        // Overlay header's back button asked us to pop — do it here, in context,
        // by mutating our own navigationPath (reliable across the window boundary).
        .onChange(of: appState.messagesPopRequested) { _, requested in
            guard requested else { return }
            appState.messagesPopRequested = false
            if !navigationPath.isEmpty { navigationPath.removeLast() }
        }
        // Clear the overlay header the moment the thread is popped (path empties),
        // which is when the pop actually begins — so the header fades out in sync
        // with the page and can't be left behind if a pop is dropped/interrupted.
        // Also hide the bottom tab bar while inside a thread (path non-empty).
        .onChange(of: navigationPath.count, initial: true) { _, count in
            if count == 0 { appState.activeMessageThread = nil }
            appNav.hideTabBar = count > 0
            // A thread pushed or popped means no members page is open (that page
            // isn't on this path). Without this the flag could be left set — it
            // hides the app header (logo + buttons), and did, on the inbox too.
            appState.threadMembersOpen = false
        }
        // Leaving the Messages tab entirely → always restore the bar.
        .onDisappear {
            appNav.hideTabBar = false
            appState.threadMembersOpen = false
        }
        .onChange(of: showSearch) { _, open in if open { searchFocused = true } }
    }

    /// Navigate to the thread named by a pending `.thread` deep link.
    private func consumeThreadDeepLink() {
        guard case let .thread(key)? = appNav.pendingDeepLink else { return }
        navigationPath = NavigationPath()
        navigationPath.append(key)
        appNav.pendingDeepLink = nil
    }

    /// The title's meta: the existing unread total; nothing at zero.
    private var unreadMeta: String? {
        let n = appState.totalUnreadMessages
        return n > 0 ? "\(n) unread" : nil
    }

    /// Room after the last thread. The list now runs under the floating tab
    /// pill and the home indicator rather than stopping above them, so this is
    /// what keeps the final row reachable — it replaces the `safeAreaInset` this
    /// page used to reserve.
    ///
    /// `tabPillBottomInset` already covers the pill and its offset from the
    /// bottom edge; with the bar hidden only the home indicator is left to clear.
    private var listBottomClearance: CGFloat {
        // The list draws under the bar (ignoresSafeArea), so it clears the
        // native tab bar's height by hand: 49pt bar + 34pt home indicator.
        (appNav.hideTabBar ? 40 : 83) + 24
    }

    /// Renders a single inbox row, switching between navigation mode and
    /// select-mode tap-to-toggle. Extracted so the ForEach above stays
    /// readable and the row's two modes share the same ChannelRow.
    @ViewBuilder
    private func threadRow(_ t: MessageThread, divider: Bool) -> some View {
        let isSelected = selectedKeys.contains(t.key)
        if selectMode {
            Button {
                if isSelected { selectedKeys.remove(t.key) }
                else { selectedKeys.insert(t.key) }
            } label: {
                ChannelRow(thread: t, people: appState.people,
                           groups: appState.groups,
                           selectMode: true, isSelected: isSelected,
                           divider: divider)
            }
            .buttonStyle(.plain)
        } else {
            NavigationLink(value: t.key) {
                ChannelRow(thread: t, people: appState.people,
                           groups: appState.groups,
                           selectMode: false, isSelected: false,
                           divider: divider)
            }
            .buttonStyle(.plain)
            .simultaneousGesture(TapGesture().onEnded {
                appState.markThreadRead(t.key)
            })
            // Press-and-hold to enter multi-select with this row selected.
            // Flipping selectMode swaps this NavigationLink for the select-mode
            // Button below, which cancels the in-flight tap so the hold doesn't
            // also navigate into the thread.
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.4).onEnded { _ in
                    enterSelectMode(selecting: t.key)
                }
            )
        }
    }

    /// Long-press a row (when not already selecting) to enter select mode with
    /// that row pre-selected. A haptic confirms the mode switch.
    private func enterSelectMode(selecting key: String) {
        guard !selectMode else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation(.easeInOut(duration: 0.2)) {
            selectMode = true
            selectedKeys.insert(key)
        }
    }

    private func exitSelectMode() {
        withAnimation(.easeInOut(duration: 0.2)) {
            selectMode = false
            selectedKeys = []
        }
    }
}

/// A bare header glyph. No glass of its own — HeaderControlsHost paints it, so
/// that every control's shape sits at the same level and can morph. See the note
/// on that host.
struct HeaderGlyph: View {
    let icon: TIcon
    var size: CGFloat = 18
    var body: some View {
        TIconView(icon: icon, size: size, color: Color(hex: T.ink))
    }
}

// MARK: - Channel row (DM avatar OR group # tile)

private struct ChannelRow: View {
    let thread: MessageThread
    let people: [Person]
    /// Needed to show a group's FULL membership rather than only the people who
    /// have spoken in it — see `ThreadRoster`.
    let groups: [ChatGroup]
    var selectMode: Bool = false
    var isSelected: Bool = false
    /// Hairline under the row — off for the last thread.
    var divider: Bool = true
    @Environment(ThemeSettings.self) private var theme

    /// The row's identity mark. One constant because a DM avatar, a group's
    /// stack and the unknown-thread fallback all have to line up in the same
    /// column — they drifted apart when this was written out four times.
    @ScaledMetric(relativeTo: .body) private var avatarSize: CGFloat = 44   // grows on large phones with the type
    /// Each face in a group's cluster. Smaller than a DM's single avatar because
    /// three of them overlap into a mark of roughly the same weight.
    @ScaledMetric(relativeTo: .body) private var stackAvatarSize: CGFloat = 26

    private var subtitle: String {
        thread.lastMessage.map { $0.text } ?? ""
    }
    private var initials: String { Initials.from(thread.displayTitle) }

    /// The DM partner — the member who isn't me, resolved from the
    /// `dm:<id>_<id>` key so we can show their real photo/color even before
    /// they've sent a message.
    private var dmPartner: Person? {
        guard thread.isDM else { return nil }
        let ids = thread.key.dropFirst(3).split(separator: "_").map(String.init)
        let otherId = ids.first(where: { $0 != thread.myId }) ?? ids.first
        return people.first(where: { $0.id == otherId })
    }

    private func personInitials(_ name: String) -> String { Initials.from(name) }

    /// Everyone in this thread — the SAME resolution the thread header uses.
    ///
    /// This used to walk `thread.messages` and collect `authorId`s, which meant
    /// a group's stack showed one avatar per person who had SPOKEN, not per
    /// member. A crew of four where only one person had posted rendered a single
    /// circle; opening the thread then showed all four, because the header
    /// resolved the group properly. `ThreadRoster` is now the one answer.
    private var participants: [Person] {
        ThreadRoster.participants(threadKey: thread.key,
                                  messages: thread.messages,
                                  people: people,
                                  groups: groups)
    }

    /// Date the last message was sent, shown top-right of the row.
    /// Today → "Today at 9:30PM" · any earlier day → "June 30".
    private var timeLabel: String {
        thread.lastMessage?.timestamp.threadDateStamp ?? ""
    }

    private var isUnread: Bool { thread.unreadCount > 0 }

    var body: some View {
        let _ = theme.accent; let _ = theme.bgPresetId
        // The line runs under the name and preview only — not under the avatar.
        // Avatar + the row's 14pt spacing; in select mode the 22pt checkmark
        // and its spacing sit in front of it too.
        RvRow(divider: divider, dividerInset: avatarSize + 14 + (selectMode ? 22 + 14 : 0)) {
            if selectMode {
                // The checkmark fades + slides in from the leading edge
                // when the user enters select mode, and the rest of the
                // row shifts right to make room — same pattern Mail uses
                // for its multi-select behavior.
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(isSelected ? Color(hex: T.sky) : Color(hex: T.muted))
                    .transition(.move(edge: .leading).combined(with: .opacity))
                    .animation(.easeInOut(duration: 0.18), value: isSelected)
            }

            if thread.isDM {
                // A DM shows the OTHER person's real avatar — their photo if set,
                // otherwise their preferred color — so it's clearly a 1:1 chat.
                if let p = dmPartner {
                    Avatar(initials: personInitials(p.name), size: avatarSize,
                           fill: .personFill(p.color), imageData: p.image)
                } else {
                    Avatar(initials: initials, size: avatarSize, gradient: true)
                }
            } else if !participants.isEmpty {
                ParticipantStack(people: participants,
                                 avatarSize: stackAvatarSize,
                                 maxShown: 3)
                    // minWidth, NOT width: a "+N" cluster is wider than one
                    // avatar and a fixed frame doesn't clip. The minimum keeps
                    // group rows aligned with the DM avatar's column.
                    .frame(minWidth: avatarSize, minHeight: avatarSize, alignment: .leading)
            } else {
                // Fallback for a thread with no decodable participants — keeps
                // the row from rendering blank.
                Avatar(initials: "#", size: avatarSize, gradient: true)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(thread.displayTitle)
                        .font(.traqs(.semibold, size: 15))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if !timeLabel.isEmpty {
                        Text(timeLabel)
                            .font(.traqs(.medium, size: 12))
                            .foregroundStyle(Color(hex: T.muted))
                            .lineLimit(1)
                    }
                }
                Text(subtitle)
                    .font(.traqs(isUnread ? .medium : .regular,
                                  size: 12.5))
                    .foregroundStyle(Color(hex: isUnread ? T.ink : T.muted))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if isUnread {
                RvDot(color: Color(hex: T.accent))
                    .accessibilityLabel("\(thread.unreadCount) unread")
            }
        }
    }
}

private struct ChatEmptyState: View {
    let filter: ChatFilter
    var body: some View {
        VStack(spacing: 12) {
            TIconView(icon: .chat, size: 44, color: Color(hex: T.hair))
            Text(filter == .mentions ? "No mentions"
                 : filter == .unread ? "Inbox zero"
                 : "No conversations yet")
                .font(TTypo.h3(18))
                .foregroundStyle(Color(hex: T.ink))
            Text("Start one with the + button.")
                .font(TTypo.sm(13))
                .foregroundStyle(Color(hex: T.muted))
        }
        .frame(maxWidth: .infinity)
        .padding(32)
    }
}

// MARK: - MessageThread

struct MessageThread: Identifiable {
    let key: String
    let messages: [Message]
    var resolvedTitle: String? = nil
    /// ISO timestamp of the last time the current user opened this thread.
    /// Compared against each message's timestamp to compute `unreadCount`.
    var lastReadAt: String? = nil
    /// The current user's person ID — own messages are never counted as unread.
    var myId: String? = nil
    var id: String { key }

    var displayTitle: String {
        if let t = resolvedTitle { return t }
        if key.hasPrefix("job:")   { return "Job: \(key.dropFirst(4))" }
        if key.hasPrefix("panel:") { return "Panel: \(key.dropFirst(6))" }
        if key.hasPrefix("op:")    { return "Op: \(key.dropFirst(3))" }
        // Group threads are keyed by id, so dropping the prefix yields a UUID, not
        // a name. Callers set `resolvedTitle` from ChatGroup.displayName; this is
        // only the last resort when the group isn't loaded yet.
        if key.hasPrefix("group:") { return "Group" }
        if key.hasPrefix("dm:")    { return "Direct Message" }
        return key
    }

    var isDM: Bool { key.hasPrefix("dm:") }
    var lastMessage: Message? { messages.last }
    var unreadCount: Int {
        guard let cutoff = lastReadAt else {
            return messages.filter { $0.authorId != myId }.count
        }
        return messages.filter { m in
            guard m.timestamp > cutoff else { return false }
            if let me = myId, m.authorId == me { return false }
            return true
        }.count
    }
}

// MARK: - ThreadDetailView

struct ThreadDetailView: View {
    @Environment(AppState.self) private var appState
    /// Only for `modalBlur` — a popup presented as its own cover can't blur the
    /// page behind it, so MainTabView does it on the popup's behalf.
    @Environment(AppNav.self) private var appNav
    @Environment(\.dismiss) private var dismiss
    let threadKey: String
    /// Open another thread (used when adding people to a DM spins up a group).
    /// Supplied by MessagesView, which owns the navigation path.
    var onOpenThread: (String) -> Void = { _ in }
    @State private var newText = ""
    @State private var isSending = false
    @State private var sendError: String? = nil
    @State private var sendShakeToken = 0      // bumped on send failure → shakes the composer
    @State private var myMessageIds: Set<String> = []
    /// Server id → the id its bubble was first shown under. A message I send
    /// appears instantly under a local id, then the server's copy replaces it with
    /// a new id. Keyed by the raw id, SwiftUI tore the bubble (and, if the message
    /// opened a new time cluster, its header) down and built new ones — the
    /// flicker on send — and the id change fired a second scroll. Rows are keyed
    /// by `viewId` instead, which never changes for a given message.
    @State private var viewIds: [String: String] = [:]
    @State private var showAddPeople = false            // add/edit-members popup?
    /// The members page, pushed when the header's name pill is tapped.
    @State private var showMembers = false
    /// 0 = the pill, 1 = the full page. Animated by open/closeMembers.
    @State private var membersProgress: CGFloat = 0
    /// The header pill's frame (global), reported by this thread's header copy.
    @State private var pillFrame: CGRect = .zero
    /// Gates open/close so a tap mid-transition can't interleave them — the
    /// cause of the page vanishing (see MembersTransition).
    @State private var membersTransition = MembersTransition()
    /// How far the composer rises for the keyboard. The page ignores the
    /// keyboard's safe area — so the header (and everything else) never moves —
    /// and this lifts just the composer, on the keyboard's own curve. The
    /// composer is a `safeAreaBar`, so the transcript's bottom inset rises with it.
    /// How many of the newest messages the transcript builds. They're built
    /// EAGERLY (a VStack, not a LazyVStack), so the whole visible conversation is
    /// measured in the first layout pass and the thread opens exactly at the
    /// bottom — lazily, rows measured over several frames as it slid in, which
    /// was the slide-and-snap (2026-10-14). Older ones load in pages on request.
    @State private var shownCount = MessagePage.size

    // Composer focus — used to re-pin the scroll to the bottom when the
    // keyboard opens (#1 auto-follow).
    @FocusState private var composerFocused: Bool

    /// The thread header's height (ThreadTopBar, in the page's top inset), not
    /// counting the status bar, which is already in the safe area.
    private let overlayBarHeight: CGFloat = 108

    /// Publishes the current thread to the overlay header window. Called on
    /// appear and whenever the derived header data (title / participants) changes,
    /// since those load in asynchronously after the view first appears.
    private func publishThreadContext() {
        appState.activeMessageThread = headerContext
    }

    /// The header's data. Published to the overlay window, and also drawn here
    /// directly while the members page is open (see `threadMembersOpen`).
    private var headerContext: ThreadContext {
        ThreadContext(
            id: threadKey,
            title: displayTitle,
            isDM: threadKey.hasPrefix("dm:"),
            participants: threadParticipants,
            // Ask MessagesView to pop (it mutates its own navigationPath in
            // context — reliable, unlike a dismiss() captured across windows).
            // The header is then cleared when the path empties (.onChange below),
            // tying the header's exit to the actual pop.
            onBack: { appState.messagesPopRequested = true },
            onTapIdentity: { openMembers() }
        )
    }

    private func membersPage(topInset: CGFloat) -> some View {
        ThreadMembersPage(
            topInset: topInset,
            onClose: { closeMembers() },
            title: displayTitle,
            participants: threadParticipants,
            canRename: editableGroup.map { appState.canAdministerGroup($0) } ?? false,
            onRename: { name in
                guard let group = editableGroup else { return }
                let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                Task { await appState.updateGroup(id: group.id, name: trimmed, memberIds: group.memberIds) }
            },
            canAdd: canAddPeople,
            onAddWillOpen: { appNav.modalBlur = true },
            addCover: { addPeopleCover },
            canLeave: editableGroup.map { g in
                appState.currentPersonId.map { g.memberIds.contains($0) } ?? false
            } ?? false,
            onLeave: {
                guard let group = editableGroup, let me = appState.currentPersonId else { return }
                Task { await appState.removeGroupMember(groupId: group.id, personId: me) }
                // Out of the group: pop the thread (and this page with it) back
                // to the inbox.
                appState.messagesPopRequested = true
            }
        )
    }

    /// The window's top safe-area inset (status bar / Dynamic Island), read the
    /// same way the overlay header reads it, so the header copy lands exactly on
    /// the overlay's header and the page clears the status bar. NOT the overlay's
    /// GeometryReader: it ignores the safe area, so it reports 0 — which put the
    /// copy and the page's back button up under the Dynamic Island on a phone.
    private var windowTopInset: CGFloat {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let key = scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
        return key?.safeAreaInsets.top ?? 0
    }

    /// Grow the pill into the members page. Each step waits a pass for the one
    /// before it to be on screen: the header copy (so the overlay header can go
    /// transparent behind an identical stand-in), then the hero mounted AT the
    /// pill, then the growth.
    private func openMembers() {
        guard membersTransition.requestOpen() else { return }
        composerFocused = false
        appState.threadMembersOpen = true
        membersProgress = 0
        showMembers = true
        // One pass for the hero to mount AT the pill, then it grows.
        DispatchQueue.main.async {
            withAnimation(.spring(duration: 0.45, bounce: 0.1)) {
                membersProgress = 1
            } completion: {
                membersTransition.didOpen()
            }
        }
    }

    /// Shrink the page back into the pill, then hand the header back. No bounce on
    /// the way in: an overshoot would undershoot the pill and snap back out.
    private func closeMembers() {
        guard membersTransition.requestClose() else { return }
        withAnimation(.spring(duration: 0.4, bounce: 0)) {
            membersProgress = 0
        } completion: {
            showMembers = false
            appState.threadMembersOpen = false
            membersTransition.didClose()                        // only now may it reopen
        }
    }

    // #1 auto-follow + #4 entrance animations. `baselineIds` is the set of
    // messages already present when the thread first appeared — those never
    // animate. `animatedIds` records every bubble that has already played its
    // entrance so scrolling it back into view (LazyVStack recycling) or the
    // optimistic→server id swap doesn't replay the animation.
    @State private var baselineIds: Set<String> = []
    @State private var animatedIds: Set<String> = []
    @State private var didCaptureBaseline = false
    // True while the bottom anchor is on-screen (user is at/near the newest
    // message). Drives auto-follow: a message from someone else that arrives via
    // the poll only scrolls when we're already at the bottom, so it can't yank
    // the user down while they're reading older history.
    @State private var isAtBottom = true
    /// True once the opening scroll-to-bottom has settled. While false (the
    /// moment a thread opens), we ALWAYS pin to the newest message regardless of
    /// `isAtBottom` or who sent it, so the thread never opens mid-history.
    @State private var didInitialScroll = false
    /// The opening pin-to-newest runs once per visit to the thread. `.onAppear`
    /// also fires when the members page is popped back off it, and re-running the
    /// pin there yanked the transcript to the bottom five times as the page
    /// collapsed — the snap at the end of that animation.
    @State private var didOpen = false
    private static let bottomAnchor = "chat_bottom_anchor"

    // #3 read receipts. `pendingIds` = my messages still in flight (show
    // "Sending…"); `lastMarkedReadAt` dedupes the read POST so we only report
    // when the newest message actually changes.
    @State private var pendingIds: Set<String> = []
    @State private var lastMarkedReadAt = ""

    // Composer attachment (one at a time). An image routes through the
    // downscaler; a non-image file is sent as-is. Mirrors the end-job panel
    // photo picker (PanelPhotoSheet) so camera/library/files behave the same.
    @State private var pickedImage: UIImage?
    @State private var pickedFile: PickedAttachment?
    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showLibrary = false
    @State private var showFiles = false
    /// The + button's source sheet, and the source picked in it. The picker is
    /// opened from the sheet's onDismiss — presenting it while the sheet is still
    /// leaving would race the two presentations.
    @State private var showAttachSheet = false
    /// A full-screen attachment picker is up (camera / photos / files).
    private var attachPickerOpen: Bool { showCamera || showLibrary || showFiles }
    @State private var pendingSource: AttachSource?

    private var hasAttachment: Bool { pickedImage != nil || pickedFile != nil }

    // Always live — recomputes whenever appState.messages changes
    var liveMessages: [Message] {
        appState.messages
            .filter { $0.threadKey == threadKey }
            .sorted { $0.timestamp < $1.timestamp }
    }

    /// Messages grouped into time clusters. A new section begins on a new
    /// calendar day or after a gap of more than an hour; each section's header
    /// shows when that cluster started (e.g. "Today at 9:30PM", "June 30 at
    /// 2:15PM"). `liveMessages` is already sorted ascending, so a single pass
    /// appends to the current section or opens a new one.
    /// The identity a message's row keeps for its whole life on screen.
    private func viewId(_ m: Message) -> String { viewIds[m.id] ?? m.id }

    private var messageSections: [MessageSection] {
        let sectionGap: TimeInterval = 60 * 60   // 1 hour
        var sections: [MessageSection] = []
        for m in liveMessages.suffix(shownCount) {
            if let last = sections.last, let lastMsg = last.messages.last,
               let lastDate = Date.fromFlexibleISO8601(lastMsg.timestamp),
               let thisDate = Date.fromFlexibleISO8601(m.timestamp),
               Calendar.current.isDate(thisDate, inSameDayAs: lastDate),
               thisDate.timeIntervalSince(lastDate) < sectionGap {
                sections[sections.count - 1].messages.append(m)
            } else {
                sections.append(MessageSection(id: viewId(m),
                                               header: m.timestamp.sectionStamp,
                                               messages: [m]))
            }
        }
        return sections
    }

    var displayTitle: String {
        let myId = appState.currentPersonId
        if threadKey.hasPrefix("dm:") {
            let ids = String(threadKey.dropFirst(3)).components(separatedBy: "_")
            let otherId = ids.first(where: { $0 != myId }) ?? ids.first
            return appState.people.first(where: { $0.id == otherId })?.name ?? "Direct Message"
        }
        if threadKey.hasPrefix("group:") {
            let ref = String(threadKey.dropFirst(6))
            // NOT `?? ref` — threads are keyed by group id, so an unresolved group
            // used to render its UUID as the title.
            return appState.groups.first(where: { $0.id == ref || $0.name == ref })?
                .displayName(people: appState.people, myId: appState.currentPersonId) ?? "Group"
        }
        if threadKey.hasPrefix("job:")   { return "Job: \(threadKey.dropFirst(4))" }
        if threadKey.hasPrefix("panel:") { return "Panel: \(threadKey.dropFirst(6))" }
        if threadKey.hasPrefix("op:")    { return "Op: \(threadKey.dropFirst(3))" }
        return threadKey
    }

    /// One-line subtitle under the (now larger) header title. DMs show the
    /// other person's role (or "Direct message"); group/scoped threads show a
    /// member/participant count so you know who's in the room.
    var headerSubtitle: String {
        if threadKey.hasPrefix("dm:") {
            let myId = appState.currentPersonId
            let ids = String(threadKey.dropFirst(3)).components(separatedBy: "_")
            let otherId = ids.first(where: { $0 != myId }) ?? ids.first
            let role = appState.people.first(where: { $0.id == otherId })?.role ?? ""
            return role.isEmpty ? "Direct message" : role
        }
        if threadKey.hasPrefix("group:") {
            let n = threadParticipants.count
            return n > 0 ? "\(n) member\(n == 1 ? "" : "s")" : "Group"
        }
        if threadKey.hasPrefix("job:")   { return "Job chat" }
        if threadKey.hasPrefix("panel:") { return "Panel chat" }
        if threadKey.hasPrefix("op:")    { return "Operation chat" }
        let n = threadParticipants.count
        return n > 0 ? "\(n) participant\(n == 1 ? "" : "s")" : ""
    }

    // MARK: - Scroll follow (#1) + entrance animation (#4) helpers

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        if animated {
            withAnimation(.easeOut(duration: 0.25)) {
                proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
    }

    /// Snapshot which messages were already on screen when the thread opened,
    /// so the initial backlog doesn't animate — only messages that arrive (or
    /// that I send) while I'm here.
    private func captureBaselineIfNeeded() {
        guard !didCaptureBaseline else { return }
        // Wait for messages to actually be present before snapshotting the
        // baseline. Deep-linking (or a push tap) into an uncached thread hits
        // .onAppear with liveMessages empty — capturing an empty baseline then
        // meant the whole backlog, when it loaded via the poll, counted as "new"
        // and every bubble animated in at once. Capturing on the first non-empty
        // snapshot instead treats that backlog as the baseline (no animation).
        guard !liveMessages.isEmpty else { return }
        baselineIds = Set(liveMessages.map { $0.id })
        didCaptureBaseline = true
    }

    /// A bubble animates its entrance only if it wasn't in the opening backlog
    /// and hasn't already animated (guards against LazyVStack recycling and the
    /// optimistic→server id swap replaying the effect).
    private func shouldAnimate(_ msg: Message) -> Bool {
        // Until the opening backlog is captured (first .onAppear), animate
        // NOTHING — otherwise baselineIds is still empty on the first render and
        // the entire thread slides/pops in, fighting the scroll-to-bottom.
        didCaptureBaseline && !baselineIds.contains(msg.id) && !animatedIds.contains(msg.id)
    }

    private func markAnimated(_ id: String) {
        animatedIds.insert(id)
    }

    // MARK: - Read receipts (#3)

    /// The id of the last message I sent — only this one carries the Sent/Read
    /// detail label (iMessage-style), which keeps the thread uncluttered.
    private var lastMineId: String? {
        liveMessages.last(where: { isMyMessage($0) })?.id
    }

    /// Delivery status shown under one of my bubbles; nil for others' messages
    /// and for my earlier (non-latest) delivered messages.
    private func deliveryStatus(for m: Message) -> MessageDeliveryStatus? {
        guard isMyMessage(m) else { return nil }
        if pendingIds.contains(m.id) { return .sending }
        guard m.id == lastMineId else { return nil }
        let myId = appState.currentPersonId ?? ""
        let others = Set(threadParticipants.map { $0.id }).subtracting([myId])
        guard !others.isEmpty, let msgDate = Date.fromFlexibleISO8601(m.timestamp) else {
            return .sent
        }
        let cursors = appState.readReceipts[threadKey] ?? [:]
        var readerCursors: [Date] = []
        for pid in others {
            if let c = cursors[pid], let cd = Date.fromFlexibleISO8601(c), cd >= msgDate {
                readerCursors.append(cd)
            }
        }
        if readerCursors.isEmpty { return .sent }
        if threadKey.hasPrefix("dm:") {
            let when = readerCursors.max().map { readLabelTime($0) } ?? ""
            return .read(when.isEmpty ? "Read" : "Read \(when)")
        }
        return .read("Read by \(readerCursors.count)")
    }

    private func readLabelTime(_ d: Date) -> String {
        let cal = Calendar.current
        let f = DateFormatter()
        if cal.isDateInToday(d) { f.dateFormat = "h:mm a" }
        else if cal.isDateInYesterday(d) { return "yesterday" }
        else { f.dateFormat = "MMM d" }
        return f.string(from: d)
    }

    /// Advance BOTH read cursors — the local one behind the inbox badge and the
    /// server one behind the sender's "Read" — to the same timestamp.
    ///
    /// Marking locally here rather than separately is the point: the two were
    /// stamped from different clocks (device now vs. the newest message), so a
    /// thread could keep counting unread while open. markThreadRead now returns
    /// what it stamped, and that exact value goes to the server.
    ///
    /// The POST is deduped on that timestamp so an idle poll doesn't re-send.
    private func markThreadReadNow() async {
        let at = appState.markThreadRead(threadKey)
        guard at != lastMarkedReadAt else { return }
        lastMarkedReadAt = at
        await appState.markThreadReadServer(threadKey, at: at)
    }

    /// Participants for the header avatar stack.
    /// - DM: the two ids encoded in the threadKey.
    /// - Group: members of the matching ChatGroup.
    /// - Job/panel/op: union of authors and participantIds from messages so
    ///   far (best-effort — the desktop doesn't carry membership on those
    ///   scopes either; this matches who's actually been involved).
    /// The header's roster. Shares `ThreadRoster` with the inbox row so the
    /// stack you tap is the stack you land on — they disagreed before, which is
    /// how the row's missing avatars went unnoticed here.
    ///
    /// One behaviour change in the move: the fallback tier used to build a `Set`
    /// of ids, so its order was whatever hashing produced and the header's
    /// avatars could reshuffle between renders. `ThreadRoster` keeps first
    /// appearance.
    private var threadParticipants: [Person] {
        ThreadRoster.participants(threadKey: threadKey,
                                  messages: liveMessages,
                                  people: appState.people,
                                  groups: appState.groups)
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Flat page background, full-screen behind the status bar / home indicator.
            PageBackground()

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 12) {
                        if liveMessages.count > shownCount {
                            Button {
                                shownCount += MessagePage.size
                            } label: {
                                Text("Show earlier messages")
                                    .font(TTypo.smBold(13))
                                    .foregroundStyle(Color(hex: T.accent))
                                    .padding(.vertical, 6)
                            }
                            .buttonStyle(.plain)
                            .padding(.top, 4)
                        }
                        if liveMessages.isEmpty {
                            Text("No messages yet. Say hello!")
                                .font(.subheadline)
                                .foregroundColor(Color(hex: T.muted))
                                .padding(.top, 40)
                        }
                        ForEach(messageSections) { section in
                            SectionTimeHeader(text: section.header)
                            // Keyed by viewId — the ForEach's own identity is what
                            // decides whether a row survives the id swap.
                            ForEach(section.messages.map { (viewId($0), $0) }, id: \.0) { row in
                                let msg = row.1
                                Group {
                                    if msg.type == "finish_request" {
                                        CompletionRequestBubble(message: msg)
                                    } else if msg.type == "timeoff_request" {
                                        TimeOffRequestBubble(message: msg)
                                    } else {
                                        MessageBubble(message: msg,
                                                      isMe: isMyMessage(msg),
                                                      animateIn: shouldAnimate(msg),
                                                      status: deliveryStatus(for: msg),
                                                      onAppeared: { markAnimated(msg.id) })
                                    }
                                }
                                // Stable across the local → server id swap.
                                .id(viewId(msg))
                            }
                        }
                        // Stable bottom anchor. Scrolling to a fixed id is far
                        // more reliable than scrolling to the last message id,
                        // which changes on the optimistic→server swap.
                        Color.clear
                            .frame(height: 1)
                            .id(Self.bottomAnchor)
                            .onAppear { isAtBottom = true }
                            .onDisappear { isAtBottom = false }
                    }
                    .padding()
                    // While the thread opens, its rows measure themselves over
                    // several frames — inside the push's animated transaction, so
                    // every height change ANIMATED: the whole transcript slid down
                    // and then snapped (2026-10-14). Nothing in here animates its
                    // layout until the opening has settled.
                    .transaction { if !didInitialScroll { $0.animation = nil } }
                }
                // Start pinned to the newest message and stay pinned as
                // content grows — the reliable iOS-17+ way to open a chat at
                // the bottom (scrollTo on a lazy trailing anchor at .onAppear
                // often no-ops because the anchor isn't realized yet).
                .defaultScrollAnchor(.bottom)
                // When the keyboard opens or closes the visible area shrinks or
                // grows; the system keeps the BOTTOM anchored through it, inside
                // the keyboard's own animation — so the newest message stays just
                // above the composer the whole way (2026-10-14).
                .defaultScrollAnchor(.bottom, for: .sizeChanges)
                // Follow the content's HEIGHT: whenever it changes while we're
                // following (opening, or already at the bottom), pin to the bottom
                // in the same frame, unanimated — so nothing visibly moves. Rows
                // that finish late (a photo loading, a long thread measuring in
                // batches, a completion-request card) are followed too; the
                // `.sizeChanges` anchor alone left those short of the bottom.
                //
                // "At the bottom" is read from the geometry just BEFORE the growth,
                // not from `isAtBottom`: that flag comes from the 1pt bottom marker
                // appearing, and a photo growing above it can push the marker off
                // screen — flipping the flag — before this runs.
                .onScrollGeometryChange(for: TranscriptGeometry.self) { g in
                    TranscriptGeometry(
                        height: g.contentSize.height,
                        // How far the scrollable end sits below the visible end,
                        // insets included — 0 when resting at the bottom.
                        fromBottom: (g.contentSize.height + g.contentInsets.bottom)
                            - (g.contentOffset.y + g.containerSize.height))
                } action: { old, new in
                    guard new.height != old.height,
                          !didInitialScroll || old.fromBottom < 48 else { return }
                    var t = Transaction(); t.disablesAnimations = true
                    withTransaction(t) { proxy.scrollTo(Self.bottomAnchor, anchor: .bottom) }
                }
                // iOS 26 adds a soft "scroll edge effect" fade at the top where
                // content meets the safe area — that stacked a second fade under
                // our header. Hide it; the header owns the top fade.
                .scrollEdgeEffectHidden(true, for: .top)
                // Swipe down on the transcript to dismiss the keyboard smoothly
                // (interactive) instead of it snapping shut and the layout jumping.
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await appState.refreshMessages() }
                // Follow the conversation: any new message (count change) or an
                // id swap on the last message re-pins to the bottom. A new
                // message also means there's something new to mark read.
                .onChange(of: liveMessages.count) {
                    // Capture the baseline the first time messages appear (handles
                    // opening into an uncached thread whose backlog loads after
                    // .onAppear), so that backlog doesn't animate in wholesale.
                    captureBaselineIfNeeded()
                    // Auto-follow if we're at the bottom, or the new message is mine,
                    // OR we're still in the just-opened window (force to newest so a
                    // late-loading backlog can't leave us mid-history).
                    if !didInitialScroll || isAtBottom || (liveMessages.last.map(isMyMessage) ?? false) {
                        scrollToBottom(proxy, animated: didInitialScroll)
                    }
                    // markThreadReadNow does the local mark too, so the badge stays
                    // clear while viewing without a second, differently-stamped call.
                    Task { await markThreadReadNow() }
                }
                .onChange(of: liveMessages.last.map(viewId)) {
                    // Same guard — but always follow the optimistic→server id swap
                    // of my OWN latest message so its bubble doesn't jump.
                    if !didInitialScroll || isAtBottom || (liveMessages.last.map(isMyMessage) ?? false) {
                        scrollToBottom(proxy, animated: didInitialScroll)
                    }
                }
                .onAppear {
                    guard !didOpen else { return }
                    didOpen = true
                    captureBaselineIfNeeded()
                    // Clear this thread's inbox unread badge the instant it's
                    // opened (observable → the inbox re-renders immediately).
                    appState.markThreadRead(threadKey)
                    // ALWAYS open on the newest message: one pin now; the
                    // `.sizeChanges` bottom anchor holds it there while backlog and
                    // attachment heights settle. This used to re-pin five times over
                    // 0.85s, and each re-pin after a drift was a visible snap. The
                    // opening window still lasts ~0.85s — late backlog in that window
                    // is followed (onChange), and layout animation stays off.
                    didInitialScroll = false
                    scrollToBottom(proxy, animated: false)
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 850_000_000)
                        didInitialScroll = true
                    }
                    // Pull latest request statuses so any timeoff_request
                    // bubble shows live state + Approve/Deny (admins get all).
                    Task { await appState.refreshTimeOffRequests() }
                }
                // The header is PART OF THE PAGE (2026-10-14): it slides in and
                // out with the thread and follows a back-swipe, like the composer.
                // It used to live in a separate UIWindow so the keyboard couldn't
                // move it. It sits in the TOP inset, and the keyboard changes only
                // the bottom one, so it doesn't move. The members page grows out
                // of THIS pill.
                .safeAreaInset(edge: .top, spacing: 0) {
                    ThreadTopBar(context: headerContext, topInset: 0,
                                 onPillFrame: { if $0 != pillFrame { pillFrame = $0 } },
                                 hidePill: showMembers)
                        .frame(height: overlayBarHeight)
                        .opacity(Double(max(0, 1 - membersProgress * 3)))
                        .allowsHitTesting(!showMembers)
                }
                // Composer sits at the bottom; SwiftUI's default keyboard
                // avoidance raises it while the (windowed) header stays put.
                .safeAreaBar(edge: .bottom, spacing: 0) {
                    VStack(spacing: 8) {
                        // Pending attachment preview (thumbnail + remove) above the row.
                        if hasAttachment {
                            HStack {
                                attachmentPreview
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 6)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }

                        // The iOS 26 Messages bar, built from Apple's own glass:
                        // + in its own glass circle on the left, the field in a
                        // glass capsule beside it, and send — a solid accent
                        // circle — inside the field's right end, shown only once
                        // there is something to send. One GlassEffectContainer
                        // holds both, so their glass blends and reacts as one
                        // system the way the native bar's does. Everything rests
                        // on the bottom edge while the text wraps (up to 5 lines).
                        let canSend = !(newText.trimmingCharacters(in: .whitespaces).isEmpty && !hasAttachment)
                        GlassEffectContainer(spacing: 8) {
                            HStack(alignment: .bottom, spacing: 8) {
                                // Attachment — slides up a native sheet of sources
                                // (camera / photos / files).
                                Button { showAttachSheet = true } label: {
                                    Image(systemName: "plus")
                                        .font(.system(size: 18, weight: .medium))
                                        .foregroundStyle(Color(hex: T.ink))   // black, not the tint
                                        .frame(width: 26, height: 26)   // 40 - 2×7 native inset
                                }
                                .nativeGlass(.circle)
                                .sheet(isPresented: $showAttachSheet, onDismiss: openPendingSource) {
                                    AttachSourceSheet { source in
                                        pendingSource = source
                                        showAttachSheet = false
                                    }
                                }
                                .accessibilityLabel("Add attachment")
                                .disabled(isSending)

                                HStack(alignment: .bottom, spacing: 6) {
                                    TextField("Message", text: $newText, axis: .vertical)
                                        .textFieldStyle(.plain)
                                        .focused($composerFocused)
                                        .font(TTypo.sm(14))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1...5)
                                        // 28 + 2×6 = 40 on one line, matching the +
                                        // circle; the 20pt radius below is half of it.
                                        .frame(minHeight: 28)
                                        .padding(.leading, 10)
                                        .padding(.trailing, canSend || isSending ? 0 : 10)

                                    if canSend || isSending {
                                        Button {
                                            Task { await sendMessage() }
                                        } label: {
                                            Group {
                                                if isSending {
                                                    ProgressView().tint(T.onAccent).scaleEffect(0.7)
                                                } else {
                                                    Image(systemName: "arrow.up")
                                                        .font(.system(size: 13, weight: .bold))
                                                        .foregroundStyle(T.onAccent)
                                                }
                                            }
                                            .frame(width: 28, height: 28)
                                            .contentShape(Circle())
                                        }
                                        .buttonStyle(.plain)
                                        // A SOLID accent circle, not tinted glass. As
                                        // glass it sat inside the field's glass, in the
                                        // same GlassEffectContainer, so the two shapes
                                        // fused and pulled apart every time it came and
                                        // went — part of the glitch on send.
                                        .background(Circle().fill(Color(hex: T.accent)))
                                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                                        .accessibilityLabel("Send")
                                        .disabled(isSending)
                                    }
                                }
                                .padding(6)
                                // A capsule on one line (radius = half of 40); a
                                // rounded rectangle as it wraps, as Messages' field.
                                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            }
                        }
                        .animation(.bouncy(duration: 0.3), value: canSend || isSending)
                        .shakeIfChanged(sendShakeToken)   // Phase 6: shake on send failure

                        if let err = sendError {
                            Text(err)
                                .font(.caption)
                                .foregroundColor(.red)
                                .padding(.horizontal, 16)
                        }
                    }
                    .padding(.horizontal, 22)   // narrower bar (was 12)
                    .padding(.top, 8)
                    // Down on the home-indicator edge when the keyboard is away;
                    // a 10pt gap above the keyboard when it's up, instead of
                    // sitting flush on it.
                    // On the home-indicator edge when the keyboard is away; 10pt
                    // above the keyboard when it's up (the lift is measured from
                    // the bottom safe area, which the keyboard covers).
                    // A fixed gap above the keyboard's top. The composer is moved by
                    // iOS's own keyboard avoidance (it's a `safeAreaBar`), in the
                    // keyboard's own animation — so it stays this exact distance from
                    // the keyboard while it opens, closes, or is swiped down at any
                    // speed (2026-10-14).
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity)
                    // No backdrop of our own. `safeAreaBar` (iOS 26) gives the
                    // bar the system's scroll-edge effect, so messages soften as
                    // they pass under the glass pill — the native treatment. The
                    // hand-rolled frosted strip that was here put the glass over a
                    // blur, where it read as a frosted slab instead of a lens.
                    .animation(.easeInOut(duration: 0.18), value: hasAttachment)
                    .sheet(isPresented: $showCamera) {
                        CameraPicker { image in pickedImage = image; pickedFile = nil; sendError = nil }
                            .ignoresSafeArea()
                    }
                    .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
                    // The header lives in its own window, which outranks every
                    // presentation — so it stands down while a picker covers the
                    // thread, as it does for the add-people cover. Coming back is
                    // delayed a beat: the + sheet closing and the picker opening
                    // are two steps, and the header mustn't flash up between them.
                    .onChange(of: attachPickerOpen) { _, open in
                        if open {
                            appState.threadModalPresented = true
                        } else {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                                if !attachPickerOpen { appState.threadModalPresented = false }
                            }
                        }
                    }
                    .fileImporter(isPresented: $showFiles,
                                  allowedContentTypes: [.image, .pdf],
                                  allowsMultipleSelection: false) { handleFileImport($0) }
                    .onChange(of: photoItem) { _, item in loadLibraryItem(item) }
                }
            }
        }
        // A group thread gets the full Edit Group popup — rename, add AND remove.
        // Anything else (a DM spinning up a group) keeps the add-only picker, since
        // there's no group to edit yet.
        //
        // A COVER, not a sheet, and for the same two reasons NewMessageSheet is
        // one. Picking a name or two never warranted a whole SCREEN sliding up
        // over the conversation; and a popup needs the full screen with a clear
        // background so it can draw its own scrim and glass card rather than
        // inherit a system sheet's.
        .fullScreenCover(isPresented: $showAddPeople) { addPeopleCover }
        // The header copy, and — while it's open — the members page growing out of
        // its pill. The conversation underneath is never touched.
        //
        // The copy is identical to the overlay window's header and in the same spot,
        // so the swap can't be seen. It exists because the page has to grow out of a
        // pill in THIS window, over this view.
        .overlay {
            // The members page, growing out of the header's pill (in the page
            // above — no stand-in copy, no hand-over between windows).
            if showMembers {
                GeometryReader { geo in
                    let origin = geo.frame(in: .global).origin
                    let full = CGRect(origin: .zero, size: geo.size)
                    let from = pillFrame.offsetBy(dx: -origin.x, dy: -origin.y)
                    ZStack(alignment: .topLeading) {
                        MembersHero(progress: membersProgress, from: from, full: full,
                                    title: displayTitle,
                                    page: membersPage(topInset: windowTopInset))
                        // The avatars and back button stay ABOVE the growing page,
                        // exactly where the header's are, fading as it grows. The
                        // hero is drawn over the whole page, so without this the
                        // collapsing pill ended on top of the avatars and then
                        // snapped behind them when the real pill took over.
                        ThreadTopBar(context: headerContext, topInset: windowTopInset,
                                     hidePill: true)
                            .opacity(Double(max(0, 1 - membersProgress * 3)))
                            .allowsHitTesting(false)
                    }
                }
                .ignoresSafeArea()
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        // Hand the current thread to the app (push suppression, the app header); clear it on exit
        // (back button or swipe-back) so the window hides. onBack captures this
        // view's dismiss so the windowed back button pops the NavigationStack.
        // Re-publish as title/participants resolve (they load after onAppear).
        .onAppear { publishThreadContext() }
        .onChange(of: displayTitle) { publishThreadContext() }
        .onChange(of: threadParticipants.map(\.id)) { publishThreadContext() }
        .onDisappear {
            // Covered by its own members page isn't leaving: keep the header's
            // context, so the overlay window stays drawn (just transparent) and
            // can come straight back when the page collapses. Anything else IS
            // leaving, and takes the members flag with it.
            if !showMembers {
                appState.activeMessageThread = nil
                appState.threadMembersOpen = false
            }
        }
        .task(id: threadKey) {
            // Poll every 3s while this conversation is open. The global
            // 15s auto-refresh feels too slow when two people are actively
            // chatting; the recipient should see your message in seconds,
            // not next-pollster. SwiftUI cancels this Task automatically
            // when the view disappears.
            while !Task.isCancelled {
                await appState.refreshMessages()
                await appState.refreshReadReceipts()
                // Keep my read cursor at the newest message so the sender sees
                // "Read" (no-op once it stops advancing).
                await markThreadReadNow()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    private func isMyMessage(_ msg: Message) -> Bool {
        if myMessageIds.contains(msg.id) { return true }
        let id = msg.authorId
        if let pid = appState.currentPersonId, !pid.isEmpty, id == pid { return true }
        if let email = appState.currentPerson?.email, !email.isEmpty, id.lowercased() == email.lowercased() { return true }
        if let email = appState.matchEmail, !email.isEmpty, id.lowercased() == email.lowercased() { return true }
        // NB: intentionally NO authorName == my name fallback — two people who
        // share a name would have each other's bubbles mis-rendered as "mine".
        // Identity is an id/email match only.
        return false
    }

    /// The add/edit-members popup. A group thread gets the full Edit Group popup —
    /// rename, add AND remove; a DM (spinning up a group) the add-only picker, since
    /// there's no group to edit yet. Presented by the thread and by the members page.
    @ViewBuilder private var addPeopleCover: some View {
            Group {
                if let group = editableGroup {
                    EditGroupPopup(group: group) { name, memberIds in
                        Task { await appState.updateGroup(id: group.id, name: name, memberIds: memberIds) }
                    }
                } else {
                    AddPeoplePopup(excludedIds: Set(threadParticipants.map { $0.id })) { ids in
                        addPeople(ids)
                    }
                }
            }
            // Covers every exit — the X, a scrim tap, and a successful save (which
            // dismisses itself). Restoring the header here rather than at each one
            // is what keeps it from being left hidden by a path we forgot about.
            .onDisappear {
                appNav.modalBlur = false
                appState.threadModalPresented = false
            }
    }

    /// Open the add/edit-members popup.
    ///
    /// Two things have to happen alongside the flag, and BOTH were the bug:
    ///
    /// * `threadModalPresented` stands the overlay header window down. That
    ///   window outranks any normal presentation, so without this the thread's
    ///   header stayed stranded on top of the picker — and its back button, which
    ///   pops the navigation stack, read as "cancel" and took you out of the
    ///   thread entirely instead of out of the picker.
    /// * `modalBlur` blurs the page behind. The popup is its own presentation and
    ///   so cannot blur the page itself.
    ///
    /// Animations off for the presentation, so the cover doesn't ALSO slide up
    /// from the bottom under a card that springs in at the centre under its own
    /// steam — the same transaction NewMessageSheet is presented in.
    private func openAddPeople() {
        appState.threadModalPresented = true
        appNav.modalBlur = true
        withTransaction(Transaction.noAnimation) { showAddPeople = true }
    }

    /// Adding people is supported for group chats (append members) and DMs
    /// (spin up a group). Job/panel/op membership comes from the job team.
    private var canAddPeople: Bool {
        threadKey.hasPrefix("group:") || threadKey.hasPrefix("dm:")
    }

    /// The group this thread IS, when it's a group thread and the group has loaded.
    /// Drives Edit Group vs the add-only picker.
    private var editableGroup: ChatGroup? {
        guard threadKey.hasPrefix("group:") else { return nil }
        let ref = String(threadKey.dropFirst(6))
        return appState.groups.first(where: { $0.id == ref || $0.name == ref })
    }

    /// Add the picked people. Group → append + persist. DM → spin up a group
    /// from the pair + picks and open it (the original DM stays intact).
    /// DM only. A group thread goes through EditGroupPopup instead, which SETS the
    /// roster (so it can remove people) and can rename — hence no group branch here.
    private func addPeople(_ ids: [String]) {
        guard !ids.isEmpty, threadKey.hasPrefix("dm:") else { return }
        let members = Array(Set(threadParticipants.map { $0.id }).union(ids))
        Task {
            // Unnamed on purpose: the title then derives from whoever is in it, so
            // it stays right as people are added. Storing a snapshot of the names
            // here would freeze the old roster into the title.
            guard let g = await appState.createGroup(name: "", memberIds: members) else { return }
            await MainActor.run { onOpenThread("group:\(g.id)") }
        }
    }

    /// Readable auto-name for a group spun up from a DM: comma-joined first
    /// names, truncated with "+N" past three.

    private func personInitials(_ name: String) -> String { Initials.from(name) }

    /// Thumbnail (image) or doc chip (file) for the pending attachment, with a
    /// remove button. Tapping the + again re-opens the source dialog.
    @ViewBuilder private var attachmentPreview: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let img = pickedImage {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous))
                } else if let file = pickedFile {
                    VStack(spacing: 3) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(Color(hex: T.accent))
                        Text(file.name)
                            .font(.system(size: 8))
                            .lineLimit(1)
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .frame(width: 64, height: 64)
                    .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: T.surface)))
                }
            }
            .overlay(RoundedRectangle(cornerRadius: T.cornerSm).stroke(Color(hex: T.hair), lineWidth: 1))

            Button {
                pickedImage = nil; pickedFile = nil; photoItem = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Color.black.opacity(0.55))
            }
            .buttonStyle(.plain)
            .offset(x: 7, y: -7)
        }
        .padding(.top, 6)
    }

    private func loadLibraryItem(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            let data = try? await item.loadTransferable(type: Data.self)
            await MainActor.run {
                if let data, let img = UIImage(data: data) {
                    pickedImage = img; pickedFile = nil; sendError = nil
                } else {
                    sendError = "Couldn't load that photo. Try another."
                }
            }
        }
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else {
                sendError = "Couldn't read that file."; return
            }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            if mime.hasPrefix("image/"), let img = UIImage(data: data) {
                pickedImage = img; pickedFile = nil          // route through the downscaler
            } else {
                pickedFile = PickedAttachment(data: data, name: url.lastPathComponent, mime: mime); pickedImage = nil
            }
            sendError = nil
        case .failure(let error):
            sendError = error.localizedDescription
        }
    }

    /// Auto-name for camera/library photos (no source filename). Files keep
    /// their own name. e.g. "photo_2026-07-01_143205.jpg".
    private func attachmentFilename(ext: String) -> String {
        let fmt = ShopTime.current.formatter("yyyy-MM-dd_HHmmss")   // a shared file: the shop's clock
        return "photo_\(fmt.string(from: Date())).\(ext)"
    }

    /// Opens the picker chosen in the + sheet, once that sheet has gone.
    private func openPendingSource() {
        guard let source = pendingSource else { return }
        pendingSource = nil
        switch source {
        case .camera:
            if UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
            else { sendError = "No camera available on this device." }
        case .photos: showLibrary = true
        case .files:  showFiles = true
        }
    }

    private func sendMessage() async {
        let text = newText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty || hasAttachment else { return }
        // Identity guard (chat ACL): the server authorizes a post ONLY when the
        // authenticated Auth0 email resolves to a person whose id == authorId.
        // If our local identity is unresolved or stale (not a person in this
        // org), the post would 403 — and the old `?? UUID().uuidString` author
        // fallback GUARANTEED a bogus id. Refuse up front with a recovery hint
        // rather than firing a doomed request.
        guard let myPid = appState.currentPersonId,
              appState.people.contains(where: { $0.id == myPid }) else {
            sendError = "Session issue, please log out and log back in."
            return
        }
        isSending = true
        sendError = nil

        // Upload the pending attachment first (if any). On failure keep the
        // composer intact so the user can retry rather than losing the photo.
        var attachments: [Attachment] = []
        do {
            if let img = pickedImage {
                guard let data = ImageDownscaler.jpeg(from: img) else {
                    throw NSError(domain: "TRAQS", code: 0,
                                  userInfo: [NSLocalizedDescriptionKey: "Couldn't process that photo."])
                }
                attachments = [try await appState.uploadMessageAttachment(
                    filename: attachmentFilename(ext: "jpg"), mimeType: "image/jpeg", data: data)]
            } else if let file = pickedFile {
                attachments = [try await appState.uploadMessageAttachment(
                    filename: file.name, mimeType: file.mime, data: file.data)]
            }
        } catch {
            sendError = "Attachment failed: \(error.localizedDescription)"
            isSending = false
            return
        }

        let authorId    = myPid   // guarded above: a real person id in this org, matching the server's email resolution
        let authorName  = appState.currentPerson?.name  ?? appState.matchEmail ?? "Me"
        let authorColor = appState.currentPerson?.color ?? "#7c3aed"

        // Parse threadKey into scope + ID fields the backend expects
        let colonIdx   = threadKey.firstIndex(of: ":") ?? threadKey.endIndex
        let scopeKey   = String(threadKey[threadKey.startIndex..<colonIdx])
        let idValue    = colonIdx < threadKey.endIndex ? String(threadKey[threadKey.index(after: colonIdx)...]) : ""

        var jobId: String?   = nil
        var panelId: String? = nil
        var opId: String?    = nil
        switch scopeKey {
        case "job":   jobId   = idValue
        case "panel": panelId = idValue
        case "op":    opId    = idValue
        default: break
        }

        // Canonical participant set per thread type. Without this, group
        // and job/panel/op messages were stored with just [authorId],
        // which meant the server's push-notification step targeted no
        // one — recipients silently went without a notification. Also
        // used by client-side filtering as a sanity layer.
        let participantIds: [String] = {
            if scopeKey == "dm" {
                return idValue.components(separatedBy: "_")
            }
            if scopeKey == "group" {
                if let g = appState.groups.first(where: { $0.name == idValue || $0.id == idValue }) {
                    return g.memberIds
                }
                return [authorId]
            }
            // job / panel / op: union of every team[] on the parent job,
            // its panels, and its operations — matches the visibility
            // rule we just put in place server-side.
            let parentJob: Job? = {
                switch scopeKey {
                case "job":   return appState.jobs.first(where: { $0.id == idValue })
                case "panel": return appState.jobs.first(where: { j in j.subs.contains { $0.id == idValue } })
                case "op":
                    for j in appState.jobs {
                        if j.subs.contains(where: { p in p.subs.contains { $0.id == idValue } }) { return j }
                    }
                    return nil
                default: return nil
                }
            }()
            guard let j = parentJob else { return [authorId] }
            var ids = Set<String>(j.team)
            for p in j.subs {
                ids.formUnion(p.team)
                for o in p.subs { ids.formUnion(o.team) }
            }
            ids.insert(authorId)   // sender always counts (even if not on team)
            return Array(ids)
        }()

        let msgId = UUID().uuidString
        myMessageIds.insert(msgId)
        pendingIds.insert(msgId)   // #3: show "Sending…" until the server confirms

        let msg = Message(
            id: msgId,
            threadKey: threadKey,
            scope: scopeKey,
            jobId: jobId, panelId: panelId, opId: opId,
            text: text,
            authorId: authorId,
            authorName: authorName,
            authorColor: authorColor,
            participantIds: participantIds,
            attachments: attachments,
            timestamp: Date.nowISO()
        )
        newText = ""
        // The keyboard can commit a pending autocorrect / predictive word AFTER
        // the binding clears, putting the sent text back in the box. Clear once
        // more on the next frame, after it has (2026-10-14).
        DispatchQueue.main.async { newText = "" }
        pickedImage = nil; pickedFile = nil; photoItem = nil
        // A light tap as the bubble springs in (#4 send feel).
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        do {
            let serverId = try await appState.sendMessageThrowing(msg)
            // Same turn as the swap inside sendMessageThrowing (no await between),
            // so the swapped row renders under its original identity.
            if serverId != msgId { viewIds[serverId] = msgId }
            myMessageIds.insert(serverId)   // track server-assigned id too
            // Mark the server id as already-animated BEFORE SwiftUI renders the
            // swapped bubble, so the optimistic pop doesn't play a second time.
            animatedIds.insert(serverId)
            pendingIds.remove(msgId)        // confirmed → "Sent"
            // Report my own newest message as read so my cursor advances past it
            // (keeps the DM "Read" math correct after I send).
            await markThreadReadNow()
        } catch {
            // Optimistic bubble is rolled back inside sendMessageThrowing; here
            // we restore the composer text, surface the inline error, and shake
            // the input bar (Phase 6) so the failure is felt, not silent.
            sendError = "Failed to send: \(error.localizedDescription)"
            newText = text
            myMessageIds.remove(msgId)      // clean up on failure
            pendingIds.remove(msgId)
            sendShakeToken += 1
        }
        isSending = false
    }
}

// MARK: - Message time sections

/// A cluster of consecutive messages, headed by the time it started.
private struct MessageSection: Identifiable {
    let id: String          // first message's id
    let header: String      // when this cluster began
    var messages: [Message]
}

/// Centered, muted time label shown above each message cluster in a thread.
private struct SectionTimeHeader: View {
    let text: String
    var body: some View {
        Text(text)
            .font(TTypo.xsBold(11))
            .foregroundStyle(Color(hex: T.muted))
            .tracking(0.3)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 8)
            .padding(.bottom, 2)
    }
}

// MARK: - Attachment bubble (image thumbnail or file chip)

/// Renders one message attachment: images load inline as a thumbnail, other
/// files show a doc chip. Tapping either opens the attachment INSIDE the app
/// (QuickLook) with download / share / copy actions — no more kicking out to
/// Safari. The inline thumbnail is still served by the no-auth `attachment`
/// GET endpoint, same as the web app's <img src>.
private struct AttachmentBubble: View {
    let attachment: Attachment
    let isMe: Bool
    @Environment(AppState.self) private var appState
    @State private var showViewer = false

    private var url: URL? { Attachment.viewURL(for: attachment.key) }
    private var isImage: Bool { attachment.mimeType.hasPrefix("image/") }

    var body: some View {
        Button {
            // Hide the overlay header window so it doesn't float over the viewer.
            appState.threadModalPresented = true
            showViewer = true
        } label: { thumbnail }
            .buttonStyle(.plain)
            .fullScreenCover(isPresented: $showViewer,
                             onDismiss: { appState.threadModalPresented = false }) {
                AttachmentViewer(attachment: attachment)
            }
    }

    /// A photo's thumbnail is ONE fixed size, loading or loaded (2026-10-14). It
    /// was a 200×150 placeholder that became the photo's own shape (up to
    /// 220×260) once it arrived — after the thread had settled — so the
    /// transcript grew past the bottom and snapped back. Cropped to fill; tapping
    /// opens the whole photo.
    static let thumbSide: CGFloat = 220

    @ViewBuilder private var thumbnail: some View {
        if isImage, let url {
            CachedThumbnail(url: url) { fileChip }
                .frame(width: Self.thumbSide, height: Self.thumbSide)
                .clipShape(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                .stroke(Color(hex: T.hair), lineWidth: isMe ? 0 : 1))
        } else {
            fileChip
        }
    }

    private var fileChip: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.fill")
                .foregroundStyle(isMe ? T.onAccent : Color(hex: T.accent))
            Text(attachment.filename)
                .font(TTypo.sm(13))
                .lineLimit(1)
                .foregroundStyle(isMe ? T.onAccent : Color(hex: T.ink))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                .fill(isMe ? Color(hex: T.accent) : Color(hex: T.surface))
        )
    }
}

// MARK: - In-app attachment viewer (QuickLook + share/save/copy)

/// Opens an attachment inside the app. Downloads it to a temp file, then hands
/// it to QuickLook, which renders images (pinch-zoom), PDFs, and documents
/// natively and exposes a Share action — the system share sheet covers
/// download (Save to Files / Save Image), copy, and share-to-apps. A Done
/// button dismisses. This replaces the old Link that punted to Safari.

// MARK: - Composer attachment (a local pick, before upload)

private struct PickedAttachment: Equatable {
    let data: Data
    let name: String
    let mime: String
}

extension Attachment {
    /// Viewable URL served by the `attachment` function. GET needs no auth —
    /// the key is an unguessable bearer — so AsyncImage/Link can hit it
    /// directly, mirroring the web app's `<img src="/api/attachment?key=…">`.
    static func viewURL(for key: String) -> URL? {
        guard let encoded = key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        return URL(string: "\(AppConfig.netlifyBase)/attachment?key=\(encoded)")
    }
}

// MARK: - Delivery status (#3)

/// Status shown under one of my own message bubbles.
enum MessageDeliveryStatus: Equatable {
    case sending          // optimistic, POST in flight
    case sent             // server confirmed, not yet read by anyone
    case read(String)     // read — label is "Read 9:42 AM" (DM) or "Read by 3" (group)
}

/// Compact caption under my latest bubble: muted "Sending…"/"✓ Sent", or a
/// sky-blue "✓✓ Read …" once a recipient's cursor passes the message.
private struct DeliveryStatusLabel: View {
    let status: MessageDeliveryStatus

    var body: some View {
        Group {
            switch status {
            case .sending:
                Text("Sending…").foregroundStyle(Color(hex: T.muted))
            case .sent:
                Text("✓ Sent").foregroundStyle(Color(hex: T.muted))
            case .read(let label):
                HStack(spacing: 4) {
                    // Stacked/overlapping double-check emblem (GroupMe-style): the
                    // back check is offset + faded so the pair reads as layered
                    // rather than two flat ticks side by side.
                    ZStack {
                        Image(systemName: "checkmark")
                            .opacity(0.5)
                            .offset(x: 4.5)
                        Image(systemName: "checkmark")
                    }
                    Text(label)
                }
                .foregroundStyle(Color(hex: T.sky))
            }
        }
        .font(.system(size: 10, weight: .semibold))
        .transition(.opacity)
    }
}

// MARK: - Attachment source sheet (the composer's +)

enum AttachSource { case camera, photos, files }

/// Slides up from the bottom when + is pressed: a native sheet at a fixed short
/// detent, which iOS 26 renders as Liquid Glass. Three big rounded-square tiles,
/// each Apple's glass button style — so each one has the native press glow too.
private struct AttachSourceSheet: View {
    let pick: (AttachSource) -> Void

    var body: some View {
        HStack(spacing: 12) {
            tile("Camera", "camera.fill", .camera)
            tile("Photos", "photo.on.rectangle", .photos)
            tile("Files", "folder.fill", .files)
        }
        .padding(.horizontal, 20)
        .padding(.top, 28)
        .frame(maxHeight: .infinity, alignment: .top)
        .presentationDetents([.height(190)])
        .presentationDragIndicator(.visible)
    }

    private func tile(_ title: String, _ symbol: String, _ source: AttachSource) -> some View {
        Button { pick(source) } label: {
            VStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 28, weight: .medium))
                Text(title)
                    .font(.subheadline.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 96)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.roundedRectangle(radius: 22))
        .foregroundStyle(.primary)
    }
}

// MARK: - MessageBubble

struct MessageBubble: View {
    @Environment(AppState.self) private var appState
    let message: Message
    let isMe: Bool
    /// When true this bubble plays an entrance animation the first time it
    /// appears — a spring "pop" for my own sends, a slide-in-from-leading for
    /// incoming messages (#4). Old backlog bubbles pass false.
    var animateIn: Bool = false
    /// Delivery status for my own messages (Sending / Sent / Read). nil for
    /// others' messages (#3).
    var status: MessageDeliveryStatus? = nil
    /// Called once the entrance has kicked off so the parent can record that
    /// this id already animated.
    var onAppeared: () -> Void = {}

    /// Timestamp is hidden by default and revealed when the user taps
    /// the bubble. A timed Task auto-hides it again so the thread stays
    /// uncluttered without forcing a second tap.
    @State private var showTimestamp = false
    @State private var hideTask: Task<Void, Never>?
    /// Drives the entrance: false = pre-animation (offset/scaled/faded),
    /// true = resting. Flipped in onAppear.
    @State private var appeared = false

    /// The bubble outline, matching the web app (src/TRAQS.jsx, the `m.text`
    /// bubble in the thread): 22pt on three corners and a 6pt tuck on the BOTTOM
    /// corner nearest the sender, so the bubble points back at whoever wrote it.
    /// This was a plain 20pt RoundedRectangle — symmetric, so it read as a pill
    /// with no sense of direction.
    ///
    /// One property, used for both the fill and the hit-test, so the tappable
    /// area can't drift from the drawn shape.
    private var bubbleShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            cornerRadii: .init(topLeading: 22,
                               bottomLeading: isMe ? 22 : 6,
                               bottomTrailing: isMe ? 6 : 22,
                               topTrailing: 22),
            style: .continuous
        )
    }

    var body: some View {
        VStack(alignment: isMe ? .trailing : .leading, spacing: 2) {
            HStack(alignment: .bottom, spacing: 8) {
                if isMe { Spacer(minLength: 40) }

                if !isMe {
                    Avatar(initials: Initials.from(message.authorName),
                           size: 34, gradient: true,   // 28 -> 34 on request (2026-10-14)
                           imageData: appState.people.first { $0.id == message.authorId }?.image)
                }

                VStack(alignment: isMe ? .trailing : .leading, spacing: 4) {
                    if !isMe {
                        Text(message.authorName).font(.caption2).foregroundColor(Color(hex: T.muted))
                    }
                    ForEach(message.attachments) { att in
                        AttachmentBubble(attachment: att, isMe: isMe)
                    }
                    if !message.text.isEmpty {
                        Text(message.text)
                            .font(TTypo.sm(13))
                            .multilineTextAlignment(.leading)
                            // Wrap to the text's natural height and cap the bubble width so
                            // long messages wrap inside a bounded bubble instead of
                            // stretching across the row / overlapping the avatar or edge.
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .foregroundStyle(isMe ? T.onAccent : Color(hex: T.ink))
                            .background {
                                let shape = bubbleShape
                                if isMe {
                                    shape.fill(Color(hex: T.accent))   // solid accent, no gradient
                                        .shadow(color: Color(hex: T.ctaGlowColor).opacity(T.ctaGlowOpacity * 0.7),
                                                radius: T.ctaGlowRadius * 0.6, x: 0, y: T.ctaGlowY * 0.6)
                                } else {
                                    // Received messages are frosted glass; sent ones
                                    // keep the solid brand gradient, which is what
                                    // makes the two sides read apart at a glance.
                                    Color.clear
                                        .glassSurface(in: shape, rim: true)
                                        .compositingGroup()
                                        .shadow(color: .black.opacity(T.ambientShadowOpacity),
                                                radius: T.ambientShadowRadius * 0.6, x: 0, y: T.ambientShadowY * 0.6)
                                }
                            }
                            .frame(maxWidth: 300, alignment: isMe ? .trailing : .leading)
                            .contentShape(bubbleShape)
                            .onTapGesture { toggleTimestamp() }
                    }

                    if isMe, let status {
                        DeliveryStatusLabel(status: status)
                            .padding(.trailing, 4)
                            .padding(.top, 1)
                    }
                }

                if !isMe { Spacer(minLength: 40) }
            }

            // Timestamp revealed on tap. This is a real, laid-out row BENEATH the
            // whole bubble (not the old zero-height overlay offset below it), so it
            // reserves space and always paints above the delivery-status label and
            // the next row's attachment instead of being covered by them.
            if showTimestamp {
                Text(message.timestamp.messageStamp)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(Color(hex: T.muted))
                    // Indent under the bubble (past the avatar) for incoming.
                    .padding(.leading, isMe ? 0 : 42)   // avatar 34 + spacing 8
                    .padding(.trailing, isMe ? 4 : 0)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .modifier(BubbleEntrance(isMe: isMe, active: animateIn, appeared: appeared))
        .onAppear {
            guard !appeared else { return }
            if animateIn {
                // Mine springs up into place; incoming slides in from the side.
                let anim: Animation = isMe
                    ? .spring(response: 0.34, dampingFraction: 0.6)
                    : .spring(response: 0.42, dampingFraction: 0.82)
                withAnimation(anim) { appeared = true }
                onAppeared()
            } else {
                appeared = true   // no animation for backlog bubbles
            }
        }
        .onDisappear { hideTask?.cancel() }
    }

    private func toggleTimestamp() {
        hideTask?.cancel()
        if showTimestamp {
            withAnimation(.easeOut(duration: 0.22)) { showTimestamp = false }
            return
        }
        withAnimation(.easeOut(duration: 0.28)) { showTimestamp = true }
        hideTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.28)) { showTimestamp = false }
        }
    }
}

/// The pre/post transform for a message bubble's entrance (#4). When `active`
/// is false it's the identity transform (resting) so backlog bubbles and
/// already-animated bubbles render normally with no first-frame flash.
/// `pre` (active && not yet appeared) is the starting pose:
///   · mine     → scaled down + nudged below, anchored bottom-trailing (a pop)
///   · incoming → slid in from the leading edge (a slide-in)
/// both fading up from transparent.
private struct BubbleEntrance: ViewModifier {
    let isMe: Bool
    let active: Bool
    let appeared: Bool

    func body(content: Content) -> some View {
        let pre = active && !appeared
        content
            .scaleEffect(pre && isMe ? 0.86 : 1,
                         anchor: isMe ? .bottomTrailing : .bottomLeading)
            .offset(x: pre && !isMe ? -28 : 0,
                    y: pre && isMe ? 12 : 0)
            .opacity(pre ? 0 : 1)
    }
}

// MARK: - Time Off Request Bubble (in-chat approve/deny)

struct TimeOffRequestBubble: View {
    @Environment(AppState.self) private var appState
    let message: Message

    @State private var denying = false
    @State private var reason = ""
    @State private var busy = false

    // Live request (if loaded) wins; otherwise fall back to the fields the
    // server embedded on the message so the card always renders.
    private var req: TimeOffRequest? {
        appState.timeOffRequests.first { $0.id == message.timeOffRequestId }
    }
    /// `nil` = not known yet (the request list hasn't loaded). Optional for the
    /// same reason as CompletionRequestBubble.status: defaulting to "pending"
    /// put live Approve/Deny on a request whose real status we hadn't got.
    private var status: String? { req?.status }
    private var type: String { req?.type ?? message.toType ?? "PTO" }
    private var startD: String { req?.start ?? message.toStart ?? "" }
    private var endD: String { req?.end ?? message.toEnd ?? "" }
    private var note: String { req?.note ?? message.toNote ?? "" }
    private var who: String { req?.personName ?? message.toPersonName ?? message.authorName }
    private var typeColor: Color { type == "UTO" ? Color(hex: "#F59E0B") : Color(hex: "#10B981") }
    private var pending: Bool { CompletionRequestRules.isActionable(status) }
    /// Decided, and therefore undoable. CANCELLED is deliberately excluded: that
    /// was the requester withdrawing, which isn't the approver's to reverse —
    /// timeoff.js refuses a reopen from it.
    private var decided: Bool { status == "approved" || status == "denied" }
    private var statusPill: (label: String, kind: TagKind, dot: Bool) {
        switch status {
        case "approved":  return ("Approved", .green, false)
        case "denied":    return ("Denied", .magenta, false)
        case "cancelled": return ("Cancelled", .neutral, false)
        case "pending":   return ("Pending", .amber, true)
        default:          return ("—", .neutral, false)   // unknown, not pending
        }
    }
    private var rangeLabel: String { ShopTime.rangeLabel(start: startD, end: endD) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 11) {
                IconChip(icon: .cal, color: typeColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Time Off Request")
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                    Text("from \(who)")
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: T.muted))
                }
                Spacer(minLength: 8)
                TagPill(label: statusPill.label, kind: statusPill.kind, dot: statusPill.dot)
            }

            HStack(spacing: 8) {
                Text(type)
                    .font(TTypo.xsBold(11))
                    .tLabel(tracking: 0.4)
                    .foregroundStyle(typeColor)
                    .padding(.horizontal, 9).padding(.vertical, 3)
                    .background(Capsule().fill(typeColor.opacity(0.14)))
                Text(rangeLabel)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
            }

            if !note.isEmpty {
                Text(note)
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
            }

            if status != "pending", let r = req, let by = r.decidedByName, !by.isEmpty {
                let extra = (r.denialReason?.isEmpty == false) ? " · “\(r.denialReason!)”" : ""
                Text("\(statusPill.label) by \(by)\(extra)")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }

            // The TOGGLE, not the bare admin role. An admin with
            // approveTimeOff switched off can see the card — they may even
            // have raised it themselves — but has nothing to act with.
            // timeoff.js decides on approveTimeOff, not approveCompletions.
            if appState.can(.approveTimeOff) && (pending || decided) {
                if denying {
                    VStack(spacing: 8) {
                        TextField("Reason (optional)…", text: $reason)
                            .textFieldStyle(.plain)
                            .font(TTypo.sm(13))
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: T.surface)))
                            .overlay(RoundedRectangle(cornerRadius: T.cornerSm).stroke(Color(hex: T.hair), lineWidth: 1))
                        HStack(spacing: 8) {
                            Button { denying = false; reason = "" } label: {
                                Text("Cancel").font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.ink))
                                    .frame(maxWidth: .infinity).padding(.vertical, 4)
                            }.nativeGlass(.capsule)
                            Button { decide("deny") } label: {
                                Text("Confirm Deny").font(TTypo.smBold(14)).foregroundStyle(T.onColor("#ef4444"))
                                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                            }.nativeGlass(.capsule, prominent: true, tint: Color(hex: "#ef4444")).disabled(busy)
                        }
                    }
                } else {
                    // Deny opens the reason field rather than firing the denial,
                    // so the morph runs on the DECISION, not on the first tap.
                    DecisionActions(
                        deny: .init(title: "Deny", systemImage: "xmark",
                                    tint: Color(hex: "#ef4444")) { denying = true },
                        approve: .init(title: "Approve", systemImage: "checkmark",
                                       tint: Color(hex: "#10b981")) { decide("approve") },
                        undo: .init(title: "Undo — back to pending",
                                    systemImage: "arrow.uturn.backward",
                                    tint: nil) { reopen() },
                        resolved: decided,
                        busy: busy)
                }
            }
        }
        .padding(T.insetLg)
        .frostedCard(radius: T.cornerLg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func decide(_ action: String) {
        guard let id = message.timeOffRequestId else { return }
        busy = true
        Task {
            await appState.decideTimeOff(id: id, action: action, reason: reason)
            busy = false
            denying = false
            reason = ""
        }
    }

    /// Undo the decision — the request goes back to the approval queue. Undoing
    /// an approval also pulls the day back out of the schedule, server-side.
    private func reopen() {
        guard let id = message.timeOffRequestId else { return }
        busy = true
        Task {
            await appState.reopenTimeOff(id: id)
            busy = false
        }
    }
}

// MARK: - Completion Request Bubble

/// Renders a `finish_request` message as a card with Approve/Deny for admins.
/// For task-level requests (message has panelId/opId), approval marks only that item Finished.
struct CompletionRequestBubble: View {
    @Environment(AppState.self) private var appState
    let message: Message
    @State private var busy = false

    private var job: Job? { appState.jobs.first { $0.id == message.jobId } }
    /// The item the request was actually raised against — sub-op, else panel,
    /// else the job. NOT always the job: see `CompletionRequestRules.target`.
    private var target: CompletionRequestRules.TargetState {
        CompletionRequestRules.target(job: job, panelId: message.panelId, opId: message.opId)
    }
    private var entry: FinishRequestEntry? {
        guard let id = message.finishRequestId else { return nil }
        return target.entries?.first { $0.id == id }
    }
    /// `nil` = genuinely NOT KNOWN — the item isn't loaded, or carries nothing
    /// about this request. Deliberately optional: this used to default to
    /// "pending", which meant an already-approved request rendered live
    /// Approve/Deny buttons any time its job was momentarily missing (a failed
    /// save rolls the whole `jobs` array back), so it could be resolved over and
    /// over.
    private var status: String? {
        CompletionRequestRules.status(target: target, requestId: message.finishRequestId)
    }
    /// Actions are offered ONLY for a request we know is pending.
    private var pending: Bool { CompletionRequestRules.isActionable(status) }
    private var statusPill: (label: String, kind: TagKind, dot: Bool) {
        switch status {
        case "approved": return ("Approved", .green, false)
        case "declined": return ("Declined", .red, false)
        case "pending":  return ("Pending", .amber, true)
        default:         return ("—", .neutral, false)   // unknown, not pending
        }
    }
    /// Set when a decision is refused — an already-resolved request, or one whose
    /// job isn't loaded. Without this the press was a silent no-op and the
    /// buttons just sat there, which read as "I approved it and nothing happened".
    @State private var refused: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 11) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color(hex: T.accent))
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(Color(hex: T.accent).opacity(0.14)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Completion Request")
                        .font(TTypo.smBold(15)).foregroundStyle(Color(hex: T.ink))
                    Text("from \(entry?.byName ?? message.authorName)")
                        .font(TTypo.xs(12)).foregroundStyle(Color(hex: T.muted))
                }
                Spacer(minLength: 8)
                TagPill(label: statusPill.label, kind: statusPill.kind, dot: statusPill.dot)
            }

            if let job {
                let isTaskLevel = message.panelId != nil
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(job.jobNumber.map { "Job #\($0) — " } ?? "")\(job.title)")
                        .font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.ink))
                    if isTaskLevel {
                        let panel = job.subs.first { $0.id == message.panelId }
                        let op = panel?.subs.first { $0.id == message.opId }
                        let label: String = {
                            if let op { return "\(panel?.title ?? "") › \(op.title)" }
                            return panel?.title ?? ""
                        }()
                        if !label.isEmpty {
                            Text(label)
                                .font(TTypo.xs(12)).foregroundStyle(Color(hex: T.muted))
                        }
                    }
                }
            } else {
                Text(message.text).font(TTypo.sm(13)).foregroundStyle(Color(hex: T.muted))
            }

            if let status, status != "pending", let by = entry?.resolvedByName, !by.isEmpty {
                Text("\(statusPill.label) by \(by)")
                    .font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
            }

            if let refused {
                Text(refused)
                    .font(TTypo.xs(12)).foregroundStyle(Color(hex: T.muted))
            }

            // Deny/Approve while the request is open; once it's approved the pair
            // melts into the Undo that reopens the item. ONE control across both
            // states, so the change is a morph rather than one set of buttons
            // being swapped out for another — see DecisionActions.
            //
            // A DECLINED request still shows nothing: `undoJobCompletion` only
            // accepts "approved" (CompletionRequestRules.applyDecision), so an
            // Undo here would be a button that refuses every press.
            // Gated on the toggle, not the bare admin role — see the note on
            // the other decision block in this file.
            if appState.can(.approveCompletions) && (pending || status == "approved") {
                DecisionActions(
                    deny: .init(title: "Deny", systemImage: "xmark",
                                tint: Color(hex: "#ef4444")) { decide(false) },
                    approve: .init(title: "Approve", systemImage: "checkmark",
                                   tint: Color(hex: "#10b981")) { decide(true) },
                    undo: .init(title: message.panelId != nil ? "Undo — reopen task"
                                                             : "Undo — reopen job",
                                systemImage: "arrow.uturn.backward",
                                tint: nil) { undo() },
                    resolved: status == "approved",
                    busy: busy)
            }
        }
        // T.insetMd, not 14: this card is on the rounder radius now, and the
        // job title was running into the corner arc.
        .padding(T.insetLg)
        .frostedCard(radius: T.cornerLg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func decide(_ approve: Bool) {
        guard let jobId = message.jobId, let reqId = message.finishRequestId else { return }
        busy = true   // disables buttons during the async; status then drives visibility
        refused = nil
        Task {
            let ok: Bool
            if approve {
                ok = await appState.approveJobCompletion(jobId: jobId, panelId: message.panelId,
                                                         opId: message.opId, requestId: reqId)
            } else {
                ok = await appState.denyJobCompletion(jobId: jobId, panelId: message.panelId,
                                                      opId: message.opId, requestId: reqId)
            }
            busy = false
            // A refusal means the request was already resolved (or its job isn't
            // loaded). Say so — the old code returned silently and left the
            // buttons up, which looked like the tap had done nothing.
            if !ok { refused = "Already resolved — pull to refresh." }
        }
    }

    private func undo() {
        guard let jobId = message.jobId, let reqId = message.finishRequestId else { return }
        busy = true
        refused = nil
        Task {
            let ok = await appState.undoJobCompletion(jobId: jobId, panelId: message.panelId,
                                                      opId: message.opId, requestId: reqId)
            busy = false
            if !ok { refused = "Already reopened — pull to refresh." }
        }
    }
}

// MARK: - Thread Top Bar (back button · avatars over a glass name pill)

/// The conversation header. No backing plate: the back button on the left, and in
/// the centre the participants' avatars sitting ON TOP of a Liquid Glass pill that
/// fits the thread's name. Tapping the pill or the avatars opens the members page
/// (ThreadMembersPage), which zooms out of the pill's spot.
///
/// Drawn in the thread page's top inset; the page ignores the keyboard, so the
/// keyboard never moves it.
///
/// No GlassEffectContainer here on purpose: inside one, glass is drawn above its
/// siblings whatever their order, which put the avatars UNDER the pill.
struct ThreadTopBar: View {
    let context: ThreadContext
    let topInset: CGFloat
    /// Set only on the thread's own copy of this header (main window): reports
    /// where the pill is, which is where the members page grows from and
    /// collapses back into.
    var onPillFrame: ((CGRect) -> Void)? = nil
    /// The copy hides its pill while the members page is out — the page's own
    /// shell IS the pill at that point, drawn in exactly the same place.
    var hidePill: Bool = false

    /// The name pill's geometry, shared with MembersHero, whose first and last
    /// frames have to BE this pill. Even padding above and below the name — it was
    /// 18 over 9, reaching up under the avatar, which read as top-heavy.
    static let avatarSize: CGFloat = 50   // 44 -> 50 on request (2026-10-14)
    /// How far the avatar sits down over the pill's top edge. 8 -> 6 with the
    /// bigger avatar: the pill sits ~8pt lower than it did.
    static let avatarOverlap: CGFloat = 6
    static let pillPadH: CGFloat = 18
    static let pillPadV: CGFloat = 10

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: -Self.avatarOverlap) {
                avatars(size: Self.avatarSize)
                    .zIndex(1)   // over the pill
                    .onTapGesture { context.onTapIdentity() }
                Button { context.onTapIdentity() } label: {
                    Text(context.title)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.horizontal, Self.pillPadH)
                        .padding(.vertical, Self.pillPadV)
                }
                .buttonStyle(.plain)
                // Plain, NOT `.interactive()`: interactive glass stretches toward
                // the finger and springs back, and this pill has to hold its size
                // and place no matter what.
                .glassEffect(.regular, in: Capsule())
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { onPillFrame?($0) }
                .opacity(hidePill ? 0 : 1)
                .accessibilityLabel("\(context.title). Show people")
            }
            // Clear of the back button on either side, so a long name truncates
            // instead of running under it; a short one still hugs its text.
            .padding(.horizontal, 72)
            .frame(maxWidth: .infinity)
            // Never animate: the title and avatars resolve after the thread opens,
            // and any transaction in flight (the tab spring, a publish) would
            // otherwise ease the pill to its new width — the "moving and snapping".
            // A change, if one comes, lands in one frame.
            .transaction { $0.animation = nil; $0.disablesAnimations = true }

            GlassKey(size: HeaderControl.diameter, action: context.onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
            }
            .accessibilityLabel("Back")
            .padding(.leading, 16)
            .padding(.top, 12)
        }
        .padding(.top, topInset + 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // ONE fixed type size, in both windows. The app sets a Dynamic Type floor
        // (xLarge / xxLarge, ContentView) that the overlay window — a separate
        // host — never inherits. So the thread's copy of this header (main window,
        // the members page collapses into it) drew a bigger pill than the overlay's,
        // and the hand-over snapped it down. Pinned here, both are identical. .large
        // is the size the overlay header has always rendered at.
        .dynamicTypeSize(.large)
    }

    /// One avatar for a DM, an overlapping stack for everything else.
    @ViewBuilder private func avatars(size: CGFloat) -> some View {
        if context.isDM, let other = context.participants.first(where: { $0.name == context.title }) {
            Avatar(initials: Initials.from(other.name), size: size,
                   fill: .personFill(other.color), imageData: other.image)
                .overlay(Circle().stroke(Color(hex: T.surface), lineWidth: 2))
        } else if context.isDM || context.participants.isEmpty {
            let i = Initials.from(context.title)
            Avatar(initials: i.isEmpty ? "#" : i, size: size, gradient: true)
                .overlay(Circle().stroke(Color(hex: T.surface), lineWidth: 2))
        } else {
            ParticipantStack(people: context.participants, avatarSize: size, maxShown: 3)
        }
    }
}

// MARK: - Members hero (the pill growing into the page)

/// The name pill's glass growing into the full members page, and shrinking back.
/// One animatable `progress`, 0 = exactly the pill, 1 = the whole screen:
///   • the shell's frame and corner run from the pill's to the screen's;
///   • its glass gives way to the page's solid background;
///   • the pill's own title fades out as the page's content fades in;
///   • the page is laid out at FULL size the whole time and only revealed through
///     the shell, so nothing inside it re-flows mid-animation.
/// Nothing outside the shell moves: the conversation under it stays exactly as it
/// is — unlike the system zoom transition, which shrinks the page behind.
struct MembersHero<Page: View>: View, Animatable {
    var progress: CGFloat
    /// The pill and the screen, in this view's own coordinates.
    let from: CGRect
    let full: CGRect
    let title: String
    let page: Page

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        let p = min(max(progress, 0), 1)
        let rect = CGRect(x: mix(from.minX, full.minX), y: mix(from.minY, full.minY),
                          width: mix(from.width, full.width), height: mix(from.height, full.height))
        // From the pill's capsule (half its height) to a corner the screen's own
        // rounded corners hide.
        let shape = RoundedRectangle(cornerRadius: mix(from.height / 2, 44), style: .continuous)
        let contentIn = max(0, (p - 0.3) / 0.7)

        ZStack(alignment: .topLeading) {
            // The shell: the pill's glass, filling in with the page background.
            // The glass goes on a container that ALWAYS holds something visible —
            // the title at the start, the fill after. Measured: with the glass on
            // the fill alone, a fill at opacity 0 (progress 0, the very frame that
            // must BE the pill) is dropped by SwiftUI, glass and all.
            ZStack {
                shape.fill(Color(hex: T.bg).opacity(Double(min(1, p * 1.6))))
                // The pill's own title, laid out exactly as the header pill's, so
                // the first and last frames ARE the pill.
                Text(title)
                    .font(TTypo.smBold(15))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.horizontal, ThreadTopBar.pillPadH)
                    .padding(.vertical, ThreadTopBar.pillPadV)
                    .dynamicTypeSize(.large)
                    .frame(width: from.width, height: from.height)
                    .opacity(Double(max(0, 1 - p * 4)))
            }
            .frame(width: rect.width, height: rect.height)
            .glassEffect(.regular, in: shape)
                .offset(x: rect.minX, y: rect.minY)

            page
                .frame(width: full.width, height: full.height)
                .mask {
                    shape
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX - full.minX, y: rect.minY - full.minY)
                        .frame(width: full.width, height: full.height, alignment: .topLeading)
                }
                .opacity(Double(contentIn))
                .offset(x: full.minX, y: full.minY)
                .allowsHitTesting(p > 0.99)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// `a` → `b` at the current progress.
    private func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat {
        a + (b - a) * min(max(progress, 0), 1)
    }
}

// MARK: - Thread members page

/// The page the header's name pill opens: a solid, full-screen page that the pill's
/// glass grows into (see MembersHero) while the conversation under it stays still.
/// The thread's name with a pencil to rename it, then everyone in the thread three
/// across, with an Add tile.
struct ThreadMembersPage<AddCover: View>: View {
    let topInset: CGFloat
    let onClose: () -> Void
    let title: String
    let participants: [Person]
    /// Only a group's creator or an admin — AppState.updateGroup refuses anyone else.
    let canRename: Bool
    let onRename: (String) -> Void
    /// Group threads (Edit Group) and DMs (spin up a group); job threads get none.
    let canAdd: Bool
    /// Runs as Add is tapped (blur the page behind, stand the header down).
    let onAddWillOpen: () -> Void
    /// The add-people / Edit Group cover. Presented from HERE, the visible page —
    /// not from the thread underneath it.
    @ViewBuilder let addCover: () -> AddCover
    /// Group threads you're in. Leaving drops you from the group and returns to the
    /// inbox — there's nothing left to show here once you're out.
    var canLeave: Bool = false
    var onLeave: () -> Void = {}

    @State private var showAdd = false
    @State private var showLeaveConfirm = false
    @State private var renaming = false
    @State private var draftName = ""
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 16), count: 3)

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                HStack(spacing: 10) {
                    Text(title)
                        .font(TTypo.h3(28))
                        .tracking(-1.3)
                        .foregroundStyle(Color(hex: T.ink))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    if canRename {
                        Button {
                            draftName = title
                            renaming = true
                        } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 34, height: 34)
                        }
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .accessibilityLabel("Rename group")
                    }
                }
                .padding(.horizontal, 20)

                LazyVGrid(columns: columns, spacing: 24) {
                    ForEach(participants, id: \.id) { p in
                        VStack(spacing: 8) {
                            Avatar(initials: Initials.from(p.name), size: 80,
                                   fill: .personFill(p.color), imageData: p.image)
                            Text(p.name)
                                .font(TTypo.sm(13))
                                .foregroundStyle(Color(hex: T.ink))
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }
                    if canAdd {
                        // Only the glyph is the button; the caption sits under it.
                        VStack(spacing: 8) {
                            GlassKey(size: 80) {
                                onAddWillOpen()
                                withTransaction(Transaction.noAnimation) { showAdd = true }
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 26, weight: .semibold))
                                    .foregroundStyle(Color(hex: T.ink))
                            }
                            .accessibilityLabel("Add people")
                            Text("Add")
                                .font(TTypo.sm(13))
                                .foregroundStyle(Color(hex: T.ink))
                                .accessibilityHidden(true)
                        }
                    }
                }
                .padding(.horizontal, 20)

                if canLeave {
                    // Apple's Liquid Glass button, in red: leaving is the one
                    // destructive thing on this page.
                    Button(role: .destructive) { showLeaveConfirm = true } label: {
                        Label("Leave Group", systemImage: "rectangle.portrait.and.arrow.right")
                            .font(TTypo.smBold(16))
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                }
            }
            .padding(.top, topInset + 64)   // under the back button
            .padding(.bottom, 32)
        }
        .scrollBounceBehavior(.basedOnSize)
        // The back button sits exactly where the thread's does, so one hands over
        // to the other in place as the page grows.
        .overlay(alignment: .topLeading) {
            GlassKey(size: HeaderControl.diameter, action: onClose) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
            }
            .accessibilityLabel("Back")
            .padding(.leading, 16)
            .padding(.top, topInset + 18)
        }
        .confirmationDialog("Leave this group?", isPresented: $showLeaveConfirm, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { onLeave() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("You'll stop receiving messages from this group.")
        }
        .alert("Rename Group", isPresented: $renaming) {
            TextField("Group name", text: $draftName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { onRename(draftName) }
        }
        .fullScreenCover(isPresented: $showAdd) { addCover() }
    }
}

/// Up to three overlapping avatar circles. If more than three participants
/// exist, the fourth slot becomes a "+N" indicator instead of the next avatar.
private struct ParticipantStack: View {
    let people: [Person]
    var avatarSize: CGFloat = 28
    /// Nil = tuck them tightly, proportional to the avatar size. Scaling with the
    /// size is the point: a fixed overlap that looks right on a 26pt avatar leaves
    /// a 34pt one strung out, which is how the inbox and the thread header ended up
    /// with visibly different clusters.
    var overlap: CGFloat? = nil
    var maxShown: Int = 3

    /// Each avatar shows ~40% of its width, so three read as one clustered mark
    /// rather than three separate circles.
    private var effectiveOverlap: CGFloat { overlap ?? avatarSize * 0.6 }

    var body: some View {
        HStack(spacing: -effectiveOverlap) {
            ForEach(Array(people.prefix(maxShown).enumerated()), id: \.element.id) { _, p in
                // Each member's real avatar: their photo if set, else their
                // preferred color (not a generic brand gradient).
                Avatar(initials: initials(p.name),
                       size: avatarSize,
                       fill: .personFill(p.color),
                       imageData: p.image)
                    .overlay(Circle().stroke(Color(hex: T.surface), lineWidth: 2))
            }
            if people.count > maxShown {
                ZStack {
                    Circle().fill(Color(hex: T.surface))
                    Text("+\(people.count - maxShown)")
                        .font(TTypo.xsBold(11))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                }
                .frame(width: avatarSize, height: avatarSize)
                .overlay(Circle().stroke(Color(hex: T.surface), lineWidth: 2))
            }
        }
    }

    private func initials(_ name: String) -> String { Initials.from(name) }
}

// MARK: - Add People Popup (search + multi-select + Add)

/// Presented from the header popover's "Add person" pill. Lists every worker not
/// already in the thread, with search and multi-select; the CTA hands the picked
/// ids back to the caller.
// MARK: - Member picker grid
//
// The 3-up grid of square person cards shared by New Group and Edit Group, so the
// two can't drift apart. Three per row keeps the photo readable and a full first
// name visible while a whole roster still scans in a few rows.
//
// The caller decides who's listed — neither sheet lists the viewer, because both
// save paths keep them a member regardless, so selecting yourself did nothing.
struct MemberPickerGrid: View {
    let people: [Person]
    @Binding var selectedIds: Set<String>

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3),
                  spacing: 10) {
            ForEach(people) { person in
                card(person)
            }
        }
    }

    /// Profile photo (initials when there's none) over the first name, with
    /// selection carried by the card itself rather than a separate checkmark row.
    @ViewBuilder
    private func card(_ person: Person) -> some View {
        let selected = selectedIds.contains(person.id)
        Button {
            if selected { selectedIds.remove(person.id) } else { selectedIds.insert(person.id) }
        } label: {
            VStack(spacing: 8) {
                Avatar(initials: MemberPickerGrid.initials(person),
                       size: 46,
                       fill: .personFill(person.color),
                       imageData: person.image)
                    .overlay(alignment: .bottomTrailing) {
                        if selected {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(Color(hex: T.accent), Color(hex: T.surface))
                                .offset(x: 3, y: 3)
                        }
                    }

                // First name only — a full name wraps at this width and leaves the
                // cards uneven heights.
                Text(person.name.split(separator: " ").first.map(String.init) ?? person.name)
                    .font(.caption.bold())
                    .foregroundColor(Color(hex: selected ? T.accent : T.text))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .padding(.horizontal, 6)
            .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                .fill(selected ? Color(hex: T.accent).opacity(0.12) : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                .strokeBorder(selected ? Color(hex: T.accent) : Color(hex: T.border),
                              lineWidth: selected ? 2 : 1))
            .contentShape(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    static func initials(_ p: Person) -> String { Initials.from(p) }
}

// MARK: - Edit Group Popup
//
// iOS parity with the web's Edit Group modal: rename the group and add OR REMOVE
// members. Group threads previously only had the add-only picker, which could add
// and nothing else — no rename, no removal.
//
// A glass popup, not the full screen it used to slide up: this is reached from a
// pill in the thread's own header, and taking the whole conversation away to
// tick two names never matched the size of the job.
struct EditGroupPopup: View {
    @Environment(AppState.self) private var appState
    /// Observed so the Save button's LABEL colour follows its paint when the
    /// frosted-glass toggle flips.
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss

    let group: ChatGroup
    /// (name, memberIds) — name may be empty, meaning "title it after its members".
    let onSave: (String, [String]) -> Void

    @State private var name: String
    @State private var selectedIds: Set<String>
    @State private var showLeaveConfirm = false
    @State private var showDeleteConfirm = false
    /// Drives the entrance spring — see `modalPopAnimation`.
    @State private var appear = false

    init(group: ChatGroup, onSave: @escaping (String, [String]) -> Void) {
        self.group = group
        self.onSave = onSave
        _name = State(initialValue: group.name)
        _selectedIds = State(initialValue: Set(group.memberIds))
    }

    private var others: [Person] {
        appState.people.filter { $0.id != appState.currentPersonId }
    }

    /// Live preview of the title this group falls back to with the name cleared.
    private var namePlaceholder: String {
        ChatGroup.memberNamesLine(memberIds: Array(selectedIds),
                                  people: appState.people,
                                  myId: appState.currentPersonId)
    }

    var body: some View {
        observeTheme
        return ZStack {
            // Tap out to cancel: nothing is persisted until Save.
            ModalScrim { close() }
            card.modalPop(appear)
        }
        .presentationBackground(.clear)
        .onAppear { withAnimation(modalPopAnimation) { appear = true } }
        .confirmationDialog("Leave this group?", isPresented: $showLeaveConfirm, titleVisibility: .visible) {
            Button("Leave", role: .destructive) {
                guard let me = appState.currentPersonId else { return }
                close { Task { await appState.removeGroupMember(groupId: group.id, personId: me) } }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("You'll stop receiving messages from this group.")
        }
        .confirmationDialog("Delete this group?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                close { Task { await appState.deleteGroup(id: group.id) } }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes the group for everyone in it.")
        }
    }

    // MARK: Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Edit Group")
                .font(TTypo.h3(20))
                .foregroundStyle(Color(hex: T.ink))

            // See AddPeoplePopup — HugScroll, never ViewThatFits, because this
            // card holds a text field.
            HugScroll {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Text("GROUP NAME")
                                .font(TTypo.xsBold(10))
                                .tracking(1)
                                .foregroundStyle(Color(hex: T.muted))
                            Text("OPTIONAL")
                                .font(TTypo.xsBold(10))
                                .tracking(1)
                                .foregroundStyle(Color(hex: T.muted).opacity(0.7))
                        }

                        TextField(namePlaceholder, text: $name)
                            .textFieldStyle(.plain)
                            .font(TTypo.smBold(14))
                            .foregroundStyle(Color(hex: T.ink))
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .background(Capsule(style: .continuous).fill(Color(hex: T.surface)))
                            .overlay(Capsule(style: .continuous).strokeBorder(Color(hex: T.hair), lineWidth: 1))

                        Text("Clear it to go back to naming the group after its members.")
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("MEMBERS")
                            .font(TTypo.xsBold(10))
                            .tracking(1)
                            .foregroundStyle(Color(hex: T.muted))
                        MemberPickerGrid(people: others, selectedIds: $selectedIds)
                    }
                }
            }

            saveButton

            // Leaving and deleting stay at the foot of the card. They're the two
            // things you can't do anywhere else, so they travel with the roster
            // rather than being dropped in the move off a full screen.
            VStack(spacing: 2) {
                Button { showLeaveConfirm = true } label: {
                    Label("Leave Group", systemImage: "rectangle.portrait.and.arrow.right")
                        .font(TTypo.smBold(14))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .foregroundStyle(Color(hex: T.amber))
                }
                .buttonStyle(.plain)

                if appState.canAdministerGroup(group) {
                    Button { showDeleteConfirm = true } label: {
                        Label("Delete Group", systemImage: "trash")
                            .font(TTypo.smBold(14))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .foregroundStyle(Color(hex: T.danger))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(T.insetHero)
        .padding(.top, 46)   // headroom for the cancel X
        .frame(maxWidth: 380)
        .glassPanel()
        .overlay(alignment: .topLeading) { cancelX }
        .padding(.horizontal, 24)
        .padding(.vertical, 40)
    }

    private var saveButton: some View {
        Button {
            guard !selectedIds.isEmpty else { return }
            // The viewer stays a member whether or not they're in selectedIds —
            // they're never listed in the grid.
            var members = Array(selectedIds)
            if let me = appState.currentPersonId, !members.contains(me) {
                members.insert(me, at: 0)
            }
            let trimmed = name.trimmingCharacters(in: .whitespaces)
            close { onSave(trimmed, members) }
        } label: {
            // Disabled is the native style's own dimming, via .disabled below.
            Text("Save Changes")
                .font(TTypo.smBold(15))
                .foregroundStyle(glassCTALabel())
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
        }
        .nativeGlass(.rounded(T.cornerLg), prominent: true)
        .disabled(selectedIds.isEmpty)
        .animation(.easeInOut(duration: 0.18), value: selectedIds.isEmpty)
    }

    private var cancelX: some View {
        Button { close() } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color(hex: T.ink))
                .frame(width: 22, height: 22)
        }
        .nativeGlass(.circle)
        .padding(18)
    }

    /// See AddPeoplePopup.close — same exit, same reason for the noAnimation.
    private func close(then finish: @escaping () -> Void = {}) {
        modalPopDismiss({ appear = $0 }) {
            withTransaction(Transaction.noAnimation) { dismiss() }
            finish()
        }
    }

    private var observeTheme: Void { _ = theme.frostedGlass; _ = theme.accent }
}

struct AddPeoplePopup: View {
    @Environment(AppState.self) private var appState
    /// Observed so the Add button's LABEL colour follows its paint when the
    /// frosted-glass toggle flips — see NewMessageSheet's note on the same button.
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss
    let excludedIds: Set<String>
    let onAdd: ([String]) -> Void

    @State private var selected: Set<String> = []
    @State private var search = ""
    @State private var searchFocusedFlag = false
    @FocusState private var searchFocused: Bool
    /// Drives the entrance spring — see `modalPopAnimation`.
    @State private var appear = false

    private var candidates: [Person] {
        appState.people
            .filter { !excludedIds.contains($0.id) }
            .filter { search.isEmpty
                || $0.name.localizedCaseInsensitiveContains(search)
                || $0.role.localizedCaseInsensitiveContains(search) }
            .sorted { $0.name < $1.name }
    }

    var body: some View {
        observeTheme
        return ZStack {
            // Tap out to cancel: nothing has happened yet, the people are only
            // added from the CTA. The thread behind is blurred by MainTabView via
            // appNav.modalBlur — this cover is its own presentation and so can't
            // blur the page itself.
            ModalScrim { close() }
            card.modalPop(appear)
        }
        .presentationBackground(.clear)   // let the conversation show through
        .onAppear { withAnimation(modalPopAnimation) { appear = true } }
    }

    // MARK: Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add People")
                .font(TTypo.h3(20))
                .foregroundStyle(Color(hex: T.ink))

            // Sized to its content, scrolling only once the roster can't fit, so
            // the popup is exactly as tall as it needs to be.
            //
            // `HugScroll`, NOT `ViewThatFits`: this card holds a text field, and a
            // ViewThatFits flips branches the moment the keyboard changes the
            // offered height, which rebuilds the field and drops its focus. See
            // "Popups that hold a text field" in Primitives.
            HugScroll {
                VStack(alignment: .leading, spacing: 12) {
                    searchPill
                    // The same 3-up grid New Message and Edit Group use, not the
                    // full-width rows this was: rows were sized for a whole screen
                    // and only three of them fit a popup.
                    MemberPickerGrid(people: candidates, selectedIds: $selected)
                    if candidates.isEmpty {
                        Text(search.isEmpty ? "No one left to add." : "No matches.")
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                    }
                }
            }

            addButton
        }
        .padding(T.insetHero)
        // Headroom for the cancel X — the same 46pt every other popup reserves, so
        // the title clears a 36pt button inset 18pt from a 46pt corner.
        .padding(.top, 46)
        .frame(maxWidth: 380)
        .glassPanel()
        .overlay(alignment: .topLeading) { cancelX }
        .padding(.horizontal, 24)
        // Room top and bottom so a tall roster can't reach the screen edges; the
        // HugScroll above starts scrolling before it gets there.
        .padding(.vertical, 40)
    }

    private var searchPill: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: T.muted))
            TextField("Search workers", text: $search)
                .textFieldStyle(.plain)
                .font(TTypo.sm(14))
                .foregroundStyle(Color(hex: T.ink))
                .focused($searchFocused)
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color(hex: T.muted))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Capsule(style: .continuous).fill(Color(hex: T.surface)))
        .overlay(Capsule(style: .continuous).strokeBorder(Color(hex: T.hair), lineWidth: 1))
    }

    private var addButton: some View {
        Button {
            let ids = Array(selected)
            close { onAdd(ids) }
        } label: {
            // Disabled is the native style's own dimming, via .disabled below.
            HStack(spacing: 7) {
                Image(systemName: "plus").font(.system(size: 15, weight: .bold))
                Text(selected.isEmpty ? "Add" : "Add (\(selected.count))").font(TTypo.smBold(15))
            }
            .foregroundStyle(glassCTALabel())
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
        }
        .nativeGlass(.rounded(T.cornerLg), prominent: true)
        .disabled(selected.isEmpty)
        .animation(.easeInOut(duration: 0.18), value: selected.isEmpty)
    }

    /// Cancel, anchored INSIDE the card's top-left (attached after the glass but
    /// before the outer padding, so it sits on the card rather than floating out
    /// in the backdrop).
    private var cancelX: some View {
        Button { close() } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color(hex: T.ink))
                .frame(width: 22, height: 22)
        }
        .nativeGlass(.circle)
        .padding(18)
    }

    /// The shared modal exit: shrink and fade, and only once that has actually
    /// finished let the presenter tear the cover down. The teardown is wrapped in
    /// `.noAnimation` for the same reason the presentation is — otherwise the
    /// cover slides back DOWN over a card that has already faded itself out.
    private func close(then finish: @escaping () -> Void = {}) {
        modalPopDismiss({ appear = $0 }) {
            withTransaction(Transaction.noAnimation) { dismiss() }
            finish()
        }
    }

    /// Touched in `body` so a live frosted-glass flip re-renders the Add button's
    /// label colour. See the property.
    private var observeTheme: Void { _ = theme.frostedGlass; _ = theme.accent }
}

// MARK: - New Group Sheet

struct NewGroupSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    /// Callback receives the group name and the selected member IDs.
    /// Previously the sheet only handed back the name, which silently
    /// dropped the member selection — the caller had no way to persist
    /// the group to the server.
    let onCreate: (String, [String]) -> Void

    @State private var groupName = ""
    @State private var selectedIds: Set<String> = []

    private var others: [Person] {
        appState.people.filter { $0.id != appState.currentPersonId }
    }

    /// The placeholder doubles as a live preview of the title this group will get if
    /// the field is left empty, so "optional" doesn't read as "unnamed".
    private var namePlaceholder: String {
        selectedIds.isEmpty
            ? "Optional — named after its members"
            : ChatGroup.memberNamesLine(memberIds: Array(selectedIds),
                                        people: appState.people,
                                        myId: appState.currentPersonId)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                PageBackground()

                ScrollView {
                    VStack(spacing: 24) {
                        VStack(spacing: 8) {
                            ZStack {
                                Circle()
                                    .fill(Color(hex: T.accent).opacity(0.12))
                                    .frame(width: 64, height: 64)
                                Image(systemName: "person.3.fill")
                                    .font(.system(size: 26))
                                    .foregroundColor(Color(hex: T.accent))
                            }
                            Text("New Group")
                                .font(.title3.bold())
                                .foregroundColor(Color(hex: T.text))
                        }
                        .padding(.top, 16)

                        // Group name — OPTIONAL. Left blank, the group takes its
                        // title from its members (ChatGroup.displayName), which is
                        // also what the web has always done.
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text("Group Name")
                                    .font(.caption.bold())
                                    .foregroundColor(Color(hex: T.muted))
                                Text("OPTIONAL")
                                    .font(.caption2.bold())
                                    .foregroundColor(Color(hex: T.muted).opacity(0.7))
                            }
                            .padding(.horizontal, 16)
                            TextField(namePlaceholder, text: $groupName)
                                .textFieldStyle(.plain)
                                .foregroundColor(Color(hex: T.text))
                                .padding(12)
                                .background(Color(hex: T.surface))
                                .cornerRadius(T.cornerSm)
                                .overlay(RoundedRectangle(cornerRadius: T.cornerSm).stroke(Color(hex: T.border), lineWidth: 1))
                                .padding(.horizontal, 16)
                        }

                        // Member selection
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Add Members")
                                .font(.caption.bold())
                                .foregroundColor(Color(hex: T.muted))
                                .padding(.horizontal, 16)

                            MemberPickerGrid(people: others, selectedIds: $selectedIds)
                                .padding(.horizontal, 16)
                        }

                        Button {
                            // Members, not the name, are what a group needs — an
                            // empty name is passed straight through and means
                            // "derive the title from the members".
                            guard !selectedIds.isEmpty else { return }
                            let name = groupName.trimmingCharacters(in: .whitespaces)
                            // Always include the current user in the
                            // group; selectedIds only contains the OTHER
                            // people the creator picked.
                            var members = Array(selectedIds)
                            if let me = appState.currentPersonId, !members.contains(me) {
                                members.insert(me, at: 0)
                            }
                            dismiss()
                            onCreate(name, members)
                        } label: {
                            Text("Create Group")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(selectedIds.isEmpty ? Color(hex: T.border) : Color(hex: T.accent))
                                .foregroundColor(T.onAccent)
                                .cornerRadius(T.cornerSm)
                        }
                        .buttonStyle(.plain)
                        .disabled(selectedIds.isEmpty)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
            }
            .navigationTitle("New Group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(Color(hex: T.accent))
                }
            }
        }
    }

}

// MARK: - New DM Sheet

struct NewDMSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let onSelect: (String) -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                PageBackground()
                List {
                    ForEach(appState.people.filter { $0.id != appState.currentPersonId }) { person in
                        Button {
                            dismiss()
                            onSelect(person.id)
                        } label: {
                            HStack(spacing: 12) {
                                Circle()
                                    .fill(Color(hex: person.color))
                                    .frame(width: 36, height: 36)
                                    .overlay(
                                        Text(Initials.from(person))
                                            .font(.subheadline.bold())
                                            .foregroundColor(Color(hex: person.color).readableText)
                                    )
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(person.name)
                                        .font(.subheadline.bold())
                                        .foregroundColor(Color(hex: T.text))
                                    Text(person.role)
                                        .font(.caption)
                                        .foregroundColor(Color(hex: T.muted))
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: T.muted))
                            }
                        }
                        .listRowBackground(Color(hex: T.card))
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("New Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(Color(hex: T.accent))
                }
            }
        }
    }
}

// MARK: - New Message Sheet (unified: 1 recipient = DM, 2+ = group)

struct NewMessageSheet: View {
    @Environment(AppState.self) private var appState
    /// Observed so the Create button's LABEL colour follows its paint when the
    /// frosted-glass toggle flips (the background observes itself, the
    /// foreground can't — see the button below).
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss
    /// (recipientIds excluding me, groupName) — groupName is nil for a 1:1 DM.
    let onStart: ([String], String?) -> Void

    @State private var selectedIds: Set<String> = []
    @State private var query = ""
    /// Optional, and only meaningful once this is a group — one recipient is a DM.
    @State private var groupName = ""
    /// Search starts collapsed to a circle once there's a group name to show.
    @State private var searchOpen = false
    @FocusState private var searchFocused: Bool

    private var others: [Person] {
        let base = appState.people.filter { $0.id != appState.currentPersonId }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return base }
        return base.filter { $0.name.lowercased().contains(q) || $0.role.lowercased().contains(q) }
    }
    private var isGroup: Bool { selectedIds.count > 1 }

    /// Whether the name field owns the top row, with search demoted to a circle.
    ///
    /// Requires a group to name, search not open (two side-by-side text fields in
    /// one row is too tight to type in), AND an empty query — with a query live the
    /// grid is filtered, and collapsing the box that explains why would leave
    /// people looking like they'd vanished.
    private var nameHasTheRow: Bool {
        isGroup && !searchOpen && query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Circular search button — expands into the full-width field.
    private var searchCircle: some View {
        Button {
            searchOpen = true
            searchFocused = true
        } label: {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(hex: T.ink))
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color(hex: T.surface)))
                .overlay(Circle().strokeBorder(Color(hex: T.hair), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    /// Full-width search field. Carries a collapse button only when there's a name
    /// pill to collapse BACK to — otherwise it's the row's only occupant.
    private var searchPill: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: T.muted))
            TextField("Search people", text: $query)
                .textFieldStyle(.plain)
                .font(TTypo.sm(14))
                .foregroundStyle(Color(hex: T.ink))
                .focused($searchFocused)
            if isGroup {
                Button {
                    query = ""
                    searchOpen = false
                    searchFocused = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color(hex: T.muted))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Capsule(style: .continuous).fill(Color(hex: T.surface)))
        .overlay(Capsule(style: .continuous).strokeBorder(Color(hex: T.hair), lineWidth: 1))
    }

    /// Pill-shaped group name field, filling the row beside the search circle.
    private var groupNamePill: some View {
        TextField("Group Name…", text: $groupName)
            .textFieldStyle(.plain)
            .font(TTypo.smBold(14))
            .foregroundStyle(Color(hex: T.ink))
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Capsule(style: .continuous).fill(Color(hex: T.surface)))
            .overlay(Capsule(style: .continuous).strokeBorder(Color(hex: T.hair), lineWidth: 1))
    }

    /// Drives the entrance spring — see `modalPopAnimation`.
    @State private var appear = false

    var body: some View {
        observeTheme
        // The glass-popup idiom every other modal here uses (Start Job, Request
        // Time Off, the panel photo sheet): a scrim over the page, a glass card
        // springing in over it. This was a full-screen sheet with its own
        // PageBackground and a 46pt page title, which read as a whole SCREEN —
        // picking two names and hitting Create never warranted leaving the inbox.
        return ZStack {
            // Tap out to cancel: nothing has happened yet, the thread is only
            // created from the CTA. The page behind is blurred by MainTabView via
            // appNav.modalBlur — this cover is its own presentation and so can't
            // blur the page itself.
            ModalScrim { close() }

            card.modalPop(appear)
        }
        .presentationBackground(.clear)   // let the inbox show through
        .onAppear { withAnimation(modalPopAnimation) { appear = true } }
    }

    // MARK: Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("New Message")
                .font(TTypo.h3(20))
                .foregroundStyle(Color(hex: T.ink))

            // Sized to its content, scrolling only once the roster can't fit, so
            // the popup is exactly as tall as it needs to be.
            //
            // `HugScroll`, NOT `ViewThatFits`: this card holds text fields (search
            // and the group name), and a ViewThatFits flips branches the moment the
            // keyboard changes the offered height, which rebuilds the field and
            // drops its focus. See "Popups that hold a text field" in Primitives.
            HugScroll {
                VStack(alignment: .leading, spacing: 10) {
                    // Top row. Once this is a group the name is the headline control
                    // and search shrinks to a circle beside it; with nothing to name,
                    // or while searching, search takes the whole row.
                    HStack(spacing: 10) {
                        if nameHasTheRow {
                            searchCircle
                            groupNamePill
                        } else {
                            searchPill
                        }
                    }
                    .animation(.spring(response: 0.34, dampingFraction: 0.82), value: nameHasTheRow)

                    // Same card grid as New Group / Edit Group.
                    MemberPickerGrid(people: others, selectedIds: $selectedIds)

                    if others.isEmpty {
                        Text("No people match \u{201C}\(query)\u{201D}")
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                    }
                }
                .animation(.easeInOut(duration: 0.18), value: isGroup)
            }

            // At the foot of the CARD now, not pinned to the screen. A bar floating
            // over a popup this size would have covered the roster it existed to
            // keep reachable.
            // Same accent-filled Liquid Glass as Clock In, Start and Start Job —
            // this is the one action the popup exists for. Disabled is the native
            // style's own dimming, via .disabled below.
            Button { start() } label: {
                HStack(spacing: 7) {
                    Image(systemName: "plus").font(.system(size: 15, weight: .bold))
                    Text("Create").font(TTypo.smBold(15))
                }
                // Prominent glass is filled with the FLAT accent, so the label is
                // judged against that.
                .foregroundStyle(glassCTALabel())
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
            }
            .nativeGlass(.rounded(T.cornerLg), prominent: true)
            .disabled(selectedIds.isEmpty)
            .animation(.easeInOut(duration: 0.18), value: selectedIds.isEmpty)
        }
        .padding(T.insetHero)
        // Headroom for the cancel X — the same 46pt every other popup reserves, so
        // the title clears a 36pt button inset 18pt from a 46pt corner.
        .padding(.top, 46)
        .frame(maxWidth: 380)
        .glassPanel()
        // Cancel, anchored INSIDE the card's top-left (attached after the glass but
        // before the outer padding, so it sits on the card rather than floating out
        // in the backdrop). Replaces the old floating Cancel button.
        .overlay(alignment: .topLeading) {
            Button { close() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color(hex: T.ink))
                    .frame(width: 22, height: 22)
            }
            .nativeGlass(.circle)
            .padding(18)
        }
        .padding(.horizontal, 24)
        // Room top and bottom so a tall roster can't reach the screen edges; the
        // HugScroll above starts scrolling before it gets there.
        .padding(.vertical, 40)
    }

    /// Touched in `body` so a live frosted-glass flip re-renders the Create
    /// button's label colour. See the property.
    private var observeTheme: Void { _ = theme.frostedGlass; _ = theme.accent }

    private func start() {
        let ids = Array(selectedIds)
        guard !ids.isEmpty else { return }
        // nil for a DM (nothing to name) and for a group left unnamed, which then
        // derives its title from its members — that stays correct as people are
        // added, where a snapshot taken now would go stale.
        let trimmed = groupName.trimmingCharacters(in: .whitespaces)
        let name: String? = (ids.count > 1 && !trimmed.isEmpty) ? trimmed : nil
        // Animate out first, THEN hand the thread to the presenter — otherwise the
        // card is torn down mid-curve and the navigation push races the exit.
        close { onStart(ids, name) }
    }

    /// The shared modal exit: shrink and fade, and only once that has actually
    /// finished let the presenter tear the cover down.
    ///
    /// The teardown is wrapped in `.noAnimation` for the same reason the
    /// presentation is — otherwise the cover slides back DOWN over a card that has
    /// already faded itself out.
    private func close(then finish: @escaping () -> Void = {}) {
        modalPopDismiss({ appear = $0 }) {
            withTransaction(Transaction.noAnimation) { dismiss() }
            finish()
        }
    }

}

// MARK: - Helpers

extension String {
    /// Compact stamp used on the tap-to-reveal message timestamp.
    /// Today → "2:34 PM" · Yesterday → "Yesterday" · earlier → "May 24"
    /// (or "May 24, 2025" if not in the current year). Different from
    /// `shortTimestamp` (used in the thread list, which keeps date+time
    /// so older threads still show a sortable cue at a glance).
    var messageStamp: String {
        guard let date = Date.fromFlexibleISO8601(self) else { return self }
        let cal = Calendar.current
        let df = DateFormatter()
        if cal.isDateInToday(date) {
            df.dateFormat = "h:mm a"
            return df.string(from: date)
        }
        if cal.isDateInYesterday(date) {
            return "Yesterday"
        }
        if cal.component(.year, from: date) == cal.component(.year, from: Date()) {
            df.dateFormat = "MMM d"
        } else {
            df.dateFormat = "MMM d, yyyy"
        }
        return df.string(from: date)
    }

    /// Date stamp for the inbox thread list. Today → "Today at 9:30PM";
    /// any earlier day → full month + day, e.g. "June 30".
    var threadDateStamp: String {
        guard let date = Date.fromFlexibleISO8601(self) else { return self }
        let cal = Calendar.current
        let df = DateFormatter()
        if cal.isDateInToday(date) {
            df.dateFormat = "h:mma"          // "9:30PM"
            return "Today at \(df.string(from: date))"
        }
        // Include the year outside the current year (matches sectionStamp) so an
        // old thread doesn't read as the same "June 30" as this year's.
        df.dateFormat = cal.component(.year, from: date) == cal.component(.year, from: Date())
            ? "MMMM d" : "MMMM d, yyyy"
        return df.string(from: date)
    }

    /// Header for an in-thread message cluster, marking when it started.
    /// Today → "Today at 9:30PM" · yesterday → "Yesterday at 9:30PM" ·
    /// earlier this year → "June 30 at 2:15PM" · older → "June 30, 2025 at 2:15PM".
    var sectionStamp: String {
        guard let date = Date.fromFlexibleISO8601(self) else { return self }
        let cal = Calendar.current
        let time = DateFormatter(); time.dateFormat = "h:mma"
        let t = time.string(from: date)
        if cal.isDateInToday(date) { return "Today at \(t)" }
        if cal.isDateInYesterday(date) { return "Yesterday at \(t)" }
        let day = DateFormatter()
        day.dateFormat = cal.component(.year, from: date) == cal.component(.year, from: Date())
            ? "MMMM d" : "MMMM d, yyyy"
        return "\(day.string(from: date)) at \(t)"
    }
}

/// The transcript's scroll geometry, as the follow-the-bottom rule reads it:
/// content height, and how far the visible bottom sits above the content's end.
struct TranscriptGeometry: Equatable {
    let height: CGFloat
    let fromBottom: CGFloat
}

// MARK: - Cached photo thumbnail

/// A remote image held in memory once loaded, so a photo seen once never
/// reloads — scrolling back to it, or reopening the thread, draws it at once.
/// AsyncImage re-fetched every time its row was rebuilt. Fills whatever frame
/// the caller gives it; shows a quiet placeholder until loaded and `failure`
/// if it can't be.
struct CachedThumbnail<Failure: View>: View {
    let url: URL
    @ViewBuilder var failure: () -> Failure
    @State private var image: UIImage?
    @State private var failed = false

    private static var cache: NSCache<NSURL, UIImage> {
        ThumbnailCache.shared
    }

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if failed {
                failure()
            } else {
                Rectangle().fill(Color(hex: T.surface))
                ProgressView().tint(Color(hex: T.muted))
            }
        }
        .task(id: url) {
            if let hit = Self.cache.object(forKey: url as NSURL) { image = hit; return }
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                // Decoded and downsized OFF the main thread: a full-size photo
                // decoded on main is a dropped frame per thumbnail. 440pt covers
                // the 220pt square at 2×.
                let decoded = await Task.detached(priority: .userInitiated) {
                    guard let full = UIImage(data: data) else { return nil as UIImage? }
                    // Aspect kept: the SHORT side becomes 440, as the square crop needs.
                    let k = 440 / max(1, min(full.size.width, full.size.height))
                    guard k < 1 else { return full }
                    return full.preparingThumbnail(of: CGSize(width: full.size.width * k,
                                                              height: full.size.height * k))
                }.value
                guard let img = decoded else { failed = true; return }
                Self.cache.setObject(img, forKey: url as NSURL)
                image = img
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }
}

enum ThumbnailCache {
    static let shared: NSCache<NSURL, UIImage> = {
        let c = NSCache<NSURL, UIImage>()
        c.countLimit = 200
        return c
    }()
}

/// The transcript's page size — see `shownCount`.
enum MessagePage {
    static let size = 150
}
