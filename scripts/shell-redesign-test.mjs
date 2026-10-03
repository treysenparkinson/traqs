// The app shell, redesign pass 1 (Hi-fi Direction C, "Candy").
//
//   node scripts/shell-redesign-test.mjs
//
// What the pass promises, and what this checks:
//
//   1. The default Light theme is a white canvas with tinted, borderless cards, and
//      both default themes are accented with the logo's sky. Checked by EXECUTING
//      src/themeTokens.js, not by reading it. Radii are deliberately NOT in that
//      module: bars and their ghosts take `T.radiusXs`, and bar geometry is not
//      this pass's to change.
//   2. The sidebar never expands. Every piece of the expand machinery is gone, not
//      merely unreachable -- a mode flag left behind is a guard nothing assigns.
//   3. The top brand strip is gone and its contents live in the rail (mark,
//      notifications, the profile menu with Upgrade and Log out), while undo/redo
//      sit in every page's title row; the save state sits in the rail above the bell.
//   4. Organization settings are tabs inside the page, not a second rail list.
//   5. Dropdown rows no longer stagger in one by one. Right-click menus keep theirs
//      (ctxRowAnim), on purpose.
//
// The rest is STRUCTURAL: TRAQS.jsx is one component with no DOM harness, so it is
// read as source -- with comments stripped first, because the comments explaining a
// removed thing quote it (SCHEDULE_MAP LESSONS #8). Every loop carries a count
// assertion so an empty match set cannot pass silently (LESSONS #1).
//
// SHELL_SRC points the source checks at another copy (e.g. the committed file) to
// show they fail there.

import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

let pass = 0, fail = 0;
const check = (name, fn) => {
  let r;
  try { r = fn(); } catch (e) { r = "threw: " + e.message; }
  if (r === true) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (r === false || r == null ? "" : "  -- " + r)); }
};

// Strip comments without touching strings or template literals. JSX comments are
// `{/* ... */}`, so removing the `/* ... */` leaves an empty `{}` -- harmless here.
function stripComments(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === "/" && d === "/" && src[i - 1] !== ":" && src[i - 1] !== "\\") {
      const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; continue;
    }
    if (c === "'" || c === '"' || c === "`") q = c;
    out += c; i++;
  }
  return out;
}

const RAW = process.env.SHELL_SRC ? readFileSync(process.env.SHELL_SRC, "utf8") : read("src/TRAQS.jsx");
const SRC = stripComments(RAW);

// ── 1. Theme tokens (executed) ──────────────────────────────────────────────────
console.log("\ntheme tokens");
const hexLum = (h) => {
  const n = parseInt(h.slice(1, 7), 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
let tok = null;
try { tok = await import(new URL("src/themeTokens.js", ROOT)); } catch (e) { tok = { _err: e.message }; }
const SKY = (read("src/brand.jsx").match(/\{\s*c:\s*"(#[0-9A-Fa-f]{6})"[^}]*\}\s*,\s*\/\/\s*sky/) || [])[1];
check("brand.jsx still names a sky bar (fixture for the accent check)", () => !!SKY || "no sky entry found");
check("src/themeTokens.js exists and exports LIGHT and DARK", () => (tok && tok.LIGHT && tok.DARK) ? true : (tok?._err || "missing exports"));
const L = tok?.LIGHT || {}, D = tok?.DARK || {};
check("Light canvas is white", () => L.bg === "#FFFFFF" || `bg ${L.bg}`);
check("Light cards are a tint of the canvas, not the canvas", () =>
  (L.card && L.card !== L.bg && hexLum(L.card) < hexLum(L.bg) && hexLum(L.bg) - hexLum(L.card) < 0.12) || `card ${L.card}`);
check("Light controls (surface) sit white on the tinted cards", () => L.surface === "#FFFFFF" || `surface ${L.surface}`);
check("Light cards are borderless (glassBorder is the card)", () => (L.card && L.glassBorder === L.card) || `glassBorder ${L.glassBorder}`);
check("Dark cards are borderless (glassBorder is the card)", () => (D.card && D.glassBorder === D.card) || `glassBorder ${D.glassBorder}`);
check("both defaults are accented with the logo's sky", () => (L.accent === SKY && D.accent === SKY) || `${L.accent} / ${D.accent} vs ${SKY}`);
check("no radius lives in the tokens (bars read T.radiusXs)", () =>
  ![...Object.keys(L), ...Object.keys(D)].some((k) => /^radius/.test(k)) || "a radius key was added");
check("danger stays the AA-safe red on Light (coral fails as text on white)", () => !("danger" in L) || L.danger === "#ef4444" || `danger ${L.danger}`);
check("TRAQS.jsx imports the tokens", () => /import\s*\{[^}]*\bLIGHT\b[^}]*\bDARK\b[^}]*\}\s*from\s*"\.\/themeTokens(\.js)?"/.test(SRC) || /import\s*\{[^}]*\bDARK\b[^}]*\bLIGHT\b[^}]*\}\s*from\s*"\.\/themeTokens/.test(SRC) || "no import");
check("the Light preset is built from LIGHT", () => /frost:\s*\{[^\n]*\.\.\.LIGHT\b/.test(SRC) || "frost does not spread LIGHT");
check("the Dark preset is built from DARK", () => /midnight:\s*\{[^\n]*\.\.\.DARK\b/.test(SRC) || "midnight does not spread DARK");

// ── 2. The rail never expands ───────────────────────────────────────────────────
console.log("\nsidebar rail");
for (const id of ["sidebarExpanded", "setSidebarExpanded", "sidebarMode", "setSidebarMode", "toggleSidebar", "draftSidebar", "setDraftSidebar", "tq_sidebar_mode", "settingsOrgExpanded"]) {
  check(`no '${id}' left in the code`, () => {
    const n = (SRC.match(new RegExp(`\\b${id}\\b`, "g")) || []).length;
    return n === 0 || `${n} occurrence(s)`;
  });
}
const asideStart = SRC.indexOf('<aside className="tq-sidebar"');
const asideEnd = asideStart < 0 ? -1 : SRC.indexOf("</aside>", asideStart);
const ASIDE = asideStart < 0 || asideEnd < 0 ? "" : SRC.slice(asideStart, asideEnd);
// The rail's helpers (navBtn etc.) are declared just above the <aside> in the same IIFE.
const railFnStart = SRC.lastIndexOf("{!isMobile && ((Tpage) => { const T = Tpage;", asideStart);
const RAIL = railFnStart < 0 || asideEnd < 0 ? "" : SRC.slice(railFnStart, asideEnd);
check("the rail and its <aside> can be located", () => (ASIDE.length > 2000 && RAIL.length > ASIDE.length) || `aside ${ASIDE.length} chars, rail ${RAIL.length}`);

// The mark shares the page titles' row: titles match the dashboard greeting, a 57px
// row (52px at lineHeight 1.1) 24px from the top (frostScroll "24px 32px 28px"), so the mark's box is that
// same row, centred, and the nav starts well below it.
check("the logo mark is centred on the page-title row", () =>
  /const TITLE_ROW_TOP = 24, TITLE_ROW_H = 57;/.test(RAIL) && /marginTop: TITLE_ROW_TOP - RAIL_PAD_TOP, height: TITLE_ROW_H/.test(ASIDE) || "mark not on the title row");
check("frostScroll puts titles 24px down, the greeting's padTop (fixture for the check above)", () => /const frostScroll = \(children, pad = "24px 32px 28px"/.test(SRC) && /const padTop = isMobile \? 2 : 24;/.test(SRC) || "frostScroll padding / greeting padTop moved");
check("page titles are the greeting's size", () => /fontSize: isMobile \? 32 : 52,\s*fontWeight: 900,\s*letterSpacing: "-0\.07em",\s*lineHeight: 1\.1/.test(SRC) && /<span style=\{\{ fontSize: isMobile \? 32 : 52, fontWeight: 900, letterSpacing: "-0\.07em"[^\n]*lineHeight: 1\.1/.test(SRC) || "title size != greeting size");
check("no page title overrides that size", () => !/<h1 style=\{\{ \.\.\.pageTitleStyle, [^}]*fontSize/.test(SRC) || "an <h1> overrides fontSize");
check("no title container is still at the old 34px offset", () => !/padding: (asPage \? )?"34px 32px/.test(SRC) || "a 34px title offset remains");
// iOS-style floating nav: the column is the page itself (no sidebar fill, no rule),
// and the nav is a frosted-glass capsule hung just under the mark. Notifications and
// the profile sit in their own glass capsule at the foot.
const asideOpen = (ASIDE.match(/^<aside[^>]*>/) || [""])[0];
// No column at all: the rail is a transparent layer over the page's left edge, so
// the page background (solid, liquid or image) runs unbroken underneath it -- a
// flat rail beside a painted page drew a top-to-bottom seam. The page content is
// padded by the rail's width, so nothing sits under the pills.
check("the rail is a transparent overlay, not a column", () =>
  /position: "absolute", left: 0, top: 0, bottom: 0/.test(asideOpen) && /background: "transparent"/.test(asideOpen) && !/borderRight/.test(asideOpen) || asideOpen.slice(0, 200));
check("one rail width, shared by the rail and the page padding", () => /const RAIL_W = 88;/.test(SRC) && /const SB_W = RAIL_W;/.test(RAIL) || "no shared RAIL_W");
check("the page is padded clear of the rail and paints under it", () =>
  /<div ref=\{contentPanelRef\} style=\{\{[^\n]*paddingLeft: isMobile \? 0 : RAIL_W/.test(SRC) || "content panel not padded by RAIL_W");
check("the body row is the rail's positioning box", () => /\{\/\* ── Body — sidebar \+ content ── \*\/\}\s*<div style=\{\{ position: "relative", flex: 1/.test(RAW) || "body row not position:relative");
check("the rail draws on the page theme (it floats over the page)", () => RAIL.startsWith("{!isMobile && ((Tpage) => { const T = Tpage;") || "rail still on the chrome theme");
const GLASS = (RAIL.match(/const railGlass = glassOn\n\s*\? \{[^\n]*/) || [""])[0];
const SOLID = (RAIL.match(/const railGlass = glassOn\n[^\n]*\n\s*: \{[^\n]*/) || [""])[0].split("\n").pop();
check("the pills are glass only when Frosted Glass is on", () => (!!GLASS && !!SOLID) || "railGlass is not gated on glassOn");
check("...and solid with no blur when it is off", () => /background: T\.surface[,\s]/.test(SOLID) && !/blur|hexA\(T\.surface/.test(SOLID) || SOLID || "no solid branch");
check("glass: translucent fill with a backdrop blur (both engines)", () =>
  /background: hexA\(T\.surface, 0\.\d+\)/.test(GLASS) && /backdropFilter: "blur\(\d+px\)/.test(GLASS) && /WebkitBackdropFilter: "blur\(\d+px\)/.test(GLASS) || GLASS || "no railGlass");
check("the glass casts no drop shadow (edge only)", () => GLASS && !/boxShadow/.test(GLASS) || "railGlass has a boxShadow");
const navOpen = (ASIDE.match(/<nav className="tq-rail-nav" style=\{\{[^\n]*/) || [""])[0];
check("the nav is a glass capsule", () => /\.\.\.railGlass/.test(navOpen) && /borderRadius: T\.radiusPill/.test(navOpen) || navOpen.slice(0, 160) || "no <nav className=\"tq-rail-nav\">");
check("...hung just below the mark, with a gap", () =>
  /const RAIL_GAP = 20;/.test(RAIL) && /const RAIL_NAV_TOP = TITLE_ROW_TOP \+ TITLE_ROW_H \+ RAIL_GAP;/.test(RAIL) &&
  /position: "absolute"/.test(navOpen) && /top: RAIL_NAV_TOP, transform: "translateX\(-50%\)"/.test(navOpen) && !/top: "50%"/.test(navOpen) || "nav not anchored under the mark");
check("...and scrolls inside itself instead of running into the foot", () =>
  /maxHeight: `calc\(100% - \$\{RAIL_NAV_TOP \+ RAIL_FOOT_CLEAR\}px\)`/.test(navOpen) && /overflowY: "auto"/.test(navOpen) || "no clearance");
const footAt = ASIDE.indexOf('className="tq-rail-foot"');
const FOOT = footAt < 0 ? "" : ASIDE.slice(footAt);
check("notifications and profile share a glass capsule at the foot", () =>
  footAt > 0 && FOOT.indexOf("...railGlass") > 0 && /borderRadius: T\.radiusPill/.test(FOOT.slice(FOOT.indexOf("...railGlass"), FOOT.indexOf("...railGlass") + 120)) && /ref=\{notifRef\}/.test(FOOT) && /ref=\{profileRef\}/.test(FOOT) || "no foot capsule holding both");
// Jobs expand lag: the page-tall list cards re-blurred their whole area on every
// resize (176-352ms per expand in Safari vs ~56ms without). They keep the fill only.
check("list cards (FrostCard) carry the no-blur class", () => /const FrostCard = [^\n]*\n\s*<div className="tq-lglass tq-lglass-card tq-list-card"/.test(SRC) || "FrostCard missing tq-list-card");
check("...and that class turns the backdrop blur off under the glass toggle", () =>
  /\.traqs-glass \.tq-lglass\.tq-lglass-card\.tq-list-card \{\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;\s*\}/.test(SRC) || "no tq-list-card blur override");
check("rail buttons are 54px circles", () => /const RAIL_BTN = 54;/.test(RAIL) && /width: RAIL_BTN, height: RAIL_BTN/.test(RAIL) || "RAIL_BTN is not 54");
check("rail icons are drawn larger (22px)", () => /const NAV_ICON = narrowViewport \? 19 : 22;/.test(SRC) || "NAV_ICON not 19/22");
// Hover names the page right beside the icon, fading in and out -- not the
// cursor-following tooltip, which lands wherever the pointer happens to be.
check("the rail names its buttons with its own beside-the-icon label", () => /\[railTip, setRailTip\] = useState\(/.test(SRC) || "no railTip state");
check("the rail no longer uses the cursor tooltip", () => !/tipCtx\.show/.test(ASIDE) && !/tipCtx\.show/.test(RAIL) || `${(RAIL.match(/tipCtx\.show/g) || []).length} tipCtx.show call(s)`);
check("the label is placed from the hovered button's own box", () => /getBoundingClientRect\(\)/.test(RAIL) && /left: railTip\.left/.test(ASIDE) || "label not anchored to the button");
check("the label fades (opacity transition), both ways", () => /opacity: railTip\.on \? 1 : 0/.test(ASIDE) && /transition: "opacity 0\.1\d?s/.test(ASIDE) || "no fade");
check("the <aside> has no hover-expand handlers", () => !/<aside[^>]*onMouse(Enter|Leave)/.test(ASIDE) || "onMouseEnter/Leave on <aside>");
check("the nav highlight is a circle", () => /borderRadius:\s*"50%"/.test((RAIL.match(/const navBtn = [\s\S]*?\n\s*\}\);/) || [""])[0]) || "navBtn is not 50%");
const NAVBTN = (RAIL.match(/const navBtn = [\s\S]*?\n\s*\}\);/) || [""])[0];
check("the selected nav button is a solid accent fill", () => /background: active \? T\.accent :/.test(NAVBTN) || "active fill is not T.accent");
check("its icon contrasts the accent", () => /color: active \? T\.accentText :/.test(NAVBTN) || "active icon is not T.accentText");
// The highlight moves on PRESS, not on the next commit. Switching page re-renders
// the whole app before React repaints the rail, which read as the highlight
// lagging behind the click. railPress paints the pressed button straight onto the
// DOM; executed here against stand-in buttons.
let RP = null;
try { RP = await import(new URL("src/railPress.js", ROOT)); } catch (e) { RP = { _err: e.message }; }
const fakeBtn = (active) => ({ dataset: { navActive: active ? "1" : "0" }, style: { background: active ? "ACC" : "transparent", color: active ? "INK_ON" : "INK_OFF" } });
check("src/railPress.js exports paintPress and isNavActive", () => (typeof RP?.paintPress === "function" && typeof RP?.isNavActive === "function") || RP?._err || "missing exports");
check("pressing paints the pressed button with the accent at once", () => {
  const was = fakeBtn(true), next = fakeBtn(false), other = fakeBtn(false);
  RP.paintPress(next, [was, next, other], { on: "ACC", onInk: "INK_ON", off: "transparent", offInk: "INK_OFF" });
  return (next.style.background === "ACC" && next.style.color === "INK_ON" && RP.isNavActive(next)) || JSON.stringify(next);
});
check("...and clears the one that was selected", () => {
  const was = fakeBtn(true), next = fakeBtn(false);
  RP.paintPress(next, [was, next], { on: "ACC", onInk: "INK_ON", off: "transparent", offInk: "INK_OFF" });
  return (was.style.background === "transparent" && was.style.color === "INK_OFF" && !RP.isNavActive(was)) || JSON.stringify(was);
});
check("...without touching buttons that were not selected", () => {
  const was = fakeBtn(true), next = fakeBtn(false), other = fakeBtn(false);
  other.style.background = "HOVER";
  RP.paintPress(next, [was, next, other, null], { on: "ACC", onInk: "INK_ON", off: "transparent", offInk: "INK_OFF" });
  return other.style.background === "HOVER" || other.style.background;
});
// A press that does not navigate (the unsaved-changes guard, a refused page) gets
// no React repaint of the rail, so the DOM would keep the painted guess. syncRail
// re-aligns every button with the selection React last rendered.
check("syncRail puts a press that did not navigate back", () => {
  const cur = fakeBtn(true), pressed = fakeBtn(false);
  const colors = { on: "ACC", onInk: "INK_ON", off: "transparent", offInk: "INK_OFF" };
  RP.paintPress(pressed, [cur, pressed], colors);
  RP.syncRail({ schedule: cur, jobs: pressed }, "schedule", colors);
  return (RP.isNavActive(cur) && cur.style.background === "ACC" && !RP.isNavActive(pressed) && pressed.style.background === "transparent") || JSON.stringify({ cur, pressed });
});
check("syncRail leaves a consistent rail alone (a hovered button keeps its hover)", () => {
  const cur = fakeBtn(true), hovered = fakeBtn(false);
  hovered.style.background = "HOVER";
  RP.syncRail({ schedule: cur, jobs: hovered, gone: null }, "schedule", { on: "ACC", onInk: "INK_ON", off: "transparent", offInk: "INK_OFF" });
  return hovered.style.background === "HOVER" || hovered.style.background;
});
check("the rail is re-synced after every commit", () => /useLayoutEffect\(\(\) => \{\s*syncRail\(navBtnRefs\.current, railActiveKeyRef\.current, railColorsRef\.current\);\s*\}\);/.test(SRC) || "no per-commit syncRail effect");
check("rail nav buttons paint on mouse-down", () => {
  const n = (ASIDE.match(/onMouseDown=\{pressNav\}/g) || []).length;
  return n >= 3 || `${n} buttons press-paint (views, Admin, settings sections)`;
});
check("hover reads the live selection, not a render-time closure", () =>
  /const hoverIn = \(label, bg = T\.hover\) => e => \{ if \(!isNavActive\(e\.currentTarget\)\)/.test(RAIL) &&
  /const hoverOut = \(bg = "transparent"\) => e => \{ if \(!isNavActive\(e\.currentTarget\)\)/.test(RAIL) || "hover still keyed on the closure");
check("buttons carry the selection React rendered (data-nav-active)", () => /data-nav-active=\{active \? "1" : "0"\}/.test(ASIDE) || "no data-nav-active");
check("nav buttons render no text labels", () => {
  const n = (ASIDE.match(/\{v\.label\}<\/span>|>Settings<\/span>|>Admin<\/span>|>Back<\/span>|>FAST TRAQS<\/span>/g) || []).length;
  return n === 0 || `${n} label span(s)`;
});

// ── 3. The brand strip moved into the rail ──────────────────────────────────────
console.log("\nbrand strip -> rail");
const count = (re, s = SRC) => (s.match(re) || []).length;
check("the logo mark renders in the rail", () => /<TraqsBars\b/.test(ASIDE) || "no <TraqsBars> in the <aside>");
check("the logo mark renders nowhere else in the app shell", () => count(/<TraqsBars\b/g) === count(/<TraqsBars\b/g, ASIDE) || `${count(/<TraqsBars\b/g)} total, ${count(/<TraqsBars\b/g, ASIDE)} in rail`);
check("the notifications bell lives in the rail", () => /ref=\{notifRef\}/.test(ASIDE) || "notifRef not in the <aside>");
check("notifRef is attached exactly once", () => count(/ref=\{notifRef\}/g) === 1 || `${count(/ref=\{notifRef\}/g)} attachments`);
check("the profile menu offers Log out", () => /setConfirmLogout\(true\)/.test(ASIDE) || "no logout in the <aside>");
check("the profile menu offers Upgrade", () => /setUpgradeOpen\(true\)/.test(ASIDE) || "no upgrade in the <aside>");
check("the profile menu shows the org name", () => /\{orgName\}/.test(ASIDE) || "no orgName in the <aside>");
check("the profile menu has an open state", () => /\[profileMenuOpen, setProfileMenuOpen\] = useState\(false\)/.test(SRC) || "no profileMenuOpen state");
check("undo/redo/save are defined once as the title-row actions", () => /const titleActions = /.test(SRC) || "no titleActions");
const titleActionsDef = (SRC.match(/const titleActions = [\s\S]*?\n {2}\);/) || [""])[0];
check("titleActions carries undo and redo, not the save state", () =>
  (/onClick=\{undo\}/.test(titleActionsDef) && /onClick=\{redo\}/.test(titleActionsDef) && !/saveStatus/.test(titleActionsDef)) || "titleActions missing undo/redo, or still carries saveStatus");
check("the save state sits on the background above the bell, outside the foot capsule", () => {
  const at = FOOT.indexOf('className="tq-rail-save"'), glass = FOOT.indexOf("...railGlass"), bell = FOOT.indexOf("ref={notifRef}");
  return (at > 0 && at < glass && glass < bell && /saveError/.test(FOOT.slice(0, at)) && /saveStatus/.test(FOOT.slice(0, at))) || `save ${at}, glass ${glass}, bell ${bell}`;
});
check("undo is wired to a button only in titleActions", () => count(/onClick=\{undo\}/g) === 1 || `${count(/onClick=\{undo\}/g)} undo buttons`);
const H1 = [...SRC.matchAll(/<h1 style=\{(pageTitle\(\)|pageTitleStyle|\{ \.\.\.pageTitleStyle[^}]*\})\}>/g)];
check("page titles found (count guard)", () => H1.length >= 10 || `${H1.length} page titles`);
let missingActions = [];
for (const m of H1) {
  const after = SRC.slice(m.index, m.index + 400);
  if (!/<\/h1>\s*\{titleActions\}/.test(after)) missingActions.push(SRC.slice(m.index, m.index + 60).replace(/\s+/g, " "));
}
check("every page title is followed by the title-row actions", () => missingActions.length === 0 || `${missingActions.length} without: ${missingActions[0]}`);
check("the dashboard greeting row carries them too", () => /dash-greeting[\s\S]{0,1500}\{titleActions\}/.test(SRC) || "no titleActions near the greeting");

// ── 4. Organization settings are tabs ───────────────────────────────────────────
console.log("\norganization settings");
check("the rail does not list the organization pages", () => !/SETTINGS_ORG_CHILDREN/.test(ASIDE) || "SETTINGS_ORG_CHILDREN in the <aside>");
const pageStart = SRC.indexOf("const renderSettingsPage = () =>");
const PAGE = pageStart < 0 ? "" : SRC.slice(pageStart, pageStart + 8000);
check("the settings page renders the organization pages as tabs", () => /SETTINGS_ORG_CHILDREN\.map\(/.test(PAGE) || "no SETTINGS_ORG_CHILDREN.map in renderSettingsPage");

// ── 5. Dropdown rows do not stagger ─────────────────────────────────────────────
console.log("\ndropdown stagger");
// An index-multiplied delay on a row-entrance keyframe is a stagger.
const STAGGER = /(toolDropUp|toolDrop|staggerUp|dropIn)\b[^\n]{0,80}?\$\{[^}]*\*\s*[\d.]+[^}]*\}(ms|s)\b|animationDelay:\s*`\$\{[^}]*\*/g;
// Not dropdowns, kept deliberately: right-click menus, cards, page lists and
// modals. Each is pinned by code within `dist` chars of the stagger (either side),
// tight enough that a dropdown elsewhere cannot borrow the exemption.
const ALLOWED = [
  ["right-click menus (ctxRowAnim)", /function ctxRowAnim\(/, 400],
  ["dashboard cards", /dashAnimate \? \{ animationDelay/, 40],
  ["schedule select-mode rows", /animationDelay: `\$\{ri \* 25\}ms` \}\}>\{selPeople\.has/, 120],
  ["Time Settings people grid (modal)", /tsSettingsDraft\.map\(\(p, pi\) =>/, 900],
  ["Add/Edit Dependencies modal", /const on=isLinked\(sub\.id\);/, 400],
];
const hits = [...SRC.matchAll(STAGGER)];
check("stagger detector finds the kept sites (count guard)", () => hits.length >= ALLOWED.length || `${hits.length} matches`);
const stray = [], used = new Set();
for (const h of hits) {
  const hit = ALLOWED.find(([, re, dist]) => re.test(SRC.slice(Math.max(0, h.index - dist), h.index + dist)));
  if (hit) used.add(hit[0]); else stray.push(SRC.slice(h.index, h.index + 70).replace(/\s+/g, " "));
}
check("no dropdown row staggers in", () => stray.length === 0 || `${stray.length} stagger(s), first: ${stray[0]}`);
check("every exemption is still used (a stale one would excuse the next dropdown)", () =>
  ALLOWED.every(([k]) => used.has(k)) || "unused: " + ALLOWED.filter(([k]) => !used.has(k)).map(([k]) => k).join(", "));
// Hand-timed delays in a template literal were the panel-section staggers (filter
// panels, the columns menu). The double-quoted 38ms ones are single context-menu
// rows, which keep their animation.
check("no hand-timed stagger delays (19/28/38/114/152ms)", () => {
  const n = count(/`toolDrop(Up)? 0\.14s (19|28|38|114|152)ms/g);
  return n === 0 || `${n} fixed-delay row(s)`;
});
check("context-menu rows keep their entrance", () => count(/"toolDrop 0\.14s 38ms both ease-out"/g) >= 3 || `${count(/"toolDrop 0\.14s 38ms both ease-out"/g)} left`);
check("right-click menus still stagger", () => /function ctxRowAnim\([\s\S]{0,400}\$\{idx \* 38\}ms/.test(SRC) || "ctxRowAnim lost its stagger");

// ── 6. Square page, solid colours ───────────────────────────────────────────────
console.log("\npage corners and fills");
check("the content panel is square (SHELL_RADIUS 0)", () => /const SHELL_RADIUS = 0;/.test(SRC) || "SHELL_RADIUS is not 0");
check("the customization preview panels are square too", () =>
  !/borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden", position: "relative", background: pT\.bg/.test(SRC) || "a rounded preview panel");
const brandGradDef = (SRC.match(/function brandGrad\([^)]*\)\s*\{[^}]*\}/) || [""])[0];
check("brandGrad is found (count guard)", () => brandGradDef.length > 0 || "no brandGrad");
check("brandGrad returns a solid colour", () => !/gradient/.test(brandGradDef) || brandGradDef);
// A 135° two-stop fill is the button / tile / header gradient the design dropped.
// Stripes, grid lines, masks and image tints are patterns, not colour gradients.
// `repeating-` excluded: those are the PTO / time-off stripes the grid must keep.
check("no two-tone 135° fills left in the app", () => {
  const n = count(/(?<!repeating-)linear-gradient\(135deg,\s*[$#]/g);
  return n === 0 || `${n} left`;
});
const APP = stripComments(process.env.SHELL_APP_SRC ? readFileSync(process.env.SHELL_APP_SRC, "utf8") : read("src/App.jsx"));
check("no two-tone 135° fills left on the sign-in / kiosk screens", () => {
  const n = count(/(?<!repeating-)linear-gradient\(135deg,\s*[$#]/g, APP);
  return n === 0 || `${n} left`;
});
check("no radial glow orbs in the app", () => count(/radial-gradient\(circle,/g) === 0 || `${count(/radial-gradient\(circle,/g)} left`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
