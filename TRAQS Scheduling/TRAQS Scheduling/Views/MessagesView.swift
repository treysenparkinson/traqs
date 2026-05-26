import SwiftUI

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
    @State private var showNewGroup = false
    @State private var showNewDM = false
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
                Color(hex: T.bg).ignoresSafeArea()

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
                            Button {
                                showNewGroup = true   // default to group creation; DM is in sheet
                            } label: {
                                TIconView(icon: .plus, size: 18, color: .white, weight: .bold)
                                    .padding(9)
                                    .background(Circle().fill(Color(hex: T.sky)))
                                    .shadow(color: Color(hex: T.sky).opacity(T.skyShadowOpacity),
                                            radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .background(Color(hex: T.bg))
                    .animation(.easeInOut(duration: 0.18), value: selectMode)

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

                    ScrollView {
                        VStack(spacing: 0) {
                            FilterPills(selected: $filter)
                                .padding(.top, 4)
                                .padding(.bottom, 8)

                            if filteredThreads.isEmpty {
                                ChatEmptyState(filter: filter)
                                    .padding(.top, 80)
                            } else {
                                TSectionTitle(title: "Inbox",
                                              action: "MARK ALL READ",
                                              onAction: { appState.markAllThreadsRead() })
                                VStack(spacing: 0) {
                                    SBox(size: .md, raised: true) {
                                        VStack(spacing: 0) {
                                            ForEach(Array(filteredThreads.enumerated()), id: \.element.id) { (i, t) in
                                                threadRow(t)
                                                if i < filteredThreads.count - 1 {
                                                    SLine().padding(.leading, 60)
                                                }
                                            }
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.bottom, 24)
                            }
                        }
                        .animation(.easeInOut(duration: 0.18), value: filter)
                    }
                    .scrollIndicators(.hidden)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { key in
                ThreadDetailView(threadKey: key)
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
        }
    }

    private func exitSelectMode() {
        withAnimation(.easeInOut(duration: 0.2)) {
            selectMode = false
            selectedKeys = []
        }
    }
}

// MARK: - Filter pills

private struct FilterPills: View {
    @Binding var selected: ChatFilter
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(ChatFilter.allCases, id: \.self) { f in
                    let on = f == selected
                    Button { withAnimation(.easeInOut(duration: 0.18)) { selected = f } } label: {
                        Text(f.label)
                            .font(TTypo.xsBold(12))
                            .foregroundStyle(on ? .white : Color(hex: T.ink))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Capsule().fill(on ? Color(hex: T.sky) : Color(hex: T.surface)))
                            .overlay(Capsule().stroke(on ? Color(hex: T.sky) : Color(hex: T.hair), lineWidth: 1))
                            .shadow(color: on ? Color(hex: T.sky).opacity(T.skyShadowOpacity) : .clear,
                                    radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
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

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
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
                Avatar(initials: initials, size: 40, fill: avatarColor)
            } else if !participants.isEmpty {
                ParticipantStack(people: participants,
                                 avatarSize: 22,
                                 overlap: 9,
                                 maxShown: 3)
                    .frame(width: 40, alignment: .leading)
            } else {
                // Fallback for a thread with no decodable participants
                // (e.g. server returned messages whose authorIds don't
                // match any person we know about — shouldn't normally
                // happen, but keeps the row from rendering blank).
                ZStack {
                    RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous)
                        .fill(Color(hex: T.surface))
                    RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous)
                        .stroke(Color(hex: T.hair), lineWidth: 1)
                    Text("#").font(.custom(TFontName.bold.rawValue, size: 18))
                        .foregroundStyle(Color(hex: T.muted))
                }
                .frame(width: 40, height: 40)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(thread.displayTitle)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    Text(subtitle)
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if thread.unreadCount > 0 {
                        Text("\(thread.unreadCount)")
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(.white)
                            .tnum()
                            .padding(.horizontal, 6)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Capsule().fill(Color(hex: T.sky)))
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
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
    @State private var newText = ""
    @State private var isSending = false
    @State private var sendError: String? = nil
    @State private var myMessageIds: Set<String> = []

    // Always live — recomputes whenever appState.messages changes
    var liveMessages: [Message] {
        appState.messages
            .filter { $0.threadKey == threadKey }
            .sorted { $0.timestamp < $1.timestamp }
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
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                ThreadHeader(title: displayTitle,
                             participants: threadParticipants,
                             onBack: { dismiss() })

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            if liveMessages.isEmpty {
                                Text("No messages yet. Say hello!")
                                    .font(.subheadline)
                                    .foregroundColor(Color(hex: T.muted))
                                    .padding(.top, 40)
                            }
                            ForEach(liveMessages) { msg in
                                MessageBubble(message: msg, isMe: isMyMessage(msg))
                                    .id(msg.id)
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
                    }
                }

                HStack(spacing: 10) {
                    TextField("Message…", text: $newText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .foregroundColor(Color(hex: T.text))
                        .padding(10)
                        .background(Color(hex: T.surface))
                        .cornerRadius(20)
                        .overlay(Capsule().stroke(Color(hex: T.border), lineWidth: 1))
                        .lineLimit(1...5)

                    Button {
                        Task { await sendMessage() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                            .foregroundColor(newText.trimmingCharacters(in: .whitespaces).isEmpty ? Color(hex: T.muted) : Color(hex: T.accent))
                    }
                    .buttonStyle(.plain)
                    .disabled(newText.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .traqsToolbar()
                .padding(.horizontal, 12)
                .padding(.bottom, 6)

                if let err = sendError {
                    Text(err)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 4)
                }
            }
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

    private func sendMessage() async {
        let text = newText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        isSending = true
        sendError = nil

        let authorId    = appState.currentPerson?.id    ?? appState.currentPersonId ?? UUID().uuidString
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
            attachments: [],
            timestamp: ISO8601DateFormatter().string(from: Date())
        )
        newText = ""
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
                Circle()
                    .fill(Color(hex: message.authorColor))
                    .frame(width: 28, height: 28)
                    .overlay(Text(String(message.authorName.prefix(1))).font(.caption2.bold()).foregroundColor(.white))
            }

            VStack(alignment: isMe ? .trailing : .leading, spacing: 2) {
                if !isMe {
                    Text(message.authorName).font(.caption2).foregroundColor(Color(hex: T.muted))
                }
                Text(message.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(isMe ? Color(hex: T.accent) : Color(hex: T.card))
                    .foregroundColor(isMe ? .white : Color(hex: T.text))
                    .cornerRadius(18)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(isMe ? Color.clear : Color(hex: T.border), lineWidth: 1)
                    )
                    .contentShape(RoundedRectangle(cornerRadius: 18))
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

// MARK: - Thread Header (back · title · participant avatars)

private struct ThreadHeader: View {
    let title: String
    let participants: [Person]
    let onBack: () -> Void

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

            Text(title)
                .font(TTypo.smBold(15))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: 8)

            if !participants.isEmpty {
                ParticipantStack(people: participants)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 14)
        .background(Color(hex: T.bg))
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
                       fill: Color(hex: p.color))
                    .overlay(Circle().stroke(Color(hex: T.bg), lineWidth: 2))
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
                .overlay(Circle().stroke(Color(hex: T.bg), lineWidth: 2))
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
}
