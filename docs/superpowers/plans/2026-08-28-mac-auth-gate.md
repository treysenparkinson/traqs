# macOS Auth Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the web app's eight-step auth gate — including the roster kiosk and its PIN time clock — to the native Mac app, faithful in behaviour and visuals, on shared backend additions that serve iOS too.

**Architecture:** A pure `GateStep` resolver in shared `Services/` decides which of eight steps to show; `MacAuthGate` renders them from one copied card language. The gate carries its own palette rather than reading `TTheme`, because it paints before a theme resolves. Three endpoints and two `login()` parameters are added to the shared layer. The brand lockup is CoreText glyph paths, filled and stroked, because SwiftUI's `Text` cannot reproduce `-webkit-text-stroke`.

**Tech Stack:** SwiftUI, macOS 26, Swift Testing in the existing `TRAQS SchedulingTests` target, CoreText, Xcode `objectVersion = 77` with `PBXFileSystemSynchronizedRootGroup`.

**Spec:** `docs/superpowers/specs/2026-08-28-mac-auth-gate-design.md`

## Global Constraints

- **Copy the web, do not design.** Every number, colour, duration and easing comes from `src/App.jsx`. A value that was not copied is a bug. This includes type: family, weight, size, letter spacing, line height.
- **The gate does NOT read `TTheme` / `@Environment(\.tqTheme)`.** It carries its own palette. `App.jsx:24` states why: "The login screen renders before a theme is resolved, so it carries its own accent." The environment value is available here and using it would still be wrong.
- **Space Grotesk's 700 face is `SpaceGrotesk-Light_Bold`**, not `SpaceGrotesk-Bold`. The file's default instance is Light, so its named instances register with that prefix. The obvious name silently returns the system face.
- **New Swift files in `TRAQS MacBook Native/` need NO pbxproj edit** (synchronized groups). Same for new files in the shared `Fonts/`, `Models/`, `Services/`.
- **Tests are Swift Testing** (`import Testing`, `@Test`, `#expect`) in `TRAQS SchedulingTests`, with `@testable import TRAQS_Scheduling`.
- **Three shared files change** (`APIService`, `AuthManager`, plus a new `Services/MacGateResolver.swift`). Every task touching them must leave the iOS build green and iOS tests passing.
- Build commands:
  - Mac: `xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" -configuration Debug build` from `TRAQS MacBook Native/`
  - iOS: `xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" -destination 'generic/platform=iOS Simulator' -configuration Debug build` from `TRAQS Scheduling/`
  - iOS tests: `xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:"TRAQS SchedulingTests"` from `TRAQS Scheduling/`

---

### Task 1: Space Grotesk ships

The lockup's font. Already downloaded to the session scratchpad (Google Fonts, OFL-1.1); this puts it in the repo and proves it registers.

**Files:**
- Create: `TRAQS Scheduling/TRAQS Scheduling/Fonts/SpaceGrotesk[wght].ttf`
- Create: `TRAQS Scheduling/TRAQS Scheduling/Fonts/SpaceGrotesk-OFL.txt`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/Theme.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `TWordmark.face` (the PostScript name) and its inclusion in `TFont.assertFacesRegistered()`. Task 5 uses the name.

- [ ] **Step 1: Put the font and its licence in the shared Fonts directory**

```bash
cd /Users/treysenparkinson/traqs
SCRATCH="$(dirname "$TMPDIR")"   # or the session scratchpad path used to download
cp "<scratchpad>/SpaceGrotesk[wght].ttf" "TRAQS Scheduling/TRAQS Scheduling/Fonts/"
cp "<scratchpad>/OFL.txt" "TRAQS Scheduling/TRAQS Scheduling/Fonts/SpaceGrotesk-OFL.txt"
ls -la "TRAQS Scheduling/TRAQS Scheduling/Fonts/"
```

The licence ships **beside the font**, renamed so it cannot be mistaken for DM Sans's. OFL-1.1 requires the licence accompany the font; this is not optional tidiness.

Both targets reference this directory as a synchronized group, so iOS bundles the file too (~137KB, unused there for now). That is deliberate: one copy of the font, so the two apps can never end up on different cuts — the same rule Task 2 of the foundation pass applied to DM Sans.

- [ ] **Step 2: Name the face, and add it to the launch assertion**

In `Theme.swift`, above `enum TFont`:

```swift
// MARK: The wordmark face
//
// Space Grotesk, which the web app's brand lockup is set in (App.jsx:50). Only
// the LOCKUP uses it — everything else is DM Sans.
//
// The PostScript name is the whole reason this is a named constant and not a
// literal at the call site. Google Fonts publishes Space Grotesk ONLY as a
// variable font, `SpaceGrotesk[wght].ttf`, whose default instance is Light. Its
// named instances therefore register as:
//
//     SpaceGrotesk-Light          (wght 300, the default)
//     SpaceGrotesk-Light_Regular
//     SpaceGrotesk-Light_Medium
//     SpaceGrotesk-Light_Bold     <- the 700 the lockup wants
//
// enumerated with CTFontManagerCopyAvailablePostScriptNames. So the obvious
// "SpaceGrotesk-Bold" does not exist, and asking for it returns the SYSTEM FACE
// in silence — the exact failure the foundation pass spent a commit fixing for
// DM Sans. Hence the assertion below covers this face too.
enum TWordmark {
    static let face = "SpaceGrotesk-Light_Bold"
}
```

Then extend the assertion's list — change

```swift
        let missing = TFontName.allCases.map(\.rawValue).filter { !available.contains($0) }
```

to

```swift
        let wanted = TFontName.allCases.map(\.rawValue) + [TWordmark.face]
        let missing = wanted.filter { !available.contains($0) }
```

- [ ] **Step 3: Build and confirm registration**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
find ~/Library/Developer/Xcode/DerivedData -path "*TRAQS MacBook Native.app/Contents/Resources/SpaceGrotesk*" 2>/dev/null
APP=$(find ~/Library/Developer/Xcode/DerivedData -maxdepth 5 -name "TRAQS MacBook Native.app" -path "*Debug*" | head -1)
"$APP/Contents/MacOS/TRAQS MacBook Native" & sleep 6
pgrep -f "TRAQS MacBook Native" >/dev/null && echo "ALIVE — face registered" || echo "DIED — assertion tripped"
pkill -f "TRAQS MacBook Native"
```

Expected: build succeeds, the `.ttf` is in Resources, and the app stays alive. If it dies, the assertion message names the missing face.

- [ ] **Step 4: iOS still builds**

```bash
cd "TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

A new resource in a shared directory changes the iOS bundle, so this is not a formality.

- [ ] **Step 5: Commit**

```bash
git add "TRAQS Scheduling/TRAQS Scheduling/Fonts/" \
        "TRAQS MacBook Native/TRAQS MacBook Native/Theme.swift"
git commit -m "feat(mac): ship Space Grotesk for the brand lockup

The web sets the lockup in Space Grotesk 700 (App.jsx:50) and neither app
had it. Google Fonts publishes only a variable file, whose 700 instance
registers as SpaceGrotesk-Light_Bold — NOT SpaceGrotesk-Bold, which does not
exist and would silently resolve to the system face. Named constant plus the
launch assertion so that cannot happen quietly.

One copy in the shared Fonts directory, so the two apps cannot drift onto
different cuts. OFL-1.1 licence ships beside it."
```

---

### Task 2: `MacGateResolver` — the four rules, TDD

The gate's decisions, extracted from the web's four `useEffect`s into pure functions. This is the only part of the pass with logic worth testing, so it goes in shared `Services/` where the iOS test target compiles it.

**Files:**
- Create: `TRAQS Scheduling/TRAQS Scheduling/Services/MacGateResolver.swift`
- Test: `TRAQS Scheduling/TRAQS SchedulingTests/MacGateResolverTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `GateStep` (enum), `MacGateResolver.launchStep(storedOrgCode:)`, `.afterConfigFetch(status:)`, `.personCheck(tapped:signedIn:)`, `.domainCheck(email:orgDomain:)`, `.membership(status:isAdminKnown:isAdmin:inRoster:rosterIsEmpty:)`. Tasks 3 and 11 call these.

- [ ] **Step 1: Write the failing tests**

Create `TRAQS Scheduling/TRAQS SchedulingTests/MacGateResolverTests.swift`:

```swift
import Testing
@testable import TRAQS_Scheduling

// The web gate's decisions (src/App.jsx AuthGate) as pure rules. Two of these
// encode fixes the web's own comments call out, and those are the tests that
// matter — the rest is bookkeeping.
@Suite("Mac auth gate step resolution")
struct MacGateResolverTests {

    // MARK: Launch

    @Test func noStoredCodeStartsAtOrgEntry() {
        #expect(MacGateResolver.launchStep(storedOrgCode: "") == .org)
        #expect(MacGateResolver.launchStep(storedOrgCode: nil) == .org)
    }

    @Test func aStoredCodeGoesStraightToTheRoster() {
        #expect(MacGateResolver.launchStep(storedOrgCode: "MATRIX") == .team)
    }

    // App.jsx: "Only clear the org code if the org truly doesn't exist (404).
    // For transient errors (network, 500), keep the code so the user isn't
    // forced to re-enter it on every blip."
    @Test func onlyA404ClearsTheStoredOrgCode() {
        #expect(MacGateResolver.afterConfigFetch(status: 404).clearsStoredCode)
        #expect(MacGateResolver.afterConfigFetch(status: 500).clearsStoredCode == false)
        #expect(MacGateResolver.afterConfigFetch(status: nil).clearsStoredCode == false)
    }

    @Test func anyConfigFailureLandsOnOrgEntry() {
        #expect(MacGateResolver.afterConfigFetch(status: 404).step == .org)
        #expect(MacGateResolver.afterConfigFetch(status: 500).step == .org)
    }

    // MARK: Who signed in

    @Test func tappingOneFaceAndSigningInAsAnotherIsWrongUser() {
        #expect(MacGateResolver.personCheck(tapped: "bob@matrix.com",
                                            signedIn: "alice@matrix.com") == .wrongUser)
    }

    @Test func caseDiffersButThePersonDoesNot() {
        #expect(MacGateResolver.personCheck(tapped: "Bob@Matrix.com",
                                            signedIn: "bob@matrix.com") == nil)
    }

    @Test func noTappedPersonMeansNothingToContradict() {
        // Admin sign-in skips the roster, so there is no selection to check.
        #expect(MacGateResolver.personCheck(tapped: nil,
                                            signedIn: "alice@matrix.com") == nil)
    }

    // MARK: Domain

    @Test func aForeignDomainIsRejected() {
        #expect(MacGateResolver.domainCheck(email: "alice@gmail.com",
                                             orgDomain: "matrix.com") == .domainError)
    }

    @Test func theOrgsOwnDomainPasses() {
        #expect(MacGateResolver.domainCheck(email: "alice@MATRIX.com",
                                             orgDomain: "matrix.com") == nil)
    }

    @Test func noConfiguredDomainCannotReject() {
        // An org with no domain set must not lock everyone out.
        #expect(MacGateResolver.domainCheck(email: "alice@matrix.com",
                                             orgDomain: nil) == nil)
    }

    // MARK: Roster membership

    @Test func theServerSaying403Or404IsNotInTeam() {
        #expect(MacGateResolver.membership(status: 403, isAdminKnown: true, isAdmin: false,
                                            inRoster: false, rosterIsEmpty: false) == .notInTeam)
        #expect(MacGateResolver.membership(status: 404, isAdminKnown: true, isAdmin: false,
                                            inRoster: false, rosterIsEmpty: false) == .notInTeam)
    }

    // App.jsx: "`isAdmin` is set by /org-config; while it's undefined we treat
    // the user as potentially-admin so the UI doesn't flicker." Without this the
    // screen flashes "not in team" in the gap between login and that fetch.
    @Test func anUnknownAdminFlagCountsAsAdminSoTheScreenCannotFlicker() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: false, isAdmin: false,
                                            inRoster: false, rosterIsEmpty: false) == nil)
    }

    @Test func anAdminOutsideTheRosterIsStillLetIn() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: true,
                                            inRoster: false, rosterIsEmpty: false) == nil)
    }

    @Test func anEmptyRosterIsNotEvidenceOfExclusion() {
        // A roster that hasn't loaded yet must not read as "you're not on it".
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: false,
                                            inRoster: false, rosterIsEmpty: true) == nil)
    }

    @Test func aNonAdminMissingFromANonEmptyRosterIsRejected() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: false,
                                            inRoster: false, rosterIsEmpty: false) == .notInTeam)
    }

    @Test func aNonAdminOnTheRosterPasses() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: false,
                                            inRoster: true, rosterIsEmpty: false) == nil)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "TRAQS Scheduling"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests" 2>&1 | grep -E "error:|TEST"
```

Expected: compile failure — `cannot find 'MacGateResolver' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Services/MacGateResolver.swift`:

```swift
import Foundation

// MARK: - The auth gate's steps
//
// One case per step in the web gate's own list (src/App.jsx:1385):
//   "org" | "create-org" | "forgot-org" | "team" | "domain-error" | "not-in-team"
// plus "login" and "wrong-user", which it sets elsewhere, and `resolved` for
// "the gate is done, show the app".
enum GateStep: Equatable {
    case org, createOrg, forgotOrg, team, login
    case domainError, notInTeam, wrongUser
    case resolved
}

// MARK: - Gate step resolution
//
// The web gate makes its decisions in four `useEffect`s. Those effects mix the
// decision with the fetching, the storage writes and the React state, which is
// why the rules are worth pulling out: each one here is a pure function of its
// inputs, so the reasons a person gets bounced are testable without a network or
// a view. See MacGateResolverTests.
//
// Caseless enum of statics with every dependency passed in — the convention this
// codebase uses for logic that needs testing (HoursCalculator, StatsMath,
// SchedulePacker). Lives in shared Services/ for the same reason: that is what
// the iOS test target compiles.
enum MacGateResolver {

    /// What to show on launch, from whatever org code storage already holds.
    static func launchStep(storedOrgCode: String?) -> GateStep {
        guard let code = storedOrgCode, !code.isEmpty else { return .org }
        return .team
    }

    /// The outcome of fetching an org's config for a stored code.
    struct ConfigFetchOutcome: Equatable {
        let step: GateStep
        /// Whether the stored org code should be forgotten.
        let clearsStoredCode: Bool
    }

    /// Every config-fetch failure lands on org entry, but only a 404 FORGETS the
    /// code. The web's reason, copied: "Only clear the org code if the org truly
    /// doesn't exist (404). For transient errors (network, 500), keep the code so
    /// the user isn't forced to re-enter it on every blip."
    ///
    /// `status: nil` is a transport failure with no HTTP status at all — the most
    /// transient case there is, so it must not clear.
    static func afterConfigFetch(status: Int?) -> ConfigFetchOutcome {
        ConfigFetchOutcome(step: .org, clearsStoredCode: status == 404)
    }

    /// You tapped a face on the roster, then signed in as somebody else. Returns
    /// nil when there is nothing to contradict — admin sign-in skips the roster,
    /// so there is no selection.
    ///
    /// Case-insensitive: Auth0 may return a differently-cased address than the
    /// roster stores.
    static func personCheck(tapped: String?, signedIn: String?) -> GateStep? {
        guard let tapped, !tapped.isEmpty else { return nil }
        guard let signedIn, !signedIn.isEmpty else { return nil }
        return tapped.lowercased() == signedIn.lowercased() ? nil : .wrongUser
    }

    /// The signed-in email's domain against the org's configured one.
    ///
    /// An org with NO configured domain cannot reject anybody — otherwise a blank
    /// setting would lock out the entire organization.
    static func domainCheck(email: String?, orgDomain: String?) -> GateStep? {
        guard let orgDomain, !orgDomain.isEmpty else { return nil }
        guard let domain = email?.split(separator: "@").last?.lowercased() else { return nil }
        return domain == orgDomain.lowercased() ? nil : .domainError
    }

    /// Roster membership. The SERVER decides: `/org-config` requires org
    /// membership, so a 403 or 404 there is the answer and the client never
    /// compares emails to reach it.
    ///
    /// Two guards on the local fallback, both load-bearing:
    ///
    ///  • `isAdminKnown == false` counts as ADMIN. `isAdmin` arrives with the
    ///    /org-config response, and in the gap between login and that response
    ///    treating it as false flashes "not in team" at every admin. The web
    ///    comment: "while it's undefined we treat the user as potentially-admin
    ///    so the UI doesn't flicker."
    ///  • An EMPTY roster proves nothing. A roster that has not loaded yet must
    ///    not read as one you are absent from.
    static func membership(status: Int?, isAdminKnown: Bool, isAdmin: Bool,
                           inRoster: Bool, rosterIsEmpty: Bool) -> GateStep? {
        if status == 403 || status == 404 { return .notInTeam }
        let treatAsAdmin = !isAdminKnown || isAdmin
        if !inRoster && !treatAsAdmin && !rosterIsEmpty { return .notInTeam }
        return nil
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2. Expected: `** TEST SUCCEEDED **`, 15 new tests passing.

- [ ] **Step 5: iOS builds**

```bash
cd "TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

- [ ] **Step 6: Commit**

```bash
git add "TRAQS Scheduling/TRAQS Scheduling/Services/MacGateResolver.swift" \
        "TRAQS Scheduling/TRAQS SchedulingTests/MacGateResolverTests.swift"
git commit -m "feat(gate): the auth gate's four rules as pure, tested logic

The web gate decides in four useEffects that mix the decision with the
fetching, the storage writes and the React state. Extracted as pure
functions so the reasons a person gets bounced are testable without a
network or a view.

Two of them encode fixes the web's own comments call out, and they are the
tests that matter: only a 404 forgets a stored org code (a 500 or a dropped
connection must not force re-entry), and an unknown isAdmin counts as admin
so the screen cannot flash 'not in team' between login and the /org-config
response. An empty roster likewise proves nothing."
```

---

### Task 3: The backend — three endpoints and two login parameters

Everything the gate needs that the shared layer does not already have.

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Services/APIService.swift`
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Services/AuthManager.swift`

**Interfaces:**
- Consumes: `Person` (Models), `OrgInfo` (APIService).
- Produces:
  - `static APIService.fetchRoster(orgCode: String) async throws -> [Person]`
  - `static APIService.createOrg(code: String, name: String, domain: String, adminEmail: String) async throws`
  - `static APIService.orgConfig(token: String, orgCode: String) async throws -> OrgConfigResponse` with `struct OrgConfigResponse: Decodable { let isAdmin: Bool?; let name: String?; let domain: String?; let connection: String? }`
  - `APIService.OrgConfigError` carrying the HTTP status, so `MacGateResolver.membership(status:)` can be fed it
  - `AuthManager.login(loginHint: String? = nil, connection: String? = nil) async`

Tasks 9, 10, 11 call these.

- [ ] **Step 1: Add the three endpoints**

In `APIService.swift`, in the `// MARK: - Org Lookup` section beside `lookupOrg`:

```swift
    /// The roster, UNAUTHENTICATED — for the kiosk, which shows faces before
    /// anybody has logged in.
    ///
    /// The backend already allows this: `netlify/functions/people.js:60` is
    /// `try { member = await requireOrgMember(event); } catch { /* unauthenticated
    /// kiosk */ }` — the GET path deliberately tolerates a missing token.
    ///
    /// Separate from the instance method `fetchPeople()`, which is authenticated
    /// and needs a configured APIService. At gate time there isn't one.
    static func fetchRoster(orgCode: String) async throws -> [Person] {
        guard let url = URL(string: "\(AppConfig.netlifyBase)/people") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.setValue(orgCode, forHTTPHeaderField: "X-Org-Code")
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
        return try JSONDecoder().decode([Person].self, from: data)
    }

    /// Provision a new organization. `POST /org`, unauthenticated — the person
    /// creating an org does not belong to one yet.
    static func createOrg(code: String, name: String,
                          domain: String, adminEmail: String) async throws {
        guard let url = URL(string: "\(AppConfig.netlifyBase)/org") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(
            ["code": code, "name": name, "domain": domain, "adminEmail": adminEmail])
        let (_, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
    }

    /// The org's FULL config, authenticated. Adds what the public `/org` does not
    /// return — chiefly the server-set `isAdmin`.
    ///
    /// The status code is the point as much as the body: `/org-config` requires
    /// org membership, so a 403 or 404 here IS the membership answer. Feed the
    /// status to `MacGateResolver.membership(status:…)` rather than comparing
    /// emails client-side — the server already knows.
    static func orgConfig(token: String, orgCode: String) async throws -> OrgConfigResponse {
        guard let url = URL(string: "\(AppConfig.netlifyBase)/org-config") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(orgCode, forHTTPHeaderField: "X-Org-Code")
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
        return try JSONDecoder().decode(OrgConfigResponse.self, from: data)
    }
```

And beside `OrgInfo` at the bottom of the file:

```swift
/// `/org-config`'s body. Distinct from `OrgInfo` (the public `/org`) because this
/// endpoint is authenticated and answers a different question: not "what is this
/// org" but "what is this org TO ME".
struct OrgConfigResponse: Decodable {
    /// Server-set. `nil` means not answered yet, which is NOT the same as false —
    /// see `MacGateResolver.membership`.
    let isAdmin: Bool?
    let name: String?
    let domain: String?
    let connection: String?
}
```

- [ ] **Step 2: Give `login` its two parameters**

In `AuthManager.swift`, change the signature and add the query items:

```swift
    /// `loginHint` pre-fills the address on Auth0's form — the roster kiosk passes
    /// the email of the face that was tapped, so the person is not asked to type
    /// what they just selected.
    ///
    /// `connection` is the org's configured Auth0 connection, which is what turns
    /// a generic prompt into "Sign in with Microsoft". Both default to nil, so
    /// existing zero-argument callers are unaffected.
    func login(loginHint: String? = nil, connection: String? = nil) async {
```

and, after the existing `queryItems` array is built:

```swift
        if let loginHint, !loginHint.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "login_hint", value: loginHint))
        }
        if let connection, !connection.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "connection", value: connection))
        }
```

Placed after the array rather than inside it because both are conditional, and an
`URLQueryItem` with a nil value still emits a bare `?login_hint` that Auth0
rejects.

- [ ] **Step 3: Both targets build, iOS tests pass**

```bash
cd "TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build 2>&1 | grep -E "error:|BUILD"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests" 2>&1 | grep -E "\*\* TEST|error:"
cd "../TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: two `BUILD SUCCEEDED` and `TEST SUCCEEDED`. `login()`'s existing call
sites must still compile untouched — that is what the defaults are for.

- [ ] **Step 4: Commit**

```bash
git add "TRAQS Scheduling/TRAQS Scheduling/Services/APIService.swift" \
        "TRAQS Scheduling/TRAQS Scheduling/Services/AuthManager.swift"
git commit -m "feat(api): the three endpoints and two login params the gate needs

fetchRoster is the UNAUTHENTICATED people fetch the kiosk shows faces from
before anyone logs in; people.js:60 already tolerates a missing token on
that path. createOrg was the only gate endpoint with no Swift equivalent.
orgConfig returns the authenticated config, and its STATUS is half the
answer — /org-config requires membership, so a 403/404 is the membership
verdict and the client never compares emails itself.

AuthManager.login gains login_hint (the roster passes the tapped face's
email) and connection (the org's Auth0 connection, which is what makes it
'Sign in with Microsoft'). Both default to nil, so iOS is unaffected — and
iOS could not pass the org's connection before either."
```

---

### Task 4: `GateCard` — the gate's own palette and card

Written before any step, because all seven card steps are built from it and a second hand-rolled copy is how they drift.

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GateCard.swift`

**Interfaces:**
- Consumes: `TFont` (Theme.swift).
- Produces: `GatePalette` (the colours), `GateMetrics` (the measurements), `GatePage<Content>`, `GateCard<Content>`, `GateCardHeader<Content>`, `GateFooter`, `GateInput`, `GatePrimaryButton`, `GateSpinner`. Tasks 5–10 use these.

- [ ] **Step 1: Create it**

Every value copied from `src/App.jsx` — palette at `:78–86`, `PAGE` at `:88`, `CARD` at `:100`, `CARD_HEADER` at `:110`, `CARD_BODY` at `:117`, `CARD_FOOTER` at `:119`, `INPUT_STYLE` at `:127`, `PAPER_FOOT` at `:318`.

```swift
import SwiftUI

// MARK: - The gate's own look
//
// THE GATE DOES NOT READ `TTheme`. It carries its own palette, and that is
// copied from the web along with everything else. App.jsx:24 states the reason:
//
//   > The login screen renders before a theme is resolved, so it carries its own
//   > accent. Matches the sky the light ("frost") theme now uses, and the sky
//   > baked into the bars asset, so login and app agree.
//
// `@Environment(\.tqTheme)` IS reachable in these views. Using it would still be
// wrong: the gate runs before an org, a user, or a preference exists.

enum GatePalette {
    /// `LOGIN_BLUE` (:27). The gate's accent, matching the frost theme's sky and
    /// the sky baked into the bars asset.
    static let blue    = Color.hex("#38BDF8")
    /// `PAPER` (:82) — "warm off-white ground… Deliberately not #fff/#0f172a —
    /// the design's warmth is what separates it from a generic auth screen."
    static let paper   = Color.hex("#EDEAE3")
    static let cardBg  = Color.hex("#FBFAF7")   // CARD_BG (:83)
    static let ink     = Color.hex("#0B0B0C")   // INK (:84)
    static let stone   = Color.hex("#8A867E")   // STONE (:85)
    static let hairline = Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.08)  // HAIRLINE (:86)

    // Card chrome, which is cooler than the paper ground on purpose.
    static let cardFill   = Color.white                 // CARD.background
    static let cardBorder = Color.hex("#e2e8f0")        // CARD.border
    static let footText   = Color.hex("#64748b")        // CARD_FOOTER.color
    static let footRule   = Color(red: 15/255, green: 23/255, blue: 42/255, opacity: 0.06)
    static let strapline  = Color.hex("#B4B0A7")        // PAPER_FOOT.color
    /// CARD_HEADER's band — `linear-gradient(135deg, #4169e1, #06b6d4)`.
    static let headerBand = LinearGradient(colors: [.hex("#4169e1"), .hex("#06b6d4")],
                                          startPoint: .topLeading, endPoint: .bottomTrailing)
}

enum GateMetrics {
    static let pageVPad: CGFloat = 48        // PAGE.padding "48px 20px"
    static let pageHPad: CGFloat = 20
    static let cardMaxWidth: CGFloat = 420   // CARD.maxWidth
    static let cardRadius: CGFloat = 20      // CARD.borderRadius
    /// CARD.boxShadow — `0 24px 60px rgba(15,23,42,0.10)`. A CSS blur radius is
    /// twice SwiftUI's, so 60 becomes 30.
    static let cardShadowRadius: CGFloat = 30
    static let cardShadowY: CGFloat = 24
    static let cardShadowOpacity: Double = 0.10
    // CARD_HEADER "32px 28px 24px", CARD_BODY "28px 28px 24px",
    // CARD_FOOTER "12px 24px 18px"
    static let headerPad = EdgeInsets(top: 32, leading: 28, bottom: 24, trailing: 28)
    static let bodyPad   = EdgeInsets(top: 28, leading: 28, bottom: 24, trailing: 28)
    static let footerPad = EdgeInsets(top: 12, leading: 24, bottom: 18, trailing: 24)
    static let straplineTopMargin: CGFloat = 16   // PAPER_FOOT.marginTop
}

/// The full-window ground every step sits on. `PAGE` (:88).
struct GatePage<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        ZStack {
            GatePalette.paper.ignoresSafeArea()
            content()
                .padding(.vertical, GateMetrics.pageVPad)
                .padding(.horizontal, GateMetrics.pageHPad)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The white card. `CARD` (:100).
struct GateCard<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        content()
            .frame(maxWidth: GateMetrics.cardMaxWidth)
            .background(GatePalette.cardFill)
            .clipShape(RoundedRectangle(cornerRadius: GateMetrics.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: GateMetrics.cardRadius, style: .continuous)
                .stroke(GatePalette.cardBorder, lineWidth: 1))
            .shadow(color: .black.opacity(GateMetrics.cardShadowOpacity),
                    radius: GateMetrics.cardShadowRadius, y: GateMetrics.cardShadowY)
    }
}

/// The gradient band at the top of a card. `CARD_HEADER` (:110).
struct GateCardHeader<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        content()
            .frame(maxWidth: .infinity)
            .padding(GateMetrics.headerPad)
            .background(GatePalette.headerBand)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.white.opacity(0.1)).frame(height: 1)
            }
    }
}

/// `CARD_FOOTER` (:119) — 11pt, centred, hairline above.
struct GateFooter: View {
    let text: String
    var body: some View {
        Text(text)
            .font(TFont.body(11))
            .foregroundStyle(GatePalette.footText)
            .frame(maxWidth: .infinity)
            .padding(GateMetrics.footerPad)
            .overlay(alignment: .top) {
                Rectangle().fill(GatePalette.footRule).frame(height: 1)
            }
    }
}

/// The mono strapline under the card. `PAPER_FOOT` (:318).
///
/// SF Mono is the FAITHFUL choice, not a compromise: PAPER_FOOT asks for
/// 'JetBrains Mono', index.html never loads it, so the web already falls back to
/// `ui-monospace` — which on macOS is SF Mono.
struct GateStrapline: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 10, design: .monospaced))
            .tracking(10 * 0.08)              // letterSpacing ".08em"
            .foregroundStyle(GatePalette.strapline)
            .padding(.top, GateMetrics.straplineTopMargin)
    }
}
```

`GateInput`, `GatePrimaryButton` and `GateSpinner` come from `INPUT_STYLE` (:127), `BtnPrimary` (:405) and `Spinner` (:391) — transcribe those three the same way, copying their padding, radius, colours and the spinner's size.

- [ ] **Step 2: Build**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Nothing renders these yet, so this only proves they compile. `Color.hex` already exists in `Theme.swift`.

- [ ] **Step 3: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/GateCard.swift"
git commit -m "feat(gate): the gate's palette and card language, copied

Every value out of src/App.jsx — paper ground, card, gradient header band,
footer, strapline. One implementation because seven steps are built from it.

The gate carries its OWN palette and does not read TTheme, which is copied
reasoning rather than an oversight: App.jsx:24 notes the login screen renders
before a theme is resolved. tqTheme is reachable in these views and using it
would still be wrong.

The strapline uses SF Mono deliberately: PAPER_FOOT asks for JetBrains Mono,
index.html never loads it, so the web is already falling back to
ui-monospace and SF Mono is the faithful match."
```

---

### Task 5: `GateLockup` — the stroked wordmark

`TraqsLockup` (`App.jsx:43`). Prototyped before the spec was written, so the technique is known to work.

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GateLockup.swift`

**Interfaces:**
- Consumes: `TWordmark.face` (Task 1), `GatePalette`.
- Produces: `GateLockup(size:color:stroke:bars:)`. Tasks 6–10 use it.

- [ ] **Step 1: Create it**

```swift
import SwiftUI
import CoreText

// MARK: - The brand lockup
//
// `TraqsLockup` (App.jsx:43): "traqs" in Space Grotesk 700 at -.05em, thickened
// with `-webkit-text-stroke: 1.5px` in the SAME colour as the fill, then the bars
// mark at .52em with its bottom on the text baseline.
//
// The wordmark is a PATH, not a `Text`, and that is forced rather than chosen:
// SwiftUI's Text cannot stroke. `-webkit-text-stroke` is not an outline — it is a
// stroke centred on the glyph outline, in the fill colour, so it THICKENS the
// letterforms by half its width on each side. Reproducing it means having the
// outlines, so the glyphs come from CoreText and get filled and then stroked.
//
// Same Canvas + Path approach `WebGlyph` uses for the sidebar icons, so there is
// one way of drawing vector art in this app rather than two.
struct GateLockup: View {
    var size: CGFloat = 84            // TraqsLockup's default
    var color: Color = GatePalette.ink
    /// `stroke = 1.5` — a fixed px value on the web, NOT em-relative, so it does
    /// not scale with `size`. Copied as-is.
    var stroke: CGFloat = 1.5
    var bars: Bool = true

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 0) {
            wordmark
            if bars {
                TRAQSBarsMark(color: color)
                    .frame(height: size * 0.52)     // ".52em", the x-height
                    .padding(.leading, size * 0.07) // "margin-left: .07em"
                    .offset(y: size * 0.01)         // "translateY(.01em)"
            }
        }
    }

    private var wordmark: some View {
        let (path, sz) = Self.glyphPath("traqs", size: size, tracking: size * -0.05)
        return Canvas { ctx, _ in
            ctx.fill(path, with: .color(color))
            // The thickening. Same colour as the fill — this is weight, not an
            // outline.
            ctx.stroke(path, with: .color(color), lineWidth: stroke)
        }
        .frame(width: sz.width + stroke, height: sz.height + stroke)
    }

    /// "traqs" as outlines, positioned by CoreText, flipped into SwiftUI's
    /// y-down space and moved to the origin.
    ///
    /// `tracking` goes in as `.kern` so CoreText applies it while laying the run
    /// out — applying it afterwards would move the glyphs without changing the
    /// advances.
    static func glyphPath(_ s: String, size: CGFloat,
                          tracking: CGFloat) -> (Path, CGSize) {
        let font = CTFontCreateWithName(TWordmark.face as CFString, size, nil)
        let attr = NSAttributedString(string: s, attributes: [
            .font: font,
            .kern: tracking,
        ])
        let line = CTLineCreateWithAttributedString(attr)
        let combined = CGMutablePath()
        for run in (CTLineGetGlyphRuns(line) as? [CTRun] ?? []) {
            let n = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: n)
            var pos = [CGPoint](repeating: .zero, count: n)
            CTRunGetGlyphs(run, CFRangeMake(0, n), &glyphs)
            CTRunGetPositions(run, CFRangeMake(0, n), &pos)
            guard let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName]
                    as! CTFont? else { continue }
            for i in 0..<n {
                guard let g = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) else { continue }
                combined.addPath(g, transform: CGAffineTransform(translationX: pos[i].x,
                                                                 y: pos[i].y))
            }
        }
        let b = combined.boundingBox
        let flip = CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: -b.minX, y: -b.maxY)
        return (Path(combined).applying(flip), CGSize(width: b.width, height: b.height))
    }
}
```

`TRAQSBarsMark` — the bars beside the wordmark. The web uses an image asset
(`TRAQS_BARS`); the iOS app already draws this natively. Port the iOS
`TRAQSBarsMark` shape rather than embedding a PNG, so it stays sharp at any size
and takes the lockup's colour. If the iOS one is not directly liftable, draw it
from the same geometry — it is three bars, and the asset is the reference.

- [ ] **Step 2: Build and eyeball it against the deployed gate**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

The lockup is not on screen until Task 7, so verification here is the build plus
a `#Preview` if you want it sooner. **Do not skip the weight check later** — the
whole point of the stroke is a specific heaviness, and it is only judgeable beside
the original.

- [ ] **Step 3: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/GateLockup.swift"
git commit -m "feat(gate): the brand lockup, filled and stroked

TraqsLockup (App.jsx:43) is Space Grotesk 700 at -.05em thickened with
-webkit-text-stroke: 1.5px in the fill colour. That is weight, not an
outline — a stroke centred on the glyph outline — and SwiftUI's Text cannot
stroke at all, so the wordmark is CoreText glyph outlines filled and then
stroked in a Canvas. Same approach WebGlyph already uses for the icons.

Tracking goes in as .kern so CoreText applies it during layout; applied
afterwards it would move glyphs without changing advances."
```

---

### Task 6: `GateLoadUp` — the timeline

`LOADUP_CSS` and the timing constants (`App.jsx:271–330`). A staged sequence, not a fade, and the logo's travel distance is measured rather than fixed.

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GateLoadUp.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `GateLoadUp.Timing` (the ms constants), `.logoIn(rise:)` modifier, `.gateFadeUp(delayMS:)` modifier. Tasks 7–10 apply them.

- [ ] **Step 1: Create it**

```swift
import SwiftUI

// MARK: - The load-up
//
// A staged timeline, copied from LOADUP_CSS and the constants under it
// (App.jsx:271–330). Not one fade: the logo arrives at CENTRE, holds, then
// travels up to its resting place, and the copy, card and strapline fade in one
// at a time behind it "so the eye is led down the page".
enum GateLoadUp {

    enum Timing {
        /// LOGO_MS. "~960ms fading in at centre (40%), a brief hold, then the
        /// travel up."
        static let logoMS: Double = 2400
        /// COPY_MS — greeting and instructions share this slow fade.
        static let copyMS: Double = 760
        static let titleAtMS: Double = 2150    // "starts just before the logo lands"
        static let blurbAtMS: Double = 2300    // TITLE_AT + 150
        static let cardAtMS:  Double = 2630    // BLURB_AT + 330
        static let footAtMS:  Double = 3250    // CARD_AT + 620
        /// FADE's default duration.
        static let fadeMS: Double = 520
        /// tqFadeUp's travel.
        static let fadeUpDistance: CGFloat = 7
    }

    /// FADE's curve — `cubic-bezier(.22,1,.36,1)`.
    static let fadeCurve = Animation.timingCurve(0.22, 1, 0.36, 1,
                                                 duration: Timing.fadeMS / 1000)
    /// tqLogoIn's first phase, the fade at centre — `cubic-bezier(.33,0,.2,1)`.
    static let logoFadeCurve = UnitCurve.bezier(startControlPoint: .init(x: 0.33, y: 0),
                                                endControlPoint: .init(x: 0.2, y: 1))
    /// tqLogoIn's travel — `cubic-bezier(.83,0,.17,1)`, i.e. easeInOutQuint:
    /// slow, fast, slow. Separate from the fade's curve ON PURPOSE. The web's
    /// note: a single curve across both phases "would have made the fade drift
    /// upward".
    static let logoTravelCurve = UnitCurve.bezier(startControlPoint: .init(x: 0.83, y: 0),
                                                  endControlPoint: .init(x: 0.17, y: 1))
}

/// The logo's arrival: fade in at centre to 40%, hold to 46%, then rise.
///
/// `rise` is how far BELOW its resting place the lockup starts, and it is
/// MEASURED by the caller, never a constant. The web's reason: "Any fixed vh/px
/// start lands wherever the content height happens to put it… a percentage that
/// centres the logo on a laptop drops it well below centre on a tall monitor."
/// So the caller reads the lockup's resting position with a GeometryReader and
/// hands in the exact offset to window centre.
struct GateLogoIn: ViewModifier {
    let rise: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var run = false

    func body(content: Content) -> some View {
        if reduceMotion {
            // The @media (prefers-reduced-motion: reduce) block: no animation,
            // full opacity, no transform.
            content
        } else {
            content
                .keyframeAnimator(initialValue: LogoPhase(), trigger: run) { view, p in
                    view.opacity(p.opacity)
                        .scaleEffect(p.scale)
                        .offset(y: p.y)
                } keyframes: { _ in
                    // Percentages of LOGO_MS, as the keyframes state them:
                    // 0% → 40% fade+scale at the risen position, 40→46% hold,
                    // 46% → 100% travel to 0.
                    let total = GateLoadUp.Timing.logoMS / 1000
                    KeyframeTrack(\.opacity) {
                        CubicKeyframe(1, duration: total * 0.40)
                        LinearKeyframe(1, duration: total * 0.60)
                    }
                    KeyframeTrack(\.scale) {
                        CubicKeyframe(1, duration: total * 0.40)
                        LinearKeyframe(1, duration: total * 0.60)
                    }
                    KeyframeTrack(\.y) {
                        LinearKeyframe(rise, duration: total * 0.46)
                        CubicKeyframe(0, duration: total * 0.54)
                    }
                }
                .onAppear { run = true }
        }
    }

    struct LogoPhase {
        var opacity: Double = 0
        var scale: CGFloat = 0.97
        var y: CGFloat = 0
    }
}

/// `tqFadeUp` with a delay — the greeting, blurb, card and strapline.
struct GateFadeUp: ViewModifier {
    let delayMS: Double
    var durationMS: Double = GateLoadUp.Timing.fadeMS
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : GateLoadUp.Timing.fadeUpDistance)
                .onAppear {
                    withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: durationMS / 1000)
                        .delay(delayMS / 1000)) { shown = true }
                }
        }
    }
}

extension View {
    func gateLogoIn(rise: CGFloat) -> some View { modifier(GateLogoIn(rise: rise)) }
    func gateFadeUp(delayMS: Double,
                    durationMS: Double = GateLoadUp.Timing.fadeMS) -> some View {
        modifier(GateFadeUp(delayMS: delayMS, durationMS: durationMS))
    }
}
```

If `UnitCurve.bezier` is unavailable for the keyframe curves, use `CubicKeyframe`'s
`startVelocity`/`endVelocity` or fall back to `SpringKeyframe` — but keep the two
phases SEPARATE either way, since that separation is the point.

- [ ] **Step 2: Build**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

- [ ] **Step 3: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/GateLoadUp.swift"
git commit -m "feat(gate): the load-up timeline

Copied from LOADUP_CSS and its constants (App.jsx:271-330). Staged, not a
single fade: the logo arrives at centre, holds, then travels up on a SECOND
curve — the web notes that one curve across both phases made the fade drift
upward — and the copy, card and strapline follow one at a time.

The rise distance is a parameter, never a constant, because the web measures
it: a fixed vh that centres the logo on a laptop drops it below centre on a
tall monitor. prefers-reduced-motion maps to accessibilityReduceMotion."
```

---

### Task 7: `org`, `forgot-org`, `create-org`

The three steps that come before anyone has an org. `OrgCodeStep` (`App.jsx:421`), `ForgotOrgStep` (`:503`), `CreateOrgStep` (`:570`).

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GateOrgSteps.swift`

**Interfaces:**
- Consumes: `GateCard`/`GatePage`/`GateFooter`/`GateInput`/`GatePrimaryButton`/`GateSpinner` (Task 4), `GateLockup` (5), `gateFadeUp`/`gateLogoIn` (6), `APIService.lookupOrg` / `.forgotOrgCode` / `.createOrg` (3).
- Produces: `GateOrgCodeStep(onResolved:onCreate:onForgot:)`, `GateForgotOrgStep(onBack:)`, `GateCreateOrgStep(onSuccess:onBack:)`. Task 11 hosts them.

- [ ] **Step 1: Transcribe the three steps**

Each is a `GatePage` → lockup + copy → `GateCard` → fields → `GatePrimaryButton` → `GateFooter`, with the load-up modifiers applied at the timeline's stages (lockup `gateLogoIn`, greeting `gateFadeUp(delayMS: titleAtMS)`, blurb `blurbAtMS`, card `cardAtMS`, strapline `footAtMS`).

Behaviour, copied from each function:

| step | on submit | errors |
|---|---|---|
| `org` | `APIService.lookupOrg(code:)` → on success hand `(code, OrgInfo)` to `onResolved`; store the code | a 404 is "that org code doesn't exist"; other failures are a generic retry message |
| `forgot-org` | `APIService.forgotOrgCode(email:)` → show the "sent" state rather than navigating away | invalid address; send failure |
| `create-org` | `APIService.createOrg(code:name:domain:adminEmail:)` → `onSuccess` | duplicate code; missing fields |

Copy the exact copy strings, field labels, placeholders and button labels from the
source — they are part of the design, not filler. `OrgCodeStep` upper-cases as you
type; `CreateOrgStep` has four fields (`code`, `name`, `domain`, `adminEmail`) held
in one struct, matching its `form` state.

- [ ] **Step 2: Build**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

- [ ] **Step 3: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/GateOrgSteps.swift"
git commit -m "feat(gate): org code, forgot code, create org

The three steps before an org exists — OrgCodeStep, ForgotOrgStep and
CreateOrgStep (App.jsx:421/503/570), copy and all. A 404 on lookup is 'that
code doesn't exist'; anything else is a retry, matching the resolver's rule
that only a 404 is conclusive."
```

---

### Task 8: `login` and the three rejections

`LoginStep` (`App.jsx:652`), `DomainError` (`:690`), `NotInTeamError` (`:1326`), `WrongUserError` (`:1354`).

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GateLoginStep.swift`

**Interfaces:**
- Consumes: Task 4/5/6 views, `AuthManager.login(loginHint:connection:)` (3).
- Produces: `GateLoginStep(orgCode:orgConfig:onSwitch:)`, `GateDomainError(userEmail:orgDomain:onLogout:)`, `GateNotInTeamError(userEmail:onLogout:)`, `GateWrongUserError(loggedInEmail:selectedName:selectedEmail:onLogout:)`.

- [ ] **Step 1: Transcribe them**

`LoginStep` is the banded card: header band with the lockup, "Sign in to access
your schedule" (`:669`), a "Sign in with Microsoft" button calling
`auth.login(connection: orgConfig.connection)`, and the footer `"Org code: \(code) · Secured by Auth0"` (`:683`).

The three rejections are the same card with an explanatory body and a single
"Sign out" action. Each names the specific mismatch — `DomainError` shows the
user's email *and* the org's domain, `WrongUserError` shows who you signed in as
*and* who you picked. Copy those strings; a generic "access denied" is not the
same screen.

- [ ] **Step 2: Build, then commit**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
git add "TRAQS MacBook Native/TRAQS MacBook Native/GateLoginStep.swift"
git commit -m "feat(gate): login and the three rejection screens

LoginStep plus DomainError, NotInTeamError and WrongUserError
(App.jsx:652/690/1326/1354). Each rejection names the specific mismatch —
the email and the org's domain, or who you signed in as versus who you
tapped — because a generic 'access denied' does not tell someone what to do
next. Sign-in passes the org's Auth0 connection, which is what makes the
button say Microsoft."
```

---

### Task 9: `team` — the roster

`TeamSelectStep`'s `login` view (`App.jsx:864`, the roster half).

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GateTeamStep.swift`

**Interfaces:**
- Consumes: `APIService.fetchRoster(orgCode:)` (3), `AuthManager.login(loginHint:connection:)` (3), Task 4/5/6 views.
- Produces: `GateTeamStep(orgCode:orgConfig:onPersonTapped:onAdminLogin:onSwitch:)`, and `GateTeamStep.View` enum (`login` / `clock`) with the bottom-right toggle. Task 10 fills the `clock` view.

- [ ] **Step 1: The roster**

A grid of faces from `fetchRoster(orgCode:)`, each with a status pill (Online /
Lunch / Break / Offline) derived the same way the web derives it. Tapping one calls
`onPersonTapped(person)`, which the host turns into
`auth.login(loginHint: person.email, connection: orgConfig?.connection)` **and**
remembers the tapped person so `MacGateResolver.personCheck` can catch a mismatch.

Plus: an admin sign-in that skips the hint, a "switch org" action, and the
bottom-right toggle to the clock view.

- [ ] **Step 2: The 5s poll**

While `team` is showing and nobody is authenticated, refresh the roster every 5s so
the pills reflect other people's devices. Copied from `:945`-ish. Stop it on
disappear and when authentication completes — a timer left running behind the app
is a background network call nobody asked for.

- [ ] **Step 3: Build, then commit**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
git add "TRAQS MacBook Native/TRAQS MacBook Native/GateTeamStep.swift"
git commit -m "feat(gate): the roster, and its 5s poll

TeamSelectStep's login view. Tapping a face signs in AS that person via
login_hint, and the tap is remembered so a mismatch lands on wrong-user
rather than silently signing someone in as a colleague.

The poll refreshes status pills while the roster is on screen and nobody is
authenticated — it is a shared-device screen, so the pills are about other
people's devices. Stopped on disappear and on login, so it cannot run on
behind the app."
```

---

### Task 10: the PIN clock kiosk

`TeamSelectStep`'s `clock` view and `PinKeypad` (`App.jsx:787`).

**Files:**
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/GateTeamStep.swift`
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GatePinPad.swift`

**Interfaces:**
- Consumes: `APIService.timeclockIdentify(pin:)`, `.timeclockClockIn`, `.timeclockClockOut`, `.timeclockEvent(action:personId:pin:)`.
- Produces: `GatePinPad(value:error:loading:onPress:onBack:onClear:onSubmit:onClose:)`.

- [ ] **Step 1: The keypad**

Digits 1–9, 0, delete, clear, confirm — `PIN_MAX` capped. One shape primitive
throughout. Copy its layout and sizes from `PinKeypad`.

- [ ] **Step 2: The flow**

Two calls, in order, exactly as the web does it:

1. `timeclockIdentify(pin:)` → resolves the PIN to a person. A wrong PIN comes back
   an error and the pad stays open for a retry.
2. Then the chosen action: `clockIn`, `clockOut`, `lunchStart`, `lunchEnd`,
   `breakStart`, `breakEnd`.

**Clock Out offers a choice** — "going to lunch" (`lunchStart`) or "end of day"
(`clockOut`) — so the success message must follow what was PERFORMED, not what was
requested. The web keeps a separate `completedAction` for exactly this; keep the
same distinction rather than reusing the requested mode.

Refresh the roster after any successful action so the pills update immediately.

- [ ] **Step 3: Build, then commit**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
git add "TRAQS MacBook Native/TRAQS MacBook Native/GatePinPad.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/GateTeamStep.swift"
git commit -m "feat(gate): the PIN clock kiosk

TeamSelectStep's clock view. identify(pin:) resolves the PIN to a person
first, then the action goes out; a wrong PIN keeps the pad open for a retry.

Clock Out offers 'going to lunch' or 'end of day', so the success message
follows what was PERFORMED rather than what was requested — the web keeps a
separate completedAction for this and so does this."
```

---

### Task 11: Wire the gate in, and retire the scaffolding

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/MacAuthGate.swift`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/AccountCommands.swift`

**Interfaces:**
- Consumes: everything above.
- Produces: `MacAuthGate()` — owns `GateStep`, the `orgConfig`, the roster cache and the tapped person; drives the four `MacGateResolver` rules.

- [ ] **Step 1: `MacAuthGate`**

Holds the step and runs the four rules at the moments the web runs them: on launch,
after Auth0 returns (person + domain), and after the authenticated `orgConfig`
call. On `.resolved` it calls `appState.configure(auth:orgCode:)` + `loadAll()` and
hands off.

Persist per the spec: config and roster to UserDefaults, org code to the Keychain
(`AppState.orgCode` already), tapped person in memory only.

- [ ] **Step 2: `RootView` shows the gate first**

```swift
        Group {
            if gateStep == .resolved {
                ParityView(mode: $mode) { webView }
            } else {
                MacAuthGate()
            }
        }
```

- [ ] **Step 3: Retire `Sign In…` and `Set Org Code…`**

Delete both from `AccountCommands`, and delete `OrgCodeWindow` / `OrgCodeSheet`
with them. **Keep `Sign Out`** — a Mac app should have it in the menu bar, and it
now returns to the gate.

This was always scaffolding: PASS 0's spec called it "a way to establish a
session", and two ways to sign in is one too many.

- [ ] **Step 4: Build both targets, run iOS tests**

```bash
cd "TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
cd "../TRAQS Scheduling"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests" 2>&1 | grep -E "\*\* TEST|error:"
```

- [ ] **Step 5: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/MacAuthGate.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/AccountCommands.swift"
git commit -m "feat(gate): the gate owns sign-in, and the scaffolding goes

MacAuthGate hosts the eight steps and runs MacGateResolver's four rules at
the moments the web runs them. On resolved it configures AppState and hands
off to ParityView.

Account ▸ Sign In… and Set Org Code… are removed along with their window.
They were scaffolding — PASS 0's spec called them 'a way to establish a
session' — and two ways to sign in is one too many. Sign Out stays, and now
returns to the gate rather than an empty shell."
```

---

### Task 12: Whole-pass verification

- [ ] **Step 1: Both targets green, tests pass**

```bash
cd "TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build 2>&1 | grep -E "error:|BUILD"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests" 2>&1 | grep -E "\*\* TEST|error:"
cd "../TRAQS MacBook Native"
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug clean build 2>&1 | grep -E "error:|warning:|BUILD" | grep -v appintents
```

Expected: no NEW warnings. Pre-existing ones live in `WebViewHost.swift` and
`AuthManager.swift:282`.

- [ ] **Step 2: No scaffolding left**

```bash
cd "TRAQS MacBook Native"
grep -rn "OrgCodeWindow\|OrgCodeSheet\|Set Org Code\|Sign In…" "TRAQS MacBook Native/" || echo "(clean)"
```

Expected: no output.

- [ ] **Step 3: Walk the spec's verification list**

Open `docs/superpowers/specs/2026-08-28-mac-auth-gate-design.md` and confirm all
seven items, including the ones only a person can do: the load-up plays, a real
org code reaches the roster, tapping a face reaches Auth0 pre-filled, the kiosk
clocks in against a real PIN and the pills change, Split mode shows the same card
and lockup weight as the deployed gate, and Sign Out returns to the gate.

- [ ] **Step 4: Commit anything Step 2 turned up**

```bash
git add -A "TRAQS MacBook Native"
git commit -m "chore(gate): clear the last of the sign-in scaffolding"
```

---

## Plan Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §1 Where it lives | 11 |
| §2 State machine (`MacGateResolver`) | 2 |
| §3 Backend — four additions | 3 |
| §4 The card steps | 4, 7, 8 |
| §5 The team kiosk | 9, 10 |
| §6 The load-up | 6 |
| §7 The lockup (font, name, stroke) | 1, 5 |
| §8 Persistence | 11 |
| Verification 1–7 | 12 |

No gaps.

**Type consistency:** `GateStep` and `MacGateResolver`'s five statics are defined in
Task 2 and consumed in 11. `OrgConfigResponse` is defined in Task 3 and consumed in
9 and 11. `TWordmark.face` is defined in Task 1 and consumed in 5. `GatePalette` /
`GateMetrics` / the card views are defined in Task 4 and consumed in 5, 7, 8, 9, 10.
`GateLockup` from 5 is consumed in 7, 8, 9. The load-up modifiers from 6 are
consumed in 7, 8, 9.

**Where TDD applies, and where it does not:** Tasks 2 is a full failing-test-first
cycle, and it is where the pass's actual logic lives — deliberately extracted from
the web's effects into shared `Services/` precisely so the iOS test target can
reach it. Task 3 is network plumbing with no branch worth asserting; Tasks 1 and
4–11 are resources and views. Those verify by build, by the launch assertion, and
by Split-mode comparison against the deployed gate — which is what the foundation
pass built the harness for. Stated rather than implied, because a plan that claimed
TDD throughout would be lying about seven of its twelve tasks.
