import SwiftUI
import Charts

struct AnalyticsView: View {
    @Environment(AppState.self) private var appState

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

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Summary cards
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        StatCard(label: "Total Jobs", value: "\(appState.jobs.count)", color: Color(hex: T.accent))
                        StatCard(label: "Completion", value: String(format: "%.0f%%", completionRate), color: Color(hex: T.statusFinished))
                        StatCard(label: "In Progress", value: "\(appState.jobs.filter { $0.status == .inProgress }.count)", color: Color(hex: T.statusInProgress))
                        StatCard(label: "Eng Queue", value: "\(appState.engineeringQueue.count)", color: Color(hex: T.statusOnHold))
                    }

                    // Status breakdown
                    if !statusCounts.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Jobs by Status").font(.headline).foregroundColor(Color(hex: T.text))
                            Chart(statusCounts, id: \.status) { item in
                                BarMark(
                                    x: .value("Count", item.count),
                                    y: .value("Status", item.status.rawValue)
                                )
                                .foregroundStyle(item.status.color)
                                .cornerRadius(4)
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
                            .frame(height: CGFloat(statusCounts.count * 44))
                        }
                        .padding()
                        .background(Color(hex: T.card))
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                    }

                    // Priority breakdown
                    if !priorityCounts.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Jobs by Priority").font(.headline).foregroundColor(Color(hex: T.text))
                            Chart(priorityCounts, id: \.priority) { item in
                                SectorMark(
                                    angle: .value("Count", item.count),
                                    innerRadius: .ratio(0.5),
                                    angularInset: 2
                                )
                                .foregroundStyle(item.priority.color)
                                .annotation(position: .overlay) {
                                    Text("\(item.count)").font(.caption.bold()).foregroundColor(.white)
                                }
                            }
                            .frame(height: 200)
                            HStack(spacing: 16) {
                                ForEach(priorityCounts, id: \.priority) { item in
                                    HStack(spacing: 4) {
                                        Circle().fill(item.priority.color).frame(width: 8, height: 8)
                                        Text(item.priority.rawValue).font(.caption).foregroundColor(Color(hex: T.muted))
                                    }
                                }
                            }
                        }
                        .padding()
                        .background(Color(hex: T.card))
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                    }

                    // Team workload
                    if !teamWorkload.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Team Workload (Active Ops)").font(.headline).foregroundColor(Color(hex: T.text))
                            Chart(teamWorkload, id: \.name) { item in
                                BarMark(
                                    x: .value("Name", item.name),
                                    y: .value("Tasks", item.count)
                                )
                                .foregroundStyle(Color(hex: T.accent))
                                .cornerRadius(4)
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
                        .padding()
                        .background(Color(hex: T.card))
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Analytics")
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}
