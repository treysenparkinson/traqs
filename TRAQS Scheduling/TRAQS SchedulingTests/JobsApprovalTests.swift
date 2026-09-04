import Testing
import Foundation
@testable import TRAQS_Scheduling

// The Approval and Activity columns' rules — `apprStateFor` / `apprActivityFor`
// and the writers behind them.
//
// Worth more coverage than most of this layer for two reasons. A wrong read shows
// somebody a chain that is not theirs to sign; a wrong WRITE forges a signature,
// or drops one somebody is relying on. And all three shapes live in
// `Panel.extras` — the passthrough that the unmodelled-field bug was about — so
// every write here is also a test that a panel's other unmodelled keys survive.
@Suite("Approval chains")
struct JobsApprovalTests {

    // MARK: Fixtures

    private func job(_ json: String) -> Job {
        try! JSONDecoder().decode(Job.self, from: json.data(using: .utf8)!)
    }

    /// Encoded with sorted keys, which is how `JobsEdit.differs` compares too and
    /// for the same reason — Dictionary iteration order is per-process.
    private func encoded(_ job: Job) -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return String(data: try! e.encode(job), encoding: .utf8)!
    }

    private var settings: OrgSettings { .default }   // Review / Approve / Release

    private var admin: JobsApproval.Actor {
        JobsApproval.Actor(id: "u1", name: "Ada", canApprove: true)
    }
    private var worker: JobsApproval.Actor {
        JobsApproval.Actor(id: "u9", name: "Bob", canApprove: false)
    }

    /// A panel with the default engineering chain seeded and nothing signed —
    /// what every panel the web creates looks like. `qty` and `depsMode` are
    /// unmodelled and are here to be checked for survival.
    private var engineeringJob: Job {
        job("""
        {"id":"j1","title":"Job","subs":[{"id":"p1","title":"Panel A",
         "engineering":{"designed":null,"verified":null,"sentToPerforex":null},
         "subs":[],"qty":12,"depsMode":"locked"}]}
        """)
    }

    // MARK: Which chain a panel is running

    @Test func aSeededEngineeringPanelReadsAsAChain() {
        let state = JobsApproval.state(of: engineeringJob.subs[0], settings: settings)
        #expect(state?.kind == .engineering)
        #expect(state?.steps.map(\.label) == ["Review", "Approve", "Release"])
        #expect(state?.done == 0)
        #expect(state?.activeIndex == 0)
    }

    // `panel.engineering !== undefined` — the KEY, not a truthy value. A panel
    // without one has no approval at all and its cell stays empty.
    @Test func aPanelWithNoEngineeringKeyHasNoChain() {
        let bare = job("""
        {"id":"j","title":"J","subs":[{"id":"p1","title":"A","subs":[]}]}
        """)
        #expect(JobsApproval.state(of: bare.subs[0], settings: settings) == nil)
        #expect(JobsApproval.rollup(of: bare, settings: settings) == nil)
    }

    // Precedence: `apprChain` supersedes both of the others (TRAQS.jsx:11193).
    @Test func aCustomChainSupersedesTheEngineeringOne() {
        let both = job("""
        {"id":"j","title":"J","subs":[{"id":"p1","title":"A","subs":[],
         "engineering":{"designed":null,"verified":null,"sentToPerforex":null},
         "apprChain":[{"label":"Draft","done":true,"by":"u3","byName":"Cy",
                       "at":"2026-01-01T10:00:00.000Z"},
                      {"label":"QA","done":false,"assigneeId":"u9"}]}]}
        """)
        let state = JobsApproval.state(of: both.subs[0], settings: settings)
        #expect(state?.kind == .chain)
        #expect(state?.total == 2)
        #expect(state?.done == 1)
        #expect(state?.latest?.record?.byName == "Cy")
    }

    @Test func aSignOffTemplateSuppliesTheLabels() {
        let orgSettings = try! JSONDecoder().decode(OrgSettings.self, from: """
        {"hpd":8,"signOffTemplates":[{"id":"t1","name":"Weld QA",
                                      "steps":["Fit","Weld","Inspect"]}]}
        """.data(using: .utf8)!)
        // A numeric `by`, which is what the server writes for an older person id.
        let panel = job("""
        {"id":"j","title":"J","subs":[{"id":"p1","title":"A","subs":[],
         "signOffs":{"t1":{"0":{"by":42,"byName":"Dee","at":"2026-02-02T09:00:00.000Z"}}}}]}
        """).subs[0]

        let state = JobsApproval.state(of: panel, settings: orgSettings)
        #expect(state?.kind == .signOff(templateID: "t1"))
        #expect(state?.steps.map(\.label) == ["Fit", "Weld", "Inspect"])
        #expect(state?.steps[0].record?.by == "42")
        #expect(state?.activeIndex == 1)
    }

    // MARK: Who may sign

    @Test func someoneWithoutApprovalAccessCannotSign() {
        let after = JobsApproval.signing(step: 0, panelID: "p1", in: engineeringJob,
                                         settings: settings, by: worker)
        #expect(JobsApproval.state(of: after.subs[0], settings: settings)?.done == 0)
    }

    // `signChainStep`'s one exception: a step ASSIGNED to you is yours to sign
    // whatever the general permission says.
    @Test func anAssignedStepIsItsAssigneesToSign() {
        let assigned = job("""
        {"id":"j","title":"J","subs":[{"id":"p1","title":"A","subs":[],
         "apprChain":[{"label":"QA","done":false,"assigneeId":"u9"}]}]}
        """)
        let mine = JobsApproval.signing(step: 0, panelID: "p1", in: assigned,
                                        settings: settings, by: worker)
        #expect(JobsApproval.state(of: mine.subs[0], settings: settings)?
                    .steps[0].record?.byName == "Bob")

        let notMine = JobsApproval.signing(
            step: 0, panelID: "p1", in: assigned, settings: settings,
            by: JobsApproval.Actor(id: "u7", name: "Zed", canApprove: false))
        #expect(JobsApproval.state(of: notMine.subs[0], settings: settings)?
                    .steps[0].isSigned == false)
    }

    // The one outcome this must never produce: overwriting somebody else's
    // signature with yours.
    @Test func aSignedStepCannotBeReSigned() {
        let signed = JobsApproval.signing(step: 0, panelID: "p1", in: engineeringJob,
                                          settings: settings, by: admin)
        let again = JobsApproval.signing(
            step: 0, panelID: "p1", in: signed, settings: settings,
            by: JobsApproval.Actor(id: "u2", name: "Eve", canApprove: true))
        #expect(JobsApproval.state(of: again.subs[0], settings: settings)?
                    .steps[0].record?.byName == "Ada")
    }

    // MARK: Signing writes the right field

    @Test func signingAnEngineeringStepWritesTheModelledField() {
        let after = JobsApproval.signing(step: 0, panelID: "p1", in: engineeringJob,
                                         settings: settings, by: admin)
        #expect(after.subs[0].engineering?.designed?.byName == "Ada")
        #expect(JobsApproval.state(of: after.subs[0], settings: settings)?.activeIndex == 1)
    }

    // THE PASSTHROUGH. Every one of these writes goes through `Panel.extras`, and
    // this is the bug that made the approval system worth modelling at all.
    @Test func signingKeepsThePanelsUnmodelledFields() {
        let after = JobsApproval.signing(step: 0, panelID: "p1", in: engineeringJob,
                                         settings: settings, by: admin)
        let json = encoded(after)
        #expect(json.contains("\"qty\":12"))
        #expect(json.contains("\"depsMode\":\"locked\""))
        #expect(json.contains("\"apprLog\""))
    }

    /// A per-STEP key this file does not model, which `settingChain` and a sign
    /// both rewrite the whole array through.
    @Test func signingKeepsAStepsUnmodelledFields() {
        let odd = job("""
        {"id":"j","title":"J","subs":[{"id":"p1","title":"A","subs":[],
         "apprChain":[{"label":"QA","done":false,"weird":7}]}]}
        """)
        let after = JobsApproval.signing(step: 0, panelID: "p1", in: odd,
                                         settings: settings, by: admin)
        #expect(encoded(after).contains("\"weird\":7"))
    }

    // MARK: Reverting cascades

    // `revertEngineering` slices `stepOrder` from the reverted step to the end: a
    // chain whose second step is signed and whose first is not describes an
    // approval that never happened.
    @Test func revertingSweepsEveryLaterStep() {
        var j = engineeringJob
        for index in 0..<3 {
            j = JobsApproval.signing(step: index, panelID: "p1", in: j,
                                     settings: settings, by: admin)
        }
        #expect(JobsApproval.state(of: j.subs[0], settings: settings)?.allDone == true)

        j = JobsApproval.reverting(step: 1, panelID: "p1", in: j,
                                   settings: settings, by: admin)
        let state = JobsApproval.state(of: j.subs[0], settings: settings)
        #expect(state?.steps[0].isSigned == true)
        #expect(state?.steps[1].isSigned == false)
        #expect(state?.steps[2].isSigned == false)
    }

    // MARK: The chain editors

    @Test func removingACustomChainFallsBackToWhatWasUnderneath() {
        let both = job("""
        {"id":"j","title":"J","subs":[{"id":"p1","title":"A","subs":[],
         "engineering":{"designed":null,"verified":null,"sentToPerforex":null},
         "apprChain":[{"label":"Draft","done":false}]}]}
        """)
        let after = JobsApproval.removingChain(panelID: "p1", in: both, by: admin)
        #expect(JobsApproval.state(of: after.subs[0], settings: settings)?.kind == .engineering)
        #expect(!encoded(after).contains("apprChain"))
    }

    // The point of seeding the editor: adding a fourth step must not un-sign the
    // first three.
    @Test func editingTheStepsKeepsExistingSignatures() {
        let signed = JobsApproval.signing(step: 0, panelID: "p1", in: engineeringJob,
                                          settings: settings, by: admin)
        let seed = JobsApproval.editableSteps(of: signed.subs[0], settings: settings)
        #expect(seed.count == 3)
        #expect(seed[0].done && seed[0].byName == "Ada")

        let promoted = JobsApproval.settingChain(seed + [ApprovalChainStep(label: "Extra")],
                                                 panelID: "p1", in: signed, by: admin)
        let state = JobsApproval.state(of: promoted.subs[0], settings: settings)
        #expect(state?.kind == .chain)
        #expect(state?.total == 4)
        #expect(state?.steps[0].record?.byName == "Ada")
    }

    // MARK: The job rollup

    @Test func aJobSumsItsPanelsAndCountsOnlyThoseWithChains() {
        let j = job("""
        {"id":"j","title":"J","subs":[
         {"id":"p1","title":"A","subs":[],"engineering":{"designed":{"by":"u1","byName":"Ada","at":"2026-03-01T10:00:00.000Z"},"verified":null,"sentToPerforex":null}},
         {"id":"p2","title":"B","subs":[],"engineering":{"designed":null,"verified":null,"sentToPerforex":null}},
         {"id":"p3","title":"C","subs":[]}]}
        """)
        let rollup = JobsApproval.rollup(of: j, settings: settings)
        #expect(rollup?.kind == .rollup)
        #expect(rollup?.done == 1)
        #expect(rollup?.total == 6)          // two panels with three steps each
        #expect(rollup?.panelCount == 2)     // p3 has no chain and is not counted
        #expect(rollup?.latest?.record?.byName == "Ada")
    }

    // MARK: Activity

    @Test func activityPrefersTheLogOverTheSignatures() {
        var j = JobsApproval.signing(step: 0, panelID: "p1", in: engineeringJob,
                                     settings: settings, by: admin)
        #expect(JobsApproval.activity(ofPanel: j.subs[0], settings: settings)?.verb == "Signed")

        // Reverting ERASES the signature, so only the log can still say what
        // happened — the reason the trail exists at all.
        j = JobsApproval.reverting(step: 0, panelID: "p1", in: j,
                                   settings: settings, by: admin)
        let activity = JobsApproval.activity(ofPanel: j.subs[0], settings: settings)
        #expect(activity?.verb == "Reverted")
        #expect(activity?.byName == "Ada")
    }

    /// Panels signed before the log existed have no trail, and the newest
    /// signature still on the steps is the fallback.
    @Test func activityFallsBackToTheNewestSignature() {
        let legacy = job("""
        {"id":"j","title":"J","subs":[{"id":"p1","title":"A","subs":[],
         "engineering":{"designed":{"by":"u1","byName":"Ada","at":"2026-03-01T10:00:00.000Z"},
                        "verified":null,"sentToPerforex":null}}]}
        """)
        let activity = JobsApproval.activity(ofPanel: legacy.subs[0], settings: settings)
        #expect(activity?.verb == "Signed")
        #expect(activity?.byName == "Ada")
        // A job row reports what happened underneath it, so a collapsed job still
        // says something.
        #expect(JobsApproval.activity(ofJob: legacy, settings: settings)?.byName == "Ada")
    }

    @Test func aRowWithNoApprovalHistoryHasNoActivity() {
        #expect(JobsApproval.activity(ofPanel: engineeringJob.subs[0],
                                      settings: settings) == nil)
    }

    // MARK: Housekeeping

    /// `APPR_LOG_CAP` — the trail is a recent-activity feed, not an audit
    /// archive, and tasks.json cannot grow without bound.
    @Test func theLogIsCapped() {
        var j = engineeringJob
        for _ in 0..<25 {
            j = JobsApproval.signing(step: 0, panelID: "p1", in: j,
                                     settings: settings, by: admin)
            j = JobsApproval.reverting(step: 0, panelID: "p1", in: j,
                                       settings: settings, by: admin)
        }
        #expect(JobsApproval.log(of: j.subs[0]).count == JobsApproval.logCap)
    }

    /// Two entries in the SAME millisecond, which sign-then-revert in one gesture
    /// routinely produces. The trail is append-only, so array order is the real
    /// order and a tie must go to the later element — with a strict `>` the
    /// Activity column reported "Signed" for an approval that had just been
    /// reverted, which is the exact failure the log exists to prevent.
    @Test func twoEntriesInTheSameMillisecondKeepTheirOrder() {
        let now = Date()
        var j = JobsApproval.signing(step: 0, panelID: "p1", in: engineeringJob,
                                     settings: settings, by: admin, at: now)
        j = JobsApproval.reverting(step: 0, panelID: "p1", in: j,
                                   settings: settings, by: admin, at: now)

        let entries = JobsApproval.log(of: j.subs[0])
        #expect(entries.count == 2)
        #expect(entries.map(\.at).first == entries.map(\.at).last)   // same stamp
        #expect(JobsApproval.newest(in: entries)?.action == "reverted")
        #expect(JobsApproval.activity(ofPanel: j.subs[0],
                                      settings: settings)?.verb == "Reverted")
    }

    /// Stamps are ordered without building a `Date` — the Activity column asks
    /// "is this newer" once per log entry per panel per redraw. The fast path only
    /// handles the UTC form this app writes; anything carrying a real offset must
    /// fall back rather than be misread.
    @Test func theFastStampKeyAgreesWithTheFormatter() {
        for stamp in ["2026-03-01T10:00:00.000Z", "2026-03-01T10:00:00Z",
                      "2026-03-01T10:00:00.500Z", "2025-12-31T23:59:59.999Z",
                      "2024-02-29T12:00:00.000Z", "1970-01-01T00:00:00.000Z"] {
            let fast = ApprovalDate.sortKey(stamp)
            let viaFormatter = ApprovalDate.parse(stamp)?.timeIntervalSince1970
            #expect(fast != nil)
            #expect(abs(fast! - viaFormatter!) < 0.0005)
        }
        // An offset the digit scan must not try to read as UTC.
        #expect(ApprovalDate.sortKey("2026-03-01T12:00:00+02:00")
                == ApprovalDate.sortKey("2026-03-01T10:00:00Z"))
        #expect(ApprovalDate.sortKey("not a date") == nil)
        #expect(ApprovalDate.sortKey("") == nil)
        #expect(JobsApproval.isNewer("2026-03-01T10:00:00.500Z",
                                     than: "2026-03-01T10:00:00.000Z"))
        #expect(!JobsApproval.isNewer("2026-03-01T10:00:00.000Z",
                                      than: "2026-03-01T10:00:00.500Z"))
    }

    /// A panel deleted by an inbound sync between the click and the commit must
    /// not throw away the rest of the tree.
    @Test func aPathThatNoLongerResolvesChangesNothing() {
        let after = JobsApproval.signing(step: 0, panelID: "gone", in: engineeringJob,
                                         settings: settings, by: admin)
        #expect(encoded(after) == encoded(engineeringJob))
    }
}
