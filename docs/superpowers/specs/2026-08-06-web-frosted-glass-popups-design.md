# Web: frosted-glass popups matching the iOS app

Date: 2026-08-06
Scope: `src/TRAQS.jsx` (React web app) only. No iOS or Netlify-function changes.

Companion to `2026-08-05-ios-glass-modals-design.md`, which did the same job natively.

## Problem

Every popup on the web app is an opaque panel. The iOS app's equivalents — clock PIN
pad, break/lunch banner, end-job photo prompt — are real frosted glass. The two apps no
longer look related.

This is not an oversight. `TRAQS.jsx:1341` records the original decision:

> ALL surfaces stay SOLID (popups, dropdowns, buttons, cards) for consistency. The
> frosted-glass translucency is OPT-IN per element via the `.tq-frost` class.

This spec reverses that decision for popups, deliberately.

Three things block glass today:

1. **The frost rules are gated on `.traqs-adaptive`** (`TRAQS.jsx:1014` and `:1021`), a
   root class present only when `adaptive` is true — and `adaptive` is
   `(bgMode === "image" && !!bgImage) || bgMode === "liquid"` (`:1350`), which exists only
   in custom-theme mode. In flat Color mode and in every preset theme (Midnight,
   Obsidian, White), `.tq-frost` does nothing at all.
2. **Popup panels set `background: T.card` inline**, which beats any non-`!important`
   stylesheet rule.
3. **The scrims are near-opaque black** (`rgba(0,0,0,0.5)`–`0.7)` plus `blur(6px)`). A
   glass panel blurring a near-black scrim resolves to a dark solid panel, so even a
   correctly-frosted popup would not read as glass.

The employee page (`renderEmployees`, `TRAQS.jsx:14814`) is newer and uses no frost at
all — zero `tq-frost` occurrences in its ~680 lines.

## Goals

1. Every popup, modal, keypad, and dropdown reads as frosted glass — including the PIN
   keypad and the break/lunch popups, which are the surfaces the user named.
2. Glass appears in **every** theme mode, not only where a background image is set.
3. The existing **Card frost opacity** slider (`TRAQS.jsx:21909`, `dc.cardOpacity`,
   range 20–100) drives popup translucency along with card translucency, from one control.
4. The employee page participates like every other surface.
5. Media viewers stay dark, because a light scrim ruins them.

## Non-goals

- **Hoisting the slider to preset themes.** `cardOpacity` lives inside the custom-theme
  object and the slider only appears in the custom-theme editor. Preset themes therefore
  frost at a fixed 80% with no control. Confirmed acceptable by the user (2026-08-06)
  because the working themes are custom ones with background images.
- **Restyling radii, shadows, typography, or spacing.** Only translucency, blur, and
  scrim change. Web keeps its existing `radiusLg: 26` panels rather than adopting the
  iOS 36pt pebble.
- **Touching layout or behaviour of any popup.** No dismissal, focus, z-index, or
  animation changes.
- **Retiring `background: T.card` app-wide.** Non-popup surfaces that are correct as
  opaque cards stay opaque.

## Design

### 1. Two CSS variables, one slider

`TRAQS.jsx:2598` currently sets the frost tint only in adaptive mode:

```js
document.documentElement.style.setProperty("--tq-frost-bg",
  T.adaptive ? hexA(solid, (T.cardOpacity ?? 80) / 100) : solid);
```

It becomes unconditional, and gains a second, glassier variable for popups:

```js
const alpha = (T.cardOpacity ?? 80) / 100;              // 0.20 … 1.00
document.documentElement.style.setProperty("--tq-frost-bg",  hexA(solid, alpha));
document.documentElement.style.setProperty("--tq-glass-bg",  hexA(solid, Math.max(0.15, alpha * 0.4)));
```

`solid` already resolves through `T.surfaceSolid || T.surface || "#1e1e2e"` (`:2583`), so
preset themes work with no extra branch. The effect's dep array drops `T.adaptive`.

**Why popups get their own variable.** The iOS recipe tints at
`T.surface.opacity(0.22)` over `.ultraThinMaterial` — the panel is mostly blur, barely
tint. Reusing `--tq-frost-bg` directly would render popups at the card alpha (80% by
default), which is a mildly tinted panel, not glass. The `× 0.4` mapping puts the default
at **32%** — close to the iOS 22% — while still moving with the slider across a
0.15–0.40 range. One slider, two surface families, and popups look like iOS at the
default rather than only at the slider's floor.

### 2. Three CSS rules

Added beside the existing frost block at `TRAQS.jsx:1014–1025`, and **not** scoped to
`.traqs-adaptive`. `!important` on `background-color` is required to beat the inline
`background: T.card`, and matches the precedent already set at `:1016`.

```css
/* Popup / modal panels */
.anim-modal-box:not(.tq-opaque),
.tq-glass:not(.tq-opaque) {
  background-color: var(--tq-glass-bg, var(--tq-surface-solid)) !important;
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  backdrop-filter: blur(28px) saturate(1.4);
}

/* Modal scrim */
.anim-modal-overlay:not(.tq-opaque) {
  background: rgba(0, 0, 0, 0.30) !important;
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
}

/* Context menus and dropdowns */
.anim-ctx:not(.tq-opaque),
.anim-ctx-up:not(.tq-opaque) {
  background-color: var(--tq-glass-bg, var(--tq-surface-solid)) !important;
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  backdrop-filter: blur(28px) saturate(1.4);
}
```

The `:not(.tq-opaque)` on every selector is what makes §4 possible without fighting
specificity.

### 3. Which surfaces need an edit

Measured, not estimated — 59 `anim-modal-overlay` sites, of which 31 already wrap their
panel in `anim-modal-box` and 28 do not:

| Group | Count | Work |
| --- | --- | --- |
| Overlays whose panel has `anim-modal-box` | 31 | none — rule 1 covers them |
| Overlays with a hand-rolled panel | 28 | add `tq-glass` to the panel div |
| Employee page (`renderEmployees:14814`) | — | add `tq-frost` to its cards and detail panels |
| Context menus / dropdowns | — | none — rule 3 covers them |

The 28 hand-rolled panels are at lines 15544, 16020, 16440, 16746, 17011, 17637, 22860,
24016, 24055, 24109, 24222, 24298, 24426, 24616, 24692, 24962, 25247, 25281, 25310,
25336, 25676, 26042, 26056, 26375, 26413, 26455, 26970, 27026 — of which three are
opt-outs (§4), leaving 25 to convert. Line numbers are a starting index, not a contract;
they shift as edits land, so each is located by its surrounding code.

`renderPinModal` (`:16017`, panel at `:16021`) is in this group. It is both the keypad
and the break/lunch popup — `pinState` drives `lunchStart_pin`, `lunchEnd_pin`,
`breakStart_pin`, `breakEnd_pin` through the same component (`:16012`), so all three
surfaces the user named are fixed by one edit plus rule 1.

### 4. Opt-outs — media viewers stay dark

A `tq-opaque` class, applied to both the overlay and its panel, excludes a surface from
all three rules. Three surfaces take it, all image viewers where a 30% scrim would put
page content behind the photo:

| Line | Surface | Current scrim |
| --- | --- | --- |
| 24962 | FAST TRAQS upload modal (`uploadModal`) | `rgba(0,0,0,0.88)` + `blur(14px)` |
| 25281 | Attachment lightbox (`lightboxAtt`) | `rgba(0,0,0,0.88)` |
| 25310 | Photo viewer | `rgba(0,0,0,0.7)` |

A fourth dark surface, line 25295 (`rgba(0,0,0,0.8)`, lightbox chrome), needs no change:
it is not an `.anim-modal-overlay` and carries no panel class, so none of the three rules
match it. It is listed here only so a future reader does not "fix" its omission.

The six other dark overlays — 13869, 23276, 23413, 24792, 24966, 25451 — were checked and
are ordinary modals with no media content. They convert to glass and lose their dark
scrims.

### 5. Divergence from iOS, stated plainly

The iOS spec uses **no scrim tint at all** — `ModalScrim` draws nothing, and separation
comes entirely from blurring the page at `radius: 3`. This spec keeps a 30% black tint,
per the user's decision on 2026-08-06.

The two are not the same look. Web modals sit over a dense dashboard where some dimming
aids focus, and web's `backdrop-filter` on the overlay blurs the page far more strongly
than iOS's radius-3 page blur, so an untinted web scrim reads as a smear rather than as
depth. If the result feels heavier than the phone, the dial is the `0.30` in rule 2;
dropping it to `~0.15` is the closest match to iOS.

## Files touched

| File | Change |
| --- | --- |
| `src/TRAQS.jsx` (CSS block, ~1014–1025) | three new rules, ungated |
| `src/TRAQS.jsx` (effect, ~2598) | `--tq-frost-bg` unconditional, add `--tq-glass-bg`, drop `T.adaptive` dep |
| `src/TRAQS.jsx` (24 panels) | add `tq-glass` |
| `src/TRAQS.jsx` (4 media surfaces) | add `tq-opaque` |
| `src/TRAQS.jsx` (`renderEmployees`) | add `tq-frost` to cards and detail panels |

Single file, because the app is a single component. No new files.

## Risks

- **Text contrast.** A panel at the slider's 20% floor over a bright background image can
  make text hard to read. The floor stays at 20% and `--tq-glass-bg` clamps at 0.15;
  existing auto-contrast text colouring is unchanged. Flagged for the visual pass rather
  than pre-emptively raising the floor.
- **Performance.** `backdrop-filter` is GPU work. One modal at a time is fine. The
  employee page rendering many frosted cards at once is the case to watch; the Jobs page
  already does exactly this, so there is precedent that it holds up.
- **`!important` escalation.** Any future inline background on a popup will silently lose
  to these rules. That is the intent, and `tq-opaque` is the documented escape.
- **Preset themes have no slider.** Fixed 80% card / 32% popup. Accepted (see Non-goals).

## Verification

The web app has no test framework, so verification is a build plus a visual pass.

1. `npm run build` succeeds. Run it only when the dev server is **not** running, then
   `rm -rf dist` — a leftover `dist/` makes Netlify Dev serve stale HTML and white-screen
   `localhost:8888`.
2. Keypad, break popup, and lunch popup are glass — the three surfaces named in the
   request.
3. Glass is present in a **preset** theme (Midnight) with no background image. This is the
   check that the `.traqs-adaptive` ungating actually worked; it is the single most
   likely thing to be silently wrong.
4. Moving **Card frost opacity** visibly retints popups, keypad, and employee-page cards
   live — not just cards.
5. The employee page frosts.
6. The four media surfaces in §4 are unchanged: still dark, image still readable.
7. Context menus and dropdowns are glass.
8. Text remains readable at slider 20% over a light background image.
9. No popup lost its dismissal behaviour — spot-check tap-outside on the PIN modal and
   two converted panels.
