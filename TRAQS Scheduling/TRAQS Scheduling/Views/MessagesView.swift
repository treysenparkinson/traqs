import SwiftUI
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import QuickLook

// MARK: - Chat V1 (Inbox) · TRAQS Light
// Inbox / channel list. DMs + group threads.

enum ChatFilter: String, CaseIterable, Hashable {
    case all, unread, dms, groups, mentions
    var label: String {
        switch self {
        case .all:      return "All"
        case .unread:   return "Unread"
        case .dms:      return "DMs"
        case .groups:   return "Groups"
        case .mentions: return "Mentions"
        }
    }
}

struct MessagesView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav
    @State private var showNewGroup = false
    @State private var showNewDM = false
    @State private var showNewMessage = false   // unified compose: 1 = DM, 2+ = group
    @State private var filter: ChatFilter = .all
    @State private var navigationPath = NavigationPath()
    @State private var searchText = ""
    @State private var showSearch = false
    @FocusState private var searchFocused: Bool

    // Bulk-select / delete state. When `selectMode` is on, rows render
    // a checkbox indicator instead of navigating on tap, and the top
    // bar swaps its icons for [Done, Delete].
    @State private var selectMode = false
    @State private var selectedKeys: Set<String> = []
    @State private var showDeleteConfirm = false

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
            .filter { key, _ in
                Self.canViewThread(key,
                                   myId: myId,
                                   jobs: appState.jobs,
                                   groups: appState.groups)
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
    static func canViewThread(_ threadKey: String,
                              myId: String?,
                              jobs: [Job],
                              groups: [ChatGroup]) -> Bool {
        guard let myId, !myId.isEmpty else { return false }
        if threadKey.hasPrefix("dm:") {
            return threadKey.dropFirst(3)
                .components(separatedBy: "_")
                .contains(myId)
        }
        if threadKey.hasPrefix("group:") {
            let ref = String(threadKey.dropFirst(6))
            guard let g = groups.first(where: { $0.name == ref || $0.id == ref })
            else { return false }
            return g.memberIds.contains(myId)
        }
        if threadKey.hasPrefix("job:") {
            let jobId = String(threadKey.dropFirst(4))
            return jobs.first(where: { $0.id == jobId }).map { userInJob(myId, $0) } ?? false
        }
        if threadKey.hasPrefix("panel:") {
            let panelId = String(threadKey.dropFirst(6))
            return jobs.first(where: { j in j.subs.contains(where: { $0.id == panelId }) })
                .map { userInJob(myId, $0) } ?? false
        }
        if threadKey.hasPrefix("op:") {
            let opId = String(threadKey.dropFirst(3))
            for j in jobs {
                for p in j.subs where p.subs.contains(where: { $0.id == opId }) {
                    return userInJob(myId, j)
                }
            }
            return false
        }
        return false
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
            return appState.groups.first(where: { $0.id == ref || $0.name == ref })?.name
        }
        return nil
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack {
                AmbientBackground()

                VStack(spacing: 0) {
                    // Sticky header.
                    TRAQSNavHeader {
                        if selectMode {
                            Button {
                                exitSelectMode()
                            } label: {
                                Text("Done")
                                    .font(TTypo.smBold(14))
                                    .foregroundStyle(Color(hex: T.ink))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .glassEffect(.regular.interactive(), in: Capsule())
                            }
                            .buttonStyle(.plain)

                            Button {
                                showDeleteConfirm = true
                            } label: {
                                HStack(spacing: 6) {
                                    TIconView(icon: .trash, size: 16, color: .red.readableText, weight: .bold)
                                    if !selectedKeys.isEmpty {
                                        Text("\(selectedKeys.count)")
                                            .font(TTypo.smBold(13))
                                            .foregroundStyle(.red.readableText)
                                            .tnum()
                                    }
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .glassEffect(.regular.tint(.red.opacity(selectedKeys.isEmpty ? 0.4 : 1.0)).interactive(), in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(selectedKeys.isEmpty)
                        } else {
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    selectMode = true
                                }
                            } label: {
                                Text("Select")
                                    .font(TTypo.smBold(13))
                                    .foregroundStyle(Color(hex: T.ink))
                                    .padding(.horizontal, 14)
                                    .frame(height: 36)
                                    .glassEffect(.regular.interactive(), in: Capsule())
                            }
                            .buttonStyle(.plain)

                            IconBtn(icon: .search, size: 18) {
                                withAnimation(.easeInOut(duration: 0.18)) {
                                    showSearch.toggle()
                                    if !showSearch { searchText = "" }
                                }
                                if showSearch { searchFocused = true }
                            }
                            IconBtn(icon: .plus, size: 18) {
                                showNewMessage = true   // pick recipients: 1 = DM, 2+ = group
                            }
                        }
                    }
                    .animation(.easeInOut(duration: 0.18), value: selectMode)

                    PageTitle(title: "Messages")
                        .padding(.bottom, 6)

                    if showSearch {
                        SearchBar(text: $searchText,
                                  placeholder: "Search conversations…",
                                  focused: $searchFocused,
                                  onCancel: {
                                      withAnimation(.easeInOut(duration: 0.18)) {
                                          showSearch = false
                                          searchText = ""
                                      }
                                  })
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    // Inbox + a floating liquid-glass filter FAB (bottom-right)
                    // that opens a native menu of chat filters.
                    ZStack(alignment: .topTrailing) {
                        ScrollView {
                            VStack(spacing: 0) {
                                if filteredThreads.isEmpty {
                                    ChatEmptyState(filter: filter)
                                        .padding(.top, 80)
                                } else {
                                    TSectionTitle(title: "Inbox",
                                                  action: "MARK ALL READ",
                                                  onAction: { appState.markAllThreadsRead() })
                                    VStack(spacing: 12) {
                                        ForEach(filteredThreads) { t in
                                            threadRow(t)
                                                .frostedCard(radius: T.cornerMd)
                                        }
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.bottom, 96)   // clear the bottom-right filter FAB
                                }
                            }
                            .animation(.easeInOut(duration: 0.18), value: filter)
                        }
                        .scrollIndicators(.visible)
                        .topFadeMask()

                        filterFab
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            .padding(.trailing, 20)
                            .padding(.bottom, 26)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            .sheet(isPresented: $showNewMessage) {
                NewMessageSheet { recipientIds, groupName in
                    guard let myId = appState.currentPersonId, !recipientIds.isEmpty else { return }
                    if recipientIds.count == 1 {
                        let ids = [myId, recipientIds[0]].sorted()
                        navigationPath.append("dm:\(ids.joined(separator: "_"))")
                    } else {
                        var members = recipientIds
                        if !members.contains(myId) { members.insert(myId, at: 0) }
                        let name = groupName ?? "Group"
                        Task {
                            guard let g = await appState.createGroup(name: name, memberIds: members) else { return }
                            await MainActor.run { navigationPath.append("group:\(g.id)") }
                        }
                    }
                }
            }
            .alert("Delete \(selectedKeys.count) conversation\(selectedKeys.count == 1 ? "" : "s")?",
                   isPresented: $showDeleteConfirm) {
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
        .onChange(of: navigationPath.count) { _, count in
            if count == 0 { appState.activeMessageThread = nil }
        }
    }

    /// Liquid-glass filter FAB (same 62pt footprint) whose tap opens a native
    /// menu of chat filters with the current one checked.
    private var filterFab: some View {
        Menu {
            Picker("Filter", selection: $filter) {
                ForEach(ChatFilter.allCases, id: \.self) { opt in
                    Text(opt.label).tag(opt)
                }
            }
        } label: {
            TIconView(icon: .filter, size: 22, color: Color(hex: T.ink))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .frame(width: 62, height: 62)
    }

    /// Navigate to the thread named by a pending `.thread` deep link.
    private func consumeThreadDeepLink() {
        guard case let .thread(key)? = appNav.pendingDeepLink else { return }
        navigationPath = NavigationPath()
        navigationPath.append(key)
        appNav.pendingDeepLink = nil
    }

    /// Renders a single inbox row, switching between navigation mode and
    /// select-mode tap-to-toggle. Extracted so the ForEach above stays
    /// readable and the row's two modes share the same ChannelRow.
    @ViewBuilder
    private func threadRow(_ t: MessageThread) -> some View {
        let isSelected = selectedKeys.contains(t.key)
        if selectMode {
            Button {
                if isSelected { selectedKeys.remove(t.key) }
                else { selectedKeys.insert(t.key) }
            } label: {
                ChannelRow(thread: t, people: appState.people,
                           selectMode: true, isSelected: isSelected)
            }
            .buttonStyle(.plain)
        } else {
            NavigationLink(value: t.key) {
                ChannelRow(thread: t, people: appState.people,
                           selectMode: false, isSelected: false)
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

// MARK: - Channel row (DM avatar OR group # tile)

private struct ChannelRow: View {
    let thread: MessageThread
    let people: [Person]
    var selectMode: Bool = false
    var isSelected: Bool = false

    private var subtitle: String {
        thread.lastMessage.map { $0.text } ?? ""
    }
    private var avatarColor: Color {
        Color(hex: thread.lastMessage?.authorColor ?? T.muted)
    }
    private var initials: String {
        let name = thread.displayTitle
        let parts = name.split(separator: " ").prefix(2).map { String($0.prefix(1)).uppercased() }
        return parts.joined()
    }

    /// Unique participants in this thread, derived from message authorIds.
    /// Stable order by first appearance so the avatar stack doesn't shuffle
    /// across re-renders.
    private var participants: [Person] {
        var seen = Set<String>()
        var ordered: [Person] = []
        for m in thread.messages {
            guard !m.authorId.isEmpty, seen.insert(m.authorId).inserted,
                  let p = people.first(where: { $0.id == m.authorId }) else { continue }
            ordered.append(p)
        }
        return ordered
    }

    /// Date the last message was sent, shown top-right of the row.
    /// Today → "Today at 9:30PM" · any earlier day → "June 30".
    private var timeLabel: String {
        thread.lastMessage?.timestamp.threadDateStamp ?? ""
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
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
                Avatar(initials: initials, size: 46, gradient: true)
            } else if !participants.isEmpty {
                ParticipantStack(people: participants,
                                 avatarSize: 26,
                                 overlap: 10,
                                 maxShown: 3)
                    .frame(width: 46, alignment: .leading)
            } else {
                // Fallback for a thread with no decodable participants
                // (e.g. server returned messages whose authorIds don't
                // match any person we know about — shouldn't normally
                // happen, but keeps the row from rendering blank).
                Avatar(initials: "#", size: 46, gradient: true)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(thread.displayTitle)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if !timeLabel.isEmpty {
                        Text(timeLabel)
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                            .lineLimit(1)
                    }
                }
                HStack(spacing: 6) {
                    Text(subtitle)
                        .font(TTypo.xs(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if thread.unreadCount > 0 {
                        Text("\(thread.unreadCount)")
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(T.onGradient)
                            .tnum()
                            .padding(.horizontal, 7)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(Capsule().fill(T.brandGradient()))
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
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
        if key.hasPrefix("group:") { return String(key.dropFirst(6)) }
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
    @State private var showAddPeople = false            // add-people multi-select sheet?
    @State private var peopleListHeight: CGFloat = 0     // measured pill-stack height

    // Composer focus — used to re-pin the scroll to the bottom when the
    // keyboard opens (#1 auto-follow).
    @FocusState private var composerFocused: Bool

    /// Space reserved at the top of the message list for the overlay header bar.
    /// The header is rendered in a separate UIWindow (OverlayWindowController) so
    /// the keyboard can't move it; here we just leave room so messages start
    /// beneath it. (Only the bar height — the status bar is already in the safe
    /// area.) Matches OverlayWindowController.barHeight / ThreadTopBar height.
    private let overlayBarHeight: CGFloat = 108

    /// Publishes the current thread to the overlay header window. Called on
    /// appear and whenever the derived header data (title / participants) changes,
    /// since those load in asynchronously after the view first appears.
    private func publishThreadContext() {
        appState.activeMessageThread = ThreadContext(
            id: threadKey,
            title: displayTitle,
            isDM: threadKey.hasPrefix("dm:"),
            participants: threadParticipants,
            // Ask MessagesView to pop (it mutates its own navigationPath in
            // context — reliable, unlike a dismiss() captured across windows).
            // The header is then cleared when the path empties (.onChange below),
            // tying the header's exit to the actual pop.
            onBack: { appState.messagesPopRequested = true },
            onTapIdentity: {
                withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                    appState.showThreadMembers.toggle()
                }
            }
        )
    }

    // #1 auto-follow + #4 entrance animations. `baselineIds` is the set of
    // messages already present when the thread first appeared — those never
    // animate. `animatedIds` records every bubble that has already played its
    // entrance so scrolling it back into view (LazyVStack recycling) or the
    // optimistic→server id swap doesn't replay the animation.
    @State private var baselineIds: Set<String> = []
    @State private var animatedIds: Set<String> = []
    @State private var didCaptureBaseline = false
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
    private var messageSections: [MessageSection] {
        let sectionGap: TimeInterval = 60 * 60   // 1 hour
        var sections: [MessageSection] = []
        for m in liveMessages {
            if let last = sections.last, let lastMsg = last.messages.last,
               let lastDate = Date.fromFlexibleISO8601(lastMsg.timestamp),
               let thisDate = Date.fromFlexibleISO8601(m.timestamp),
               Calendar.current.isDate(thisDate, inSameDayAs: lastDate),
               thisDate.timeIntervalSince(lastDate) < sectionGap {
                sections[sections.count - 1].messages.append(m)
            } else {
                sections.append(MessageSection(id: m.id,
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
            return appState.groups.first(where: { $0.id == ref || $0.name == ref })?.name ?? ref
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

    /// Translate a UIKit keyboard animation (duration + curve from the
    /// keyboard notification's userInfo) into the closest SwiftUI animation so
    /// a scroll can ride the same timing as the keyboard. The keyboard's
    /// private curve (raw 7) has no SwiftUI equivalent — easeOut matches it
    /// closely enough that the motion reads as one synchronized movement.
    private static func keyboardAnimation(duration: Double, curveRaw: Int) -> Animation {
        switch UIView.AnimationCurve(rawValue: curveRaw) {
        case .linear:    return .linear(duration: duration)
        case .easeIn:    return .easeIn(duration: duration)
        case .easeInOut: return .easeInOut(duration: duration)
        default:         return .easeOut(duration: duration)   // .easeOut + private curve 7
        }
    }

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

    /// Report the thread read up to its newest message so the sender sees
    /// "Read". Deduped on the newest timestamp so we don't POST every poll.
    private func markThreadReadNow() async {
        let at = liveMessages.last?.timestamp ?? Date.nowISO()
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
    private var threadParticipants: [Person] {
        if threadKey.hasPrefix("dm:") {
            let ids = String(threadKey.dropFirst(3)).components(separatedBy: "_")
            return ids.compactMap { id in appState.people.first(where: { $0.id == id }) }
        }
        if threadKey.hasPrefix("group:") {
            let ref = String(threadKey.dropFirst(6))
            if let g = appState.groups.first(where: { $0.id == ref || $0.name == ref }) {
                return g.memberIds.compactMap { id in appState.people.first(where: { $0.id == id }) }
            }
        }
        let ids = Set(liveMessages.flatMap { [$0.authorId] + $0.participantIds })
        return ids.compactMap { id in appState.people.first(where: { $0.id == id }) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Flat page background, full-screen behind the status bar / home indicator.
            Color(hex: T.bg).ignoresSafeArea()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if liveMessages.isEmpty {
                            Text("No messages yet. Say hello!")
                                .font(.subheadline)
                                .foregroundColor(Color(hex: T.muted))
                                .padding(.top, 40)
                        }
                        ForEach(messageSections) { section in
                            SectionTimeHeader(text: section.header)
                            ForEach(section.messages) { msg in
                                if msg.type == "finish_request" {
                                    CompletionRequestBubble(message: msg)
                                        .id(msg.id)
                                } else if msg.type == "timeoff_request" {
                                    TimeOffRequestBubble(message: msg)
                                        .id(msg.id)
                                } else {
                                    MessageBubble(message: msg,
                                                  isMe: isMyMessage(msg),
                                                  animateIn: shouldAnimate(msg),
                                                  status: deliveryStatus(for: msg),
                                                  onAppeared: { markAnimated(msg.id) })
                                        .id(msg.id)
                                }
                            }
                        }
                        // Stable bottom anchor. Scrolling to a fixed id is far
                        // more reliable than scrolling to the last message id,
                        // which changes on the optimistic→server swap.
                        Color.clear
                            .frame(height: 1)
                            .id(Self.bottomAnchor)
                    }
                    .padding()
                }
                // Start pinned to the newest message and stay pinned as
                // content grows — the reliable iOS-17+ way to open a chat at
                // the bottom (scrollTo on a lazy trailing anchor at .onAppear
                // often no-ops because the anchor isn't realized yet).
                .defaultScrollAnchor(.bottom)
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
                    scrollToBottom(proxy, animated: true)
                    appState.markThreadRead(threadKey)   // keep inbox badge clear while viewing
                    Task { await markThreadReadNow() }
                }
                .onChange(of: liveMessages.last?.id) { scrollToBottom(proxy, animated: true) }
                // Keyboard opening shrinks the viewport — re-pin so the newest
                // message stays visible above the composer. Drive this off the
                // keyboard's OWN will-show notification (not a focus change +
                // delayed nudge) and animate with the exact duration/curve the
                // system reports, so the messages rise in lockstep with the
                // keyboard in ONE synchronized animation — no "keyboard first,
                // then text catches up" lag. keyboardWillShow fires in the same
                // runloop SwiftUI applies its keyboard inset, so scrolling to the
                // bottom anchor here targets the final (shrunk) layout and both
                // animate together.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { note in
                    let info = note.userInfo
                    let duration = (info?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
                    let curveRaw = (info?[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int) ?? UIView.AnimationCurve.easeOut.rawValue
                    withAnimation(Self.keyboardAnimation(duration: duration, curveRaw: curveRaw)) {
                        proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
                    }
                }
                .onAppear {
                    captureBaselineIfNeeded()
                    // Clear this thread's inbox unread badge the instant it's
                    // opened (observable → the inbox re-renders immediately).
                    appState.markThreadRead(threadKey)
                    // Always open on the newest message. defaultScrollAnchor(.bottom)
                    // gets us close, but a couple of non-animated nudges once the
                    // lazy content realizes its trailing anchor guarantee we land
                    // exactly at the bottom — and catch messages that load async
                    // right after open (when the count doesn't change post-appear).
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { scrollToBottom(proxy, animated: false) }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { scrollToBottom(proxy, animated: false) }
                    // Pull latest request statuses so any timeoff_request
                    // bubble shows live state + Approve/Deny (admins get all).
                    Task { await appState.refreshTimeOffRequests() }
                }
                // Reserve room at the top for the overlay header window
                // (rendered in a SEPARATE UIWindow — see OverlayWindowController —
                // so the keyboard can't displace it). Messages start beneath it.
                .safeAreaInset(edge: .top, spacing: 0) {
                    Color.clear.frame(height: overlayBarHeight)
                }
                // Composer sits at the bottom; SwiftUI's default keyboard
                // avoidance raises it while the (windowed) header stays put.
                .safeAreaInset(edge: .bottom, spacing: 0) {
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

                        HStack(spacing: 10) {
                            // Attachment button — a native liquid-glass menu of
                            // sources (camera / photo album / file).
                            Menu {
                                Button {
                                    if UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
                                    else { sendError = "No camera available on this device." }
                                } label: { Label("Take Photo", systemImage: "camera") }
                                Button { showLibrary = true } label: { Label("Photo Album", systemImage: "photo.on.rectangle") }
                                Button { showFiles = true } label: { Label("Choose File", systemImage: "doc") }
                            } label: {
                                Image(systemName: "paperclip")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(Color(hex: T.ink))
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                            .buttonStyle(.glass)
                            .buttonBorderShape(.circle)
                            .frame(width: 44, height: 44)
                            .disabled(isSending)

                            TextField("Message…", text: $newText, axis: .vertical)
                                .textFieldStyle(.plain)
                                .focused($composerFocused)
                                .font(TTypo.sm(14))
                                .foregroundColor(Color(hex: T.ink))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                                // Fixed 20pt corner radius (not a Capsule): reads as a
                                // pill on one line, but grows into a rounded-square as
                                // the text wraps — a Capsule's height/2 radius would
                                // curve the sides inward and clip the text.
                                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.ultraThinMaterial))
                                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
                                .lineLimit(1...5)

                            // Send is allowed with text OR an attachment (or both).
                            let sendDisabled = (newText.trimmingCharacters(in: .whitespaces).isEmpty && !hasAttachment) || isSending
                            Button {
                                Task { await sendMessage() }
                            } label: {
                                Group {
                                    if isSending {
                                        ProgressView().progressViewStyle(.circular).tint(T.onGradient).scaleEffect(0.85)
                                    } else {
                                        TIconView(icon: .send, size: 18, color: T.onGradient, weight: .bold)
                                    }
                                }
                                .frame(width: 44, height: 44)
                                .background(Circle().fill(T.brandGradient(start: .topLeading, end: .bottomTrailing)))
                                .shadow(color: Color(hex: T.ctaGlowColor).opacity(sendDisabled ? 0 : T.ctaGlowOpacity),
                                        radius: T.ctaGlowRadius, x: 0, y: T.ctaGlowY)
                                .opacity(sendDisabled ? 0.5 : 1)
                            }
                            .buttonStyle(.plain)
                            .disabled(sendDisabled)
                        }
                        .shakeIfChanged(sendShakeToken)   // Phase 6: shake on send failure

                        if let err = sendError {
                            Text(err)
                                .font(.caption)
                                .foregroundColor(.red)
                                .padding(.horizontal, 16)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
                    .frame(maxWidth: .infinity)
                    // Frosted composer — blurred messages show through, matching
                    // the header. The frost feathers in at the TOP (no hard
                    // hairline) and fills solid down PAST the home indicator
                    // (ignoresSafeArea) so there's no clear strip at the bottom.
                    .background(
                        Rectangle()
                            .fill(.ultraThinMaterial)
                            .mask(
                                LinearGradient(stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: .black, location: 0.16),
                                    .init(color: .black, location: 1)
                                ], startPoint: .top, endPoint: .bottom)
                            )
                            .ignoresSafeArea(edges: .bottom)
                    )
                    .animation(.easeInOut(duration: 0.18), value: hasAttachment)
                    .sheet(isPresented: $showCamera) {
                        CameraPicker { image in pickedImage = image; pickedFile = nil; sendError = nil }
                            .ignoresSafeArea()
                    }
                    .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
                    .fileImporter(isPresented: $showFiles,
                                  allowedContentTypes: [.image, .pdf],
                                  allowsMultipleSelection: false) { handleFileImport($0) }
                    .onChange(of: photoItem) { _, item in loadLibraryItem(item) }
                }
            }
        }
        // Members popover — pills slide out beneath the (windowed) header when
        // its ▾ is tapped. Rendered here in the main window; toggled via the
        // shared appState.showThreadMembers flag from the overlay header.
        .overlay { peoplePopoverOverlay }
        .sheet(isPresented: $showAddPeople) {
            AddPeopleSheet(excludedIds: Set(threadParticipants.map { $0.id })) { ids in
                addPeople(ids)
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .toolbar(.hidden, for: .navigationBar)
        // Hand the current thread to the overlay header window; clear it on exit
        // (back button or swipe-back) so the window hides. onBack captures this
        // view's dismiss so the windowed back button pops the NavigationStack.
        // Re-publish as title/participants resolve (they load after onAppear).
        .onAppear { publishThreadContext() }
        .onChange(of: displayTitle) { publishThreadContext() }
        .onChange(of: threadParticipants.map(\.id)) { publishThreadContext() }
        .onDisappear {
            appState.activeMessageThread = nil
            appState.showThreadMembers = false
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

    // MARK: - People / add-to-chat popover
    //
    // FAB-style popout from the header: the thread's people slide out as pills
    // (staggered spring), with an "Add person" pill below. Tapping it presents
    // AddPeopleSheet (search + multi-select + Add). Open state lives in
    // appState.showThreadMembers because the ▾ toggle comes from the overlay
    // window's header, while this popover renders in the main-window view tree.
    /// Blur is only as tall as the pill stack (+ a soft fade tail).
    private var peopleBlurHeight: CGFloat { max(90, peopleListHeight / 0.66) }

    @ViewBuilder private var peoplePopoverOverlay: some View {
        ZStack(alignment: .topTrailing) {
            // Full-screen invisible tap-catcher so tapping anywhere dismisses.
            Color.clear
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { appState.showThreadMembers = false }
                }
                .allowsHitTesting(appState.showThreadMembers)

            // Blur only as tall as the list, easing out at its bottom.
            FadingBlur(flip: true)
                .frame(maxWidth: .infinity)
                .frame(height: peopleBlurHeight)
                .opacity(appState.showThreadMembers ? 1 : 0)
                .allowsHitTesting(false)
                .animation(.easeInOut(duration: 0.28), value: appState.showThreadMembers)

            VStack(alignment: .trailing, spacing: 10) {
                if appState.showThreadMembers {
                    let people = threadParticipants
                    // People slide in from the right, top-down, one-by-one.
                    ForEach(Array(people.enumerated()), id: \.element.id) { idx, p in
                        PersonPill(name: p.name, initials: personInitials(p.name))
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                            .animation(.spring(response: 0.32, dampingFraction: 0.74)
                                        .delay(Double(idx) * 0.05), value: appState.showThreadMembers)
                    }
                    // Add-person pill sits below the roster (reveals last).
                    if canAddPeople {
                        AddPersonPill { showAddPeople = true }
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                            .animation(.spring(response: 0.32, dampingFraction: 0.74)
                                        .delay(Double(people.count) * 0.05), value: appState.showThreadMembers)
                    }
                }
            }
            // Below the overlay header (≈ status bar + bar height).
            .padding(.top, overlayBarHeight + 8)
            .padding(.horizontal, 16)
            .background(
                GeometryReader { geo in
                    Color.clear.preference(key: PeopleListHeightKey.self, value: geo.size.height)
                }
            )
        }
        .onPreferenceChange(PeopleListHeightKey.self) { peopleListHeight = $0 }
    }

    /// Adding people is supported for group chats (append members) and DMs
    /// (spin up a group). Job/panel/op membership comes from the job team.
    private var canAddPeople: Bool {
        threadKey.hasPrefix("group:") || threadKey.hasPrefix("dm:")
    }

    /// Add the picked people. Group → append + persist. DM → spin up a group
    /// from the pair + picks and open it (the original DM stays intact).
    private func addPeople(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { appState.showThreadMembers = false }
        if threadKey.hasPrefix("group:") {
            let name = String(threadKey.dropFirst(6))
            Task { await appState.addGroupMembers(groupName: name, add: ids) }
        } else if threadKey.hasPrefix("dm:") {
            let members = Array(Set(threadParticipants.map { $0.id }).union(ids))
            let name = suggestedGroupName(memberIds: members)
            Task {
                guard let g = await appState.createGroup(name: name, memberIds: members) else { return }
                await MainActor.run { onOpenThread("group:\(g.id)") }
            }
        }
    }

    /// Readable auto-name for a group spun up from a DM: comma-joined first
    /// names, truncated with "+N" past three.
    private func suggestedGroupName(memberIds: [String]) -> String {
        let names = memberIds.compactMap { id in
            appState.people.first(where: { $0.id == id })?.name
                .split(separator: " ").first.map(String.init)
        }
        guard !names.isEmpty else { return "New Group" }
        if names.count <= 3 { return names.joined(separator: ", ") }
        return names.prefix(3).joined(separator: ", ") + " +\(names.count - 3)"
    }

    private func personInitials(_ name: String) -> String {
        name.split(separator: " ").prefix(2).map { String($0.prefix(1)).uppercased() }.joined()
    }

    /// Thumbnail (image) or doc chip (file) for the pending attachment, with a
    /// remove button. Tapping the paperclip again re-opens the source dialog.
    @ViewBuilder private var attachmentPreview: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let img = pickedImage {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: T.surface)))
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.hair), lineWidth: 1))

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
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd_HHmmss"
        return "photo_\(fmt.string(from: Date())).\(ext)"
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
        pickedImage = nil; pickedFile = nil; photoItem = nil
        // A light tap as the bubble springs in (#4 send feel).
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        do {
            let serverId = try await appState.sendMessageThrowing(msg)
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
            appState.attachmentViewerPresented = true
            showViewer = true
        } label: { thumbnail }
            .buttonStyle(.plain)
            .fullScreenCover(isPresented: $showViewer,
                             onDismiss: { appState.attachmentViewerPresented = false }) {
                AttachmentViewer(attachment: attachment)
            }
    }

    @ViewBuilder private var thumbnail: some View {
        if isImage, let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    fileChip
                case .empty:
                    ZStack {
                        RoundedRectangle(cornerRadius: 16).fill(Color(hex: T.surface))
                        ProgressView().tint(Color(hex: T.muted))
                    }
                    .frame(width: 200, height: 150)
                @unknown default:
                    EmptyView()
                }
            }
            .frame(maxWidth: 220, maxHeight: 260)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color(hex: T.hair), lineWidth: isMe ? 0 : 1))
        } else {
            fileChip
        }
    }

    private var fileChip: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.fill")
                .foregroundStyle(isMe ? T.onGradient : Color(hex: T.accent))
            Text(attachment.filename)
                .font(TTypo.sm(13))
                .lineLimit(1)
                .foregroundStyle(isMe ? T.onGradient : Color(hex: T.ink))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isMe ? AnyShapeStyle(T.brandGradient()) : AnyShapeStyle(Color(hex: T.surface)))
        )
    }
}

// MARK: - In-app attachment viewer (QuickLook + share/save/copy)

/// Opens an attachment inside the app. Downloads it to a temp file, then hands
/// it to QuickLook, which renders images (pinch-zoom), PDFs, and documents
/// natively and exposes a Share action — the system share sheet covers
/// download (Save to Files / Save Image), copy, and share-to-apps. A Done
/// button dismisses. This replaces the old Link that punted to Safari.
private struct AttachmentViewer: View {
    let attachment: Attachment
    @Environment(\.dismiss) private var dismiss

    private enum LoadState: Equatable {
        case loading
        case ready(URL)
        case failed(String)
    }
    @State private var state: LoadState = .loading

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()
            switch state {
            case .loading:
                VStack(spacing: 14) {
                    ProgressView().tint(Color(hex: T.muted))
                    Text("Loading \(attachment.filename)…")
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                }
            case .ready(let fileURL):
                QuickLookPreview(url: fileURL, onDone: { dismiss() })
                    .ignoresSafeArea()
            case .failed(let msg):
                VStack(spacing: 14) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 34))
                        .foregroundStyle(Color(hex: T.muted))
                    Text(msg)
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .multilineTextAlignment(.center)
                    HStack(spacing: 18) {
                        Button("Retry") { Task { await load() } }
                            .foregroundStyle(Color(hex: T.accent))
                        Button("Close") { dismiss() }
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .font(TTypo.smBold(15))
                    .buttonStyle(.plain)
                }
                .padding(40)
            }
        }
        .task { await load() }
    }

    private func load() async {
        state = .loading
        guard let remote = Attachment.viewURL(for: attachment.key) else {
            state = .failed("This attachment can't be opened."); return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: remote)
            // Write into a unique temp subfolder using the real filename, so
            // QuickLook infers the right type and a Save/Share exports a
            // sensibly-named file.
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let safeName = attachment.filename.isEmpty ? "attachment" : attachment.filename
            let fileURL = dir.appendingPathComponent(safeName)
            try data.write(to: fileURL, options: .atomic)
            state = .ready(fileURL)
        } catch {
            state = .failed("Couldn't load this attachment.\n\(error.localizedDescription)")
        }
    }
}

/// Wraps `QLPreviewController` in a nav controller so it gets a Done button and
/// its native Share action (→ Save to Files / Save Image / Copy / AirDrop).
private struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(url: url, onDone: onDone) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let preview = QLPreviewController()
        preview.dataSource = context.coordinator
        preview.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: context.coordinator,
            action: #selector(Coordinator.doneTapped))
        return UINavigationController(rootViewController: preview)
    }

    func updateUIViewController(_ vc: UINavigationController, context: Context) {
        context.coordinator.onDone = onDone
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        var onDone: () -> Void
        init(url: URL, onDone: @escaping () -> Void) { self.url = url; self.onDone = onDone }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
        @objc func doneTapped() { onDone() }
    }
}

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
                Text("✓✓ \(label)").foregroundStyle(Color(hex: T.sky))
            }
        }
        .font(.system(size: 10, weight: .semibold))
        .transition(.opacity)
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

    var body: some View {
        VStack(alignment: isMe ? .trailing : .leading, spacing: 2) {
            HStack(alignment: .bottom, spacing: 8) {
                if isMe { Spacer(minLength: 40) }

                if !isMe {
                    Avatar(initials: String(message.authorName.prefix(1)).uppercased(),
                           size: 28, gradient: true,
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
                            .font(TTypo.sm(14))
                            .multilineTextAlignment(.leading)
                            // Wrap to the text's natural height and cap the bubble width so
                            // long messages wrap inside a bounded bubble instead of
                            // stretching across the row / overlapping the avatar or edge.
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .foregroundStyle(isMe ? T.onGradient : Color(hex: T.ink))
                            .background {
                                let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
                                if isMe {
                                    shape.fill(T.brandGradient())
                                        .shadow(color: Color(hex: T.ctaGlowColor).opacity(T.ctaGlowOpacity * 0.7),
                                                radius: T.ctaGlowRadius * 0.6, x: 0, y: T.ctaGlowY * 0.6)
                                } else {
                                    shape.fill(Color(hex: T.surface))
                                        .overlay(shape.strokeBorder(
                                            LinearGradient(colors: [Color(hex: T.highlightStroke).opacity(0.55), .clear],
                                                           startPoint: .top, endPoint: .bottom),
                                            lineWidth: 1))
                                        .compositingGroup()
                                        .shadow(color: .black.opacity(T.ambientShadowOpacity),
                                                radius: T.ambientShadowRadius * 0.6, x: 0, y: T.ambientShadowY * 0.6)
                                }
                            }
                            .frame(maxWidth: 300, alignment: isMe ? .trailing : .leading)
                            .contentShape(RoundedRectangle(cornerRadius: 20))
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
                    .padding(.leading, isMe ? 0 : 36)
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
    private var status: String { req?.status ?? "pending" }
    private var type: String { req?.type ?? message.toType ?? "PTO" }
    private var startD: String { req?.start ?? message.toStart ?? "" }
    private var endD: String { req?.end ?? message.toEnd ?? "" }
    private var note: String { req?.note ?? message.toNote ?? "" }
    private var who: String { req?.personName ?? message.toPersonName ?? message.authorName }
    private var typeColor: Color { type == "UTO" ? Color(hex: "#F59E0B") : Color(hex: "#10B981") }
    private var pending: Bool { status == "pending" }
    private var statusPill: (label: String, kind: TagKind, dot: Bool) {
        switch status {
        case "approved":  return ("Approved", .green, false)
        case "denied":    return ("Denied", .magenta, false)
        case "cancelled": return ("Cancelled", .neutral, false)
        default:          return ("Pending", .amber, true)
        }
    }
    private var rangeLabel: String {
        let out = DateFormatter(); out.dateFormat = "MMM d"
        let inF = ISO8601DateFormatter(); inF.formatOptions = [.withFullDate]
        let sL = inF.date(from: startD).map(out.string(from:)) ?? startD
        let eL = inF.date(from: endD).map(out.string(from:)) ?? endD
        return startD == endD ? sL : "\(sL) – \(eL)"
    }

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

            if appState.isAdmin && pending {
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
                                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(RoundedRectangle(cornerRadius: T.cornerSm).stroke(Color(hex: T.hair), lineWidth: 1))
                            }.buttonStyle(.plain)
                            Button { decide("deny") } label: {
                                Text("Confirm Deny").font(TTypo.smBold(14)).foregroundStyle(T.onColor("#ef4444"))
                                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: "#ef4444")))
                            }.buttonStyle(.plain).disabled(busy)
                        }
                    }
                } else {
                    HStack(spacing: 10) {
                        Button { denying = true } label: {
                            Text("Deny").font(TTypo.smBold(15)).foregroundStyle(T.onColor("#ef4444"))
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: "#ef4444")))
                        }.buttonStyle(.plain).disabled(busy)
                        Button { decide("approve") } label: {
                            Text("Approve").font(TTypo.smBold(15)).foregroundStyle(T.onColor("#10b981"))
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: "#10b981")))
                        }.buttonStyle(.plain).disabled(busy)
                    }
                }
            }
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
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
}

// MARK: - Completion Request Bubble

/// Renders a `finish_request` message as a card with Approve/Deny for admins.
/// For task-level requests (message has panelId/opId), approval marks only that item Finished.
struct CompletionRequestBubble: View {
    @Environment(AppState.self) private var appState
    let message: Message
    @State private var busy = false

    private var job: Job? { appState.jobs.first { $0.id == message.jobId } }
    private var entry: FinishRequestEntry? {
        guard let id = message.finishRequestId else { return nil }
        return job?.finishRequests?.first { $0.id == id }
    }
    private var status: String { entry?.status ?? "pending" }
    private var pending: Bool { status == "pending" }
    private var statusPill: (label: String, kind: TagKind, dot: Bool) {
        switch status {
        case "approved": return ("Approved", .green, false)
        case "declined": return ("Declined", .red, false)
        default:         return ("Pending", .amber, true)
        }
    }

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

            if status != "pending", let by = entry?.resolvedByName, !by.isEmpty {
                Text("\(statusPill.label) by \(by)")
                    .font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
            }

            // Undo an approval — reopen the item (in case it needs to come back).
            if appState.isAdmin && status == "approved" {
                Button { undo() } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.uturn.backward")
                        Text(message.panelId != nil ? "Undo — reopen task" : "Undo — reopen job")
                    }
                    .font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.accent))
                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                    .background(RoundedRectangle(cornerRadius: T.cornerSm).stroke(Color(hex: T.accent).opacity(0.5), lineWidth: 1))
                }.buttonStyle(.plain).disabled(busy)
            }

            if appState.isAdmin && pending {
                HStack(spacing: 10) {
                    Button { decide(false) } label: {
                        Text("Deny").font(TTypo.smBold(15)).foregroundStyle(T.onColor("#ef4444"))
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: "#ef4444")))
                    }.buttonStyle(.plain).disabled(busy)
                    Button { decide(true) } label: {
                        Text("Approve").font(TTypo.smBold(15)).foregroundStyle(T.onColor("#10b981"))
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: "#10b981")))
                    }.buttonStyle(.plain).disabled(busy)
                }
            }
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func decide(_ approve: Bool) {
        guard let jobId = message.jobId, let reqId = message.finishRequestId else { return }
        busy = true   // disables buttons during the async; status then drives visibility
        Task {
            if approve {
                await appState.approveJobCompletion(jobId: jobId, panelId: message.panelId,
                                                    opId: message.opId, requestId: reqId)
            } else {
                await appState.denyJobCompletion(jobId: jobId, panelId: message.panelId,
                                                 opId: message.opId, requestId: reqId)
            }
            busy = false
        }
    }

    private func undo() {
        guard let jobId = message.jobId, let reqId = message.finishRequestId else { return }
        busy = true
        Task {
            await appState.undoJobCompletion(jobId: jobId, panelId: message.panelId,
                                             opId: message.opId, requestId: reqId)
            busy = false
        }
    }
}

// MARK: - Thread Top Bar (back button · identity · participant avatars)

/// The conversation header: back button, then the identity — a single avatar for
/// a DM or an overlapping stack for a group — beside the title and subtitle.
/// Rendered inside the overlay window (see OverlayWindowController) and fed via
/// ThreadContext, so the keyboard can't displace it.
struct ThreadTopBar: View {
    let title: String
    let isDM: Bool
    let participants: [Person]
    let onBack: () -> Void
    /// Tapping the identity (avatar/title) opens the members popover.
    var onTapIdentity: (() -> Void)? = nil

    /// Initials for the DM's single leading avatar, derived from the title
    /// (which already resolves to the other person's name).
    private var titleInitials: String {
        let parts = title.split(separator: " ").prefix(2).map { String($0.prefix(1)).uppercased() }
        return parts.joined()
    }

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
                    .frame(width: 38, height: 38)
                    .glassEffect(.regular.interactive(), in: Circle())
            }
            .buttonStyle(.plain)

            Button { onTapIdentity?() } label: {
                HStack(spacing: 11) {
                    Spacer(minLength: 0)

                    Text(title)
                        .font(TTypo.h3(20))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                        .truncationMode(.tail)

                    // Identity avatars on the RIGHT, name sits just to their left:
                    // a single large avatar for a DM, an overlapping stack for a
                    // group / job / panel / op.
                    if isDM {
                        Avatar(initials: titleInitials.isEmpty ? "?" : titleInitials,
                               size: 42, gradient: true)
                    } else if !participants.isEmpty {
                        ParticipantStack(people: participants,
                                         avatarSize: 34, overlap: 12, maxShown: 3)
                    } else {
                        Avatar(initials: "#", size: 42, gradient: true)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onTapIdentity == nil)
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 12)
    }
}

/// Up to three overlapping avatar circles. If more than three participants
/// exist, the fourth slot becomes a "+N" indicator instead of the next avatar.
private struct ParticipantStack: View {
    let people: [Person]
    var avatarSize: CGFloat = 28
    var overlap: CGFloat = 10
    var maxShown: Int = 3

    var body: some View {
        HStack(spacing: -overlap) {
            ForEach(Array(people.prefix(maxShown).enumerated()), id: \.element.id) { _, p in
                Avatar(initials: initials(p.name),
                       size: avatarSize,
                       gradient: true,
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

    private func initials(_ name: String) -> String {
        name.split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
            .joined()
    }
}

// MARK: - Header popover pills

/// Reports the measured height of the popover's pill stack so the blur behind
/// it can be sized to the list instead of the whole screen.
private struct PeopleListHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// A person in the header people popover — avatar + name in a capsule.
private struct PersonPill: View {
    let name: String
    let initials: String
    var body: some View {
        HStack(spacing: 8) {
            Avatar(initials: initials, size: 24, gradient: true)
            Text(name)
                .font(TTypo.smBold(14))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
        }
        .padding(.leading, 6)
        .padding(.trailing, 16)
        .padding(.vertical, 7)
        .background(Capsule().fill(Color(hex: T.surface)))
        .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 10, x: 0, y: 4)
    }
}

/// The "Add person" action pill below the roster — gradient, to stand out.
private struct AddPersonPill: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 14, weight: .bold))
                Text("Add person").font(TTypo.smBold(14))
            }
            .foregroundStyle(T.onGradient)
            .padding(.horizontal, 18)
            .padding(.vertical, 11)
            .background(Capsule().fill(T.brandGradient()))
            .shadow(color: Color(hex: T.sky).opacity(T.skyShadowOpacity),
                    radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Add People Sheet (search + multi-select + Add)

/// Presented from the header popover's "Add person" pill. Lists all workers
/// not already in the thread, with a search bar and multi-select; "Add" (top
/// right) hands the picked ids back to the caller.
struct AddPeopleSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let excludedIds: Set<String>
    let onAdd: ([String]) -> Void

    @State private var selected: Set<String> = []
    @State private var search = ""
    @FocusState private var searchFocused: Bool

    private var candidates: [Person] {
        appState.people
            .filter { !excludedIds.contains($0.id) }
            .filter { search.isEmpty
                || $0.name.localizedCaseInsensitiveContains(search)
                || $0.role.localizedCaseInsensitiveContains(search) }
            .sorted { $0.name < $1.name }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

                VStack(spacing: 0) {
                    SearchBar(text: $search,
                              placeholder: "Search workers…",
                              focused: $searchFocused,
                              onCancel: { search = "" })
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 6)

                    ScrollView {
                        VStack(spacing: 10) {
                            ForEach(candidates) { p in
                                Button { toggle(p.id) } label: { row(p) }
                                    .buttonStyle(.plain)
                            }
                            if candidates.isEmpty {
                                Text(search.isEmpty ? "No one left to add." : "No matches.")
                                    .font(TTypo.sm(13))
                                    .foregroundStyle(Color(hex: T.muted))
                                    .padding(.top, 40)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 4)
                        .padding(.bottom, 24)
                    }
                    .scrollIndicators(.visible)
                }
            }
            .navigationTitle("Add People")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(Color(hex: T.accent))
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(selected.isEmpty ? "Add" : "Add (\(selected.count))") {
                        onAdd(Array(selected))
                        dismiss()
                    }
                    .fontWeight(.bold)
                    .foregroundColor(selected.isEmpty ? Color(hex: T.muted) : Color(hex: T.accent))
                    .disabled(selected.isEmpty)
                }
            }
        }
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    private func row(_ p: Person) -> some View {
        let isOn = selected.contains(p.id)
        return HStack(spacing: 12) {
            Circle()
                .fill(Color(hex: p.color))
                .frame(width: 40, height: 40)
                .overlay(Text(String(p.name.prefix(1)).uppercased())
                    .font(.subheadline.bold()).foregroundColor(Color(hex: p.color).readableText))
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(TTypo.smBold(15)).foregroundStyle(Color(hex: T.ink)).lineLimit(1)
                if !p.role.isEmpty {
                    Text(p.role).font(TTypo.xs(12)).foregroundStyle(Color(hex: T.muted)).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 22))
                .foregroundStyle(isOn ? Color(hex: T.sky) : Color(hex: T.muted))
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: T.cornerMd).fill(Color(hex: T.card)))
        .overlay(RoundedRectangle(cornerRadius: T.cornerMd)
            .stroke(isOn ? Color(hex: T.sky).opacity(0.5) : Color(hex: T.hair), lineWidth: 1))
        .contentShape(Rectangle())
    }
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

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

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

                        // Group name
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Group Name")
                                .font(.caption.bold())
                                .foregroundColor(Color(hex: T.muted))
                                .padding(.horizontal, 16)
                            TextField("e.g. Electrical Team, Project Alpha…", text: $groupName)
                                .textFieldStyle(.plain)
                                .foregroundColor(Color(hex: T.text))
                                .padding(12)
                                .background(Color(hex: T.surface))
                                .cornerRadius(10)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
                                .padding(.horizontal, 16)
                        }

                        // Member selection
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Add Members")
                                .font(.caption.bold())
                                .foregroundColor(Color(hex: T.muted))
                                .padding(.horizontal, 16)

                            ForEach(appState.people.filter { $0.id != appState.currentPersonId }) { person in
                                Button {
                                    if selectedIds.contains(person.id) {
                                        selectedIds.remove(person.id)
                                    } else {
                                        selectedIds.insert(person.id)
                                    }
                                } label: {
                                    HStack(spacing: 12) {
                                        Circle()
                                            .fill(Color(hex: person.color))
                                            .frame(width: 36, height: 36)
                                            .overlay(
                                                Text(String(person.name.prefix(1)).uppercased())
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
                                        Image(systemName: selectedIds.contains(person.id) ? "checkmark.circle.fill" : "circle")
                                            .foregroundColor(selectedIds.contains(person.id) ? Color(hex: T.accent) : Color(hex: T.muted))
                                    }
                                    .padding(12)
                                    .background(Color(hex: T.card))
                                    .cornerRadius(10)
                                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(
                                        selectedIds.contains(person.id) ? Color(hex: T.accent).opacity(0.4) : Color(hex: T.border),
                                        lineWidth: 1
                                    ))
                                }
                                .buttonStyle(.plain)
                                .padding(.horizontal, 16)
                            }
                        }

                        Button {
                            let name = groupName.trimmingCharacters(in: .whitespaces)
                            guard !name.isEmpty else { return }
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
                                .background(groupName.trimmingCharacters(in: .whitespaces).isEmpty ? Color(hex: T.border) : Color(hex: T.accent))
                                .foregroundColor(T.onAccent)
                                .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                        .disabled(groupName.trimmingCharacters(in: .whitespaces).isEmpty)
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
                Color(hex: T.bg).ignoresSafeArea()
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
                                        Text(String(person.name.prefix(1)).uppercased())
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
    @Environment(\.dismiss) private var dismiss
    /// (recipientIds excluding me, groupName) — groupName is nil for a 1:1 DM.
    let onStart: ([String], String?) -> Void

    @State private var selectedIds: Set<String> = []
    @State private var groupName = ""
    @State private var query = ""

    private var others: [Person] {
        let base = appState.people.filter { $0.id != appState.currentPersonId }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return base }
        return base.filter { $0.name.lowercased().contains(q) || $0.role.lowercased().contains(q) }
    }
    private var isGroup: Bool { selectedIds.count > 1 }

    /// Auto name for a group when the user leaves the name blank — first names of
    /// the selected people, e.g. "Alex & Sam" or "Alex, Sam +2".
    private var autoGroupName: String {
        let names = appState.people.filter { selectedIds.contains($0.id) }
            .map { String($0.name.split(separator: " ").first ?? Substring($0.name)) }
        switch names.count {
        case 0:  return "Group"
        case 1:  return names[0]
        case 2:  return "\(names[0]) & \(names[1])"
        default: return "\(names.prefix(2).joined(separator: ", ")) +\(names.count - 2)"
        }
    }

    private var subtitle: String {
        if selectedIds.isEmpty { return "One person for a DM · several for a group" }
        return isGroup ? "\(selectedIds.count) people · group" : "Direct message"
    }

    private func initials(_ p: Person) -> String {
        let parts = p.name.split(separator: " ").prefix(2).map { String($0.prefix(1)).uppercased() }
        let j = parts.joined(); return j.isEmpty ? "?" : j
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            ScrollView {
                VStack(spacing: 18) {
                    PageTitle(title: "New Message", subtitle: subtitle)
                        .padding(.top, 8)

                    // Group name — appears once it's a group (2+ selected).
                    if isGroup {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("GROUP NAME")
                                .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                                .foregroundStyle(Color(hex: T.muted))
                            TextField(autoGroupName, text: $groupName)
                                .textFieldStyle(.plain)
                                .font(TTypo.sm(15))
                                .foregroundStyle(Color(hex: T.ink))
                                .padding(14)
                                .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).fill(Color(hex: T.surface)))
                                .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    // Recipients
                    VStack(alignment: .leading, spacing: 10) {
                        Text("RECIPIENTS")
                            .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                            .foregroundStyle(Color(hex: T.muted))

                        // Search field
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color(hex: T.muted))
                            TextField("Search people", text: $query)
                                .textFieldStyle(.plain)
                                .font(TTypo.sm(14))
                                .foregroundStyle(Color(hex: T.ink))
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).fill(Color(hex: T.surface)))
                        .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))

                        VStack(spacing: 8) {
                            ForEach(others) { person in
                                recipientRow(person)
                            }
                            if others.isEmpty {
                                Text("No people match “\(query)”")
                                    .font(TTypo.sm(13))
                                    .foregroundStyle(Color(hex: T.muted))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 20)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                // Clear the floating action bar so the last row stays reachable.
                .padding(.bottom, 96)
                .animation(.easeInOut(duration: 0.18), value: isGroup)
            }
            .scrollIndicators(.visible)
            .scrollDismissesKeyboard(.interactively)

            // Floating action bar — Cancel (left) + Create (right). Stays pinned
            // to the bottom while the recipient list scrolls behind it.
            VStack {
                Spacer()
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Text("Cancel")
                            .font(TTypo.smBold(15))
                            .foregroundStyle(Color(hex: T.ink))
                            .padding(.horizontal, 24).padding(.vertical, 14)
                            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color(hex: T.surface)))
                            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
                            .shadow(color: .black.opacity(0.12), radius: 12, x: 0, y: 4)
                    }
                    .buttonStyle(.plain)

                    Spacer(minLength: 0)

                    Button { start() } label: {
                        HStack(spacing: 7) {
                            Image(systemName: "plus").font(.system(size: 15, weight: .bold))
                            Text("Create").font(TTypo.smBold(15))
                        }
                        .foregroundStyle(T.onGradient)
                        .padding(.horizontal, 24).padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .fill(selectedIds.isEmpty ? AnyShapeStyle(Color(hex: T.progressTrack))
                                                          : AnyShapeStyle(T.brandGradient()))
                        )
                        .shadow(color: Color(hex: T.ctaGlowColor).opacity(selectedIds.isEmpty ? 0 : T.ctaGlowOpacity),
                                radius: T.ctaGlowRadius, x: 0, y: T.ctaGlowY)
                        .opacity(selectedIds.isEmpty ? 0.7 : 1)
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedIds.isEmpty)
                    .animation(.easeInOut(duration: 0.18), value: selectedIds.isEmpty)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 18)
            }
        }
    }

    private func start() {
        let ids = Array(selectedIds)
        guard !ids.isEmpty else { return }
        let name: String? = ids.count > 1
            ? { let t = groupName.trimmingCharacters(in: .whitespaces); return t.isEmpty ? autoGroupName : t }()
            : nil
        dismiss()
        onStart(ids, name)
    }

    // One selectable recipient — frosted rounded row with the person's avatar
    // (profile photo when set), name/role, and a gradient check when selected.
    private func recipientRow(_ person: Person) -> some View {
        let selected = selectedIds.contains(person.id)
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if selected { selectedIds.remove(person.id) } else { selectedIds.insert(person.id) }
            }
        } label: {
            HStack(spacing: 12) {
                Avatar(initials: initials(person), size: 42,
                       fill: Color(hex: person.color), imageData: person.image)
                VStack(alignment: .leading, spacing: 2) {
                    Text(person.name)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                    if !person.role.isEmpty {
                        Text(person.role)
                            .font(TTypo.xs(12))
                            .foregroundStyle(Color(hex: T.muted))
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                ZStack {
                    if selected {
                        Circle().fill(T.brandGradient())
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(T.onGradient)
                    } else {
                        Circle().strokeBorder(Color(hex: T.hair), lineWidth: 1.5)
                    }
                }
                .frame(width: 24, height: 24)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).fill(Color(hex: T.surface)))
            .overlay(
                RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                    .stroke(selected ? Color(hex: T.accentGradientStart) : Color(hex: T.hair),
                            lineWidth: selected ? 1.6 : 1)
            )
        }
        .buttonStyle(.plain)
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
        let df = DateFormatter()
        if Calendar.current.isDateInToday(date) {
            df.dateFormat = "h:mma"          // "9:30PM"
            return "Today at \(df.string(from: date))"
        }
        df.dateFormat = "MMMM d"             // "June 30"
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
