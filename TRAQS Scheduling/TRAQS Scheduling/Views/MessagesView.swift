import SwiftUI

// MARK: - Message Tab

private enum MsgTab: String, CaseIterable {
    case direct = "Direct"
    case groups = "Groups"
}

// MARK: - MessagesView

struct MessagesView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var showNewGroup = false
    @State private var showNewDM = false
    @State private var tab: MsgTab = .groups
    @State private var navigationPath = NavigationPath()

    var allThreads: [MessageThread] {
        let myId = appState.currentPersonId
        return Dictionary(grouping: appState.messages, by: \.threadKey)
            .map { key, msgs in
                MessageThread(
                    key: key,
                    messages: msgs.sorted { $0.timestamp < $1.timestamp },
                    resolvedTitle: resolveTitle(key: key, myId: myId)
                )
            }
            .sorted { ($0.messages.last?.timestamp ?? "") > ($1.messages.last?.timestamp ?? "") }
    }

    var filteredThreads: [MessageThread] {
        switch tab {
        case .direct: return allThreads.filter { $0.key.hasPrefix("dm:") }
        case .groups:  return allThreads.filter { !$0.key.hasPrefix("dm:") }
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
                    // ── Logo header ──
                    HStack {
                        Spacer()
                        VStack(spacing: 2) {
                            TRAQSNavLogo()
                            Text("Messages")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(Color(hex: T.muted))
                                .kerning(0.8)
                                .textCase(.uppercase)
                        }
                        Spacer()
                    }
                    .padding(.top, 20)
                    .padding(.bottom, 14)
                    .background(Color(hex: T.surface))

                    Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                    // ── Sub-header: segmented picker + new thread button ──
                    ZStack {
                        Picker("", selection: $tab) {
                            Text("Direct").tag(MsgTab.direct)
                            Text("Groups").tag(MsgTab.groups)
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 180)

                        HStack {
                            Spacer()
                            Button {
                                if tab == .direct { showNewDM = true }
                                else { showNewGroup = true }
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(Color(hex: T.accent))
                                    .frame(width: 32, height: 32)
                                    .background(Color(hex: T.accent).opacity(0.12))
                                    .clipShape(Circle())
                                    .overlay(Circle().stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color(hex: T.surface))

                    if filteredThreads.isEmpty {
                        Spacer()
                        VStack(spacing: 10) {
                            Image(systemName: tab == .direct ? "person.fill" : "person.3.fill")
                                .font(.system(size: 36))
                                .foregroundColor(Color(hex: T.muted).opacity(0.5))
                            Text(tab == .direct ? "No direct messages" : "No group conversations")
                                .font(.subheadline)
                                .foregroundColor(Color(hex: T.muted))
                        }
                        Spacer()
                    } else {
                        List {
                            ForEach(filteredThreads) { thread in
                                NavigationLink(value: thread.key) {
                                    ThreadRow(thread: thread)
                                }
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                            }
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                        .refreshable { await appState.loadAll() }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            // ThreadDetailView receives just the key and reads messages live from appState
            .navigationDestination(for: String.self) { key in
                ThreadDetailView(threadKey: key)
            }
            .sheet(isPresented: $showNewGroup) {
                NewGroupSheet { name in
                    navigationPath.append("group:\(name)")
                }
            }
            .sheet(isPresented: $showNewDM) {
                NewDMSheet { personId in
                    guard let myId = appState.currentPersonId else { return }
                    let ids = [myId, personId].sorted()
                    tab = .direct
                    navigationPath.append("dm:\(ids.joined(separator: "_"))")
                }
            }
        }
        .task { await appState.refreshMessages() }
    }
}

// MARK: - MessageThread

struct MessageThread: Identifiable {
    let key: String
    let messages: [Message]
    var resolvedTitle: String? = nil
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
    var unreadCount: Int { 0 }
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

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
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

                Rectangle()
                    .fill(Color(hex: T.border))
                    .frame(height: 1)

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
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color(hex: T.surface))

                if let err = sendError {
                    Text(err)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 4)
                }
            }
        }
        .navigationTitle(displayTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
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

        let participantIds: [String]
        if scopeKey == "dm" {
            participantIds = idValue.components(separatedBy: "_")
        } else {
            participantIds = [authorId]
        }

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
                Text(message.timestamp.shortTimestamp)
                    .font(.system(size: 9))
                    .foregroundColor(Color(hex: T.muted))
            }

            if !isMe { Spacer(minLength: 40) }
        }
    }
}

// MARK: - New Group Sheet

struct NewGroupSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let onCreate: (String) -> Void

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
                            dismiss()
                            onCreate(name)
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
}
