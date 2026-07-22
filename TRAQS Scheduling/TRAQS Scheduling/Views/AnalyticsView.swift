import SwiftUI
import Charts

struct AnalyticsView: View {
    @Environment(AppState.self) private var appState

    // Admins see the whole team (everyone's aggregate); everyone else sees only
    // their own stats (task 5).
    private var isAdmin: Bool { appState.isAdmin }
    private var myId: String? { appState.currentPersonId }

    // Admin-only employee filter. nil = "Everyone" (team overview); otherwise a
    // person id whose personal stats are shown (same rule as the web app).
    @State private var selectedPersonId: String? = nil
    /// Whose personal stats to compute: an admin's picked employee, else self.
    private var activePersonId: String? { selectedPersonId ?? myId }
    /// True for the self view (non-admin, or an admin who hasn't picked anyone) —
    /// drives the "My …" vs. neutral card labels.
    private var isViewingSelf: Bool { selectedPersonId == nil }

    // MARK: - Org-wide (admin) computed

    var statusCounts: [(status: JobStatus, count: Int)] {
        JobStatus.allCases.map { s in
            (s, appState.jobs.filter { $0.status == s }.count)
        }.filter { $0.count > 0 }
    }

    var priorityCounts: [(priority: Priority, count: Int)] {
        Priority.allCases.map { p in
            (p, appState.jobs.filter { $0.pri == p }.count)
        }.filter { $0.count > 0 }
    }

    var completionRate: Double {
        guard !appState.jobs.isEmpty else { return 0 }
        let done = appState.jobs.filter { $0.status == .finished }.count
        return Double(done) / Double(appState.jobs.count) * 100
    }

    var teamWorkload: [(name: String, count: Int)] {
        appState.people.map { person in
            let count = appState.jobs.flatMap { $0.subs }.flatMap { $0.subs }
                .filter { $0.team.contains(person.id) && $0.status != .finished }
                .count
            return (person.name, count)
        }
        .filter { $0.count > 0 }
        .sorted { $0.count > $1.count }
    }

    /// Average active operations per person who has any active work — the
    /// "everyone's average" figure for the admin view.
    private var avgActivePerPerson: Double {
        guard !teamWorkload.isEmpty else { return 0 }
        let total = teamWorkload.reduce(0) { $0 + $1.count }
        return Double(total) / Double(teamWorkload.count)
    }

    // MARK: - Personal (non-admin) computed

    /// All operations the active person (self or picked employee) is on the team for.
    private var myOps: [Operation] {
        guard let pid = activePersonId else { return [] }
        return appState.jobs.flatMap { $0.subs }.flatMap { $0.subs }
            .filter { $0.team.contains(pid) }
    }
    private var myDone: Int { myOps.filter { $0.status == .finished }.count }
    private var myActive: Int { myOps.filter { $0.status == .inProgress }.count }
    private var myTotal: Int { myOps.count }
    private var myCompletion: Double { myTotal > 0 ? Double(myDone) / Double(myTotal) * 100 : 0 }
    private var myStatusCounts: [(status: JobStatus, count: Int)] {
        JobStatus.allCases.map { s in (s, myOps.filter { $0.status == s }.count) }
            .filter { $0.count > 0 }
    }

    // MARK: - Header helpers

    /// Page subtitle: self, team overview, or the picked employee's first name.
    private var subtitleText: String {
        if !isAdmin { return "Your stats" }
        if let pid = selectedPersonId,
           let p = appState.people.first(where: { $0.id == pid }) {
            let first = p.name.split(separator: " ").first.map(String.init) ?? p.name
            return "\(first)’s stats"
        }
        return "Team overview"
    }

    /// Admin-only employee menu. "Everyone" pinned on top (team overview), a
    /// divider, then every person — styled as a TRAQS frosted pill.
    @ViewBuilder
    private var employeePicker: some View {
        let selected = selectedPersonId.flatMap { pid in appState.people.first(where: { $0.id == pid }) }
        Menu {
            Button { selectedPersonId = nil } label: {
                if selectedPersonId == nil { Label("Everyone", systemImage: "checkmark") } else { Text("Everyone") }
            }
            Divider()
            ForEach(appState.people.sorted { $0.name < $1.name }) { p in
                Button { selectedPersonId = p.id } label: {
                    if selectedPersonId == p.id { Label(p.name, systemImage: "checkmark") } else { Text(p.name) }
                }
            }
        } label: {
            HStack(spacing: 8) {
                if let selected {
                    Circle().fill(Color(hex: selected.color)).frame(width: 9, height: 9)
                    Text(selected.name).font(TTypo.smBold(13)).foregroundStyle(Color(hex: T.ink)).lineLimit(1)
                } else {
                    Image(systemName: "person.2.fill").font(.system(size: 12)).foregroundStyle(Color(hex: T.muted))
                    Text("Everyone").font(TTypo.smBold(13)).foregroundStyle(Color(hex: T.ink))
                }
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color(hex: T.muted))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frostedCard(radius: T.cornerMd)
        }
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                TRAQSNavHeader()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        // Employee picker (admin only) — top-left, above the title.
                        if isAdmin {
                            employeePicker
                                .padding(.horizontal, 16)
                        }

                        PageTitle(title: "Stats", subtitle: subtitleText)
                            .padding(.bottom, 4)

                        // Non-admin → own stats. Admin → team overview, unless an
                        // employee is picked, then that person's personal stats.
                        if isAdmin && selectedPersonId == nil { adminContent } else { personalContent }
                    }
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                }
            }
        }
        .navigationTitle("Analytics")
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        // Stats are computed from jobs/people; pull the latest the instant the
        // page opens instead of waiting for the next Ably event or 15s poll.
        // Coalesced + rehydrates only on a real change, so no spurious re-render.
        .task { appState.foregroundSync() }
    }

    // MARK: - Personal content (each person's own stats)

    @ViewBuilder
    private var personalContent: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            AnalyticsStatTile(label: isViewingSelf ? "My Jobs Done" : "Jobs Done",
                              value: "\(myDone)",
                              accent: Color(hex: T.statusFinished))
            AnalyticsStatTile(label: "Completion",
                              value: String(format: "%.0f%%", myCompletion),
                              accent: Color(hex: T.accentGradientStart))
            AnalyticsStatTile(label: "In Progress",
                              value: "\(myActive)",
                              accent: Color(hex: T.statusInProgress))
            AnalyticsStatTile(label: "Total Ops",
                              value: "\(myTotal)",
                              accent: Color(hex: T.statusOnHold))
        }
        .padding(.horizontal, 16)

        if !myStatusCounts.isEmpty {
            statusChartCard(title: isViewingSelf ? "My Jobs by Status" : "Jobs by Status", data: myStatusCounts)
        } else {
            VStack(spacing: 6) {
                Text("No assigned operations yet")
                    .font(TTypo.h3(16))
                    .foregroundStyle(Color(hex: T.ink))
                Text(isViewingSelf ? "Your stats appear here once you're on a job." : "Stats appear here once they're on a job.")
                    .font(TTypo.xs(12))
                    .foregroundStyle(Color(hex: T.muted))
            }
            .frame(maxWidth: .infinity)
            .padding(28)
            .frostedCard(radius: T.cornerHero)
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Admin content (everyone's aggregate)

    @ViewBuilder
    private var adminContent: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            AnalyticsStatTile(label: "Total Jobs",
                              value: "\(appState.jobs.count)",
                              accent: Color(hex: T.accentGradientStart))
            AnalyticsStatTile(label: "Completion",
                              value: String(format: "%.0f%%", completionRate),
                              accent: Color(hex: T.statusFinished))
            AnalyticsStatTile(label: "In Progress",
                              value: "\(appState.jobs.filter { $0.status == .inProgress }.count)",
                              accent: Color(hex: T.statusInProgress))
            AnalyticsStatTile(label: "Avg Ops / Person",
                              value: String(format: "%.1f", avgActivePerPerson),
                              accent: Color(hex: T.statusOnHold))
        }
        .padding(.horizontal, 16)

        if !statusCounts.isEmpty {
            statusChartCard(title: "Jobs by Status", data: statusCounts)
        }

        // Priority breakdown
        if !priorityCounts.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Jobs by Priority")
                    .font(TTypo.h3(18))
                    .foregroundStyle(Color(hex: T.ink))
                Chart(priorityCounts, id: \.priority) { item in
                    SectorMark(
                        angle: .value("Count", item.count),
                        innerRadius: .ratio(0.5),
                        angularInset: 2
                    )
                    .foregroundStyle(item.priority.color)
                    .annotation(position: .overlay) {
                        Text("\(item.count)").font(.caption.bold()).foregroundColor(item.priority.color.readableText)
                    }
                }
                .frame(height: 200)
                HStack(spacing: 16) {
                    ForEach(priorityCounts, id: \.priority) { item in
                        HStack(spacing: 5) {
                            Circle().fill(item.priority.color).frame(width: 8, height: 8)
                            Text(item.priority.rawValue).font(.caption).foregroundColor(Color(hex: T.muted))
                        }
                    }
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frostedCard(radius: T.cornerHero)
            .padding(.horizontal, 16)
        }

        // Team workload
        if !teamWorkload.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Team Workload (Active Ops)")
                    .font(TTypo.h3(18))
                    .foregroundStyle(Color(hex: T.ink))
                Chart(teamWorkload, id: \.name) { item in
                    BarMark(
                        x: .value("Name", item.name),
                        y: .value("Tasks", item.count)
                    )
                    .foregroundStyle(T.brandGradient(start: .bottom, end: .top))
                    .cornerRadius(6)
                    .annotation(position: .top) {
                        Text("\(item.count)").font(.caption).foregroundColor(Color(hex: T.muted))
                    }
                }
                .chartXAxis {
                    AxisMarks { _ in
                        AxisValueLabel().foregroundStyle(Color(hex: T.muted))
                    }
                }
                .chartYAxis(.hidden)
                .frame(height: 180)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frostedCard(radius: T.cornerHero)
            .padding(.horizontal, 16)
        }
    }

    // Shared horizontal bar-by-status card used by both views.
    private func statusChartCard(title: String, data: [(status: JobStatus, count: Int)]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(TTypo.h3(18))
                .foregroundStyle(Color(hex: T.ink))
            Chart(data, id: \.status) { item in
                BarMark(
                    x: .value("Count", item.count),
                    y: .value("Status", item.status.rawValue)
                )
                .foregroundStyle(item.status.color)
                .cornerRadius(6)
                .annotation(position: .trailing) {
                    Text("\(item.count)").font(.caption).foregroundColor(Color(hex: T.muted))
                }
            }
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks { _ in
                    AxisValueLabel().foregroundStyle(Color(hex: T.muted))
                }
            }
            .frame(height: CGFloat(data.count * 44))
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frostedCard(radius: T.cornerHero)
        .padding(.horizontal, 16)
    }
}

// MARK: - AnalyticsStatTile (private)
// Frosted summary card matching the Stats wireframe: uppercase muted label,
// large bold value, and a bright tinted accent bar at the bottom. Styling-only
// helper local to this file.
private struct AnalyticsStatTile: View {
    let label: String
    let value: String
    var accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label.uppercased())
                .font(TTypo.xsBold(11))
                .tLabel(tracking: 1.0)
                .foregroundStyle(Color(hex: T.muted))
            Text(value)
                .font(.custom(TFontName.bold.rawValue, size: 30))
                .foregroundStyle(Color(hex: T.ink))
            Capsule()
                .fill(accent)
                .frame(width: 32, height: 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .frostedCard(radius: T.cornerMd)
    }
}
