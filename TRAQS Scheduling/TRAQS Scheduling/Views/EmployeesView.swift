import SwiftUI

// MARK: - Employees · the Basic tier's directory
//
// Takes the Analytics tab's place on Basic (Analytics is Business-only, as on
// the web). Everyone in the org, with a way to reach them: call, text, email.
// Nothing here edits anyone — it's a contact sheet, open to every member.

struct EmployeesView: View {
    @Environment(AppState.self) private var appState
    @State private var search = ""

    /// Real people — the same rule TeamPicker uses — alphabetical, with you
    /// first so your own card isn't lost in the middle.
    private var people: [Person] {
        let me: String? = appState.currentPersonId
        let q: String = search.trimmingCharacters(in: .whitespaces).lowercased()
        let members: [Person] = appState.people.filter { (p: Person) -> Bool in
            let real = p.userRole == "user" || p.userRole == "admin"
            guard real, !p.name.isEmpty else { return false }
            return q.isEmpty || p.name.lowercased().contains(q) || p.role.lowercased().contains(q)
        }
        return members.sorted { (a: Person, b: Person) -> Bool in
            let aMe = a.id == me, bMe = b.id == me
            if aMe != bMe { return aMe }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    var body: some View {
        ZStack {
            PageBackground()

            VStack(spacing: 0) {
                // The shell owns the header; this reserves its height so the
                // scroll view's frame starts below it (see HomeView).
                Color.clear.frame(height: GlassHeader.height)

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        PageTitle(title: "Employees")
                            .padding(.top, pageTitleTopInset)
                            .padding(.bottom, 12)

                        searchField
                            .padding(.horizontal, 16)
                            .padding(.bottom, 14)

                        LazyVStack(spacing: 10) {
                            ForEach(people) { p in
                                EmployeeCard(person: p, isMe: p.id == appState.currentPersonId)
                            }
                            if people.isEmpty {
                                Text(search.isEmpty ? "No employees yet." : "No one matches “\(search)”.")
                                    .font(TTypo.sm(13))
                                    .foregroundStyle(Color(hex: T.muted))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 22)
                                    .frostedCard(radius: T.cornerMd)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 28)
                    }
                    .padding(.top, 4)
                }
                .scrollIndicators(.visible)
                .scrollDismissesKeyboard(.interactively)
                .topFadeMask()
                .refreshable { await appState.loadAll() }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: T.muted))
            TextField("Search by name or department", text: $search)
                .font(TTypo.sm(15))
                .foregroundStyle(Color(hex: T.ink))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color(hex: T.muted))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassControl(in: Capsule(style: .continuous), interactive: false)
    }
}

// MARK: - One person

private struct EmployeeCard: View {
    let person: Person
    let isMe: Bool
    @Environment(\.openURL) private var openURL

    private var phone: String? {
        let p = person.phone?.trimmingCharacters(in: .whitespaces) ?? ""
        return p.isEmpty ? nil : p
    }
    private var email: String? {
        let e = person.email.trimmingCharacters(in: .whitespaces)
        return e.isEmpty ? nil : e
    }

    var body: some View {
        HStack(spacing: 12) {
            Avatar(initials: Initials.from(person), size: 46,
                   fill: .personFill(person.color), imageData: person.image)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(person.name)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                    if isMe {
                        Text("You")
                            .font(TTypo.xsBold(10))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                }
                if !person.role.isEmpty {
                    Text(person.role)
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
                Text(phone.map(PhoneNumber.display) ?? "No phone number")
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: phone == nil ? T.muted : T.ink))
                    .tnum()
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            // Your own card has nobody to call.
            if !isMe {
                HStack(spacing: 8) {
                    if let phone, let tel = PhoneNumber.url("tel", phone) {
                        contactButton("phone.fill", label: "Call \(person.name)") { openURL(tel) }
                    }
                    if let phone, let sms = PhoneNumber.url("sms", phone) {
                        contactButton("message.fill", label: "Text \(person.name)") { openURL(sms) }
                    }
                    if let email, let mail = URL(string: "mailto:\(email)") {
                        contactButton("envelope.fill", label: "Email \(person.name)") { openURL(mail) }
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frostedCard(radius: T.cornerMd)
    }

    private func contactButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: T.ink))
                .frame(width: 22, height: 22)
        }
        .glassCircleButton()
        .accessibilityLabel(label)
    }
}

// MARK: - Phone numbers

enum PhoneNumber {
    /// US numbers as "(801) 555-0134" (with "+1" when the leading 1 is
    /// written); anything else exactly as it was entered.
    static func display(_ raw: String) -> String {
        let digits = raw.filter(\.isNumber)
        if digits.count == 10 {
            let d = Array(digits)
            return "(\(String(d[0..<3]))) \(String(d[3..<6]))-\(String(d[6..<10]))"
        }
        if digits.count == 11, digits.hasPrefix("1") {
            return "+1 " + display(String(digits.dropFirst()))
        }
        return raw
    }

    /// `tel:` / `sms:` URL: digits only, keeping a leading "+".
    static func url(_ scheme: String, _ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        let digits = trimmed.filter(\.isNumber)
        guard digits.count >= 3 else { return nil }
        return URL(string: "\(scheme):\(trimmed.hasPrefix("+") ? "+" : "")\(digits)")
    }
}
