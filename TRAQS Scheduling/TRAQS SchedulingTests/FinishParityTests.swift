import Testing
import Foundation
@testable import TRAQS_Scheduling

// #477. The finish-request status rule, held against the web's — fixtures/finish-parity.json,
// written by scripts/finish-parity-test.mjs from src/finishRequests.js. Nobody types the
// `web` column; it is computed from `requestStatusOf`.
//
// THIS IS NOT A PORT PARITY SUITE, and that is the point. ScheduleParityTests compares the
// same function written twice. These two are deliberately DIFFERENT functions:
//
//   web  requestStatusOf(target, requestId) -> String      (never nil: it always guesses)
//   iOS  CompletionRequestRules.status(target:requestId:) -> String?
//
// and CompletionRequestRules documents why it departs: "the web falls back to 'pending' even
// when the target is MISSING, which is exactly what let a resolved request render live
// Approve/Deny whenever its job wasn't loaded. An unfound target stays nil — unknown — here."
//
// So this suite asserts THE DOCUMENTED DEPARTURE IS THE ONLY DIFFERENCE. Each case carries
// both answers; a case where they differ sets `iosDiffers` and must give a reason. A new
// divergence that nobody declared fails here, instead of living in a header nobody diffs.
//
// The fixture found a SECOND departure that the prose had never recorded: a target that IS
// loaded but carries no row, no stamp and no mirror, and is not finished. The web's fallback
// ends in "pending"; iOS returns nil. Five of the eighteen cases depart, all in that shape.
//
// ROWS ARE DECODED BY THE APP'S OWN `FinishRequestEntry` decoder, not rebuilt by hand. A
// hand-built row once turned a missing status into "" — a value the app never produces, since
// the real decoder reads it as "pending" — and the fixture declared a sixth departure that
// existed only in the test (#508).
//
// WHY THIS EXISTS WHILE THE TWO AGREE ON EVERY LIVE RECORD: this rule is the one handshake
// that crosses the platforms — a request is raised on iOS and approved on the web — so a
// divergence is guaranteed to reach a user. Agreement today is what makes it cheap to pin.
@Suite("Finish-request status parity with the web")
struct FinishParityTests {

    // MARK: The file

    struct Fixture: Decodable {
        struct Case: Decodable {
            struct Target: Decodable {
                let status: String?
                let pendingFinish: Bool?
                let finishRequest: Stamp?
                /// Decoded exactly as the app decodes them — numeric ids and a missing
                /// `status` included — so the suite tests what a phone would hold.
                let finishRequests: [FinishRequestEntry]?
            }
            struct Stamp: Decodable { let requestId: String? }
            let name: String
            /// null means the job was never loaded.
            let target: Target?
            let requestId: String?
            let web: String
            let ios: String?
            let iosDiffers: Bool?
            let why: String?
        }
        let cases: [Case]
    }

    static func load() throws -> Fixture {
        // Same lookup ScheduleParityTests uses. Repo-relative, from this file:
        // TRAQS Scheduling/TRAQS SchedulingTests → ../../fixtures. (Not Bundle.module —
        // that exists only in a SwiftPM package, and the fixture is not a bundle resource.)
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("fixtures/finish-parity.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// Build the TargetState the fixture describes, without going through `target(job:…)` —
    /// that resolver has its own tests. This suite is about `status`.
    static func state(_ t: Fixture.Case.Target?) -> CompletionRequestRules.TargetState {
        guard let t else { return .missing }
        return CompletionRequestRules.TargetState(
            found: true,
            entries: t.finishRequests,
            stampRequestId: t.finishRequest?.requestId,
            pendingFinish: t.pendingFinish ?? false,
            isFinished: t.status == "Finished"
        )
    }

    // MARK: The parity

    @Test("every case answers exactly what the fixture says it must")
    func statusMatchesFixture() throws {
        let fx = try Self.load()
        #expect(fx.cases.count == 18, "the fixture lost or gained cases without this suite being told")
        for c in fx.cases {
            let got = CompletionRequestRules.status(target: Self.state(c.target), requestId: c.requestId)
            #expect(got == c.ios, """
                \(c.name)
                  iOS returned \(got.map { "\"\($0)\"" } ?? "nil")
                  fixture expects \(c.ios.map { "\"\($0)\"" } ?? "nil")
                  the web returns "\(c.web)"\(c.why.map { "\n  declared departure: \($0)" } ?? "")
                """)
        }
    }

    @Test("a departure is declared, never discovered")
    func departuresAreDeclared() throws {
        let fx = try Self.load()
        for c in fx.cases {
            let differs = c.ios != c.web
            #expect(differs == (c.iosDiffers ?? false),
                    "\(c.name): the fixture and the answers disagree about whether this is a departure")
            if differs {
                #expect((c.why?.count ?? 0) > 20, "\(c.name): a departure with no reason is a bug being documented as a feature")
            }
        }
    }

    @Test("the departures all have one shape: iOS declines to guess")
    func departuresAreOneRule() throws {
        let fx = try Self.load()
        let diffs = fx.cases.filter { $0.ios != $0.web }
        #expect(!diffs.isEmpty, "a fixture with no departures is not testing the thing it exists for")
        #expect(diffs.count < fx.cases.count, "a fixture where everything departs is not parity")
        for c in diffs {
            #expect(c.ios == nil && c.web == "pending",
                    "\(c.name): a departure that is NOT 'iOS returns nil where the web guesses pending' is a new rule, not the documented one")
        }
    }

    @Test("an unknown status is never actionable")
    func unknownIsNeverActionable() throws {
        let fx = try Self.load()
        for c in fx.cases where c.ios == nil {
            #expect(CompletionRequestRules.isActionable(c.ios) == false,
                    "\(c.name): Approve/Deny would be offered for a status iOS does not know")
        }
    }
}
