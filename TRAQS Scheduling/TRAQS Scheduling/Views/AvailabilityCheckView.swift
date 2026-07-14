import SwiftUI

// MARK: - Availability Quick-Check
// A read-only "how soon could a ~N-hour job get done between these two dates?"
// gut-check for admins on the Jobs page. It creates nothing and persists nothing.
//
// The soonest-slot math mirrors the desktop scheduler: only auto-schedulable
// crew are considered, existing scheduled panels/ops and time-off count as
// booked, and the requested hours are treated as POOLED capacity the shop can
// split across whoever's free each business day. A short AI-phrased summary is
// layered on top (with a templated fallback).

// MARK: Result model

struct AvailPerson: Identifiable, Equatable {
    let id: String
    let name: String
    let color: String
}

struct AvailabilityResult {
    var feasibleInWindow = false
    var start: String?         // first business day with any free capacity
    var doneBy: String?        // day the requested hours are covered
    var hoursRequested: Double = 0
    var people: [AvailPerson] = []
    var windowFrom = ""
    var windowTo = ""
    var capacityInWindow: Double = 0   // total free hours From…To (for the shortfall note)
    var noCrew = false
    var invalid = false
}

// MARK: Engine

enum AvailabilityEngine {
    private static let cal = Calendar.current

    private static func ymd(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// Mirrors GanttView.isWorkDay: workDays uses JS weekday (0=Sun…6=Sat);
    /// Calendar uses 1=Sun…7=Sat. Holidays are excluded too.
    private static func isWorkDay(_ date: Date, _ org: OrgSettings) -> Bool {
        let jsDay = cal.component(.weekday, from: date) - 1
        return org.workDays.contains(jsDay) && !org.holidays.contains(ymd(date))
    }

    /// Free = no time-off and no non-finished scheduled panel/op overlapping `day`.
    /// Collapses the desktop's overlap test to a single day (start == end == day).
    /// String dates ("yyyy-MM-dd") compare correctly lexicographically.
    private static func isFree(_ p: Person, on day: String, jobs: [Job]) -> Bool {
        for t in p.timeOff where t.start <= day && t.end >= day { return false }
        for job in jobs {
            for panel in job.subs {
                if panel.team.contains(p.id), panel.status != .finished,
                   !panel.start.isEmpty, !panel.end.isEmpty,
                   panel.start <= day, panel.end >= day, panel.subs.isEmpty {
                    return false
                }
                for op in panel.subs {
                    guard op.team.contains(p.id), op.status != .finished else { continue }
                    if !op.start.isEmpty, !op.end.isEmpty, op.start <= day, op.end >= day {
                        return false
                    }
                }
            }
        }
        return true
    }

    static func compute(people: [Person], jobs: [Job], org: OrgSettings,
                        from: Date, to: Date, hours: Double) -> AvailabilityResult {
        let H = max(0, hours)
        let eligible = people.filter {
            ($0.userRole == "user" || $0.userRole == "admin") && ($0.autoSchedule ?? true)
        }
        var result = AvailabilityResult()
        result.hoursRequested = H
        result.windowFrom = ymd(from)
        result.windowTo = ymd(to)
        result.noCrew = eligible.isEmpty
        result.invalid = !(H > 0)
        guard !result.invalid, !result.noCrew else { return result }

        let perDay = org.productiveHoursPerDay
        let today = cal.startOfDay(for: Date())
        let toDayStart = cal.startOfDay(for: to)
        var day = max(cal.startOfDay(for: from), today)   // never look in the past

        var remaining = H
        var order: [String] = []
        var byId: [String: Person] = [:]
        var scannedBusinessDays = 0

        while remaining > 0 && scannedBusinessDays < 400 {
            if isWorkDay(day, org) {
                scannedBusinessDays += 1
                let dstr = ymd(day)
                let free = eligible.filter { isFree($0, on: dstr, jobs: jobs) }
                let cap = Double(free.count) * perDay
                if day <= toDayStart { result.capacityInWindow += cap }
                if cap > 0 {
                    if result.start == nil { result.start = dstr }
                    for p in free where byId[p.id] == nil { byId[p.id] = p; order.append(p.id) }
                    remaining -= cap
                    if remaining <= 0 {
                        result.doneBy = dstr
                        result.feasibleInWindow = day <= toDayStart
                        break
                    }
                }
            }
            guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }

        result.people = order.compactMap { byId[$0] }.map {
            AvailPerson(id: $0.id, name: $0.name, color: $0.color)
        }
        return result
    }
}

// MARK: Display helpers

private func prettyDate(_ ymd: String) -> String {
    guard let d = ymd.asDate else { return ymd }
    let f = DateFormatter()
    f.dateFormat = "EEE, MMM d"
    return f.string(from: d)
}

private func rangeLabel(_ r: AvailabilityResult) -> String {
    guard let s = r.start, let e = r.doneBy else { return "" }
    return s == e ? prettyDate(e) : "\(prettyDate(s)) – \(prettyDate(e))"
}

func availabilityTemplate(_ r: AvailabilityResult) -> String {
    if r.invalid { return "Enter how many hours the job needs." }
    if r.noCrew { return "No auto-schedulable crew are set up, so there's nothing to check against." }
    guard r.doneBy != nil else {
        return "The schedule looks fully booked — couldn't fit \(hrs(r.hoursRequested))h within the scan horizon."
    }
    let names = r.people.map(\.name)
    let who: String
    if names.isEmpty { who = "" }
    else if names.count <= 3 { who = " — \(names.joined(separator: ", ")) \(names.count == 1 ? "is" : "are") open" }
    else { who = " — \(names.count) people are open" }
    let range = rangeLabel(r)
    return r.feasibleInWindow
        ? "Soonest you could knock out \(hrs(r.hoursRequested))h is \(range)\(who)."
        : "Won't fit your window — earliest realistic finish for \(hrs(r.hoursRequested))h is \(range)\(who)."
}

/// Trim a trailing ".0" so "40.0" reads as "40" but "37.5" stays.
private func hrs(_ v: Double) -> String {
    v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
}

// MARK: - Expanding Liquid-Glass button

/// Admin-only header control (top-right of the Jobs page). A circular
/// clock.arrow.circlepath glass icon that opens a native Liquid-Glass dropdown;
/// choosing "Check for availability" opens the quick-check sheet (owned by the
/// parent via `isPresented`). Matches the app's IconBtn look so it sits inline
/// with the other header buttons.
struct AvailabilityCheckButton: View {
    @Binding var isPresented: Bool

    var body: some View {
        Menu {
            Button {
                isPresented = true
            } label: {
                Label("Check for availability", systemImage: "clock.arrow.circlepath")
            }
        } label: {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(hex: T.accent))
                .padding(9)
                .glassEffect(.regular.interactive(), in: Circle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Sheet

struct AvailabilityCheckSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var fromDate = Calendar.current.startOfDay(for: Date())
    @State private var toDate = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date()
    @State private var hoursText = ""

    @State private var result: AvailabilityResult?
    @State private var aiText = ""
    @State private var loadingSummary = false

    private var hours: Double { Double(hoursText) ?? 0 }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        if let r = result { resultCard(r) } else { inputForm }
                    }
                    .padding(20)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Color(hex: T.accent))
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // Header
    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color(hex: T.accent))
                .frame(width: 40, height: 40)
                .background(Circle().fill(Color(hex: T.accent).opacity(0.12)))
            VStack(alignment: .leading, spacing: 2) {
                Text("Check Availability").font(TTypo.h3(20))
                    .foregroundStyle(Color(hex: T.ink))
                Text("A quick read-only look — nothing gets scheduled.")
                    .font(TTypo.xs(12)).foregroundStyle(Color(hex: T.muted))
            }
            Spacer(minLength: 0)
        }
    }

    // Input form
    private var inputForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            fieldCard {
                DatePicker("From", selection: $fromDate, displayedComponents: .date)
                Divider()
                DatePicker("To", selection: $toDate, in: fromDate..., displayedComponents: .date)
            }
            .font(TTypo.body(15))
            .tint(Color(hex: T.accent))

            fieldCard {
                HStack {
                    Text("Total hours needed").font(TTypo.body(15))
                        .foregroundStyle(Color(hex: T.ink))
                    Spacer()
                    TextField("e.g. 40", text: $hoursText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .font(TTypo.bodyBold(16))
                        .frame(width: 90)
                }
            }

            Button {
                runCheck()
            } label: {
                Text("Find soonest")
                    .font(TTypo.bodyBold(16))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Capsule().fill(hours > 0 ? AnyShapeStyle(T.brandGradient()) : AnyShapeStyle(Color(hex: T.muted).opacity(0.4))))
            }
            .buttonStyle(.plain)
            .disabled(!(hours > 0))
            .padding(.top, 4)
        }
    }

    // Result card
    @ViewBuilder
    private func resultCard(_ r: AvailabilityResult) -> some View {
        let ok = r.doneBy != nil && !r.invalid && !r.noCrew
        VStack(alignment: .leading, spacing: 14) {
            if ok {
                VStack(alignment: .leading, spacing: 4) {
                    Text(r.feasibleInWindow ? "SOONEST COMPLETION" : "EARLIEST REALISTIC FINISH")
                        .font(TTypo.xsBold(11)).tracking(0.6)
                        .foregroundStyle(Color(hex: T.muted))
                    Text(rangeLabel(r))
                        .font(.system(size: 26, weight: .heavy, design: .rounded))
                        .foregroundStyle(Color(hex: r.feasibleInWindow ? T.accent : T.amber))
                }

                // AI sentence (or fallback), with a loading state.
                HStack(alignment: .top, spacing: 8) {
                    if loadingSummary {
                        ProgressView().controlSize(.small)
                        Text("Summarizing…").font(TTypo.sm(14)).italic()
                            .foregroundStyle(Color(hex: T.muted))
                    } else {
                        Text(aiText.isEmpty ? availabilityTemplate(r) : aiText)
                            .font(TTypo.sm(14)).foregroundStyle(Color(hex: T.ink))
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: T.cornerMd).fill(Color(hex: T.surface)))
                .overlay(RoundedRectangle(cornerRadius: T.cornerMd).stroke(Color(hex: T.border)))

                if !r.feasibleInWindow {
                    Label {
                        Text("This runs past your \(prettyDate(r.windowTo)) cutoff — the window only has about \(Int(r.capacityInWindow.rounded()))h of free capacity.")
                            .font(TTypo.xs(12))
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                    }
                    .foregroundStyle(Color(hex: T.amber))
                }

                if !r.people.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("WHO'S OPEN").font(TTypo.xsBold(11)).tracking(0.6)
                            .foregroundStyle(Color(hex: T.muted))
                        FlowChips(people: r.people)
                    }
                }
            } else {
                Text(aiText.isEmpty ? availabilityTemplate(r) : aiText)
                    .font(TTypo.sm(14)).foregroundStyle(Color(hex: T.ink))
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: T.cornerMd).fill(Color(hex: T.surface)))
                    .overlay(RoundedRectangle(cornerRadius: T.cornerMd).stroke(Color(hex: T.border)))
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    result = nil; aiText = ""; loadingSummary = false
                }
            } label: {
                Text("Check again")
                    .font(TTypo.bodyBold(15))
                    .foregroundStyle(Color(hex: T.accent))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .overlay(Capsule().stroke(Color(hex: T.accent).opacity(0.5)))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
    }

    private func fieldCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 10) { content() }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: T.cornerMd).fill(Color(hex: T.surface)))
            .overlay(RoundedRectangle(cornerRadius: T.cornerMd).stroke(Color(hex: T.border)))
    }

    // Compute + AI
    private func runCheck() {
        let r = AvailabilityEngine.compute(
            people: appState.people, jobs: appState.jobs, org: appState.orgSettings,
            from: fromDate, to: toDate, hours: hours)
        withAnimation(.easeInOut(duration: 0.2)) { result = r }
        aiText = ""

        // No point calling AI when there's nothing meaningful to phrase.
        guard r.doneBy != nil, !r.invalid, !r.noCrew else { return }
        loadingSummary = true
        let payload: [String: Any] = [
            "hoursRequested": r.hoursRequested,
            "soonestStart": r.start.map(prettyDate) as Any,
            "doneBy": r.doneBy.map(prettyDate) as Any,
            "fitsWithinRequestedWindow": r.feasibleInWindow,
            "requestedWindow": "\(prettyDate(r.windowFrom)) to \(prettyDate(r.windowTo))",
            "peopleOpen": r.people.map(\.name),
        ]
        let userJSON = (try? JSONSerialization.data(withJSONObject: payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let system = "You are a scheduling assistant for a manufacturing shop. You are given a PRE-COMPUTED availability result as JSON. Write exactly ONE short, friendly sentence (max ~25 words) telling the admin the soonest a job of the requested hours could get done. Use the dates and names EXACTLY as given — never invent or shift dates, people, or caveats. No greeting, no preamble, no extra lines."

        Task {
            let text = await appState.availabilitySummary(system: system, userJSON: userJSON)
            await MainActor.run {
                // Ignore a stale response if the user already reset the form.
                guard result != nil else { return }
                aiText = text ?? availabilityTemplate(r)
                loadingSummary = false
            }
        }
    }
}

// MARK: - Wrapping chip row

private struct FlowChips: View {
    let people: [AvailPerson]

    var body: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(people) { p in
                HStack(spacing: 7) {
                    Text(initials(p.name))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(Color(hex: p.color)))
                    Text(p.name).font(TTypo.smBold(13)).foregroundStyle(Color(hex: T.ink))
                }
                .padding(.vertical, 4)
                .padding(.trailing, 11)
                .padding(.leading, 4)
                .background(Capsule().fill(Color(hex: T.surface)))
                .overlay(Capsule().stroke(Color(hex: T.border)))
            }
        }
    }

    private func initials(_ name: String) -> String {
        name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined().uppercased()
    }
}

/// Minimal wrapping HStack (chips flow onto new lines when they run out of width).
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW, x > 0 { x = 0; y += lineH + lineSpacing; lineH = 0 }
            x += s.width + spacing
            lineH = max(lineH, s.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + lineH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxW = bounds.width
        var x: CGFloat = 0, y: CGFloat = 0, lineH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW, x > 0 { x = 0; y += lineH + lineSpacing; lineH = 0 }
            v.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            lineH = max(lineH, s.height)
        }
    }
}
