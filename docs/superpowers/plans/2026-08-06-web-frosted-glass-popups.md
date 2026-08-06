# Web Frosted-Glass Popups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every popup, modal, keypad, and dropdown in the React web app read as frosted glass in all theme modes, driven by the existing Card frost opacity slider.

**Architecture:** Three unscoped CSS rules replace 25 hand-rolled opaque panels' appearance by overriding their inline `background: T.card` with `!important`. A new `--tq-glass-bg` CSS variable carries a glassier alpha than cards use, derived from the same slider through one pure function. Three media viewers opt out via a `tq-opaque` class applied *before* the rules land, so no intermediate commit renders them wrong.

**Tech Stack:** React 18, Vite 6, plain CSS-in-template-string (the app injects a `<style>` block from `src/TRAQS.jsx`), Node 26 for the checker script.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-web-frosted-glass-popups-design.md`. Every value below is copied from it.
- All app changes land in **one file**: `src/TRAQS.jsx`. The app is a single ~27k-line component.
- Card alpha = `cardOpacity / 100`, range **0.20 – 1.00**. Slider is `dc.cardOpacity`, `min="20" max="100"`, at `src/TRAQS.jsx:21909`.
- Popup alpha = `max(0.15, cardAlpha * 0.4)`. Default `cardOpacity` is **80**, giving **0.32**.
- Panel/menu blur: `blur(28px) saturate(1.4)`. Scrim: `rgba(0,0,0,0.30)` + `blur(16px)`.
- Rules must **NOT** be scoped to `.traqs-adaptive` — that gate is the bug being fixed.
- Every rule selector carries `:not(.tq-opaque)`.
- **Never run `npm run build` while the dev server is running.** It recreates `dist/`, which makes Netlify Dev serve stale HTML and white-screen `localhost:8888`. If you do build, `rm -rf dist` afterward.
- Commit after every task. Do not push; the user pushes.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/TRAQS.jsx` | All app changes: pure helper, CSS variables, CSS rules, class additions |
| `scripts/check-frost.mjs` | **New.** Executable regression checker. Grows across tasks 1–6. |

**Deviation from the spec, stated explicitly:** the spec's "Files touched" table lists only `src/TRAQS.jsx` and says "No new files." This plan adds `scripts/check-frost.mjs`. That is tooling, not app code, and it exists because a prior source-pattern-only check in this repo passed while the code threw at runtime. The checker executes the one piece of real logic (`glassAlpha`) rather than pattern-matching it.

---

### Task 1: `glassAlpha()` pure helper + executable checker

**Files:**
- Modify: `src/TRAQS.jsx` (insert after `hexA`, which ends at line 1286)
- Create: `scripts/check-frost.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `glassAlpha(cardOpacity: number | undefined) → number` at module scope in `src/TRAQS.jsx`. Task 2 calls it. Returns a 0–1 alpha, floored at `0.15`, defaulting to `cardOpacity = 80` when the argument is `undefined` or not finite.

- [ ] **Step 1: Write the failing checker**

Create `scripts/check-frost.mjs`:

```js
// Regression checker for the frosted-glass popup work.
// Spec: docs/superpowers/specs/2026-08-06-web-frosted-glass-popups-design.md
//
// Check [1] EXECUTES glassAlpha in an isolated scope. A source-regex check is not
// enough: an earlier checker in this repo passed while the code threw
// "localDayOf is not defined" at runtime, because the function referenced a
// closure it could not see. Compiling it with `new Function` means any undefined
// free variable fails here instead of in the browser.
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.log(`  FAIL ${m}`); failures++; };

// Slice a top-level `function name(...) { ... }` out of the source by brace-walking.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

console.log("\n[1] glassAlpha executes with only its parameters in scope:");
const fnSrc = extractFn(SRC, "glassAlpha");
if (!fnSrc) {
  fail("glassAlpha not found in src/TRAQS.jsx");
} else {
  let fn = null;
  try {
    fn = new Function(`${fnSrc}; return glassAlpha;`)();
  } catch (e) {
    fail(`could not compile in isolation: ${e.message}`);
  }
  if (fn) {
    const cases = [
      [80,        0.32, "default 80 -> 0.32 (near the iOS 22% tint)"],
      [100,       0.40, "max 100 -> 0.40"],
      [20,        0.15, "min 20 -> floored at 0.15, not 0.08"],
      [undefined, 0.32, "undefined -> treated as 80"],
      [0,         0.15, "0 -> floored at 0.15"],
    ];
    for (const [input, expected, label] of cases) {
      try {
        const got = fn(input);
        if (Math.abs(got - expected) < 1e-9) pass(label);
        else fail(`${label} — got ${got}, expected ${expected}`);
      } catch (e) {
        fail(`${label} — THREW: ${e.message}`);
      }
    }
    try {
      const got = fn(80);
      if (got > 0 && got < 1) pass("returns a 0..1 alpha, not a percentage");
      else fail(`returned ${got}, which is not a 0..1 alpha`);
    } catch { /* already reported above */ }
  }
}

console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-frost.mjs`
Expected: FAIL with `glassAlpha not found in src/TRAQS.jsx`, exit code 1.

- [ ] **Step 3: Write the minimal implementation**

In `src/TRAQS.jsx`, insert immediately after the closing `}` of `hexA` (currently line 1286, directly before the `// Position a fixed dropdown relative to its trigger rect` comment):

```js
// Popup/menu translucency, derived from the same "Card frost opacity" slider that
// drives cards. Popups are deliberately glassier than cards: the iOS app tints its
// modals at surface-opacity 0.22 over a blur, so reusing the card alpha (80% by
// default) would render a mildly tinted panel rather than glass. The 0.4 factor puts
// the default at 0.32 while still tracking the slider across 0.15..0.40. Floored at
// 0.15 so the slider's 20% minimum stays legible over a bright background image.
function glassAlpha(cardOpacity) {
  const pct = Number.isFinite(cardOpacity) ? cardOpacity : 80;
  return Math.max(0.15, (pct / 100) * 0.4);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/check-frost.mjs`
Expected: PASS, all six `[1]` assertions ok, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/TRAQS.jsx scripts/check-frost.mjs
git commit -m "feat(web): add glassAlpha() for popup translucency

Derives popup alpha from the existing Card frost opacity slider, mapped into a
glassier 0.15-0.40 range so the default reads like the iOS modals rather than
like a card."
```

---

### Task 2: Opt out the three media viewers

Done **before** the CSS rules land (Task 4). The scrim rule matches every `.anim-modal-overlay`, so if the rules shipped first these three would briefly render with a light scrim behind a photo.

**Files:**
- Modify: `src/TRAQS.jsx` — three overlay elements and their panels

**Interfaces:**
- Consumes: nothing.
- Produces: the class name `tq-opaque` present on three overlays. Task 4's selectors exclude it via `:not(.tq-opaque)`.

- [ ] **Step 1: Add the checker section**

Append to `scripts/check-frost.mjs`, immediately before the final `console.log(failures === 0 ...)` line:

```js
console.log("\n[2] media viewers opt out via tq-opaque:");
{
  const optOuts = [
    ["uploadModal",  "FAST TRAQS upload modal"],
    ["lightboxAtt",  "attachment lightbox"],
  ];
  for (const [token, label] of optOuts) {
    // Find the overlay line that renders this surface, then confirm tq-opaque is on it.
    const line = SRC.split("\n").find(l => l.includes(token) && l.includes("anim-modal-overlay"));
    if (!line) fail(`${label}: could not find its anim-modal-overlay line`);
    else if (line.includes("tq-opaque")) pass(`${label} overlay carries tq-opaque`);
    else fail(`${label} overlay is missing tq-opaque — it would get a 30% scrim`);
  }
  const opaqueCount = (SRC.match(/tq-opaque/g) || []).length;
  if (opaqueCount >= 6) pass(`tq-opaque applied ${opaqueCount}x (>=3 overlays + >=3 panels)`);
  else fail(`tq-opaque appears only ${opaqueCount}x; expected >=6 (overlay + panel for 3 surfaces)`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-frost.mjs`
Expected: FAIL — `uploadModal` and `lightboxAtt` overlays missing `tq-opaque`, and the count check fails.

- [ ] **Step 3: Apply `tq-opaque` to the three surfaces**

Locate each by its state token, not by line number. For each, add `tq-opaque` to the **overlay's** `className` and to its immediate child **panel** div.

Surface A — FAST TRAQS upload modal. Find the line containing `uploadModal && <div className="anim-modal-overlay"` with `rgba(0,0,0,0.88)`:

```jsx
// before
<div className="anim-modal-overlay" onClick={...} style={{ ..., background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", ... }}>
// after
<div className="anim-modal-overlay tq-opaque" onClick={...} style={{ ..., background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", ... }}>
```

Surface B — attachment lightbox. Find the line containing `lightboxAtt && <div className="anim-modal-overlay"` with `rgba(0,0,0,0.88)`. Same edit.

Surface C — photo viewer, the overlay with `rgba(0,0,0,0.7)` immediately following the lightbox block. Same edit.

For each of the three, also add `tq-opaque` to the child panel div. If the panel already has a `className`, append to it (`className="anim-modal-box tq-opaque"`); if it has none, add `className="tq-opaque"`.

Do **not** change any `background`, `backdropFilter`, or layout value on these three. They keep their dark scrims exactly as they are.

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/check-frost.mjs`
Expected: PASS, `[1]` and `[2]` sections all ok.

- [ ] **Step 5: Commit**

```bash
git add src/TRAQS.jsx scripts/check-frost.mjs
git commit -m "feat(web): opt media viewers out of the coming glass rules

The upload modal, attachment lightbox, and photo viewer keep their dark scrims;
a 30% scrim would put page content behind the image."
```

---

### Task 3: Drive both frost variables from the slider, ungated

**Files:**
- Modify: `src/TRAQS.jsx:2598` and the effect's dependency array at `src/TRAQS.jsx:2600`

**Interfaces:**
- Consumes: `glassAlpha()` from Task 1.
- Produces: CSS custom properties `--tq-frost-bg` (cards, now unconditional) and `--tq-glass-bg` (popups) on `document.documentElement`. Task 4's rules read `--tq-glass-bg`.

- [ ] **Step 1: Add the checker section**

Append to `scripts/check-frost.mjs`, before the final summary line:

```js
console.log("\n[3] frost variables are set unconditionally and use glassAlpha:");
{
  const frostLine = SRC.split("\n").find(l => l.includes('setProperty("--tq-frost-bg"'));
  const glassLine = SRC.split("\n").find(l => l.includes('setProperty("--tq-glass-bg"'));

  if (!frostLine) fail("--tq-frost-bg is never set");
  else if (/T\.adaptive\s*\?/.test(frostLine))
    fail("--tq-frost-bg is still gated on T.adaptive — popups stay solid in preset themes");
  else pass("--tq-frost-bg is set unconditionally (no T.adaptive gate)");

  if (!glassLine) fail("--tq-glass-bg is never set");
  else if (!glassLine.includes("glassAlpha"))
    fail("--tq-glass-bg does not use glassAlpha() — the slider mapping would be duplicated");
  else pass("--tq-glass-bg is set via glassAlpha()");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-frost.mjs`
Expected: FAIL — `--tq-frost-bg is still gated on T.adaptive` and `--tq-glass-bg is never set`.

- [ ] **Step 3: Replace the variable assignment**

In `src/TRAQS.jsx`, replace this single line (currently 2598):

```js
    document.documentElement.style.setProperty("--tq-frost-bg", T.adaptive ? hexA(solid, (T.cardOpacity ?? 80) / 100) : solid);
```

with:

```js
    // Both frost tints are now unconditional. They used to be gated on T.adaptive
    // (an image or liquid background), which meant .tq-frost did nothing in flat
    // Color mode or in any preset theme. Popups read --tq-glass-bg, which is the
    // same surface colour at a glassier alpha — see glassAlpha().
    document.documentElement.style.setProperty("--tq-frost-bg", hexA(solid, (T.cardOpacity ?? 80) / 100));
    document.documentElement.style.setProperty("--tq-glass-bg", hexA(solid, glassAlpha(T.cardOpacity)));
```

Leave the `--tq-bg-image` line below it unchanged — it *should* stay gated on `T.adaptive`, because there is genuinely no image to paint in the other modes.

- [ ] **Step 4: Update the dependency array**

The effect's deps (currently line 2600) still list `T.adaptive`, which no longer affects these two properties but does still affect `--tq-bg-image`. Leave the array exactly as it is:

```js
  }, [T.surfaceSolid, T.surface, T.adaptive, T.cardOpacity, T.bgImage]);
```

No edit for this step — it is here so you do not "helpfully" remove `T.adaptive` and break `--tq-bg-image` updates.

- [ ] **Step 5: Run it to verify it passes**

Run: `node scripts/check-frost.mjs`
Expected: PASS, sections `[1]`–`[3]` all ok.

- [ ] **Step 6: Commit**

```bash
git add src/TRAQS.jsx scripts/check-frost.mjs
git commit -m "feat(web): drive frost tints from the slider in every theme

--tq-frost-bg was gated on T.adaptive, so .tq-frost did nothing in flat Color
mode or any preset theme. Both tints are now unconditional, and popups get
--tq-glass-bg at the glassier alpha from glassAlpha()."
```

---

### Task 4: The three CSS rules

**Files:**
- Modify: `src/TRAQS.jsx` — insert after the existing frost block that ends at line 1025

**Interfaces:**
- Consumes: `--tq-glass-bg` from Task 3; `tq-opaque` from Task 2.
- Produces: the class name `tq-glass`, which Task 5 applies to 25 panels.

- [ ] **Step 1: Add the checker section**

Append to `scripts/check-frost.mjs`, before the final summary line:

```js
console.log("\n[4] CSS rules exist, are ungated, and honour tq-opaque:");
{
  const needed = [
    [".anim-modal-box", "popup panels"],
    [".tq-glass",       "hand-rolled panels"],
    [".anim-modal-overlay", "scrim"],
    [".anim-ctx",       "context menus"],
  ];
  for (const [sel, label] of needed) {
    // Match the selector only where it heads a rule (start of line), not in JSX.
    const re = new RegExp(`^\\s*\\${sel}[^{\\n]*:not\\(\\.tq-opaque\\)`, "m");
    if (re.test(SRC)) pass(`${label}: ${sel} rule present with :not(.tq-opaque)`);
    else fail(`${label}: no ${sel} rule carrying :not(.tq-opaque)`);
  }
  // The whole point: these must NOT be scoped to .traqs-adaptive.
  const badly = SRC.match(/^\s*\.traqs-adaptive\s+\.(anim-modal-box|tq-glass|anim-modal-overlay|anim-ctx)/m);
  if (badly) fail(`rule is scoped to .traqs-adaptive ("${badly[0].trim()}") — glass would not appear in preset themes`);
  else pass("no popup rule is scoped to .traqs-adaptive");

  if (SRC.includes("var(--tq-glass-bg")) pass("rules consume --tq-glass-bg");
  else fail("no rule reads var(--tq-glass-bg)");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-frost.mjs`
Expected: FAIL — all four selector checks fail, and the `--tq-glass-bg` consumption check fails.

- [ ] **Step 3: Insert the rules**

In `src/TRAQS.jsx`, insert immediately after the closing `}` of the existing `.traqs-adaptive .tq-frost, .traqs-adaptive .anim-card-wrap { ...backdrop-filter... }` block (currently ends line 1025), before the `/* Smoothly fade text between black/white ... */` comment:

```css
/* ── Frosted-glass popups ────────────────────────────────────────────────────
   Deliberately NOT scoped to .traqs-adaptive, unlike the card rules above. The
   original decision (see the buildCustomTheme comment) kept every popup solid;
   popups now read as glass in EVERY theme, including flat Color mode and the
   presets, to match the native iOS app.
   `!important` is required because these panels set `background: T.card` inline,
   which otherwise wins. Same precedent as the .tq-frost rule above.
   `:not(.tq-opaque)` is the documented escape hatch — media viewers keep their
   dark scrims, because a light scrim puts page content behind the photo. */
.anim-modal-box:not(.tq-opaque),
.tq-glass:not(.tq-opaque) {
  background-color: var(--tq-glass-bg, var(--tq-surface-solid)) !important;
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  backdrop-filter: blur(28px) saturate(1.4);
}
/* The scrim has to be light enough to see through, or the panel's own blur just
   samples a near-black wall and resolves to a dark solid panel. */
.anim-modal-overlay:not(.tq-opaque) {
  background: rgba(0, 0, 0, 0.30) !important;
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
}
.anim-ctx:not(.tq-opaque),
.anim-ctx-up:not(.tq-opaque) {
  background-color: var(--tq-glass-bg, var(--tq-surface-solid)) !important;
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  backdrop-filter: blur(28px) saturate(1.4);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/check-frost.mjs`
Expected: PASS, sections `[1]`–`[4]` all ok.

- [ ] **Step 5: Visual smoke check**

With the dev server already running at `localhost:8888` (do **not** run `npm run build`), hard-reload and open any modal that already uses `anim-modal-box`. It should be translucent with a light scrim.

Then switch to the **Midnight** preset theme with no background image and open the same modal. It must still be glass. This is the check that the `.traqs-adaptive` ungating actually worked and is the single most likely thing to be silently wrong.

- [ ] **Step 6: Commit**

```bash
git add src/TRAQS.jsx scripts/check-frost.mjs
git commit -m "feat(web): frosted-glass rules for popups, scrims, and menus

Three ungated rules override the inline background: T.card on popup panels,
lighten the scrim to 30% so the panel blur has something to sample, and frost
context menus. tq-opaque excludes media viewers."
```

---

### Task 5: Convert the 25 hand-rolled panels

**Files:**
- Modify: `src/TRAQS.jsx` — 25 panel divs

**Interfaces:**
- Consumes: the `tq-glass` class from Task 4.
- Produces: nothing new.

The 25 overlays whose panel lacks `anim-modal-box`. **The line numbers below are the OVERLAY line; the panel is its child div, normally the very next line.** Line numbers shift as you edit — locate each by its surrounding code, and work bottom-up so earlier numbers stay valid:

```
15544  16020  16440  16746  17011  17637  22860  24016  24055  24109
24222  24298  24426  24616  24692  25247  25336  25676  26042  26056
26375  26413  26455  26970  27026
```

Excluded because Task 2 already opted them out: 24962, 25281, 25310.

`renderPinModal` is the one at **16020**. It is the keypad *and* the break/lunch popup — `pinState` drives `lunchStart_pin`, `lunchEnd_pin`, `breakStart_pin`, and `breakEnd_pin` through the same component — so all three surfaces the user named are covered by that single edit.

- [ ] **Step 1: Add the checker section**

Append to `scripts/check-frost.mjs`, before the final summary line:

```js
console.log("\n[5] hand-rolled panels carry tq-glass:");
{
  const lines = SRC.split("\n");
  const overlays = lines
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => l.includes("anim-modal-overlay"));

  let bare = 0;
  for (const { n } of overlays) {
    const window = lines.slice(n - 1, n + 7).join("\n");
    if (window.includes("tq-opaque")) continue;          // media viewer, exempt
    if (window.includes("anim-modal-box")) continue;      // covered by the rule
    if (window.includes("tq-glass")) continue;            // converted
    bare++;
  }
  if (bare === 0) pass("every non-exempt overlay has a glass panel (anim-modal-box or tq-glass)");
  else fail(`${bare} overlay(s) still render an opaque hand-rolled panel`);

  const glassCount = (SRC.match(/tq-glass/g) || []).length;
  // 25 panels + the CSS selector occurrence from Task 4.
  if (glassCount >= 26) pass(`tq-glass appears ${glassCount}x (>=25 panels + 1 selector)`);
  else fail(`tq-glass appears only ${glassCount}x; expected >=26`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-frost.mjs`
Expected: FAIL — `25 overlay(s) still render an opaque hand-rolled panel`.

- [ ] **Step 3: Convert each panel**

Three shapes occur. Twenty of the panels have no `className`; five already have one.

Shape A — no className, style first (e.g. the PIN modal panel):

```jsx
// before
<div style={{ background: T.card, borderRadius: 26, padding: "52px 32px 32px", ... }} onClick={e => e.stopPropagation()}>
// after
<div className="tq-glass" style={{ background: T.card, borderRadius: 26, padding: "52px 32px 32px", ... }} onClick={e => e.stopPropagation()}>
```

Shape B — no className, handler first:

```jsx
// before
<div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.borderLight}`, ... }}>
// after
<div className="tq-glass" onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.borderLight}`, ... }}>
```

Shape C — className already present (e.g. `anim-delete-box`), append rather than replace:

```jsx
// before
<div className="anim-delete-box" style={{ background: T.card, borderRadius: 20, padding: 32, ... }}>
// after
<div className="anim-delete-box tq-glass" style={{ background: T.card, borderRadius: 20, padding: 32, ... }}>
```

Do **not** delete the inline `background: T.card`. It stays as the fallback for any browser without `backdrop-filter`, and the CSS rule overrides it with `!important`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/check-frost.mjs`
Expected: PASS, sections `[1]`–`[5]` all ok.

- [ ] **Step 5: Visual check of the named surfaces**

Hard-reload `localhost:8888`. Confirm all three surfaces the user asked for are glass:
1. The clock-in **keypad**.
2. **Start Break** / **End Break**.
3. **Start Lunch** / **End Lunch**.

Then spot-check tap-outside-to-dismiss still works on the PIN modal and two other converted panels — no dismissal behaviour should have changed.

- [ ] **Step 6: Commit**

```bash
git add src/TRAQS.jsx scripts/check-frost.mjs
git commit -m "feat(web): frost the 25 hand-rolled popup panels

Includes renderPinModal, which is the keypad and the break/lunch popups in one
component. Inline background: T.card is kept as a no-backdrop-filter fallback."
```

---

### Task 6: Frost the employee page

**Files:**
- Modify: `src/TRAQS.jsx` — `renderEmployees`, which starts at line 14814

**Interfaces:**
- Consumes: `--tq-frost-bg` from Task 3 via the pre-existing `.tq-frost` rules.
- Produces: nothing new.

The employee page is newer than the frost system and uses it nowhere — zero `tq-frost` occurrences in its ~680 lines. It gets the **card** treatment (`tq-frost`), not the popup treatment, because these are page cards rather than popups.

- [ ] **Step 1: Add the checker section**

Append to `scripts/check-frost.mjs`, before the final summary line:

```js
console.log("\n[6] employee page participates in the frost system:");
{
  const lines = SRC.split("\n");
  const start = lines.findIndex(l => l.includes("const renderEmployees = "));
  if (start === -1) {
    fail("could not find renderEmployees");
  } else {
    // Bound the search at the next top-level render function.
    const rest = lines.slice(start + 1);
    const endRel = rest.findIndex(l => /^  const render[A-Z]/.test(l));
    const body = rest.slice(0, endRel === -1 ? rest.length : endRel).join("\n");
    const n = (body.match(/tq-frost/g) || []).length;
    if (n >= 1) pass(`renderEmployees uses tq-frost ${n}x`);
    else fail("renderEmployees has no tq-frost — the employee page stays opaque");
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-frost.mjs`
Expected: FAIL — `renderEmployees has no tq-frost`.

- [ ] **Step 3: Add `tq-frost` to the page's cards**

Within `renderEmployees`, find each card-like container — a div whose style sets `background: T.card` and a `borderRadius` — and add the class, matching the shapes in Task 5:

```jsx
// no className yet
<div style={{ background: T.card, borderRadius: T.radius, ... }}>
<div className="tq-frost" style={{ background: T.card, borderRadius: T.radius, ... }}>

// className already present
<div className="anim-card-wrap" style={{ background: T.card, ... }}>
<div className="anim-card-wrap tq-frost" style={{ background: T.card, ... }}>
```

Do not add it to rows inside a card, to buttons, or to form fields — only the card containers and detail panels. Nested frost stacks blur on blur and muddies text.

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/check-frost.mjs`
Expected: PASS, all sections `[1]`–`[6]` ok.

- [ ] **Step 5: Check it for performance**

Open the employee page with a background image set and scroll. `backdrop-filter` is GPU work and this page can render many cards at once. If it stutters, note it — the Jobs page already does the same thing at similar density, so precedent says it holds, but this is the one page where it could bite.

- [ ] **Step 6: Commit**

```bash
git add src/TRAQS.jsx scripts/check-frost.mjs
git commit -m "feat(web): frost the employee page cards

The page postdates the frost system and used it nowhere, so it read as the only
fully opaque surface left."
```

---

### Task 7: Full verification pass

**Files:** none modified unless a check fails.

- [ ] **Step 1: Run the full checker**

Run: `node scripts/check-frost.mjs`
Expected: PASS, sections `[1]` through `[6]`, exit code 0.

- [ ] **Step 2: Build cleanly**

Stop the dev server first, then:

```bash
npm run build && rm -rf dist
```

Expected: `✓ built` with no new errors. The pre-existing `Duplicate key "minHeight"` warning in the Schedule nav is unrelated — leave it. Removing `dist` afterward is mandatory or the next `localhost:8888` load white-screens.

- [ ] **Step 3: Restart the dev server and walk the spec's visual checklist**

```bash
npm run dev
```

Work through §Verification of the spec, items 2–9:

1. Keypad, break popup, lunch popup are glass.
2. **Glass appears in the Midnight preset with no background image** — the highest-risk item.
3. Moving **Card frost opacity** live-retints popups, keypad, and employee cards, not just cards.
4. Employee page frosts.
5. The three media surfaces are unchanged — still dark, image still readable.
6. Context menus and dropdowns are glass.
7. Text stays readable at slider 20% over a light background image.
8. No popup lost tap-outside dismissal.

- [ ] **Step 4: Report**

Report which checks passed and which did not, with the actual output. If item 2 fails, the `.traqs-adaptive` ungating in Task 3 or Task 4 did not take — re-read both before changing anything.

- [ ] **Step 5: Commit any fixes**

Only if a check failed and required a change. Otherwise nothing to commit; the user pushes.
