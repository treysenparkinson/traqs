# macOS: the auth gate

Date: 2026-08-28
Scope: `TRAQS MacBook Native/`, plus additive changes to the SHARED
`TRAQS Scheduling/TRAQS Scheduling/Services/` and `Fonts/`. No web changes.

Second pass of the native Mac build. Follows
`2026-08-28-mac-native-foundation-design.md`, which deferred the gate once planning
established its real size.

## Problem

The Mac app has no way to sign in. PASS 0 gave it an `Account ▸ Sign In…` menu
command, explicitly as scaffolding: enough to reach a screen, none of the gate's
actual work. Everything the real gate does is still missing.

`src/App.jsx` — 1709 lines — is that gate, and it is not a login button. It is
**eight steps**:

| step | what it is |
|---|---|
| `org` | org-code entry, with routes to create and recover |
| `create-org` | provisions a new organization |
| `forgot-org` | emails the code to a known address |
| `team` | the roster kiosk — see below |
| `login` | "Sign in with Microsoft", via the org's Auth0 connection |
| `domain-error` | your email's domain is not the org's |
| `not-in-team` | the server says you are not in this roster |
| `wrong-user` | you tapped one face and signed in as someone else |

`team` (460 lines) is two features in one component: a roster where you tap your
face to sign in as that person, and a **full unauthenticated clock-in/out kiosk**
with a PIN keypad, polling every 5s so status pills stay live. It is a
shared-shop-floor screen.

Three things block a port beyond the views themselves:

1. **`AuthManager.login()` takes no parameters.** No `login_hint` (the roster
   needs it — tapping a face pre-fills that email) and no `connection` (every
   step needs the org's, which is what makes it "Sign in with Microsoft" rather
   than a generic Auth0 prompt).
2. **Three endpoints have no Swift equivalent** — see §3.
3. **The lockup needs a font neither app ships.** It is live Space Grotesk 700
   text thickened with `-webkit-text-stroke`, and SwiftUI's `Text` cannot stroke.

## Goals

1. All eight steps, faithful in behaviour and in visuals.
2. The kiosk works: roster sign-in and PIN clock actions, both.
3. The four step-resolution rules are pure, testable logic rather than effects
   tangled into a view.
4. The additions to `Services/` serve iOS too — it cannot pass the org's
   connection either.
5. The gate retires PASS 0's scaffolding rather than sitting beside it.

## Non-goals

- **Any screen.** `NativeShell.page` still renders its placeholder. Jobs is the
  next pass.
- **A theme picker.** Still the loose end PASS 0 named.
- **Kiosk parity beyond the gate.** The clock kiosk exists only inside `team`, as
  on the web. It is not a second time-clock UI for the signed-in app.

## Design

### 1. Where it lives

`RootView` resolves a step before anything else renders:

```
GateStep.resolved  →  ParityView (Native / Split / Web)
anything else      →  MacAuthGate
```

`MacAuthGate` owns the eight steps. `ParityView` and `NativeShell` are untouched.

**This retires PASS 0's Account scaffolding.** `Account ▸ Sign In…` and
`Set Org Code…` are removed — the gate owns both, and two ways to sign in is one
too many. `Sign Out` stays: a Mac app should have it in the menu bar, and it
routes back into the gate.

### 2. The state machine — `MacGateResolver`

Pure logic, in shared `Services/`, as a caseless `enum` of `static` functions with
every input passed in. Same convention as `HoursCalculator` and `StatsMath`, and
the same reason: the iOS test target compiles `Services/`, so this is the part
that can actually be tested.

```swift
enum GateStep: Equatable {
    case org, createOrg, forgotOrg, team, login
    case domainError, notInTeam, wrongUser
    case resolved
}
```

Four checks, in the web's order. Three need no round-trip:

1. **Launch** — an org code in the Keychain resolves to `team`; nothing resolves
   to `org`. A **404** on the config fetch clears the stored code; any other
   failure KEEPS it. That asymmetry is deliberate on the web and copied: a
   network blip must not force re-entry, only a genuinely dead org should.
2. **Selected-person mismatch** — the tapped person's email ≠ the signed-in
   email → `wrongUser`.
3. **Domain** — signed-in email's domain ≠ `orgConfig.domain` → `domainError`.
4. **Roster membership** — the authenticated `org-config` call decides. 403/404
   → `notInTeam`. **While `isAdmin` is unknown the user is treated as admin**, so
   the screen cannot flash "not in team" in the gap between login and that
   fetch. Copied, including the reason.

### 3. Backend — four additions, all shared

Most of the gate's API surface already exists in `APIService` and needs nothing:
`lookupOrg(code:)` (:656) is the web's `fetchOrgConfig`, `forgotOrgCode(email:)`
(:384), `timeclockIdentify(pin:)` (:499), and `timeclockClockIn` /
`timeclockClockOut` / `timeclockEvent` (:506–520) are the kiosk's clock actions.
`OrgInfo` already carries `name`, `domain`, `adminEmail`, `connection`.

Missing:

| addition | notes |
|---|---|
| `static func fetchRoster(orgCode:) -> [Person]` | UNAUTHENTICATED people fetch for the kiosk roster. The backend already allows it: `netlify/functions/people.js:60` is `try { requireOrgMember(event) } catch { /* unauthenticated kiosk */ }`. Distinct from `fetchPeople()`, which is authenticated and instance-scoped. |
| `static func createOrg(...)` | `POST /org`. The one endpoint with no Swift equivalent at all. |
| `static func orgConfig(token:orgCode:) -> OrgConfigResponse` | A new `Decodable` beside `OrgInfo`, adding the fields the unauthenticated `/org` does not return — chiefly `isAdmin`. `GET /org-config` with auth. Returns the full config including the server-set `isAdmin`. A 403/404 IS the membership answer — the server knows, so the client never compares emails itself. |
| `AuthManager.login(loginHint:connection:)` | Additive, both defaulting to nil, so the existing zero-argument call sites are unchanged. Adds `login_hint` and `connection` query items to the authorize URL. |

### 4. The card steps

`org`, `create-org`, `forgot-org`, `login` and the three rejections share one card
built from the web's constants, all copied:

```
PAGE        ground PAPER #EDEAE3, centred, padding 48/20
CARD        max-width 420, radius 20, border #e2e8f0,
            shadow 0 24px 60px rgba(15,23,42,0.10)
CARD_HEADER padding 32/28/24, centred,
            linear-gradient(135deg, #4169e1, #06b6d4)
CARD_BODY   padding 28/28/24
CARD_FOOTER padding 12/24/18, 11pt, #64748b,
            top border rgba(15,23,42,0.06)
```

**The gate carries its own palette and does NOT read `TTheme`.** `LOGIN_BLUE
#38BDF8`, `INK #0B0B0C`, `STONE #8A867E`, `HAIRLINE rgba(16,24,40,.08)`,
`CARD_BG #FBFAF7`. The web's reason, copied verbatim from `App.jsx:24`: "The login
screen renders before a theme is resolved, so it carries its own accent." Reaching
for `@Environment(\.tqTheme)` here would be wrong even though it is available.

### 5. The team kiosk

Two views inside `team`, toggled bottom-right:

- **`login`** — the roster. Tap a face → `AuthManager.login(loginHint: person.email,
  connection: orgConfig.connection)`, and the tapped person is remembered so check
  2 can catch a mismatch. Plus an admin sign-in that skips the hint.
- **`clock`** — the PIN pad. `timeclockIdentify(pin:)` first, then the chosen
  action: `clockIn`, `clockOut`, `lunchStart`, `lunchEnd`, `breakStart`,
  `breakEnd`. Clock Out offers "going to lunch" vs "end of day", so the success
  message follows what was actually performed, not what was requested.
- **A 5s poll** refreshes the roster while `team` is on screen and nobody is
  authenticated, so the status pills (Online / Lunch / Break / Offline) reflect
  other people's devices.

### 6. The load-up

A real timeline, not a fade. Ported with `keyframeAnimator`, which the iOS tab bar
already uses:

```
logo   2400ms  fade in at CENTRE to 40%, hold to 46%, then rise
               cubic-bezier(.33,0,.2,1) → cubic-bezier(.83,0,.17,1)
title  @2150   fade-up 7px, 520ms, cubic-bezier(.22,1,.36,1)
blurb  @2300
card   @2630
foot   @3250
```

The rise distance is **measured, not fixed**. The web reads the lockup's resting
position and computes the exact offset to viewport centre, because a fixed `vh`
that centres the logo on a laptop drops it below centre on a tall monitor. A
`GeometryReader` does the same job here.

`prefers-reduced-motion` maps to `accessibilityReduceMotion`: no animation, full
opacity, no transform.

### 7. The lockup

Space Grotesk 700, `letterSpacing -.05em`, `line-height 1`, thickened with
`-webkit-text-stroke: 1.5px` in the SAME colour as the fill. Then the bars mark at
`.52em` (x-height), `margin-left .07em`, `translateY(.01em)`, baseline-aligned.

Three things this requires, all verified before speccing rather than assumed:

1. **The font.** Google Fonts publishes only a variable `SpaceGrotesk[wght].ttf`
   (no static cuts), OFL-1.1, so bundling is permitted and the license ships
   beside it. Added to `TRAQS Scheduling/Fonts/`, which both targets already
   reference.
2. **Its PostScript name is `SpaceGrotesk-Light_Bold`.** Not `SpaceGrotesk-Bold`.
   The file's default instance is Light, so its named instances register as
   `SpaceGrotesk-Light`, `-Light_Regular`, `-Light_Medium`, `-Light_Bold`
   (enumerated with `CTFontManagerCopyAvailablePostScriptNames`). Asking for the
   obvious name would silently return the system face, which is precisely the
   class of bug PASS 0 spent a commit fixing — so the name goes in the launch
   assertion too.
3. **SwiftUI `Text` cannot stroke.** The wordmark is therefore CoreText glyph
   paths — `CTFontCreatePathForGlyph` per glyph, positioned by `CTRunGetPositions`
   — filled and then stroked in a `Canvas`. Same technique `WebGlyph` uses for the
   icons, so the codebase has one way of doing this. Prototyped and rendered
   before this spec was written.

### 8. Persistence

| web | Mac |
|---|---|
| `localStorage tq_org_code` | Keychain — `AppState.orgCode` already is |
| `localStorage tq_org_config` | UserDefaults |
| `localStorage tq_team_people` | UserDefaults, roster cache |
| `sessionStorage tq_selected_person` | in-memory `@State` — session-scoped by design, and a relaunch should not inherit a stale face |

## Files touched

| file | change |
|---|---|
| `Services/MacGateResolver.swift` | NEW, shared — `GateStep` + the four rules, pure |
| `Services/APIService.swift` | EDIT — `fetchRoster`, `createOrg`, `orgConfig` |
| `Services/AuthManager.swift` | EDIT — `login(loginHint:connection:)` |
| `Fonts/SpaceGrotesk[wght].ttf`, `Fonts/SpaceGrotesk-OFL.txt` | NEW. No project change needed — `Fonts/` is already a synchronized group in both targets, and the Mac's `ATSApplicationFontsPath` already points at the resource root. |
| `MacAuthGate.swift` | NEW — the step host |
| `GateCard.swift` | NEW — PAGE/CARD language + palette |
| `GateLockup.swift` | NEW — stroked wordmark + bars |
| `GateLoadUp.swift` | NEW — the timeline |
| `GateOrgSteps.swift` | NEW — org, create-org, forgot-org |
| `GateLoginStep.swift` | NEW — login + the three rejections |
| `GateTeamStep.swift` | NEW — roster + kiosk + PIN pad |
| `AccountCommands.swift` | EDIT — Sign In / Set Org Code removed, Sign Out kept |
| `TRAQSDesktopApp.swift` | EDIT — gate ahead of ParityView |
| `Theme.swift` | EDIT — Space Grotesk in the launch assertion |

## Verification

1. Mac builds clean; iOS builds and its tests pass (three shared files change).
2. `MacGateResolver` unit tests cover all four rules, including the two the web
   comments call out as bug-fixes: 404-clears-but-500-keeps, and
   unknown-`isAdmin`-counts-as-admin.
3. Launch assertion passes with Space Grotesk added.
4. Signed out, the gate appears with the load-up. Entering an org code reaches the
   roster. Tapping a face reaches Auth0 pre-filled with that email.
5. The kiosk clocks in and out against a real PIN, and the status pills change.
6. Split mode: the gate beside the deployed gate, same card, same lockup weight.
7. `Account ▸ Sign Out` returns to the gate rather than an empty shell.

## Next

1. **The Jobs screen** — `renderTasks`, `TRAQS.jsx:11316`.
2. The remaining screens, then the theme picker.
