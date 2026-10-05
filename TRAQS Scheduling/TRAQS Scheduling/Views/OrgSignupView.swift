import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Create organization · the signup wizard
//
// The web's CreateOrgStep (src/App.jsx) + SignupSteps.jsx, screen for screen:
// Identity → Organization basics → Tier → Payroll → Confirm & activate, then the
// org-code screen. The RULES are in Services/OrgSignup.swift; this file is
// navigation, rendering, and the one network call.
//
// Signup comes BEFORE sign-in, as on the web. `POST /org` is unauthenticated,
// and the creator gets in afterwards because their address is in the new org's
// adminEmails — their person row is written on first login.
//
// Paper palette and card, the same as WelcomeView, so this reads as the same
// flow. Every control on it is Liquid Glass: fields, pills, menus, the date
// button, tier cards, and every button down to Back and Edit.

private enum Paper {
    static let ground = Color(hex: "#EDEAE3")
    static let card = Color(hex: "#FBFAF7")
    static let ink = Color(hex: "#0B0B0C")
    static let stone = Color(hex: "#8A867E")
    static let hairline = Color(hex: "#101828").opacity(0.08)
    static let error = Color(hex: "#C0392B")
    /// The button blue — fixed, not the customization accent. See WelcomeView.
    static let blue = Color(hex: "#4169E1")
    /// A little white in the glass for the things you READ or type into —
    /// fields, the summary sections, the calendar. Buttons are clear glass.
    static let glassFill = Color.white.opacity(0.55)
}

struct OrgSignupView: View {
    /// The org exists: its code and name. The caller takes it to sign-in.
    let onActivated: (_ code: String, _ name: String) -> Void
    /// Back out of the first step, to the welcome screen.
    let onCancel: () -> Void

    @State private var form = OrgSignup.Form.initial()
    @State private var step: OrgSignup.Step = .identity
    /// Errors appear only once a step has been attempted — on an untouched form
    /// they read as complaints about not having typed yet.
    @State private var touched: Set<OrgSignup.Step> = []
    @State private var cardVisible = true
    @State private var loading = false
    @State private var serverError: String?
    @State private var activatedCode: String?

    private let fadeDuration = 0.19
    /// Back and Next share one label size and one frame (`NavPillSize`), so the
    /// pair can't drift apart again.
    static let navFont = TTypo.smBold(15)

    private var errors: [OrgSignup.Field: String] {
        touched.contains(step) ? OrgSignup.validate(step, form) : [:]
    }

    var body: some View {
        ZStack {
            Paper.ground.ignoresSafeArea()
            GeometryReader { screen in
                ScrollView {
                    VStack(spacing: 0) {
                        TRAQSHeaderLogo(size: 52, fixedBrand: true)
                            .padding(.top, 24)
                            .padding(.bottom, 14)
                        Text(activatedCode == nil ? step.heading : "Organization created")
                            .font(TTypo.h3(20))
                            .tracking(-0.4)
                            .foregroundStyle(Paper.ink)
                            .multilineTextAlignment(.center)
                            .padding(.bottom, 22)

                        card
                            .opacity(cardVisible ? 1 : 0)
                            .scaleEffect(cardVisible ? 1 : 1.03)

                        if activatedCode == nil {
                            StepDots(current: step).padding(.top, 18)
                        }
                    }
                    .padding(.bottom, 24)
                    .frame(maxWidth: 440)
                    .padding(.horizontal, 22)
                    // At least a screen tall, content centred in it: every step's
                    // card sits in the middle of the screen, and a step taller than
                    // the screen (Confirm, or Identity with the keyboard up) still
                    // scrolls from the top.
                    .frame(maxWidth: .infinity, minHeight: screen.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .preferredColorScheme(.light)
    }

    // MARK: - Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let code = activatedCode {
                ActivatedPanel(code: code, orgName: form.name.trimmingCharacters(in: .whitespaces)) {
                    onActivated(code, form.name.trimmingCharacters(in: .whitespaces))
                }
            } else {
                if let serverError {
                    ErrorBox(text: serverError).padding(.bottom, 14)
                }
                stepContent
                // Back bottom-left, Next bottom-right.
                // Back bottom-left, Next bottom-right — the same small pill.
                HStack(spacing: 12) {
                    backButton
                    Spacer(minLength: 0)
                    primaryButton
                }
                .padding(.top, 22)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 24)
        .background(RoundedRectangle(cornerRadius: T.cornerHero, style: .continuous).fill(Paper.card))
        .overlay(RoundedRectangle(cornerRadius: T.cornerHero, style: .continuous)
            .strokeBorder(Paper.hairline, lineWidth: 1))
        .shadow(color: .black.opacity(0.07), radius: 30, x: 0, y: 18)
    }

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case .identity: IdentityStep(form: $form, errors: errors)
        case .basics:   BasicsStep(form: $form, errors: errors)
        case .tier:     TierStep(form: $form, errors: errors)
        case .payroll:  PayrollStep(form: $form, errors: errors)
        case .confirm:  ConfirmStep(form: form, errors: errors, onEdit: goTo)
        }
    }

    private var primaryButton: some View {
        let isConfirm = step == .confirm
        let name = form.name.trimmingCharacters(in: .whitespaces)
        return Button {
            if isConfirm { Task { await activate() } } else { next() }
        } label: {
            Group {
                if loading {
                    ProgressView().tint(.white)
                } else {
                    Text(isConfirm ? "Activate “\(name.isEmpty ? "your organization" : name)” →" : "Next")
                        .font(Self.navFont)
                        .lineLimit(1)
                        .minimumScaleFactor(isConfirm ? 0.75 : 1)
                }
            }
            .foregroundStyle(.white)
            .modifier(NavPillSize())
            .glassCTA(in: Capsule(style: .continuous), tint: Paper.blue)
        }
        .buttonStyle(.plain)
        .disabled(loading)
    }

    private var backButton: some View {
        Button(action: back) {
            Text(step.previous.map { "← \($0.title)" } ?? "← Back")
                .font(Self.navFont)
                .foregroundStyle(Paper.ink)
                .lineLimit(1)
                .modifier(NavPillSize())
                .glassControl(in: Capsule(style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(loading)
    }

    // MARK: - Navigation

    private func next() {
        touched.insert(step)
        guard OrgSignup.isValid(step, form), let target = step.next else { return }
        serverError = nil
        go(to: target)
    }

    private func back() {
        serverError = nil
        guard let prev = step.previous else { onCancel(); return }
        go(to: prev)
    }

    /// Edit from Confirm. Marked touched so its problems show the moment it
    /// opens — the whole reason to be sent back.
    private func goTo(_ target: OrgSignup.Step) {
        touched.insert(target)
        go(to: target)
    }

    /// The card fades out, the step swaps at the midpoint, it fades back in —
    /// cross-fading two different form heights makes the card jump.
    private func go(to target: OrgSignup.Step) {
        guard target != step else { return }
        hideKeyboard()
        withAnimation(.easeInOut(duration: fadeDuration)) { cardVisible = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + fadeDuration) {
            step = target
            withAnimation(.easeInOut(duration: fadeDuration)) { cardVisible = true }
        }
    }

    private func activate() async {
        touched.insert(.confirm)
        guard OrgSignup.isValid(.confirm, form) else { return }
        hideKeyboard()
        loading = true
        serverError = nil
        defer { loading = false }
        do {
            let code = try await APIService.createOrg(OrgSignup.payload(form))
            withAnimation(.easeInOut(duration: fadeDuration)) { cardVisible = false }
            DispatchQueue.main.asyncAfter(deadline: .now() + fadeDuration) {
                activatedCode = code
                withAnimation(.easeInOut(duration: fadeDuration)) { cardVisible = true }
            }
        } catch let e as CreateOrgError {
            serverError = e.localizedDescription
        } catch {
            serverError = "Couldn't reach TRAQS. Check your connection and try again."
        }
    }

    private func hideKeyboard() {
        #if canImport(UIKit)
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        #endif
    }
}

// MARK: - Steps

private struct IdentityStep: View {
    @Binding var form: OrgSignup.Form
    let errors: [OrgSignup.Field: String]

    private let rowAnimation = Animation.smooth(duration: 0.28)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FieldBlock("Organization Name", error: errors[.name]) {
                GlassTextField("Acme Fabrication", text: $form.name, content: .organizationName)
            }
            FieldBlock("Your Name", error: errors[.adminName]) {
                GlassTextField("Dana Reyes", text: $form.adminName, content: .name, capitalization: .words)
            }
            FieldBlock("Your Email", error: errors[.adminEmail]) {
                GlassTextField("dana@acmefab.com", text: $form.adminEmail, content: .emailAddress,
                               keyboard: .emailAddress, capitalization: .never)
            }

            FieldLabel("Other Administrators")
            ForEach(form.extraAdmins.indices, id: \.self) { i in
                HStack(spacing: 8) {
                    GlassTextField("sam@acmefab.com", text: Binding(
                        get: { form.extraAdmins.indices.contains(i) ? form.extraAdmins[i] : "" },
                        set: { if form.extraAdmins.indices.contains(i) { form.extraAdmins[i] = $0 } }),
                        keyboard: .emailAddress, capitalization: .never)
                    GlassSmallButton("Remove") {
                        withAnimation(rowAnimation) { _ = form.extraAdmins.remove(at: i) }
                    }
                }
                .padding(.bottom, 8)
                .transition(.opacity)
            }
            if let e = errors[.extraAdmins] { ErrorText(e).padding(.bottom, 8) }
            // Animated, so the new row fades in WHILE this button slides down to
            // make room. Unanimated, the row appeared at once, right where the
            // button's glass was still finishing its press bounce, and the glass
            // drew over the new field for a moment.
            Button { withAnimation(rowAnimation) { form.extraAdmins.append("") } } label: {
                Text("+ Add administrator")
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Paper.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .glassControl(in: Capsule(style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
    }
}

private struct BasicsStep: View {
    @Binding var form: OrgSignup.Form
    let errors: [OrgSignup.Field: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FieldBlock("Industry", error: errors[.industry]) {
                GlassMenu(selection: $form.industry,
                          options: OrgSignup.industries.map { .init(value: $0, label: $0) })
            }
            // Pills, not a menu: four options, all visible, as the web draws them.
            FieldBlock("Company Size", error: errors[.companySize]) {
                HStack(spacing: 8) {
                    ForEach(OrgSignup.companySizes, id: \.value) { c in
                        GlassPill(c.label, on: form.companySize == c.value) { form.companySize = c.value }
                    }
                }
            }
            FieldBlock("Country / Region", error: errors[.country]) {
                GlassMenuButton(label: form.country.isEmpty ? nil : form.country) {
                    ForEach(OrgSignup.commonCountries, id: \.self) { c in
                        MenuCheckItem(c, on: form.country == c) { form.country = c }
                    }
                    Divider()
                    Menu("All countries") {
                        ForEach(OrgSignup.countriesByLetter(), id: \.letter) { group in
                            Menu(group.letter) {
                                ForEach(group.names, id: \.self) { c in
                                    MenuCheckItem(c, on: form.country == c) { form.country = c }
                                }
                            }
                        }
                    }
                }
            }
            FieldBlock("Time Zone", error: errors[.timeZone]) {
                GlassMenuButton(label: form.timeZone.isEmpty ? nil : OrgSignup.timeZoneLabel(form.timeZone)) {
                    Section("United States") {
                        ForEach(OrgSignup.usTimeZones, id: \.value) { z in
                            MenuCheckItem(OrgSignup.timeZoneLabel(z.value), on: form.timeZone == z.value) {
                                form.timeZone = z.value
                            }
                        }
                    }
                    Menu("All time zones") {
                        ForEach(OrgSignup.otherTimeZones(), id: \.region) { group in
                            Menu(group.region.replacingOccurrences(of: "_", with: " ")) {
                                ForEach(group.zones, id: \.self) { z in
                                    MenuCheckItem(OrgSignup.timeZoneLabel(z), on: form.timeZone == z) {
                                        form.timeZone = z
                                    }
                                }
                            }
                        }
                    }
                }
            }
            FieldBlock("Currency", error: errors[.currency]) {
                GlassMenu(selection: $form.currency, options: OrgSignup.currencies)
            }
        }
    }
}

/// Business is drawn at full fidelity, dimmed and inert — the point of the
/// screen is the comparison. It is Matrix Systems' tier for now.
private struct TierStep: View {
    @Binding var form: OrgSignup.Form
    let errors: [OrgSignup.Field: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TierCard(name: "Basic", price: "Included", note: "Everything you need to run a crew.",
                     features: OrgSignup.basicFeatures, on: form.tier == .basic, disabled: false) {
                form.tier = .basic
            }
            TierCard(name: "Business", badge: "Coming soon", note: "Everything in Basic, plus:",
                     features: OrgSignup.businessFeatures, on: false, disabled: true) {}
            if let e = errors[.tier] { ErrorBox(text: e) }
            Text("You can move to Business later without starting over.")
                .font(TTypo.xs(11.5))
                .foregroundStyle(Paper.stone)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
    }
}

private struct PayrollStep: View {
    @Binding var form: OrgSignup.Form
    let errors: [OrgSignup.Field: String]
    @State private var pickingDate = false

    /// The shop being signed up: the zone picked above, not the phone's. A first pay day is a
    /// shop day (chunk D ruling 6), and the org has no settings yet for `ShopTime.current`.
    private var shop: ShopTime { ShopTime(zone: TimeZone(identifier: form.timeZone) ?? .current) }

    private var date: Binding<Date> {
        Binding(
            get: { shop.date(ofDay: form.payPeriodStart) ?? Date() },
            set: { form.payPeriodStart = shop.ymd($0) })
    }

    private var dateLabel: String? {
        guard let d = shop.date(ofDay: form.payPeriodStart) else { return nil }
        return shop.formatter("MMMM d, yyyy").string(from: d)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Two rows of two — four on one line leaves each too narrow to read.
            FieldBlock("Pay Period", error: errors[.payPeriodType]) {
                VStack(spacing: 8) {
                    ForEach([Array(OrgSignup.payPeriods.prefix(2)), Array(OrgSignup.payPeriods.suffix(2))],
                            id: \.self) { row in
                        HStack(spacing: 8) {
                            ForEach(row, id: \.value) { p in
                                GlassPill(p.label, on: form.payPeriodType == p.value) { form.payPeriodType = p.value }
                            }
                        }
                    }
                }
            }
            // A DATE, not a weekday: every period boundary counts forward from it.
            // A button rather than a bare DatePicker, because a DatePicker always
            // shows a date and "today" would look chosen when nothing was.
            FieldBlock("First Pay Period Starts", error: errors[.payPeriodStart]) {
                VStack(alignment: .leading, spacing: 10) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            if form.payPeriodStart.isEmpty {
                                form.payPeriodStart = shop.day(Date())
                            }
                            pickingDate.toggle()
                        }
                    } label: {
                        HStack {
                            Text(dateLabel ?? "Select a date")
                                .font(TTypo.sm(15))
                                .foregroundStyle(dateLabel == nil ? Paper.stone : Paper.ink)
                            Spacer()
                            Image(systemName: "calendar")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Paper.stone)
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 13)
                        .glassControl(in: Capsule(style: .continuous))
                    }
                    .buttonStyle(.plain)

                    if pickingDate {
                        DatePicker("First pay period starts", selection: date, displayedComponents: .date)
                            .environment(\.timeZone, shop.zone)
                            .datePickerStyle(.graphical)
                            .labelsHidden()
                            .tint(Paper.blue)
                            .padding(8)
                            .glassControl(in: RoundedRectangle(cornerRadius: 22, style: .continuous),
                                          interactive: false, tint: Paper.glassFill)
                            .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top)))
                    }
                }
            }
        }
    }
}

private struct ConfirmStep: View {
    let form: OrgSignup.Form
    let errors: [OrgSignup.Field: String]
    let onEdit: (OrgSignup.Step) -> Void

    private var extras: [String] {
        form.extraAdmins.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    var body: some View {
        let inviteCount = OrgSignup.inviteRecipients(form).count
        let period = OrgSignup.payPeriods.first { $0.value == form.payPeriodType }?.label
        let size = OrgSignup.companySizes.first { $0.value == form.companySize }.map { "\($0.label) people" }

        VStack(alignment: .leading, spacing: 12) {
            if !errors.isEmpty {
                ErrorBox(text: "Something above needs attention before this can be activated. Use Edit to go back.")
            }
            Section(title: "Identity") { onEdit(.identity) } rows: {
                Row("Organization", form.name)
                Row("Administrator", form.adminName)
                Row("Email", form.adminEmail)
                Row("Other admins", extras.isEmpty ? "None" : extras.joined(separator: ", "))
            }
            Section(title: "Organization basics") { onEdit(.basics) } rows: {
                Row("Industry", form.industry)
                Row("Size", size ?? "")
                Row("Country", form.country)
                Row("Time zone", form.timeZone)
                Row("Currency", form.currency)
            }
            Section(title: "Tier") { onEdit(.tier) } rows: {
                Row("Plan", form.tier == .business ? "Business" : "Basic")
            }
            Section(title: "Payroll") { onEdit(.payroll) } rows: {
                Row("Pay period", period ?? "")
                Row("First period starts", form.payPeriodStart)
            }

            // Invites follow the org's creation — there is nothing to attach them
            // to before it exists — so this says what will happen.
            HStack(spacing: 8) {
                Image(systemName: "envelope")
                    .font(.system(size: 13, weight: .semibold))
                Text(inviteCount > 0
                     ? "\(inviteCount) invite\(inviteCount == 1 ? "" : "s") will be sent"
                     : "No invites to send")
                    .font(TTypo.smBold(13))
            }
            .foregroundStyle(Paper.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .glassControl(in: Capsule(style: .continuous), interactive: false, tint: Paper.glassFill)
            .padding(.top, 2)

            Text("Invites auto-create employee TRAQS accounts on accept.")
                .font(TTypo.xs(12))
                .foregroundStyle(Paper.stone)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    private struct Section<Rows: View>: View {
        let title: String
        let onEdit: () -> Void
        @ViewBuilder let rows: () -> Rows

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title.uppercased())
                        .font(TTypo.xsBold(11))
                        .tracking(0.4)
                        .foregroundStyle(Paper.stone)
                    Spacer()
                    GlassSmallButton("Edit", action: onEdit)
                }
                .padding(.bottom, 2)
                rows()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .glassControl(in: RoundedRectangle(cornerRadius: 18, style: .continuous),
                          interactive: false, tint: Paper.glassFill)
        }
    }

    private struct Row: View {
        let label: String
        let value: String
        init(_ label: String, _ value: String) { self.label = label; self.value = value }

        var body: some View {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(label).foregroundStyle(Color(hex: "#8A8378"))
                Spacer(minLength: 8)
                Text(value.isEmpty ? "—" : value)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color(hex: "#2B2926"))
                    .multilineTextAlignment(.trailing)
            }
            .font(TTypo.sm(13))
            .padding(.vertical, 3)
        }
    }
}

// MARK: - Activated

/// Shown once the org exists. The code is generated server-side and this is the
/// only place it's presented, so it's hard to miss and easy to copy.
private struct ActivatedPanel: View {
    let code: String
    let orgName: String
    let onContinue: () -> Void
    @State private var copied = false

    var body: some View {
        VStack(spacing: 0) {
            Text("\(orgName) is live")
                .font(TTypo.smBold(15))
                .foregroundStyle(Color(hex: "#2B2926"))
                .padding(.bottom, 4)
            Text("This is your organization code. Your team enters it to sign in.")
                .font(TTypo.sm(13))
                .foregroundStyle(Color(hex: "#8A8378"))
                .multilineTextAlignment(.center)
                .padding(.bottom, 18)

            Text(code)
                .font(.custom(TFontName.bold.rawValue, size: 22))
                .tracking(2.2)
                .foregroundStyle(Color(hex: "#2B2926"))
                .textSelection(.enabled)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .padding(.horizontal, 10)
                .glassControl(in: RoundedRectangle(cornerRadius: 16, style: .continuous),
                              interactive: false, tint: Paper.blue.opacity(0.10))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Paper.blue.opacity(0.7), lineWidth: 1.5))
                .padding(.bottom, 12)

            GlassSmallButton(copied ? "Copied" : "Copy code") {
                #if canImport(UIKit)
                UIPasteboard.general.string = code
                #endif
                copied = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { copied = false }
            }
            .padding(.bottom, 18)

            Text("Write it down now. You can always find it again from the sign-in screen.")
                .font(TTypo.xs(12))
                .foregroundStyle(Paper.stone)
                .multilineTextAlignment(.center)
                .padding(.bottom, 18)

            Button(action: onContinue) {
                Text("Continue to sign in")
                    .font(TTypo.smBold(15))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .glassCTA(in: Capsule(style: .continuous), tint: Paper.blue)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Controls

/// The Back / Next pill's size — one definition for both.
private struct NavPillSize: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 22)
            .frame(minWidth: 108, minHeight: 46)
    }
}

private struct StepDots: View {
    let current: OrgSignup.Step

    var body: some View {
        VStack(spacing: 8) {
            Text("STEP \(current.number) OF \(OrgSignup.Step.allCases.count)")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .tracking(2)
                .foregroundStyle(Paper.stone)
            HStack(spacing: 6) {
                ForEach(OrgSignup.Step.allCases) { s in
                    Circle()
                        .fill(s.number <= current.number ? Paper.ink : Color(hex: "#D7D3C9"))
                        .frame(width: 7, height: 7)
                }
            }
            .animation(.easeInOut(duration: 0.22), value: current)
        }
    }
}

private struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(TTypo.xsBold(10))
            .tracking(1)
            .foregroundStyle(Paper.stone)
            .padding(.bottom, 8)
    }
}

private struct ErrorText: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(TTypo.xs(12))
            .foregroundStyle(Paper.error)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ErrorBox: View {
    let text: String
    var body: some View {
        Text(text)
            .font(TTypo.sm(13))
            .foregroundStyle(Color(hex: "#B42318"))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(hex: "#EF4444").opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color(hex: "#EF4444").opacity(0.28), lineWidth: 1))
    }
}

/// A label, its control, and the field's error UNDER it — next to what it's about.
private struct FieldBlock<Content: View>: View {
    let label: String
    let error: String?
    @ViewBuilder let content: () -> Content

    init(_ label: String, error: String?, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.error = error
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FieldLabel(label)
            content()
            if let error { ErrorText(error).padding(.top, 6) }
        }
        .padding(.bottom, 14)
    }
}

private struct GlassTextField: View {
    let placeholder: String
    @Binding var text: String
    var content: UITextContentType? = nil
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .sentences
    @FocusState private var focused: Bool

    init(_ placeholder: String, text: Binding<String>, content: UITextContentType? = nil,
         keyboard: UIKeyboardType = .default, capitalization: TextInputAutocapitalization = .sentences) {
        self.placeholder = placeholder
        self._text = text
        self.content = content
        self.keyboard = keyboard
        self.capitalization = capitalization
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(TTypo.sm(15))
            .foregroundStyle(Paper.ink)
            .textContentType(content)
            .keyboardType(keyboard)
            .textInputAutocapitalization(capitalization)
            .autocorrectionDisabled()
            .focused($focused)
            .padding(.horizontal, 18)
            .padding(.vertical, 13)
            // Taps on the padding focus the field too; the field itself sits
            // above this and keeps its own taps for cursor placement.
            .background(Color.clear.contentShape(Capsule()).onTapGesture { focused = true })
            .glassControl(in: Capsule(style: .continuous), interactive: false, tint: Paper.glassFill)
            .overlay(Capsule(style: .continuous)
                .strokeBorder(focused ? Paper.blue : .clear, lineWidth: 1.2))
            .animation(.easeInOut(duration: 0.15), value: focused)
    }
}

/// Selectable pill: ink-tinted glass when on, clear glass when off.
private struct GlassPill: View {
    let label: String
    let on: Bool
    let action: () -> Void

    init(_ label: String, on: Bool, action: @escaping () -> Void) {
        self.label = label
        self.on = on
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(on ? TTypo.smBold(12.5) : TTypo.sm(12.5))
                .foregroundStyle(on ? Color.white : Paper.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .glassControl(in: Capsule(style: .continuous), tint: on ? Paper.ink : nil)
                .animation(.easeInOut(duration: 0.12), value: on)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A dropdown: the system menu, opened from a glass capsule showing the current
/// value (or "Select…").
private struct GlassMenuButton<Items: View>: View {
    let label: String?
    @ViewBuilder let items: () -> Items

    var body: some View {
        Menu {
            items()
        } label: {
            HStack(spacing: 8) {
                Text(label ?? "Select…")
                    .font(TTypo.sm(15))
                    .foregroundStyle(label == nil ? Paper.stone : Paper.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Paper.stone)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 13)
            .contentShape(Capsule())
            .glassControl(in: Capsule(style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// A menu row that shows a checkmark on the current choice.
private struct MenuCheckItem: View {
    let title: String
    let on: Bool
    let action: () -> Void
    init(_ title: String, on: Bool, action: @escaping () -> Void) {
        self.title = title
        self.on = on
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            if on { Label(title, systemImage: "checkmark") } else { Text(title) }
        }
    }
}

/// A flat list of options as a dropdown.
private struct GlassMenu: View {
    @Binding var selection: String
    let options: [OrgSignup.Option]

    var body: some View {
        GlassMenuButton(label: options.first { $0.value == selection }?.label) {
            ForEach(options, id: \.value) { o in
                MenuCheckItem(o.label, on: o.value == selection) { selection = o.value }
            }
        }
    }
}

private struct GlassSmallButton: View {
    let title: String
    let action: () -> Void
    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(TTypo.smBold(12.5))
                .foregroundStyle(Paper.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .glassControl(in: Capsule(style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct TierCard: View {
    let name: String
    var price: String? = nil
    var badge: String? = nil
    let note: String
    let features: [String]
    let on: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text(name)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(disabled ? Color(hex: "#6F6B62") : Paper.ink)
                    Spacer()
                    if let badge {
                        Text(badge.uppercased())
                            .font(.system(size: 9, weight: .semibold))
                            .tracking(1.2)
                            .foregroundStyle(Paper.stone)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .glassControl(in: Capsule(), interactive: false, tint: Paper.glassFill)
                    } else if let price {
                        Text(price).font(TTypo.xs(11)).foregroundStyle(Paper.stone)
                    }
                }
                Text(note)
                    .font(TTypo.xs(11.5))
                    .foregroundStyle(Paper.stone)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(features, id: \.self) { f in
                        HStack(alignment: .firstTextBaseline, spacing: 7) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(disabled ? Color(hex: "#B4B0A6") : Paper.ink)
                            Text(f)
                                .font(TTypo.sm(12.5))
                                .foregroundStyle(disabled ? Color(hex: "#7C786F") : Color(hex: "#2B2926"))
                        }
                    }
                }
                .padding(.top, 9)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .glassControl(in: RoundedRectangle(cornerRadius: 18, style: .continuous),
                          interactive: !disabled)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(on ? Paper.ink : .clear, lineWidth: 1.5))
            .opacity(disabled ? 0.62 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
