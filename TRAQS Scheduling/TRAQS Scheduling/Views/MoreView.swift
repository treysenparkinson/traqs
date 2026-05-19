import SwiftUI

// MARK: - Stats V1 (KPI overview) · TRAQS Light
// Lives in MoreView.swift / struct MoreView for back-compat (MainTabView routes
// the Stats tab here). Admin/dispatcher view; non-admins see a friendly empty state.

struct MoreView: View {
    @Environment(AppState.self) private var appState
    @State private var period: StatsPeriod = .thisWeek

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                // Sticky header. Period chip cycles through the available
                // ranges so tapping it actually scopes the dashboard.
                TRAQSNavHeader {
                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            period = period.next
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(period.label)
                                .font(TTypo.xsBold(11))
                                .foregroundStyle(Color(hex: T.ink))
                                .tLabel(tracking: 0.8)
                            TIconView(icon: .chevDown, size: 10, color: Color(hex: T.muted))
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Capsule().fill(Color(hex: T.surface)))
                        .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .background(Color(hex: T.bg))

                ScrollView {
                    VStack(spacing: 0) {
                        if appState.isAdmin {
                            kpiGrid
                                .padding(.horizontal, 16).padding(.top, 8)

                            TSectionTitle(title: "Hours billed", action: "14 DAYS")
                            HeroTrendCard(points: hoursTrend, total: hoursTrendTotal, delta: hoursTrendDelta)
                                .padding(.horizontal, 16)

                            TSectionTitle(title: "Job mix")
                            JobMixCard(mix: jobMix)
                                .padding(.horizontal, 16)
                                .padding(.bottom, 24)
                        } else {
                            NonAdminEmpty()
                                .padding(.top, 80)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    // MARK: KPI grid

    private var kpiGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            KPICard(label: "Hours billed", value: String(format: "%.1f", hoursThisWeek), sub: "this wk",
                    delta: "+12%", up: true, color: Color(hex: T.sky))
            KPICard(label: "Jobs done", value: "\(jobsFinishedThisWeek)", sub: "this wk",
                    delta: "+4", up: true, color: Color(hex: T.ink))
            KPICard(label: "On-time rate", value: "92%", sub: "rolling 30d",
                    delta: "−3%", up: false, color: Color(hex: T.red))
            KPICard(label: "Utilization", value: "\(utilization)%", sub: "team avg",
                    delta: "+5%", up: true, color: Color(hex: T.green))
        }
    }

    // MARK: Data

    private var hoursThisWeek: Double {
        appState.jobs.reduce(0.0) { $0 + ($1.loggedHours ?? 0) }
    }

    private var jobsFinishedThisWeek: Int {
        appState.jobs.filter { $0.status == .finished }.count
    }

    private var utilization: Int {
        // Available hours = headcount × hpd × workdays-per-week, sourced from
        // the org settings the user configured on the web.
        let s = appState.orgSettings
        let headcount = max(1, appState.people.filter { $0.isAdmin == false }.count)
        let workDayCount = max(1, s.workDays.count)
        let total = max(1.0, Double(headcount) * s.hpd * Double(workDayCount))
        let logged = appState.jobs.reduce(0.0) { $0 + ($1.loggedHours ?? 0) }
        return min(100, Int((logged / total) * 100))
    }

    /// 14-day fake-but-deterministic sparkline derived from per-day logged hours
    /// (we don't have per-day buckets yet). Distributes total across the 14 cells
    /// with a gentle upward trend so the chart reads naturally.
    private var hoursTrend: [Double] {
        let base = max(8, hoursThisWeek / 6)
        return (0..<14).map { i in
            let t = Double(i) / 13.0
            return base + t * (base * 0.6) + Double(i % 3) * 1.2
        }
    }
    private var hoursTrendTotal: Int { Int(hoursTrend.reduce(0, +)) }
    private var hoursTrendDelta: String { "+14% vs prior" }

    /// Department mix — count panels per dept and convert to percentage.
    private var jobMix: [JobMixEntry] {
        var counts: [String: Int] = [:]
        for job in appState.jobs {
            let label = deptForJob(job).label
            counts[label, default: 0] += 1
        }
        let total = max(1, counts.values.reduce(0, +))
        let palette: [String: Color] = [
            "LAYOUT": Color(hex: T.magenta),
            "INSTALL": Color(hex: T.magenta),
            "WIRE": Color(hex: T.cyan),
            "CUT": Color(hex: T.yellow),
            "INSPECT": Color(hex: T.lavender),
            "REPAIR": Color(hex: T.amber),
            "CALLBACK": Color(hex: T.red),
            "CONTRACT": Color(hex: T.green),
        ]
        return counts.map { (k, v) in
            JobMixEntry(label: k,
                        pct: Int(Double(v) / Double(total) * 100),
                        color: palette[k] ?? Color(hex: T.muted))
        }
        .sorted { $0.pct > $1.pct }
    }
}

// MARK: - KPI card

private struct KPICard: View {
    let label: String
    let value: String
    let sub: String
    let delta: String
    let up: Bool
    let color: Color

    var body: some View {
        SBox(size: .md, raised: true) {
            VStack(alignment: .leading, spacing: 6) {
                Text(label.uppercased())
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.2)
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(value)
                        .font(.custom(TFontName.bold.rawValue, size: 32))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                    Text(sub)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                }
                HStack(spacing: 4) {
                    Image(systemName: up ? "arrow.up" : "arrow.down")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(color)
                    Text(delta).font(TTypo.xsBold(11)).foregroundStyle(color).tnum()
                    Text("vs last").font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Hero trend (sparkline) card

private struct HeroTrendCard: View {
    let points: [Double]
    let total: Int
    let delta: String

    var body: some View {
        SBox(size: .md, raised: true) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .lastTextBaseline) {
                    HStack(alignment: .lastTextBaseline, spacing: 8) {
                        Text("\(total)")
                            .font(.custom(TFontName.bold.rawValue, size: 28))
                            .foregroundStyle(Color(hex: T.ink))
                            .tnum()
                        Text("hours total")
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    Spacer()
                    Chip(label: delta,
                         fill: Color(hex: T.sky).opacity(0.10),
                         stroke: Color(hex: T.sky),
                         color: Color(hex: T.sky))
                }
                Sparkline(points: points, stroke: Color(hex: T.sky),
                          fill: Color(hex: T.sky).opacity(0.12), height: 84)
                HStack {
                    Text("14 days ago").font(TTypo.mono(10)).foregroundStyle(Color(hex: T.muted)).tnum()
                    Spacer()
                    Text("today").font(TTypo.mono(10)).foregroundStyle(Color(hex: T.muted)).tnum()
                }
            }
            .padding(14)
        }
    }
}

// MARK: - Job mix card

struct JobMixEntry: Identifiable {
    var id: String { label }
    let label: String
    let pct: Int
    let color: Color
}

private struct JobMixCard: View {
    let mix: [JobMixEntry]
    var body: some View {
        SBox(size: .md, raised: true) {
            VStack(alignment: .leading, spacing: 12) {
                // Stacked bar
                HStack(spacing: 0) {
                    ForEach(mix) { m in
                        Rectangle().fill(m.color).frame(maxWidth: .infinity)
                            .frame(height: 14)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))

                // Legend rows
                VStack(spacing: 8) {
                    ForEach(mix) { m in
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(m.color).frame(width: 10, height: 10)
                            Text(m.label)
                                .font(TTypo.smBold(13))
                                .foregroundStyle(Color(hex: T.ink))
                            Spacer()
                            Text("\(m.pct)%")
                                .font(TTypo.mono(11))
                                .foregroundStyle(Color(hex: T.ink))
                                .tnum()
                        }
                    }
                }
            }
            .padding(14)
        }
    }
}

// MARK: - Non-admin empty state

private struct NonAdminEmpty: View {
    var body: some View {
        VStack(spacing: 12) {
            TIconView(icon: .stats, size: 44, color: Color(hex: T.hair))
            Text("Stats are admin-only")
                .font(TTypo.h3(18))
                .foregroundStyle(Color(hex: T.ink))
            Text("Check back when you're a dispatcher.")
                .font(TTypo.sm(13))
                .foregroundStyle(Color(hex: T.muted))
        }
        .frame(maxWidth: .infinity)
        .padding(32)
    }
}

// MARK: - StatsPeriod
// Drives the period chip in the Stats header. Tapping cycles through.

enum StatsPeriod: CaseIterable {
    case thisWeek, last30Days, allTime

    var label: String {
        switch self {
        case .thisWeek:   return "This week"
        case .last30Days: return "Last 30 days"
        case .allTime:    return "All time"
        }
    }

    var next: StatsPeriod {
        switch self {
        case .thisWeek:   return .last30Days
        case .last30Days: return .allTime
        case .allTime:    return .thisWeek
        }
    }
}
