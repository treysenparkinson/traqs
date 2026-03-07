import SwiftUI

struct FastTRAQSView: View {
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss

    struct ChatMessage: Identifiable {
        let id = UUID()
        let text: String
        let isUser: Bool
    }

    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isThinking = false

    private let suggestions = [
        "What jobs are due this week?",
        "Who has the most active tasks?",
        "Which jobs are on hold?",
        "Show me In Progress jobs",
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

                VStack(spacing: 0) {
                    // Messages
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                if messages.isEmpty {
                                    emptyState
                                }
                                ForEach(messages) { msg in
                                    FastChatBubble(message: msg).id(msg.id)
                                }
                                if isThinking {
                                    thinkingIndicator.id("thinking")
                                }
                            }
                            .padding()
                        }
                        .onChange(of: messages.count) {
                            withAnimation { proxy.scrollTo(messages.last?.id, anchor: .bottom) }
                        }
                        .onChange(of: isThinking) {
                            if isThinking { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } }
                        }
                    }

                    Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                    // Input bar
                    HStack(spacing: 10) {
                        TextField("Ask anything…", text: $input, axis: .vertical)
                            .textFieldStyle(.plain)
                            .foregroundColor(Color(hex: T.text))
                            .padding(10)
                            .background(Color(hex: T.surface))
                            .cornerRadius(20)
                            .overlay(Capsule().stroke(Color(hex: T.border), lineWidth: 1))
                            .lineLimit(1...4)

                        Button { Task { await ask() } } label: {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.title2)
                                .foregroundColor(
                                    input.trimmingCharacters(in: .whitespaces).isEmpty || isThinking
                                        ? Color(hex: T.muted)
                                        : Color(hex: T.accent)
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isThinking)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color(hex: T.surface))
                }
            }
            .navigationTitle("Ask TRAQS")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundColor(Color(hex: T.accent))
                }
            }
        }
    }

    // MARK: - Empty State

    private var isAdmin: Bool { appState.currentPerson?.isAdmin ?? false }

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color(hex: T.accent).opacity(0.12))
                    .frame(width: 72, height: 72)
                Image(systemName: "bolt.fill")
                    .font(.system(size: 30))
                    .foregroundColor(Color(hex: T.accent))
            }
            Text("Ask TRAQS")
                .font(.title3.bold())
                .foregroundColor(Color(hex: T.text))
            Text(isAdmin
                 ? "Ask anything about your schedule, jobs, team, or deadlines — or request changes."
                 : "Ask anything about your schedule, jobs, team, or deadlines.")
                .foregroundColor(Color(hex: T.muted))
                .multilineTextAlignment(.center)
                .font(.subheadline)
                .padding(.horizontal, 24)

            if !isAdmin {
                HStack(spacing: 4) {
                    Image(systemName: "lock.fill").font(.system(size: 10))
                    Text("Read-only mode").font(.caption2.bold())
                }
                .foregroundColor(Color(hex: T.muted))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color(hex: T.surface))
                .cornerRadius(10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
            }

            VStack(spacing: 8) {
                ForEach(suggestions, id: \.self) { s in
                    Button {
                        input = s
                        Task { await ask() }
                    } label: {
                        Text(s)
                            .font(.caption)
                            .foregroundColor(Color(hex: T.text))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Color(hex: T.surface))
                            .cornerRadius(20)
                            .overlay(Capsule().stroke(Color(hex: T.border), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 32)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Thinking Indicator

    private var thinkingIndicator: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Circle()
                .fill(Color(hex: T.accent).opacity(0.12))
                .frame(width: 28, height: 28)
                .overlay(
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 12))
                        .foregroundColor(Color(hex: T.accent))
                )
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle().fill(Color(hex: T.muted)).frame(width: 6, height: 6)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Color(hex: T.card))
            .cornerRadius(18)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: T.border), lineWidth: 1))
            Spacer(minLength: 60)
        }
    }

    // MARK: - Ask

    private func ask() async {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, let token = auth.accessToken else { return }
        input = ""
        messages.append(.init(text: text, isUser: true))
        isThinking = true

        let api = APIService(token: token, orgCode: appState.orgCode)

        let jobSummaries = appState.jobs.prefix(30).map {
            "\($0.title) [#\($0.jobNumber ?? "-"), \($0.status.rawValue), \($0.start)→\($0.end)]"
        }.joined(separator: "; ")

        let teamList = appState.people.map { "\($0.name) (\($0.role))" }.joined(separator: ", ")
        let clientList = appState.clients.map { $0.name }.joined(separator: ", ")
        let isAdmin = appState.currentPerson?.isAdmin ?? false

        let system: String
        if isAdmin {
            system = """
            You are Ask TRAQS, a scheduling assistant with full edit capabilities.
            You can suggest and describe changes to jobs, schedules, panels, and operations.
            Jobs: \(jobSummaries)
            Team: \(teamList)
            Clients: \(clientList)
            When the user asks to make a change, describe exactly what would change and confirm.
            Keep responses concise and focused.
            """
        } else {
            system = """
            You are Ask TRAQS, a read-only scheduling assistant.
            You can answer questions about the schedule but cannot make changes.
            Jobs: \(jobSummaries)
            Team: \(teamList)
            Clients: \(clientList)
            If asked to make changes, politely explain you don't have permission and suggest contacting an admin.
            Keep responses concise and focused.
            """
        }

        do {
            let reply = try await api.askAI(system: system, userMessage: text)
            messages.append(.init(text: reply, isUser: false))
        } catch {
            messages.append(.init(text: "Error: \(error.localizedDescription)", isUser: false))
        }
        isThinking = false
    }
}

// MARK: - Chat Bubble

struct FastChatBubble: View {
    let message: FastTRAQSView.ChatMessage

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.isUser { Spacer(minLength: 60) }

            if !message.isUser {
                Circle()
                    .fill(Color(hex: T.accent).opacity(0.12))
                    .frame(width: 28, height: 28)
                    .overlay(
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 12))
                            .foregroundColor(Color(hex: T.accent))
                    )
            }

            Text(message.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(message.isUser ? Color(hex: T.accent) : Color(hex: T.card))
                .foregroundColor(Color(hex: T.text))
                .cornerRadius(18)
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(message.isUser ? Color.clear : Color(hex: T.border), lineWidth: 1)
                )

            if !message.isUser { Spacer(minLength: 60) }
        }
    }
}
