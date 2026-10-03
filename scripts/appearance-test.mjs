// Appearance: Light / Dark + an accent, plus the job-card, list-cell and
// schedule-grid settings (2026-10-03). The Custom theme, image and liquid
// backgrounds, Frosted Glass and saved presets are gone.
//
// src/appearance.js is executed here; the page wiring is checked in the source.
//
//   node scripts/appearance-test.mjs
import { readFileSync } from "node:fs";
import { normalizeAppearance, appearanceTheme, ACCENTS, DEFAULT_PREFS } from "../src/appearance.js";

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, fn) => {
  let r; try { r = fn(); } catch (e) { r = "threw: " + e.message; }
  if (r === true) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (r ? "  -- " + r : "")); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || `${JSON.stringify(a)} != ${JSON.stringify(b)}`;

console.log("1. migration keeps what each person saw");
const oldCustom = { bg: "#101018", accent: "#ec4899", surface: "#202030", bgMode: "liquid", bgImage: "data:x", cardOpacity: 64, jobBarMode: "custom", jobBarColor: "#22c55e", cellColorMode: "adaptive", scheduleGrid: false };
check("a dark custom theme becomes Dark", () => eq(normalizeAppearance("custom", oldCustom).themeMode, "midnight"));
check("a light custom theme becomes Light", () => eq(normalizeAppearance("custom", { ...oldCustom, bg: "#F4F1EA" }).themeMode, "frost"));
check("...keeping its accent and element settings", () => eq(normalizeAppearance("custom", oldCustom).prefs,
  { v: 1, accent: "#ec4899", jobBarMode: "custom", jobBarColor: "#22c55e", cellColorMode: "adaptive", scheduleGrid: false }));
check("...and dropping background, glass and colour fields", () => { const k = Object.keys(normalizeAppearance("custom", oldCustom).prefs); return !k.some(x => ["bg", "surface", "bgMode", "bgImage", "cardOpacity"].includes(x)) || k.join(); });
check("a legacy preset keeps its mode and gets the defaults (it never applied customTheme)", () =>
  eq(normalizeAppearance("frost", oldCustom), { themeMode: "frost", prefs: { ...DEFAULT_PREFS } }));
check("Obsidian maps to Dark", () => eq(normalizeAppearance("obsidian", null).themeMode, "midnight"));
check("nothing saved: Light with defaults", () => eq(normalizeAppearance(null, null), { themeMode: "frost", prefs: { ...DEFAULT_PREFS } }));
check("new-shape prefs pass through", () => { const p = { v: 1, accent: "#7c3aed", jobBarMode: "adaptive", jobBarColor: null, cellColorMode: "system", scheduleGrid: true }; return eq(normalizeAppearance("midnight", p), { themeMode: "midnight", prefs: p }); });
check("junk values are cleaned", () => eq(normalizeAppearance("frost", { v: 1, accent: "red", jobBarMode: "rainbow", cellColorMode: 3 }).prefs, { ...DEFAULT_PREFS }));

console.log("2. the live theme");
const BASE = { name: "Light", colorScheme: "light", accent: "#38BDF8", accentText: "#ffffff", bg: "#FFFFFF" };
check("no accent chosen: the mode's own accent and accentText", () => { const t = appearanceTheme(BASE, DEFAULT_PREFS); return eq([t.accent, t.accentText, t.bg], ["#38BDF8", "#ffffff", "#FFFFFF"]); });
check("a chosen accent replaces it, with its own contrast text", () => { const t = appearanceTheme(BASE, { ...DEFAULT_PREFS, accent: "#f59e0b" }); return eq(t.accent, "#f59e0b") && typeof t.accentText === "string" && t.hover.includes("rgba(") || JSON.stringify(t); });
check("element settings ride on the theme", () => { const t = appearanceTheme(BASE, { ...DEFAULT_PREFS, jobBarMode: "custom", jobBarColor: "#22c55e", cellColorMode: "adaptive", scheduleGrid: false }); return eq([t.jobBarMode, t.jobBarColor, t.cellColorMode, t.scheduleGrid], ["custom", "#22c55e", "adaptive", false]); });
check("jobBarColor falls back to the accent", () => eq(appearanceTheme(BASE, { ...DEFAULT_PREFS, accent: "#7c3aed" }).jobBarColor, "#7c3aed"));
check("no frosted glass: cardOpacity is not set", () => eq(appearanceTheme(BASE, DEFAULT_PREFS).cardOpacity, undefined));
check("eight swatches, the first is the default sky", () => eq([ACCENTS.length, ACCENTS[0]], [8, "#38BDF8"]));

console.log("3. the page and what was removed");
check("T is built by appearanceTheme", () => /T = appearanceTheme\(THEMES\[_tMode\] \|\| THEMES\.frost, _tc\);/.test(SRC) || "not wired");
check("saved and synced themes are normalized", () => /return normalizeAppearance\(localStorage\.getItem\("tq_theme"\), saved\);/.test(SRC) && /const a = normalizeAppearance\(remote\.themeMode \?\? themeMode, remote\.customTheme \?\? customTheme\);/.test(SRC) || "a read path is not normalized");
check("the Custom theme, its builder and the Customize modal are gone", () => !/buildCustomTheme|customizationOpen|id: "custom", label: "Custom" \}, \]|\{ id: "custom", label: "Custom" \}\]\.map\(th/.test(SRC) || "still there");
check("saved presets and the background-image history are gone", () => !/themePresets|bgImageHistory|presetNameInput/.test(SRC) || "still there");
check("the page offers Light / Dark and the swatches", () => /\{ id: "frost", label: "Light" \}, \{ id: "midnight", label: "Dark" \}/.test(SRC) && /ACCENTS\.map\(/.test(SRC) || "missing");
check("job-card, list-cell and grid controls stayed", () => /System Elements/.test(SRC) && /List Cells/.test(SRC) && /Schedule Grid/.test(SRC) || "missing");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
