import Testing
import Foundation
@testable import TRAQS_Scheduling

/// src/orgSignup.js, rule for rule. If one of these has to change, the web's
/// copy almost certainly does too.
@Suite("Org signup") @MainActor
struct OrgSignupTests {

    private var complete: OrgSignup.Form {
        var f = OrgSignup.Form.initial(timeZone: "America/Denver")
        f.name = "Acme Fabrication"
        f.adminName = "Dana Reyes"
        f.adminEmail = "Dana@AcmeFab.com "
        f.industry = "Fabrication"
        f.companySize = "11-50"
        f.country = "United States"
        f.payPeriodStart = "2026-10-05"
        return f
    }

    @Test func aCompleteFormPassesEveryStep() {
        for step in OrgSignup.Step.allCases {
            #expect(OrgSignup.isValid(step, complete), "\(step) should pass")
        }
    }

    @Test func stepsAreNumberedFromIdentity() {
        #expect(OrgSignup.Step.identity.number == 1)
        #expect(OrgSignup.Step.confirm.number == 5)
        #expect(OrgSignup.Step.identity.previous == nil)
        #expect(OrgSignup.Step.tier.previous == .basics)
        #expect(OrgSignup.Step.confirm.next == nil)
    }

    @Test func identityNeedsNameAdminAndEmail() {
        let e = OrgSignup.validate(.identity, OrgSignup.Form())
        #expect(e[.name] != nil && e[.adminName] != nil && e[.adminEmail] != nil)

        var long = complete
        long.name = String(repeating: "x", count: 81)
        #expect(OrgSignup.validate(.identity, long)[.name] == "Keep this under 80 characters.")
    }

    @Test func extraAdminsMustBeRealAndDistinct() {
        var f = complete
        f.extraAdmins = ["", "   "]
        #expect(OrgSignup.isValid(.identity, f), "blank rows are unused, not errors")

        f.extraAdmins = ["not-an-email"]
        #expect(OrgSignup.validate(.identity, f)[.extraAdmins] == "Not a valid email: not-an-email")

        f.extraAdmins = ["dana@acmefab.com"]
        #expect(OrgSignup.validate(.identity, f)[.extraAdmins] == "That address is already listed.")
    }

    @Test func basicsNeedsEverythingAndAKnownCurrency() {
        var f = complete
        f.industry = ""; f.companySize = ""; f.country = " "; f.timeZone = ""; f.currency = "JPY"
        let e = OrgSignup.validate(.basics, f)
        #expect(Set(e.keys) == [.industry, .companySize, .country, .timeZone, .currency])
    }

    @Test func businessIsRefused() {
        var f = complete
        f.tier = .business
        #expect(!OrgSignup.isValid(.tier, f))
        #expect(!OrgSignup.isValid(.confirm, f))
    }

    @Test func payrollNeedsAPeriodAndARealDate() {
        var f = complete
        f.payPeriodStart = ""
        #expect(OrgSignup.validate(.payroll, f)[.payPeriodStart] != nil)
        f.payPeriodStart = "2026-13-40"
        #expect(OrgSignup.validate(.payroll, f)[.payPeriodStart] != nil)
        f.payPeriodStart = "2026-10-05"
        f.payPeriodType = "fortnightly"
        #expect(OrgSignup.validate(.payroll, f)[.payPeriodType] != nil)
    }

    @Test func confirmCatchesAnEarlierStep() {
        var f = complete
        f.country = ""
        #expect(OrgSignup.validate(.confirm, f)[.country] != nil)
    }

    @Test func payloadIsTrimmedLowercasedAndSplit() throws {
        var f = complete
        f.extraAdmins = [" Sam@AcmeFab.com", "", "sam@acmefab.com", "dana@acmefab.com"]
        let p = OrgSignup.payload(f)
        #expect(p.name == "Acme Fabrication")
        #expect(p.adminEmail == "dana@acmefab.com")
        #expect(p.adminEmails == ["dana@acmefab.com", "sam@acmefab.com"])
        #expect(p.settings == .init(timeZone: "America/Denver", payPeriodType: "biweekly",
                                    payPeriodStart: "2026-10-05"))

        // The wire shape the server destructures: settings nested, no tier, no code.
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(p)) as? [String: Any]
        #expect(json?["tier"] == nil && json?["code"] == nil)
        #expect((json?["settings"] as? [String: Any])?["payPeriodType"] as? String == "biweekly")
        #expect(json?["currency"] as? String == "USD")
    }

    @Test func invitesExcludeTheCreator() {
        var f = complete
        f.extraAdmins = ["dana@acmefab.com", "sam@acmefab.com", " SAM@acmefab.com", ""]
        #expect(OrgSignup.inviteRecipients(f) == ["sam@acmefab.com"])
    }

    @Test func timeZonesAreUSFirstThenEveryOtherZoneOnce() {
        #expect(OrgSignup.timeZoneLabel("America/Denver") == "Mountain — America/Denver")
        #expect(OrgSignup.timeZoneLabel("America/Argentina/Buenos_Aires") == "America/Argentina/Buenos Aires")
        let others = OrgSignup.otherTimeZones(known: ["America/Denver", "Europe/London", "Asia/Tokyo", "Europe/Berlin", "UTC"])
        #expect(others.map(\.region) == ["Asia", "Europe"])
        #expect(others.last?.zones == ["Europe/Berlin", "Europe/London"])
    }

    @Test func countriesAreEnglishNamesAndIncludeTheCommonOnes() {
        let all = OrgSignup.allCountries()
        for c in OrgSignup.commonCountries { #expect(all.contains(c), "\(c) missing") }
        #expect(Set(all).count == all.count)
        #expect(OrgSignup.countriesByLetter().first?.letter == "A")
    }
}
