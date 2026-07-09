import SwiftUI

struct ClientsView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var searchText = ""
    @State private var selectedClient: Client? = nil
    @State private var showAddClient = false
    @State private var showSearch = false
    @FocusState private var searchFocused: Bool

    var filteredClients: [Client] {
        guard !searchText.isEmpty else { return appState.clients }
        return appState.clients.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    // Count subtitle, e.g. "8 clients · 3 active jobs" — matches the Team
    // header's "5 on the clock · 2 on a job" language.
    private var clientSubtitle: String {
        let count = appState.clients.count
        let active = appState.jobs.filter { $0.status == .inProgress }.count
        let clientWord = count == 1 ? "client" : "clients"
        if active > 0 {
            return "\(count) \(clientWord) · \(active) active"
        }
        return "\(count) \(clientWord)"
    }

    var body: some View {
        NavigationSplitView {
            ZStack {
                AmbientBackground()

                VStack(spacing: 0) {
                    // Persistent header — search slides in below it; add lives in the trailing slot.
                    TRAQSNavHeader {
                        IconBtn(icon: .search, size: 18) {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                showSearch.toggle()
                                if !showSearch { searchText = "" }
                            }
                            if showSearch { searchFocused = true }
                        }
                        IconBtn(icon: .plus, size: 18) { showAddClient = true }
                    }
                    .background(Color(hex: T.bg))

                    PageTitle(title: "Clients", subtitle: clientSubtitle)
                        .padding(.bottom, 14)

                    // Search field — slides in under the title.
                    if showSearch {
                        SearchBar(text: $searchText,
                                  placeholder: "Search clients…",
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

                    List(filteredClients, selection: $selectedClient) { client in
                        ClientRow(client: client)
                            .tag(client)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .refreshable { await appState.loadAll() }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        } detail: {
            if let client = selectedClient {
                ClientDetailView(client: client)
            } else {
                ZStack {
                    AmbientBackground()
                    ContentUnavailableView("Select a Client", systemImage: "building.2", description: Text("Choose a client to view details."))
                }
            }
        }
        .sheet(isPresented: $showAddClient) {
            ClientEditView(client: nil)
        }
        // Reconcile with the server the instant this page opens, so navigating
        // here always shows the latest — not stale cache until the next Ably
        // event or poll. Coalesced + rehydrates only on a real change.
        .task { appState.foregroundSync() }
    }
}

struct ClientRow: View {
    @Environment(AppState.self) private var appState
    let client: Client

    var jobCount: Int {
        appState.jobs.filter { $0.clientId == client.id }.count
    }
    var activeCount: Int {
        appState.jobs.filter { $0.clientId == client.id && $0.status == .inProgress }.count
    }

    // Leading subtitle line: prefer a contact person, fall back to email.
    private var subtitle: String {
        client.contact.isEmpty ? client.email : client.contact
    }

    var body: some View {
        HStack(spacing: 12) {
            Avatar(initials: String(client.name.prefix(1)).uppercased(),
                   size: 44,
                   gradient: true)

            VStack(alignment: .leading, spacing: 2) {
                Text(client.name)
                    .font(TTypo.smBold(15))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
            }

            Spacer()

            if activeCount > 0 {
                TagPill(label: "\(activeCount) active", kind: .green)
            } else if jobCount > 0 {
                TagPill(label: "\(jobCount) \(jobCount == 1 ? "job" : "jobs")", kind: .neutral)
            }

            TIconView(icon: .chev, size: 14, color: Color(hex: T.muted))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frostedCard(radius: T.cornerMd)
    }
}

struct ClientDetailView: View {
    @Environment(AppState.self) private var appState
    let client: Client
    @State private var showEdit = false

    var clientJobs: [Job] {
        appState.jobs.filter { $0.clientId == client.id }
    }
    private var activeJobs: Int {
        clientJobs.filter { $0.status == .inProgress }.count
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // ── Header (hero) card ──
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 16) {
                            Avatar(initials: String(client.name.prefix(1)).uppercased(),
                                   size: 64,
                                   gradient: true)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(client.name)
                                    .font(.custom(TFontName.bold.rawValue, size: 22))
                                    .foregroundStyle(Color(hex: T.ink))
                                if !client.contact.isEmpty {
                                    Text(client.contact)
                                        .font(TTypo.sm(14))
                                        .foregroundStyle(Color(hex: T.muted))
                                }
                            }
                            Spacer()
                        }

                        // Status pills summarizing the client's workload.
                        HStack(spacing: 8) {
                            TagPill(label: "\(clientJobs.count) \(clientJobs.count == 1 ? "job" : "jobs")",
                                    kind: .indigo)
                            if activeJobs > 0 {
                                TagPill(label: "\(activeJobs) active", kind: .green, dot: true)
                            }
                        }
                    }
                    .padding(18)
                    .frostedCard(radius: T.cornerHero)

                    // ── Contact info ──
                    if !client.email.isEmpty || !client.phone.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Contact")
                                .font(TTypo.h3(18))
                                .foregroundStyle(Color(hex: T.ink))
                            if !client.email.isEmpty {
                                HStack(spacing: 12) {
                                    IconChip(icon: .chat, color: Color(hex: T.pillIndigoFg), size: 38)
                                    Text(client.email)
                                        .font(TTypo.sm(14))
                                        .foregroundStyle(Color(hex: T.ink))
                                }
                            }
                            if !client.phone.isEmpty {
                                HStack(spacing: 12) {
                                    IconChip(icon: .bell, color: Color(hex: T.pillGreenFg), size: 38)
                                    Text(client.phone)
                                        .font(TTypo.sm(14))
                                        .foregroundStyle(Color(hex: T.ink))
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18)
                        .frostedCard(radius: T.cornerMd)
                    }

                    // ── Jobs ──
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Jobs (\(clientJobs.count))")
                            .font(TTypo.h3(18))
                            .foregroundStyle(Color(hex: T.ink))
                        ForEach(clientJobs) { job in
                            JobRow(job: job)
                        }
                        if clientJobs.isEmpty {
                            Text("No jobs yet")
                                .font(TTypo.sm(14))
                                .foregroundStyle(Color(hex: T.muted))
                        }
                    }

                    // ── Notes ──
                    if !client.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Notes")
                                .font(TTypo.h3(18))
                                .foregroundStyle(Color(hex: T.ink))
                            Text(client.notes)
                                .font(TTypo.sm(14))
                                .foregroundStyle(Color(hex: T.muted))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18)
                        .frostedCard(radius: T.cornerMd)
                    }
                }
                .padding(16)
            }
        }
        .navigationTitle(client.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { showEdit = true }
                    .foregroundColor(Color(hex: T.accent))
            }
        }
        .sheet(isPresented: $showEdit) {
            ClientEditView(client: client)
        }
    }
}

struct ClientEditView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let client: Client?

    @State private var name = ""
    @State private var contact = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var notes = ""
    @State private var color = "#7c3aed"

    private let colorOptions = ["#7c3aed","#4f46e5","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#8b5cf6"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Info") {
                    TextField("Company Name", text: $name)
                    TextField("Contact Person", text: $contact)
                }
                Section("Contact") {
                    TextField("Email", text: $email).keyboardType(.emailAddress)
                    TextField("Phone", text: $phone).keyboardType(.phonePad)
                }
                Section("Color") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(colorOptions, id: \.self) { c in
                                Circle()
                                    .fill(Color(hex: c))
                                    .frame(width: 32, height: 32)
                                    .overlay(
                                        color == c ? Image(systemName: "checkmark").foregroundColor(.white).font(.caption.bold()) : nil
                                    )
                                    .onTapGesture { color = c }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                Section("Notes") {
                    TextEditor(text: $notes).frame(minHeight: 60)
                }
            }
            .navigationTitle(client == nil ? "New Client" : "Edit Client")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .onAppear { populate() }
    }

    private func populate() {
        guard let c = client else { return }
        name = c.name; contact = c.contact; email = c.email
        phone = c.phone; notes = c.notes; color = c.color
    }

    private func save() {
        let updated = Client(
            id: client?.id ?? UUID().uuidString,
            name: name.trimmingCharacters(in: .whitespaces),
            contact: contact, email: email, phone: phone,
            color: color, notes: notes
        )
        var list = appState.clients
        if let i = list.firstIndex(where: { $0.id == updated.id }) {
            list[i] = updated
        } else {
            list.append(updated)
        }
        appState.updateClients(list)
        dismiss()
    }
}
