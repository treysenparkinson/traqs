import Foundation

// MARK: - Organization signup: the rules
//
// A port of src/orgSignup.js — the web's signup wizard, its validation, and what
// it sends. Pure, so every rule is testable without a view, and the screens
// (OrgSignupView) stay a rendering of this rather than the place the rules live.
// Change a rule there, change it here: the server re-checks the enums, but not
// the required fields.
//
// WHERE THE VALUES GO (the thing most likely to be got wrong):
//
//   config.json     name, adminEmail, adminName, adminEmails,
//                   industry, companySize, country, currency
//   settings.json   timeZone, payPeriodType, payPeriodStart
//
// The server splits them; the payload's `settings` object is what tells it to.
// There is no org code in the payload — the server generates it — and no tier:
// Basic is what an org is until someone sets otherwise.

enum OrgSignup {

    struct Option: Hashable {
        let value: String
        let label: String
    }

    /// Stored values EXACTLY as the app reads them — "biweekly" without a hyphen
    /// and "semi-monthly" with one. The reader compares these literally.
    static let payPeriods: [Option] = [
        .init(value: "weekly", label: "Weekly"),
        .init(value: "biweekly", label: "Bi-weekly"),
        .init(value: "semi-monthly", label: "Semi-monthly"),
        .init(value: "monthly", label: "Monthly"),
    ]

    static let companySizes: [Option] = [
        .init(value: "1-10", label: "1–10"),
        .init(value: "11-50", label: "11–50"),
        .init(value: "51-200", label: "51–200"),
        .init(value: "200+", label: "200+"),
    ]

    static let industries: [String] = [
        "Electrical", "Mechanical", "Manufacturing", "Construction",
        "Engineering", "Fabrication", "Industrial Services", "Other",
    ]

    static let currencies: [Option] = [
        .init(value: "USD", label: "USD · US Dollar"),
        .init(value: "CAD", label: "CAD · Canadian Dollar"),
        .init(value: "EUR", label: "EUR · Euro"),
        .init(value: "GBP", label: "GBP · British Pound"),
        .init(value: "AUD", label: "AUD · Australian Dollar"),
        .init(value: "MXN", label: "MXN · Mexican Peso"),
    ]

    // MARK: Time zones and countries (the Basics step's dropdowns)

    /// The web's Settings list (US_TZ in TRAQS.jsx), in its order. Values are
    /// IANA identifiers — what settings.json stores and the server reads.
    static let usTimeZones: [Option] = [
        .init(value: "America/Denver", label: "Mountain"),
        .init(value: "America/Phoenix", label: "Arizona (no DST)"),
        .init(value: "America/Los_Angeles", label: "Pacific"),
        .init(value: "America/Chicago", label: "Central"),
        .init(value: "America/New_York", label: "Eastern"),
        .init(value: "America/Anchorage", label: "Alaska"),
        .init(value: "Pacific/Honolulu", label: "Hawaii"),
    ]

    /// Every other zone the device knows, grouped by its region prefix
    /// ("Europe", "Asia", …) and sorted, for the "All time zones" submenu.
    static func otherTimeZones(known: [String] = TimeZone.knownTimeZoneIdentifiers)
        -> [(region: String, zones: [String])] {
        let us = Set(usTimeZones.map(\.value))
        let grouped = Dictionary(grouping: known.filter { !us.contains($0) && $0.contains("/") }) {
            String($0.prefix(while: { $0 != "/" }))
        }
        return grouped.keys.sorted().map { ($0, grouped[$0]!.sorted()) }
    }

    /// "Mountain — America/Denver" for a US zone, "Europe/London" otherwise,
    /// with the identifier's underscores read as spaces.
    static func timeZoneLabel(_ id: String) -> String {
        let readable = id.replacingOccurrences(of: "_", with: " ")
        if let us = usTimeZones.first(where: { $0.value == id }) { return "\(us.label) — \(readable)" }
        return readable
    }

    /// Top of the country list — the likeliest picks for a US-based product.
    static let commonCountries = ["United States", "Canada", "Mexico", "United Kingdom", "Australia"]

    /// Every ISO country, by its ENGLISH name whatever the phone's language —
    /// the value lands in config.json and the web shows it as typed text, so
    /// it has to be the same word on every device.
    static func allCountries() -> [String] {
        let en = Locale(identifier: "en_US")
        let names = Locale.Region.isoRegions
            .map(\.identifier)
            .filter { $0.count == 2 && $0.allSatisfy(\.isLetter) }
            .compactMap { en.localizedString(forRegionCode: $0) }
        return Array(Set(names)).sorted()
    }

    /// `allCountries` bucketed by first letter, for the A–Z submenus.
    static func countriesByLetter() -> [(letter: String, names: [String])] {
        let grouped = Dictionary(grouping: allCountries()) { String($0.prefix(1)).uppercased() }
        return grouped.keys.sorted().map { ($0, grouped[$0]!) }
    }

    /// tiers.js — the same lists the web's tier step and upgrade modal show.
    static let basicFeatures = [
        "Time tracking & timesheets",
        "Mobile clock in/out",
        "Scheduling & job management",
        "Pay-period hours export",
    ]
    static let businessFeatures = [
        "Microsoft / SSO sign-in",
        "Granular admin permissions",
        "Priority support",
    ]

    // MARK: Steps

    /// Five forms; the welcome screen is the entry point, not a step. `heading`
    /// is what the screen says, `title` is the short name the Back button and
    /// the confirmation sections use.
    enum Step: String, CaseIterable, Identifiable {
        case identity, basics, tier, payroll, confirm

        var id: String { rawValue }
        var number: Int { (Step.allCases.firstIndex(of: self) ?? 0) + 1 }

        var title: String {
            switch self {
            case .identity: return "Identity"
            case .basics:   return "Organization basics"
            case .tier:     return "Tier"
            case .payroll:  return "Payroll"
            case .confirm:  return "Confirm"
            }
        }

        var heading: String {
            switch self {
            case .identity: return "Set up your organization"
            case .basics:   return "Organization basics"
            case .tier:     return "Choose your tier"
            case .payroll:  return "Payroll rhythm"
            case .confirm:  return "Confirm & activate"
            }
        }

        var previous: Step? {
            let all = Step.allCases
            guard let i = all.firstIndex(of: self), i > 0 else { return nil }
            return all[i - 1]
        }

        var next: Step? {
            let all = Step.allCases
            guard let i = all.firstIndex(of: self), i + 1 < all.count else { return nil }
            return all[i + 1]
        }
    }

    enum Tier: String { case basic, business }

    // MARK: The form

    struct Form: Equatable {
        var name = ""
        var adminName = ""
        var adminEmail = ""
        var extraAdmins: [String] = []
        var industry = ""
        var companySize = ""
        var country = ""
        var timeZone = ""
        var currency = "USD"
        var tier: Tier = .basic
        var payPeriodType = "biweekly"
        /// yyyy-MM-dd. Empty until picked.
        var payPeriodStart = ""

        /// The web seeds the zone with the browser's guess; this is the device's.
        static func initial(timeZone: String = TimeZone.current.identifier) -> Form {
            var f = Form()
            f.timeZone = timeZone
            return f
        }
    }

    enum Field: String, Hashable {
        case name, adminName, adminEmail, extraAdmins
        case industry, companySize, country, timeZone, currency
        case tier, payPeriodType, payPeriodStart
    }

    static func isEmail(_ v: String) -> Bool {
        v.trimmingCharacters(in: .whitespacesAndNewlines)
            .range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    static func isDate(_ v: String) -> Bool {
        guard v.count == 10 else { return false }
        let chars = Array(v)
        guard chars[4] == "-", chars[7] == "-" else { return false }
        return dayFormatter.date(from: v) != nil
    }

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static func trim(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Errors for one step. Empty means it may advance. Per-step so a half-filled
    /// later step can't block an earlier one, and so Confirm can re-run every
    /// step's rules to catch a section edited into an invalid state.
    static func validate(_ step: Step, _ form: Form) -> [Field: String] {
        var e: [Field: String] = [:]
        let name = trim(form.name)

        switch step {
        case .identity:
            if name.isEmpty { e[.name] = "Organization name is required." }
            else if name.count > 80 { e[.name] = "Keep this under 80 characters." }
            if trim(form.adminName).isEmpty { e[.adminName] = "Your name is required." }
            if !isEmail(form.adminEmail) { e[.adminEmail] = "Enter a valid email address." }
            // No domain at signup — a domain allowlist is a Business control.
            // A blank extra-admin row is just unused, not an error.
            let extras = form.extraAdmins.map(trim).filter { !$0.isEmpty }
            if let bad = extras.first(where: { !isEmail($0) }) {
                e[.extraAdmins] = "Not a valid email: \(bad)"
            }
            let all = ([form.adminEmail] + extras).map { trim($0).lowercased() }.filter { !$0.isEmpty }
            if Set(all).count != all.count { e[.extraAdmins] = "That address is already listed." }

        case .basics:
            if form.industry.isEmpty { e[.industry] = "Pick an industry." }
            if form.companySize.isEmpty { e[.companySize] = "Pick a company size." }
            if trim(form.country).isEmpty { e[.country] = "Country is required." }
            if trim(form.timeZone).isEmpty { e[.timeZone] = "Time zone is required." }
            if !currencies.contains(where: { $0.value == form.currency }) { e[.currency] = "Pick a currency." }

        case .tier:
            // Business is shown but refused here as well as in the UI — a
            // disabled card is a suggestion, and this value decides the POST.
            if form.tier != .basic { e[.tier] = "Business is not available yet. It is coming soon." }

        case .payroll:
            if !payPeriods.contains(where: { $0.value == form.payPeriodType }) {
                e[.payPeriodType] = "Pick a pay period."
            }
            // A DATE, not a weekday: every period boundary counts forward from it.
            if !isDate(form.payPeriodStart) {
                e[.payPeriodStart] = "Pick the date the first pay period starts."
            }

        case .confirm:
            for s in Step.allCases where s != .confirm {
                e.merge(validate(s, form)) { current, _ in current }
            }
        }
        return e
    }

    static func isValid(_ step: Step, _ form: Form) -> Bool { validate(step, form).isEmpty }

    // MARK: What gets sent

    struct Payload: Encodable, Equatable {
        struct Settings: Encodable, Equatable {
            let timeZone: String
            let payPeriodType: String
            let payPeriodStart: String
        }
        let name: String
        let adminEmail: String
        let adminName: String
        let adminEmails: [String]
        let industry: String
        let companySize: String
        let country: String
        let currency: String
        let settings: Settings
    }

    /// `buildOrgPayload`. The primary admin first, then the invitees, lowercased
    /// and de-duplicated in order.
    static func payload(_ form: Form) -> Payload {
        let admin = trim(form.adminEmail).lowercased()
        var seen = Set<String>()
        let emails = ([admin] + form.extraAdmins.map { trim($0).lowercased() }.filter { !$0.isEmpty })
            .filter { seen.insert($0).inserted }
        return Payload(
            name: trim(form.name),
            adminEmail: admin,
            adminName: trim(form.adminName),
            adminEmails: emails,
            industry: form.industry,
            companySize: form.companySize,
            country: trim(form.country),
            currency: form.currency.isEmpty ? "USD" : form.currency,
            settings: .init(timeZone: trim(form.timeZone),
                            payPeriodType: form.payPeriodType,
                            payPeriodStart: form.payPeriodStart))
    }

    /// Other admins that aren't the person signing up — what Confirm counts as
    /// "invites".
    static func inviteRecipients(_ form: Form) -> [String] {
        let admin = trim(form.adminEmail).lowercased()
        var seen = Set<String>()
        return form.extraAdmins
            .map { trim($0).lowercased() }
            .filter { !$0.isEmpty && $0 != admin && seen.insert($0).inserted }
    }
}
