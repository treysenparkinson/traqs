// Default theme palettes — redesign pass 1 (Hi-fi Direction C, "Candy").
//
// A white canvas, cards that are a soft tint of it and carry no border, and the
// logo's sky as the accent on both defaults. The design's purple is NOT used: the
// accent comes from the logo (src/brand.jsx BRAND_BARS), and coral / amber / green
// stay semantic (alerts, warnings, in/finished) rather than decorative.
//
// Kept to the colours a theme preset spreads over its base, as plain data, so a
// suite can import and EXECUTE it (scripts/shell-redesign-test.mjs). Deliberately
// absent:
//   - radii: schedule bars and their drag ghosts read `T.radiusXs`, and bar
//     geometry is out of scope for a shell pass;
//   - danger: `#ef4444` stays. Coral reads well as a fill but fails AA as text on
//     white, and danger is used as text.
//   - hover tints: TRAQS.jsx derives them from the accent with hexA/blendHex.
//
// `glassBorder === card` is what makes a card borderless: every card draws its
// border in glassBorder, while row and table separators use `border`.

const SKY = "#38BDF8";

export const LIGHT = {
  bg: "#FFFFFF",          // the canvas
  surface: "#FFFFFF",     // controls, pills, inputs, menus — white on the tinted cards
  card: "#F4F5FA",        // tinted, borderless cards
  border: "#E6E7F0",      // row and table separators
  borderLight: "#E3E4EF", // control outlines
  text: "#17162B",
  textSec: "#6F6E85",
  textDim: "#9A99AE",
  bgText: "#17162B",
  accent: SKY,
  glass: "#FFFFFF",
  glassBorder: "#F4F5FA",
};

// The dark default keeps its existing ground (card lighter than the page, the
// inverse of Light) and takes the same accent and the same borderless cards.
export const DARK = {
  accent: SKY,
  card: "#27272C",
  glassBorder: "#27272C",
};
