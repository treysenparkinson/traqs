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

/// A fallback completion date (soonest for a given person) offered when the job
/// won't fit the requested window.
struct AvailAlternative: Identifiable, Equatable {
    let start: String        // "yyyy-MM-dd" — first working day of the run
    let doneBy: String       // "yyyy-MM-dd" — completion
    let personName: String
    let personColor: String
    var id: String { start + doneBy }
}

struct AvailabilityResult {
    var feasibleInWindow = false
    var start: String?          // first working day the soonest person begins
    var doneBy: String?         // soonest completion date across eligible people
    var hoursRequested: Double = 0
    var daysNeeded: Int = 0     // working days of labor for one person
    var people: [AvailPerson] = []   // person(s) who hit that soonest completion
    var alternatives: [AvailAlternative] = []   // soonest per-person dates (fallback options)
    var departments: [String] = []   // department filter applied (empty = any)
    var windowFrom = ""
    var windowTo = ""
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
                        from: Date, to: Date, hours: Double, departments: Set<String> = []) -> AvailabilityResult {
        let H = max(0, hours)
        let depts = Set(departments.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
        let eligibleAll = people.filter {
            ($0.userRole == "user" || $0.userRole == "admin") && $0.isAutoSchedulable
        }
        // Department filter (mirrors desktop personDeptMatch): a person qualifies if
        // their department is any of the selected ones. Empty selection = anyone.
        let eligible = depts.isEmpty ? eligibleAll : eligibleAll.filter { depts.contains($0.role) }

        var result = AvailabilityResult()
        result.hoursRequested = H
        result.departments = depts.sorted()
        result.windowFrom = ymd(from)
        result.windowTo = ymd(to)
        result.noCrew = eligible.isEmpty
        result.invalid = !(H > 0)
        guard !result.invalid, !result.noCrew else { return result }

        // Convert the job into working days of labor for ONE person, at the shop's
        // hours/day — exactly like the desktop's opDurBD: ceil(totalHours / hpd).
        // e.g. 120h ÷ 8h/day = 15 working days done by one assignee.
        let hpd = max(1, org.hpd)
        let daysNeeded = max(1, Int((H / hpd).rounded(.up)))
        result.daysNeeded = daysNeeded

        let today = cal.startOfDay(for: Date())
        let toDayCutoff = ymd(cal.startOfDay(for: to))
        let startFrom = max(cal.startOfDay(for: from), today)   // never look in the past

        // For each eligible person, find their earliest run of `daysNeeded`
        // CONSECUTIVE free working days — i.e. a clear block they could actually
        // give to this job. A day they're already booked (another job / time-off)
        // breaks the run, so people tied up elsewhere are pushed out, just like the
        // new-job scheduler's isPersonFree(whole-span) check. Soonest across the
        // crew is the answer.
        var soonest: (person: AvailPerson, start: String, doneBy: String)?
        var doneByPerson: [(person: AvailPerson, start: String, doneBy: String)] = []

        for p in eligible {
            var run = 0
            var runStart: String?
            var finished: String?
            var startOfFinished: String?
            var scanned = 0
            var day = startFrom
            while scanned < 400 {
                if isWorkDay(day, org) {
                    scanned += 1
                    let dstr = ymd(day)
                    if isFree(p, on: dstr, jobs: jobs) {
                        if run == 0 { runStart = dstr }
                        run += 1
                        if run >= daysNeeded { finished = dstr; startOfFinished = runStart; break }
                    } else {
                        run = 0; runStart = nil
                    }
                }
                guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
            }
            if let finished, let startOfFinished {
                let ap = AvailPerson(id: p.id, name: p.name, color: p.color)
                doneByPerson.append((ap, startOfFinished, finished))
                if soonest == nil || finished < soonest!.doneBy {
                    soonest = (ap, startOfFinished, finished)
                }
            }
        }

        if let s = soonest {
            result.start = s.start
            result.doneBy = s.doneBy
            result.feasibleInWindow = s.doneBy <= toDayCutoff
            // Everyone who can also hit that same soonest completion, soonest first.
            let tied = doneByPerson.filter { $0.doneBy == s.doneBy && $0.person.id != s.person.id }.map(\.person)
            result.people = [s.person] + tied

            // Fallback options: the soonest completion for each DISTINCT date across
            // people, earliest first (= closest to the requested window). Up to 5.
            var seen = Set<String>()
            var alts: [AvailAlternative] = []
            for entry in doneByPerson.sorted(by: { $0.doneBy < $1.doneBy }) {
                if seen.contains(entry.doneBy) { continue }
                seen.insert(entry.doneBy)
                alts.append(AvailAlternative(start: entry.start,
                                             doneBy: entry.doneBy,
                                             personName: entry.person.name,
                                             personColor: entry.person.color))
                if alts.count >= 5 { break }
            }
            result.alternatives = alts
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

private func avatarInitials(_ name: String) -> String {
    name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined().uppercased()
}

private func rangeLabel(_ r: AvailabilityResult) -> String {
    guard let s = r.start, let e = r.doneBy else { return "" }
    return s == e ? prettyDate(e) : "\(prettyDate(s)) – \(prettyDate(e))"
}

private func shortDay(_ ymd: String) -> String {
    guard let d = ymd.asDate else { return ymd }
    let f = DateFormatter(); f.dateFormat = "MMM d"
    return f.string(from: d)
}

/// "Wire" / "Wire or Cut" / "Wire, Cut, or Layout"
private func deptPhrase(_ depts: [String]) -> String {
    switch depts.count {
    case 0: return ""
    case 1: return depts[0]
    case 2: return "\(depts[0]) or \(depts[1])"
    default: return depts.dropLast().joined(separator: ", ") + ", or " + depts.last!
    }
}

/// The real work span: start → completion (e.g. "Jul 15 → Aug 4"). Reflects the
/// true duration so a 15-day job never reads like a 3-day one.
private func spanLabel(_ r: AvailabilityResult) -> String {
    guard let s = r.start, let e = r.doneBy else { return "" }
    return s == e ? shortDay(e) : "\(shortDay(s)) → \(shortDay(e))"
}

func availabilityTemplate(_ r: AvailabilityResult) -> String {
    if r.invalid { return "Enter how many hours the job needs." }
    if r.noCrew {
        return r.departments.isEmpty
            ? "No auto-schedulable crew are set up, so there's nothing to check against."
            : "No auto-schedulable people are in \(deptPhrase(r.departments)), so there's nothing to check against."
    }
    guard r.doneBy != nil else {
        return "The schedule looks fully booked — couldn't find a \(r.daysNeeded)-working-day opening for \(hrs(r.hoursRequested))h within the scan horizon."
    }
    let who = r.people.first.map { " with \($0.name)" } ?? ""
    let done = r.doneBy.map(prettyDate) ?? ""
    return r.feasibleInWindow
        ? "\(hrs(r.hoursRequested))h (~\(r.daysNeeded) working days for one person) could be done by \(done)\(who)."
        : "Won't fit your window — the soonest\(who) is by \(done) for \(hrs(r.hoursRequested))h (~\(r.daysNeeded) working days)."
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
    @State private var departments: Set<String> = []   // empty = any department
    @State private var deptPickerOpen = false
    @State private var fromPickerOpen = false
    @State private var toPickerOpen = false
    @State private var selectedAlt: AvailAlternative?   // a tapped fallback option

    @State private var result: AvailabilityResult?
    @State private var aiText = ""
    @State private var loadingSummary = false

    private var hours: Double { Double(hoursText) ?? 0 }
    private var deptLabel: String {
        switch departments.count {
        case 0: return "Any"
        case 1: return departments.first!
        default: return "\(departments.count) selected"
        }
    }

    // A date field that always shows the same long format ("July 18, 2026") and
    // opens a graphical picker in a popover — avoids the compact picker rendering
    // From and To in different formats.
    @ViewBuilder
    private func dateRow(_ label: String, selection: Binding<Date>, minDate: Date?, isOpen: Binding<Bool>) -> some View {
        HStack {
            Text(label).font(TTypo.body(15)).foregroundStyle(Color(hex: T.ink))
            Spacer()
            Button { isOpen.wrappedValue = true } label: {
                Text(longDate(selection.wrappedValue))
                    .font(TTypo.bodyBold(15)).foregroundStyle(Color(hex: T.accent))
            }
            .buttonStyle(.plain)
            .popover(isPresented: isOpen) {
                Group {
                    if let minDate {
                        DatePicker("", selection: selection, in: minDate..., displayedComponents: .date)
                    } else {
                        DatePicker("", selection: selection, displayedComponents: .date)
                    }
                }
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(Color(hex: T.accent))
                .frame(minWidth: 320, maxHeight: 380)
                .padding(12)
                .presentationCompactAdaptation(.popover)
            }
        }
    }

    private func longDate(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MMMM d, yyyy"
        return f.string(from: d)
    }

    @ViewBuilder
    private func deptRow(_ title: String, checked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 17))
                    .foregroundStyle(Color(hex: checked ? T.accent : T.muted))
                Text(title).font(TTypo.body(15)).foregroundStyle(Color(hex: T.ink))
                Spacer(minLength: 0)
            }
            .padding(.vertical, 11).padding(.horizontal, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

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
                dateRow("From", selection: $fromDate, minDate: nil, isOpen: $fromPickerOpen)
                Divider()
                dateRow("To", selection: $toDate, minDate: fromDate, isOpen: $toPickerOpen)
            }

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

            // Optional department filter — narrows the check to people who can
            // actually do that work (mirrors the new-job scheduler's dept match).
            if !appState.orgSettings.roles.isEmpty {
                fieldCard {
                    HStack {
                        Text("Departments").font(TTypo.body(15))
                            .foregroundStyle(Color(hex: T.ink))
                        Spacer()
                        Button { deptPickerOpen = true } label: {
                            HStack(spacing: 5) {
                                Text(deptLabel)
                                    .font(TTypo.bodyBold(15))
                                    .lineLimit(1)
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.system(size: 11, weight: .semibold))
                            }
                            .foregroundStyle(Color(hex: T.accent))
                        }
                        .buttonStyle(.plain)
                        // A popover stays open across taps (unlike Menu), so you can
                        // toggle several departments, then tap outside to dismiss.
                        .popover(isPresented: $deptPickerOpen) {
                            ScrollView {
                                VStack(spacing: 0) {
                                    deptRow("Any department", checked: departments.isEmpty) {
                                        departments.removeAll()
                                    }
                                    Divider().padding(.horizontal, 14)
                                    ForEach(appState.orgSettings.roles, id: \.self) { role in
                                        deptRow(role, checked: departments.contains(role)) {
                                            if departments.contains(role) { departments.remove(role) }
                                            else { departments.insert(role) }
                                        }
                                    }
                                }
                                .padding(.vertical, 6)
                            }
                            .frame(minWidth: 260, maxHeight: 360)
                            .presentationCompactAdaptation(.popover)
                        }
                    }
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

    // Result card — a clear yes/no verdict.
    @ViewBuilder
    private func resultCard(_ r: AvailabilityResult) -> some View {
        let ok = r.doneBy != nil && !r.invalid && !r.noCrew
        VStack(alignment: .leading, spacing: 16) {
            if ok {
                if r.feasibleInWindow { fitsView(r) } else { noFitView(r) }
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
                    result = nil; aiText = ""; loadingSummary = false; selectedAlt = nil
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

    // ✓ It fits — green verdict.
    @ViewBuilder
    private func fitsView(_ r: AvailabilityResult) -> some View {
        VStack(spacing: 14) {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(Color(hex: T.green))
                Text("Yes — this fits in your schedule!")
                    .font(TTypo.h3(20)).multilineTextAlignment(.center)
                    .foregroundStyle(Color(hex: T.ink))
                VStack(spacing: 3) {
                    Text("This can get done in this time frame:")
                        .font(TTypo.smBold(13)).foregroundStyle(Color(hex: T.muted))
                    Text(spanLabel(r))
                        .font(TTypo.h1(30)).foregroundStyle(Color(hex: T.green))
                        .lineLimit(1).minimumScaleFactor(0.5)
                }
                Text("≈ \(r.daysNeeded) working days for one person\(r.departments.isEmpty ? "" : " in \(deptPhrase(r.departments))").")
                    .font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(22)
            .background(RoundedRectangle(cornerRadius: T.cornerLg).fill(Color(hex: T.green).opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: T.cornerLg).stroke(Color(hex: T.green).opacity(0.22), lineWidth: 1))

            summaryCard(r)

            if !r.people.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(r.people.count > 1 ? "SOONEST WITH (ANY OF)" : "SOONEST WITH")
                        .font(TTypo.xsBold(11)).tracking(0.6)
                        .foregroundStyle(Color(hex: T.muted))
                    FlowChips(people: r.people)
                }
            }
        }
    }

    // ✗ It won't fit — red verdict + closest working dates.
    @ViewBuilder
    private func noFitView(_ r: AvailabilityResult) -> some View {
        VStack(spacing: 14) {
            VStack(spacing: 10) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(Color(hex: T.red))
                Text("No — this won't fit")
                    .font(TTypo.h3(20)).foregroundStyle(Color(hex: T.ink))
                Text("This will not work by \(prettyDate(r.windowTo)), unfortunately.")
                    .font(TTypo.sm(13)).multilineTextAlignment(.center)
                    .foregroundStyle(Color(hex: T.muted))
            }
            .frame(maxWidth: .infinity)
            .padding(22)
            .background(RoundedRectangle(cornerRadius: T.cornerLg).fill(Color(hex: T.red).opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: T.cornerLg).stroke(Color(hex: T.red).opacity(0.22), lineWidth: 1))

            if let alt = selectedAlt {
                selectedAltDetail(r, alt)
            } else if !r.alternatives.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("CLOSEST DATES THAT COULD WORK — TAP ONE")
                        .font(TTypo.xsBold(11)).tracking(0.6)
                        .foregroundStyle(Color(hex: T.muted))
                    ForEach(r.alternatives) { alt in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) { selectedAlt = alt }
                        } label: {
                            HStack(spacing: 11) {
                                Image(systemName: "calendar")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color(hex: T.accent))
                                    .frame(width: 30, height: 30)
                                    .background(Circle().fill(Color(hex: T.accent).opacity(0.12)))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("by \(prettyDate(alt.doneBy))")
                                        .font(TTypo.smBold(15)).foregroundStyle(Color(hex: T.ink))
                                    Text(r.departments.isEmpty ? "Any department" : deptPhrase(r.departments))
                                        .font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Color(hex: T.muted))
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: T.cornerMd).fill(Color(hex: T.surface)))
                            .overlay(RoundedRectangle(cornerRadius: T.cornerMd).stroke(Color(hex: T.border)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // Detail for a tapped fallback option: its full working span + a summary.
    @ViewBuilder
    private func selectedAltDetail(_ r: AvailabilityResult, _ alt: AvailAlternative) -> some View {
        let deptSuffix = r.departments.isEmpty ? "" : " in \(deptPhrase(r.departments))"
        let span = alt.start == alt.doneBy ? shortDay(alt.doneBy) : "\(shortDay(alt.start)) → \(shortDay(alt.doneBy))"
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { selectedAlt = nil }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .bold))
                    Text("Back to options").font(TTypo.smBold(13))
                }
                .foregroundStyle(Color(hex: T.accent))
            }
            .buttonStyle(.plain)

            VStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44)).foregroundStyle(Color(hex: T.green))
                Text("This option works").font(TTypo.h3(19)).foregroundStyle(Color(hex: T.ink))
                VStack(spacing: 3) {
                    Text("It can be worked in full:")
                        .font(TTypo.smBold(13)).foregroundStyle(Color(hex: T.muted))
                    Text(span)
                        .font(TTypo.h1(28)).foregroundStyle(Color(hex: T.green))
                        .lineLimit(1).minimumScaleFactor(0.5)
                }
                Text("\(hrs(r.hoursRequested))h · ≈ \(r.daysNeeded) working days\(deptSuffix) · done by \(prettyDate(alt.doneBy)).")
                    .font(TTypo.xs(12)).foregroundStyle(Color(hex: T.muted))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
            .background(RoundedRectangle(cornerRadius: T.cornerLg).fill(Color(hex: T.green).opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: T.cornerLg).stroke(Color(hex: T.green).opacity(0.22), lineWidth: 1))
        }
    }

    // AI one-liner (or template fallback) with a loading state.
    @ViewBuilder
    private func summaryCard(_ r: AvailabilityResult) -> some View {
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
            from: fromDate, to: toDate, hours: hours, departments: departments)
        withAnimation(.easeInOut(duration: 0.2)) { result = r }
        aiText = ""
        selectedAlt = nil

        // Only phrase a summary on the "it fits" path — the no-fit path shows the
        // red verdict + alternative dates instead.
        guard r.doneBy != nil, !r.invalid, !r.noCrew, r.feasibleInWindow else { return }
        loadingSummary = true
        let payload: [String: Any] = [
            "hoursRequested": r.hoursRequested,
            "workingDaysForOnePerson": r.daysNeeded,
            "department": r.departments.isEmpty ? "any" : deptPhrase(r.departments),
            "workSpan": spanLabel(r),
            "completionDate": r.doneBy.map(prettyDate) as Any,
            "fitsWithinRequestedWindow": r.feasibleInWindow,
            "requestedWindow": "\(prettyDate(r.windowFrom)) to \(prettyDate(r.windowTo))",
            "soonestPerson": r.people.first?.name as Any,
        ]
        let userJSON = (try? JSONSerialization.data(withJSONObject: payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let system = "You are a scheduling assistant for a manufacturing shop. You are given a PRE-COMPUTED availability estimate (assuming one person works the job over consecutive working days) as JSON. Write exactly ONE short, friendly sentence (max ~25 words) telling the admin when the job could realistically be finished and who could do it soonest. Use `completionDate` and `soonestPerson` EXACTLY as given — never invent or shift dates, people, or caveats. Phrase it as an estimate. No greeting, no preamble, no extra lines."

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
                        .font(TTypo.xsBold(10))
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
