import SwiftUI

struct MessagesView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var selectedThreadKey: String? = nil
    @State private var showNewGroup = false

    var threads: [MessageThread] {
        Dictionary(grouping: appState.messages, by: \.threadKey)
            .map { key, msgs in
                MessageThread(
                    key: key,
                    messages: msgs.sorted { $0.timestamp < $1.timestamp }
                )
            }
            .sorted { ($0.messages.last?.timestamp ?? "") > ($1.messages.last?.timestamp ?? "") }
    }

    var body: some View {
        NavigationSplitView {
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

                    // ── Sub-header: New thread ──
                    HStack {
                        Spacer()
                        Button { showNewGroup = true } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(Color(hex: T.accent))
                                .frame(width: 32, height: 32)
                                .background(Color(hex: T.accent).opacity(0.12))
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color(hex: T.surface))

                    List(threads, selection: $selectedThreadKey) { thread in
                        ThreadRow(thread: thread)
                            .tag(thread.key)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .refreshable { await appState.loadAll() }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showNewGroup) {
                NewGroupSheet { name in
                    selectedThreadKey = "group:\(name)"
                }
            }
        } detail: {
            if let key = selectedThreadKey,
               let thread = threads.first(where: { $0.key == key }) {
                ThreadDetailView(thread: thread)
            } else {
                ZStack {
                    Color(hex: T.bg).ignoresSafeArea()
                    ContentUnavailableView("Select a Thread", systemImage: "bubble.left.and.bubble.right", description: Text("Choose a conversation to view messages."))
                }
            }
        }
        .task { await appState.refreshMessages() }
    }
}

struct MessageThread: Identifiable {
    let key: String
    let messages: [Message]
    var id: String { key }

    var displayTitle: String {
        if key.hasPrefix("job:") { return "Job: \(key.dropFirst(4))" }
        if key.hasPrefix("panel:") { return "Panel: \(key.dropFirst(6))" }
        if key.hasPrefix("op:") { return "Op: \(key.dropFirst(3))" }
        if key.hasPrefix("group:") { return "Group: \(key.dropFirst(6))" }
        return key
    }

    var lastMessage: Message? { messages.last }
    var unreadCount: Int { 0 }
}

struct ThreadRow: View {
    let thread: MessageThread

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color(hex: thread.lastMessage?.authorColor ?? T.accent).opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: thread.key.hasPrefix("group") ? "person.3" : "bubble.left")
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

struct ThreadDetailView: View {
    @Environment(AppState.self) private var appState
    let thread: MessageThread
    @State private var newText = ""
    @State private var isSending = false

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                // Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(thread.messages) { msg in
                                MessageBubble(message: msg, isMe: msg.authorId == appState.currentPersonId)
                                    .id(msg.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: thread.messages.count) {
                        if let last = thread.messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                // Divider
                Rectangle()
                    .fill(Color(hex: T.border))
                    .frame(height: 1)

                // Input
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
            }
        }
        .navigationTitle(thread.displayTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private func sendMessage() async {
        guard let person = appState.currentPerson else { return }
        let text = newText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        isSending = true
        let msg = Message(
            id: UUID().uuidString,
            threadKey: thread.key,
            scope: thread.key.components(separatedBy: ":").first ?? "job",
            jobId: nil, panelId: nil, opId: nil,
            text: text,
            authorId: person.id,
            authorName: person.name,
            authorColor: person.color,
            participantIds: [person.id],
            attachments: [],
            timestamp: ISO8601DateFormatter().string(from: Date())
        )
        newText = ""
        await appState.sendMessage(msg)
        isSending = false
    }
}

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
                    .foregroundColor(Color(hex: T.text))
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
    @Environment(\.dismiss) private var dismiss
    let onCreate: (String) -> Void

    @State private var groupName = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

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
                        Text("Create a new message group for your team.")
                            .font(.subheadline)
                            .foregroundColor(Color(hex: T.muted))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                    .padding(.top, 16)

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

                    Spacer()
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
