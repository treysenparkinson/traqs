import SwiftUI

struct ClientsView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var searchText = ""
    @State private var selectedClient: Client? = nil
    @State private var showAddClient = false

    var filteredClients: [Client] {
        guard !searchText.isEmpty else { return appState.clients }
        return appState.clients.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
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
                            Text("Clients")
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

                    // ── Sub-header: Add ──
                    HStack {
                        Spacer()
                        Button { showAddClient = true } label: {
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

                    // Search bar
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(Color(hex: T.muted))
                        TextField("Search clients…", text: $searchText)
                            .textFieldStyle(.plain)
                            .foregroundColor(Color(hex: T.text))
                        if !searchText.isEmpty {
                            Button { searchText = "" } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(10)
                    .background(Color(hex: T.surface))
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                    List(filteredClients, selection: $selectedClient) { client in
                        ClientRow(client: client)
                            .tag(client)
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
        } detail: {
            if let client = selectedClient {
                ClientDetailView(client: client)
            } else {
                ZStack {
                    Color(hex: T.bg).ignoresSafeArea()
                    ContentUnavailableView("Select a Client", systemImage: "building.2", description: Text("Choose a client to view details."))
                }
            }
        }
        .sheet(isPresented: $showAddClient) {
            ClientEditView(client: nil)
        }
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

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(hex: client.color))
                .frame(width: 36, height: 36)
                .overlay(
                    Text(String(client.name.prefix(1)).uppercased())
                        .font(.headline.bold())
                        .foregroundColor(.white)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(client.name).font(.subheadline.bold()).foregroundColor(Color(hex: T.text))
                Text(client.contact.isEmpty ? client.email : client.contact)
                    .font(.caption).foregroundColor(Color(hex: T.muted))
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(jobCount) jobs").font(.caption).foregroundColor(Color(hex: T.muted))
                if activeCount > 0 {
                    Text("\(activeCount) active")
                        .font(.caption2.bold())
                        .foregroundColor(Color(hex: T.statusInProgress))
                }
            }
        }
        .padding(12)
        .background(Color(hex: T.card))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
    }
}

struct ClientDetailView: View {
    @Environment(AppState.self) private var appState
    let client: Client
    @State private var showEdit = false

    var clientJobs: [Job] {
        appState.jobs.filter { $0.clientId == client.id }
    }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header card
                    HStack(spacing: 16) {
                        Circle()
                            .fill(Color(hex: client.color))
                            .frame(width: 64, height: 64)
                            .overlay(
                                Text(String(client.name.prefix(1)).uppercased())
                                    .font(.largeTitle.bold())
                                    .foregroundColor(.white)
                            )
                        VStack(alignment: .leading, spacing: 4) {
                            Text(client.name).font(.title2.bold()).foregroundColor(Color(hex: T.text))
                            if !client.contact.isEmpty {
                                Text(client.contact).foregroundColor(Color(hex: T.muted))
                            }
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color(hex: T.card))
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))

                    // Contact info
                    if !client.email.isEmpty || !client.phone.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Contact").font(.headline).foregroundColor(Color(hex: T.text))
                            if !client.email.isEmpty {
                                Label(client.email, systemImage: "envelope")
                                    .font(.subheadline)
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            if !client.phone.isEmpty {
                                Label(client.phone, systemImage: "phone")
                                    .font(.subheadline)
                                    .foregroundColor(Color(hex: T.muted))
                            }
                        }
                        .padding()
                        .background(Color(hex: T.card))
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                    }

                    // Jobs
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Jobs (\(clientJobs.count))").font(.headline).foregroundColor(Color(hex: T.text))
                        ForEach(clientJobs) { job in
                            JobRow(job: job)
                        }
                        if clientJobs.isEmpty {
                            Text("No jobs yet").foregroundColor(Color(hex: T.muted)).font(.subheadline)
                        }
                    }

                    // Notes
                    if !client.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Notes").font(.headline).foregroundColor(Color(hex: T.text))
                            Text(client.notes).foregroundColor(Color(hex: T.muted))
                        }
                        .padding()
                        .background(Color(hex: T.card))
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                    }
                }
                .padding()
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
