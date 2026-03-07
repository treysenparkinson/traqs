import SwiftUI

struct AskTRAQSView: View {
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
                                    AskChatBubble(message: msg).id(msg.id)
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

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color(hex: T.accent).opacity(0.12))
                    .frame(width: 72, height: 72)
                Image(systemName: "cpu.fill")
                    .font(.system(size: 30))
                    .foregroundColor(Color(hex: T.accent))
            }
            Text("Ask TRAQS")
                .font(.title3.bold())
                .foregroundColor(Color(hex: T.text))
            Text("Ask anything about your schedule, jobs, team, or deadlines.")
                .foregroundColor(Color(hex: T.muted))
                .multilineTextAlignment(.center)
                .font(.subheadline)
                .padding(.horizontal, 24)

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
                    Image(systemName: "cpu.fill")
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

        let system = """
        You are TRAQS AI, a scheduling assistant. Answer questions clearly and helpfully.
        Jobs: \(jobSummaries)
        Team: \(appState.people.map { "\($0.name) (\($0.role))" }.joined(separator: ", "))
        Clients: \(appState.clients.map { $0.name }.joined(separator: ", "))
        Keep responses concise and focused.
        """

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

struct AskChatBubble: View {
    let message: AskTRAQSView.ChatMessage

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.isUser { Spacer(minLength: 60) }

            if !message.isUser {
                Circle()
                    .fill(Color(hex: T.accent).opacity(0.12))
                    .frame(width: 28, height: 28)
                    .overlay(
                        Image(systemName: "cpu.fill")
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
