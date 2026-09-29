import Testing
import Foundation
@testable import TRAQS_Scheduling

/// The invite email's Accept link, as iOS hands it to the app. The server builds
/// it in email-invite.js (`inviteAcceptUrl`); these pin the two ends together.
struct InviteLinkTests {
    private func parse(_ s: String) -> InviteLink? { URL(string: s).flatMap(InviteLink.parse) }

    @Test func readsTheLinkTheEmailSends() {
        let link = parse("https://traqs.netlify.app/?org=TES.4865.54VU&invite=abc_DEF-123")
        #expect(link == InviteLink(orgCode: "TES.4865.54VU", token: "abc_DEF-123"))
    }

    @Test func percentEncodingIsUndone() {
        // encodeURIComponent on the server; a legacy code with no dots is fine too.
        let link = parse("https://traqs.netlify.app/?org=MTX2026TRAQS&invite=a%2Db")
        #expect(link?.token == "a-b")
        #expect(link?.orgCode == "MTX2026TRAQS")
    }

    @Test func noTrailingSlashStillCounts() {
        #expect(parse("https://traqs.netlify.app?org=ABC&invite=t") != nil)
    }

    @Test func orgCodeIsUppercasedLikeATypedOne() {
        #expect(parse("https://traqs.netlify.app/?org=tes.4865.54vu&invite=t")?.orgCode == "TES.4865.54VU")
    }

    @Test func bothHalvesAreRequired() {
        #expect(parse("https://traqs.netlify.app/?org=ABC") == nil)
        #expect(parse("https://traqs.netlify.app/?invite=t") == nil)
        #expect(parse("https://traqs.netlify.app/?org=&invite=t") == nil)
    }

    @Test func onlyOurHostOverHTTPS() {
        #expect(parse("https://traqs.com/?org=ABC&invite=t") == nil)
        #expect(parse("http://traqs.netlify.app/?org=ABC&invite=t") == nil)
        #expect(parse("https://evil.example/?org=ABC&invite=t") == nil)
    }

    @Test func onlyTheRootPath() {
        #expect(parse("https://traqs.netlify.app/jobs?org=ABC&invite=t") == nil)
    }
}
