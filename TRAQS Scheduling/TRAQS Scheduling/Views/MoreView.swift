import SwiftUI

// MARK: - MoreView

struct MoreView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var showFastTRAQS = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

                VStack(spacing: 0) {
                    // ── Logo header ──
                    HStack {
                        Spacer()
                        VStack(spacing: 2) {
                            TRAQSNavLogo()
                            Text("More")
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

                    List {
                        if appState.isAdmin {
                            Section("AI Tools") {
                                Button {
                                    showFastTRAQS = true
                                } label: {
                                    Label("Ask TRAQS", systemImage: "bolt.fill")
                                        .foregroundColor(Color(hex: T.accent))
                                }
                                .listRowBackground(Color(hex: T.card))
                            }
                        }

                        Section {
                            NavigationLink {
                                ClientsView()
                            } label: {
                                Label("Clients", systemImage: "building.2")
                                    .foregroundColor(Color(hex: T.text))
                            }
                            .listRowBackground(Color(hex: T.card))

                            NavigationLink {
                                AnalyticsView()
                            } label: {
                                Label("Analytics", systemImage: "chart.pie")
                                    .foregroundColor(Color(hex: T.text))
                            }
                            .listRowBackground(Color(hex: T.card))

                            NavigationLink {
                                TeamView()
                            } label: {
                                Label("Team", systemImage: "person.3")
                                    .foregroundColor(Color(hex: T.text))
                            }
                            .listRowBackground(Color(hex: T.card))

                            NavigationLink {
                                CustomizeView()
                            } label: {
                                Label("Customize", systemImage: "paintpalette.fill")
                                    .foregroundColor(Color(hex: T.text))
                            }
                            .listRowBackground(Color(hex: T.card))
                        }

                        Section {
                            Button(role: .destructive) {
                                auth.logout()
                                appState.orgCode = ""
                                KeychainHelper.delete(forKey: KeychainHelper.orgCodeKey)
                            } label: {
                                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                                    .foregroundColor(Color(hex: T.danger))
                            }
                            .listRowBackground(Color(hex: T.card))
                        }
                    }
                    .listStyle(.insetGrouped)
                    .scrollContentBackground(.hidden)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showFastTRAQS) { FastTRAQSView() }
            .safeAreaInset(edge: .bottom) {
                if let person = appState.currentPerson {
                    VStack(spacing: 0) {
                        Rectangle().fill(Color(hex: T.border)).frame(height: 1)
                        HStack(spacing: 10) {
                            Circle()
                                .fill(Color(hex: person.color))
                                .frame(width: 32, height: 32)
                                .overlay(
                                    Text(String(person.name.prefix(1)).uppercased())
                                        .font(.caption.bold())
                                        .foregroundColor(.white)
                                )
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text("Signed in as")
                                        .font(.caption)
                                        .foregroundColor(Color(hex: T.muted))
                                    Text(person.name)
                                        .font(.caption.bold())
                                        .foregroundColor(Color(hex: T.text))
                                    if person.isAdmin {
                                        Text("Admin")
                                            .font(.caption2.bold())
                                            .padding(.horizontal, 5).padding(.vertical, 2)
                                            .background(Color(hex: T.eng).opacity(0.2))
                                            .foregroundColor(Color(hex: T.eng))
                                            .cornerRadius(4)
                                    }
                                }
                                Text(person.email)
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            Spacer()
                            Text(appState.orgCode)
                                .font(.caption2.bold())
                                .foregroundColor(Color(hex: T.muted))
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(Color(hex: T.surface))
                                .cornerRadius(6)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: T.border), lineWidth: 1))
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color(hex: T.surface))
                    }
                }
            }
        }
    }
}
