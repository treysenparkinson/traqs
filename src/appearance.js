// Appearance — the whole of the web theme since the 2026-10-03 simplification:
// Light or Dark, an accent colour, and the three element settings that stayed
// (job-card colours, list-cell colours, schedule grid).
//
// What went: the Custom theme (primary / secondary / background pickers), image
// and liquid backgrounds, Frosted Glass and saved presets. Their fields may still
// sit in localStorage or the synced user-settings blob, so everything read from
// either goes through normalizeAppearance, which drops them.
//
// Pure data and functions, so scripts/appearance-test.mjs can import and EXECUTE
// it. THEMES stays in TRAQS.jsx; the base palette is passed in.

import { blendHex, hexA, hexLum, accentText } from "./barPaint.js";

export const MODES = ["frost", "midnight"]; // Light, Dark

// The accent swatches. The first is the logo's sky, which both defaults already
// use (themeTokens.js), so "no accent chosen" and "the first swatch" look the same.
export const ACCENTS = ["#38BDF8", "#3d7fff", "#7c3aed", "#ec4899", "#f43f5e", "#f97316", "#f59e0b", "#10b981"];

// The prefs object stored as `customTheme` (the key and sync shape are kept so
// nothing server-side changes). accent null = the mode's own accent.
export const DEFAULT_PREFS = Object.freeze({
  v: 1, accent: null, jobBarMode: "system", jobBarColor: null, cellColorMode: "system", scheduleGrid: true,
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const hexOr = (v, d) => (typeof v === "string" && HEX.test(v) ? v : d);

/**
 * Map whatever was saved onto { themeMode, prefs } without changing what the
 * person saw:
 *   - "custom" becomes Light or Dark by its background, with the same darkness
 *     test buildCustomTheme used (luminance < 0.18 = dark), and keeps its accent
 *     and element settings — on a custom theme those were live;
 *   - a legacy preset keeps its mode and gets the defaults, because a preset
 *     never applied customTheme's accent or element settings, even when the
 *     object held some from an earlier custom theme;
 *   - prefs already in the new shape (v: 1) pass through, cleaned.
 */
export function normalizeAppearance(themeMode, saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  const keep = (src) => ({
    v: 1,
    accent: hexOr(src.accent, null),
    jobBarMode: ["system", "adaptive", "custom"].includes(src.jobBarMode) ? src.jobBarMode : "system",
    jobBarColor: hexOr(src.jobBarColor, null),
    cellColorMode: src.cellColorMode === "adaptive" ? "adaptive" : "system",
    scheduleGrid: src.scheduleGrid !== false,
  });
  if (themeMode === "custom") {
    const bg = hexOr(s.bg, "#FFFFFF");
    return { themeMode: hexLum(bg) < 0.18 ? "midnight" : "frost", prefs: keep(s) };
  }
  const mode = themeMode === "midnight" || themeMode === "obsidian" ? "midnight" : "frost";
  return { themeMode: mode, prefs: s.v === 1 ? keep(s) : { ...DEFAULT_PREFS } };
}

/**
 * The live theme: the Light or Dark palette with the chosen accent laid over it.
 * Hover tints are rebuilt from the accent the way the two presets build theirs,
 * so a swapped accent never leaves the old one's tint behind.
 */
export function appearanceTheme(base, prefs) {
  const p = prefs || DEFAULT_PREFS;
  const dark = base.colorScheme === "dark";
  const accent = hexOr(p.accent, base.accent);
  return {
    ...base,
    accent,
    accentText: accent === base.accent && base.accentText ? base.accentText : accentText(accent),
    hover: hexA(blendHex(accent, dark ? 0.45 : -0.35), dark ? 0.2 : 0.14),
    hoverStrong: hexA(blendHex(accent, dark ? 0.45 : -0.35), dark ? 0.34 : 0.24),
    // Schedule bars: system = each job's own colour, adaptive = the accent for
    // all, custom = jobBarColor for all.
    jobBarMode: p.jobBarMode || "system",
    jobBarColor: hexOr(p.jobBarColor, accent),
    // Status / priority cells: system = their configured colours, adaptive =
    // shades of the accent.
    cellColorMode: p.cellColorMode || "system",
    scheduleGrid: p.scheduleGrid !== false,
  };
}
