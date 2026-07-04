import SwiftUI
import PhotosUI
import UIKit
import UniformTypeIdentifiers

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
    @State private var filter: ChatFilter = .all
    @State private var filterOpen = false   // filter FAB dropdown open?
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
                    lastReadAt: readMap[key]
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
        guard key.hasPrefix("dm:") else { return nil }
        let ids = String(key.dropFirst(3)).components(separatedBy: "_")
        let otherId = ids.first(where: { $0 != myId }) ?? ids.first
        return appState.people.first(where: { $0.id == otherId })?.name
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
                                    .background(Capsule().fill(Color(hex: T.surface)))
                                    .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                            }
                            .buttonStyle(.plain)

                            Button {
                                showDeleteConfirm = true
                            } label: {
                                HStack(spacing: 6) {
                                    TIconView(icon: .trash, size: 16, color: .white, weight: .bold)
                                    if !selectedKeys.isEmpty {
                                        Text("\(selectedKeys.count)")
                                            .font(TTypo.smBold(13))
                                            .foregroundStyle(.white)
                                            .tnum()
                                    }
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(Capsule().fill(Color.red.opacity(selectedKeys.isEmpty ? 0.4 : 1.0)))
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
                                    .background(Capsule().fill(Color(hex: T.surface)))
                                    .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                                    .compositingGroup()
                                    .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                                            radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
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
                                showNewGroup = true   // default to group creation; DM is in sheet
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

                    // Inbox + the filter FAB. The list blurs behind the floating
                    // filter options when the FAB is open (mirrors the Jobs tab's
                    // range picker); tapping the backdrop dismisses it.
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
                        .scrollIndicators(.hidden)
                        .topFadeMask()
                        .allowsHitTesting(!filterOpen)

                        // Fading backdrop blur + tap-to-dismiss. Always mounted,
                        // driven by opacity so it eases away when the FAB closes.
                        FadingBlur()
                            .ignoresSafeArea()
                            .opacity(filterOpen ? 1 : 0)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) {
                                    filterOpen = false
                                }
                            }
                            .allowsHitTesting(filterOpen)
                            .animation(.easeInOut(duration: 0.28), value: filterOpen)

                        // Bottom-right: the filter FAB with its options stacked
                        // ABOVE it (they float over the blurred inbox).
                        VStack(alignment: .trailing, spacing: 12) {
                            filterOptions
                            FilterFab(open: $filterOpen)
                        }
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
            }
            .sheet(isPresented: $showNewGroup) {
                NewGroupSheet { name, memberIds in
                    // Persist the group server-side so other devices see
                    // it. Without this, "create group" only changed local
                    // navigation state and the group never reached
                    // groups.json — desktop and other iOS devices would
                    // never see the new group.
                    Task { await appState.createGroup(name: name, memberIds: memberIds) }
                    navigationPath.append("group:\(name)")
                }
            }
            .sheet(isPresented: $showNewDM) {
                NewDMSheet { personId in
                    guard let myId = appState.currentPersonId else { return }
                    let ids = [myId, personId].sorted()
                    navigationPath.append("dm:\(ids.joined(separator: "_"))")
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
    }

    /// Floating filter options — stacked vertically above the filter FAB,
    /// dropping in one-by-one (nearest the FAB reveals first). Empty (zero-size)
    /// when closed. Mirrors the Jobs tab's range picker.
    @ViewBuilder private var filterOptions: some View {
        VStack(alignment: .trailing, spacing: 10) {
            if filterOpen {
                let opts = Array(ChatFilter.allCases.reversed())   // [mentions … all]
                ForEach(Array(opts.enumerated()), id: \.element) { idx, opt in
                    let fromFab = opts.count - 1 - idx   // 0 = nearest the FAB
                    RangePill(label: opt.label, selected: opt == filter) {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.8)) {
                            filter = opt
                            filterOpen = false
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(response: 0.32, dampingFraction: 0.74)
                                .delay(Double(fromFab) * 0.05), value: filterOpen)
                }
            }
        }
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

// MARK: - Filter FAB
// Bottom-right floating filter button, mirroring the Jobs tab's calendar FAB
// (CalendarFab): a gradient circle that toggles a stack of filter options
// (reusing RangePill) above it. Replaces the old horizontal filter pills.

private struct FilterFab: View {
    @Binding var open: Bool
    var body: some View {
        Button {
            withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { open.toggle() }
        } label: {
            TIconView(icon: .filter, size: 24, color: .white, weight: .bold)
                .frame(width: 62, height: 62)
                .background(Circle().fill(T.brandGradient(start: .topLeading, end: .bottomTrailing)))
                .shadow(color: Color(hex: T.ctaGlowColor).opacity(0.5), radius: 16, x: 0, y: 8)
                .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
                .scaleEffect(open ? 1.06 : 1)
        }
        .buttonStyle(.plain)
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
                            .foregroundStyle(.white)
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
        guard let cutoff = lastReadAt else { return messages.count }
        return messages.filter { $0.timestamp > cutoff }.count
    }
}

// MARK: - ThreadRow

struct ThreadRow: View {
    let thread: MessageThread

    var threadIcon: String {
        if thread.isDM { return "person.fill" }
        if thread.key.hasPrefix("group:") { return "person.3.fill" }
        return "tag"
    }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color(hex: thread.lastMessage?.authorColor ?? T.accent).opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: threadIcon)
                    .foregroundColor(Color(hex: thread.lastMessage?.authorColor ?? T.accent))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(thread.displayTitle)
                    .font(.subheadline.bold())
                    .foregroundColor(Color(hex: T.text))
                    .lineLimit(1)
                if let last = thread.lastMessage {
                    Text(last.text)
                        .font(.caption)
                        .foregroundColor(Color(hex: T.muted))
                        .lineLimit(1)
                }
            }

            Spacer()

            if let last = thread.lastMessage {
                Text(last.timestamp.shortTimestamp)
                    .font(.caption2)
                    .foregroundColor(Color(hex: T.muted))
            }
        }
        .padding(12)
        .background(Color(hex: T.card))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
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
    @State private var myMessageIds: Set<String> = []
    @State private var showPeople = false     // header people/add popover open?
    @State private var showAddPeople = false  // add-people multi-select sheet?
    @State private var peopleListHeight: CGFloat = 0   // measured pill-stack height

    // Composer attachment (one at a time). An image routes through the
    // downscaler; a non-image file is sent as-is. Mirrors the end-job panel
    // photo picker (PanelPhotoSheet) so camera/library/files behave the same.
    @State private var pickedImage: UIImage?
    @State private var pickedFile: PickedAttachment?
    @State private var photoItem: PhotosPickerItem?
    @State private var showSourceDialog = false
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
        if threadKey.hasPrefix("group:") { return String(threadKey.dropFirst(6)) }
        if threadKey.hasPrefix("job:")   { return "Job: \(threadKey.dropFirst(4))" }
        if threadKey.hasPrefix("panel:") { return "Panel: \(threadKey.dropFirst(6))" }
        if threadKey.hasPrefix("op:")    { return "Op: \(threadKey.dropFirst(3))" }
        return threadKey
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
            let name = String(threadKey.dropFirst(6))
            if let g = appState.groups.first(where: { $0.name == name }) {
                return g.memberIds.compactMap { id in appState.people.first(where: { $0.id == id }) }
            }
        }
        let ids = Set(liveMessages.flatMap { [$0.authorId] + $0.participantIds })
        return ids.compactMap { id in appState.people.first(where: { $0.id == id }) }
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                ThreadHeader(title: displayTitle,
                             participants: threadParticipants,
                             onBack: { dismiss() },
                             onTapPeople: {
                                 withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                                     showPeople.toggle()
                                 }
                             })

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
                                    if msg.type == "timeoff_request" {
                                        TimeOffRequestBubble(message: msg)
                                            .id(msg.id)
                                    } else {
                                        MessageBubble(message: msg, isMe: isMyMessage(msg))
                                            .id(msg.id)
                                    }
                                }
                            }
                        }
                        .padding()
                    }
                    .refreshable { await appState.refreshMessages() }
                    .onChange(of: liveMessages.count) {
                        if let last = liveMessages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                    .onAppear {
                        if let last = liveMessages.last {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                        // Pull latest request statuses so any timeoff_request
                        // bubble shows live state + Approve/Deny (admins get all).
                        Task { await appState.refreshTimeOffRequests() }
                    }
                }

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
                        // Attachment button — photo / camera / file, same sources
                        // as the end-job panel photo.
                        Button { showSourceDialog = true } label: {
                            Image(systemName: "paperclip")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(Color(hex: T.ink))
                                .frame(width: 44, height: 44)
                                .background(Circle().fill(Color(hex: T.surface)))
                                .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(isSending)

                        TextField("Message…", text: $newText, axis: .vertical)
                            .textFieldStyle(.plain)
                            .font(TTypo.sm(14))
                            .foregroundColor(Color(hex: T.ink))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(Capsule().fill(Color(hex: T.surface)))
                            .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                            .lineLimit(1...5)

                        // Send is allowed with text OR an attachment (or both).
                        let sendDisabled = (newText.trimmingCharacters(in: .whitespaces).isEmpty && !hasAttachment) || isSending
                        Button {
                            Task { await sendMessage() }
                        } label: {
                            Group {
                                if isSending {
                                    ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(0.85)
                                } else {
                                    TIconView(icon: .send, size: 18, color: .white, weight: .bold)
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
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 6)
                .animation(.easeInOut(duration: 0.18), value: hasAttachment)
                .confirmationDialog("Add attachment", isPresented: $showSourceDialog, titleVisibility: .visible) {
                    Button("Take Photo") {
                        if UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
                        else { sendError = "No camera available on this device." }
                    }
                    Button("Photo Album") { showLibrary = true }
                    Button("Choose File") { showFiles = true }
                    Button("Cancel", role: .cancel) {}
                }
                .sheet(isPresented: $showCamera) {
                    CameraPicker { image in pickedImage = image; pickedFile = nil; sendError = nil }
                        .ignoresSafeArea()
                }
                .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
                .fileImporter(isPresented: $showFiles,
                              allowedContentTypes: [.image, .pdf],
                              allowsMultipleSelection: false) { handleFileImport($0) }
                .onChange(of: photoItem) { _, item in loadLibraryItem(item) }

                if let err = sendError {
                    Text(err)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 4)
                }
            }
        }
        .overlay { peoplePopoverOverlay }
        .sheet(isPresented: $showAddPeople) {
            AddPeopleSheet(excludedIds: Set(threadParticipants.map { $0.id })) { ids in
                addPeople(ids)
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: threadKey) {
            // Poll every 3s while this conversation is open. The global
            // 15s auto-refresh feels too slow when two people are actively
            // chatting; the recipient should see your message in seconds,
            // not next-pollster. SwiftUI cancels this Task automatically
            // when the view disappears.
            while !Task.isCancelled {
                await appState.refreshMessages()
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
        if let name = appState.currentPerson?.name, !name.isEmpty, msg.authorName == name { return true }
        return false
    }

    // MARK: - People / add-to-chat popover
    //
    // FAB-style popout from the header: the thread's people slide out as pills
    // (staggered spring, like the inbox filter FAB), with an "Add person" pill
    // below. Tapping it presents AddPeopleSheet (search + multi-select + Add).
    /// Blur is only as tall as the pill stack (+ a soft fade tail): FadingBlur's
    /// flipped gradient keeps the top ~66% solid, so sizing the frame to
    /// listHeight / 0.66 lands the solid band right at the list's bottom and
    /// eases out just below it.
    private var peopleBlurHeight: CGFloat { max(90, peopleListHeight / 0.66) }

    @ViewBuilder private var peoplePopoverOverlay: some View {
        ZStack(alignment: .topTrailing) {
            // Full-screen invisible tap-catcher so tapping anywhere dismisses,
            // even below the (now-confined) blur.
            Color.clear
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { showPeople = false }
                }
                .allowsHitTesting(showPeople)

            // Blur only as tall as the list, easing out at its bottom.
            FadingBlur(flip: true)
                .frame(maxWidth: .infinity)
                .frame(height: peopleBlurHeight)
                .opacity(showPeople ? 1 : 0)
                .allowsHitTesting(false)
                .animation(.easeInOut(duration: 0.28), value: showPeople)

            VStack(alignment: .trailing, spacing: 10) {
                if showPeople {
                    let people = threadParticipants
                    // People slide in from the right, top-down, one-by-one.
                    ForEach(Array(people.enumerated()), id: \.element.id) { idx, p in
                        PersonPill(name: p.name, initials: personInitials(p.name))
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                            .animation(.spring(response: 0.32, dampingFraction: 0.74)
                                        .delay(Double(idx) * 0.05), value: showPeople)
                    }
                    // Add-person pill sits below the roster (reveals last).
                    if canAddPeople {
                        AddPersonPill { showAddPeople = true }
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                            .animation(.spring(response: 0.32, dampingFraction: 0.74)
                                        .delay(Double(people.count) * 0.05), value: showPeople)
                    }
                }
            }
            .padding(.top, 60)
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
    /// (spin up a group). Job/panel/op membership comes from the job team, so
    /// it isn't edited here.
    private var canAddPeople: Bool {
        threadKey.hasPrefix("group:") || threadKey.hasPrefix("dm:")
    }

    /// Add the picked people. Group → append + persist. DM → spin up a group
    /// from the pair + picks and open it (the original DM stays intact).
    private func addPeople(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { showPeople = false }
        if threadKey.hasPrefix("group:") {
            let name = String(threadKey.dropFirst(6))
            Task { await appState.addGroupMembers(groupName: name, add: ids) }
        } else if threadKey.hasPrefix("dm:") {
            let members = Array(Set(threadParticipants.map { $0.id }).union(ids))
            let name = suggestedGroupName(memberIds: members)
            Task {
                await appState.createGroup(name: name, memberIds: members)
                await MainActor.run { onOpenThread("group:\(name)") }
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
            timestamp: ISO8601DateFormatter().string(from: Date())
        )
        newText = ""
        pickedImage = nil; pickedFile = nil; photoItem = nil
        do {
            let serverId = try await appState.sendMessageThrowing(msg)
            myMessageIds.insert(serverId)   // track server-assigned id too
        } catch {
            sendError = "Failed to send: \(error.localizedDescription)"
            newText = text
            myMessageIds.remove(msgId)      // clean up on failure
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

/// Renders one message attachment: images load inline (tap opens full-size in
/// the browser); other files show a tappable doc chip. Served by the no-auth
/// `attachment` GET endpoint, same as the web app's <img src>.
private struct AttachmentBubble: View {
    let attachment: Attachment
    let isMe: Bool

    private var url: URL? { Attachment.viewURL(for: attachment.key) }
    private var isImage: Bool { attachment.mimeType.hasPrefix("image/") }

    var body: some View {
        if isImage, let url {
            Link(destination: url) {
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
            }
            .buttonStyle(.plain)
        } else if let url {
            Link(destination: url) { fileChip }.buttonStyle(.plain)
        } else {
            fileChip
        }
    }

    private var fileChip: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.fill")
                .foregroundStyle(isMe ? .white : Color(hex: T.accent))
            Text(attachment.filename)
                .font(TTypo.sm(13))
                .lineLimit(1)
                .foregroundStyle(isMe ? .white : Color(hex: T.ink))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isMe ? AnyShapeStyle(T.brandGradient()) : AnyShapeStyle(Color(hex: T.surface)))
        )
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

// MARK: - MessageBubble

struct MessageBubble: View {
    let message: Message
    let isMe: Bool

    /// Timestamp is hidden by default and revealed when the user taps
    /// the bubble. A timed Task auto-hides it again so the thread stays
    /// uncluttered without forcing a second tap.
    @State private var showTimestamp = false
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isMe { Spacer(minLength: 40) }

            if !isMe {
                Avatar(initials: String(message.authorName.prefix(1)).uppercased(),
                       size: 28, gradient: true)
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
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(isMe ? .white : Color(hex: T.ink))
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
                    .contentShape(RoundedRectangle(cornerRadius: 20))
                    .onTapGesture { toggleTimestamp() }
                    // Overlay rather than a sibling view so the timestamp
                    // doesn't grow the VStack — otherwise the HStack's
                    // .bottom alignment pulls the avatar (and the bubble)
                    // downward when the stamp appears. `.move(edge: .top)`
                    // for the inserted view slides it DOWN from behind
                    // the bubble's bottom edge and back up on dismiss.
                    .overlay(alignment: isMe ? .bottomTrailing : .bottomLeading) {
                        if showTimestamp {
                            Text(message.timestamp.messageStamp)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(Color(hex: T.muted))
                                .padding(.horizontal, 4)
                                .offset(y: 18)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                }
            }

            if !isMe { Spacer(minLength: 40) }
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
                                Text("Confirm Deny").font(TTypo.smBold(14)).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: "#ef4444")))
                            }.buttonStyle(.plain).disabled(busy)
                        }
                    }
                } else {
                    HStack(spacing: 10) {
                        Button { denying = true } label: {
                            Text("Deny").font(TTypo.smBold(15)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: "#ef4444")))
                        }.buttonStyle(.plain).disabled(busy)
                        Button { decide("approve") } label: {
                            Text("Approve").font(TTypo.smBold(15)).foregroundStyle(.white)
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

// MARK: - Thread Header (back · title · participant avatars)

private struct ThreadHeader: View {
    let title: String
    let participants: [Person]
    let onBack: () -> Void
    /// Tapping the title or the avatar stack opens the people/add popover.
    var onTapPeople: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color(hex: T.surface)))
                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
            }
            .buttonStyle(.plain)

            Button { onTapPeople?() } label: {
                HStack(spacing: 6) {
                    Text(title)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if onTapPeople != nil {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onTapPeople == nil)

            Spacer(minLength: 8)

            if !participants.isEmpty {
                Button { onTapPeople?() } label: {
                    ParticipantStack(people: participants)
                }
                .buttonStyle(.plain)
                .disabled(onTapPeople == nil)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 14)
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
                       gradient: true)
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

/// A person in the header people popover — avatar + name in a capsule, styled
/// like the FAB range pills.
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
            .foregroundStyle(.white)
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
                    .scrollIndicators(.hidden)
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
                    .font(.subheadline.bold()).foregroundColor(.white))
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
                                                    .foregroundColor(.white)
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
                                .foregroundColor(.white)
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
                                            .foregroundColor(.white)
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

// MARK: - Helpers

extension String {
    var shortTimestamp: String {
        let f = ISO8601DateFormatter()
        guard let date = f.date(from: self) else { return self }
        let df = DateFormatter()
        if Calendar.current.isDateInToday(date) {
            df.dateFormat = "h:mm a"
        } else {
            df.dateStyle = .short
            df.timeStyle = .short
        }
        return df.string(from: date)
    }

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
