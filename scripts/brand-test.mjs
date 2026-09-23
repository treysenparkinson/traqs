// One palette, used in two places, and they must not drift apart.
//
// The four colours were measured off the app icon's candy-bars cut, not matched
// by eye -- the sky is #38BDF8, which is exactly the accent the rest of the app
// already uses, and that is easy to miss and then re-type slightly wrong. The
// logo's four lines and the liquid background behind it both read from
// BRAND_BARS, so a colour can only be changed in one place. This asserts that
// stays true, because a literal hex pasted into the CSS would look correct on
// the day it was written and be wrong the first time the palette moves.
//
//   node scripts/brand-test.mjs

import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (msg, cond) => {
  if (cond) { pass++; console.log("ok    " + msg); }
  else { fail++; console.error("FAIL  " + msg); }
};

// ── the palette ──────────────────────────────────────────────────────────────
// Measured from TRAQS Scheduling/.../AppIcon.icon/Assets/traqs-candy-bars.png.
// Widths are fractions of the mark's full width and match the iOS lockup.
const MEASURED = [
  { c: "#FF6B57", w: 0.552 },
  { c: "#F0A819", w: 0.789 },
  { c: "#38BDF8", w: 1 },
  { c: "#1D7D5C", w: 0.448 },
];

const barsBlock = SRC.slice(SRC.indexOf("const BRAND_BARS = ["), SRC.indexOf("];", SRC.indexOf("const BRAND_BARS = [")));
ok("BRAND_BARS is declared", barsBlock.length > 0);

const hexes = [...barsBlock.matchAll(/"(#[0-9A-F]{6})"/g)].map((m) => m[1]);
ok("four colours, in the order the mark stacks them",
  JSON.stringify(hexes) === JSON.stringify(MEASURED.map((b) => b.c)));

const widths = [...barsBlock.matchAll(/w: ([\d.]+)/g)].map((m) => +m[1]);
ok("four widths, matching the measured mark",
  JSON.stringify(widths) === JSON.stringify(MEASURED.map((b) => b.w)));

// The sky bar is the app's existing accent. If someone changes one and not the
// other the logo stops matching every accent surface in the product.
ok("the sky bar is the accent the product already uses", hexes[2] === "#38BDF8");

// ── the mark ─────────────────────────────────────────────────────────────────
ok("the mark is drawn from BRAND_BARS, not a hardcoded list",
  /BRAND_BARS\.map/.test(SRC));
// The old single-colour cut must be gone, not merely unused: an import left
// behind is an invitation to render it again.
ok("the single-colour bars PNG is no longer imported",
  !/import TRAQS_BARS from/.test(SRC));
ok("the lockup renders the drawn mark", /<TraqsBars\b/.test(SRC));

// ── the background ───────────────────────────────────────────────────────────
const liquid = SRC.slice(SRC.indexOf("const LIQUID_CSS = `"), SRC.indexOf("const LOADUP_CSS"));
ok("LIQUID_CSS is declared", liquid.length > 0);
ok("all four washes are built from BRAND_BARS",
  [0, 1, 2, 3].every((i) => liquid.includes(`BRAND_BARS[${i}].c`)));
// THE POINT OF THIS FILE. A literal hex here compiles, renders, and is wrong the
// moment the palette moves.
ok("no colour is re-typed as a literal in the background CSS",
  !/#[0-9A-Fa-f]{6}/.test(liquid));

// The wash must stay off the lockup: colours sliding behind the wordmark made
// the mark itself look like it was moving.
ok("the centre is masked clear so the wash never sits under the logo",
  /mask-image: \$\{CENTRE_CLEAR\}/.test(liquid) && /-webkit-mask-image/.test(liquid));

// ── the orbit ────────────────────────────────────────────────────────────────
// The washes travel one shared circle, a quarter turn apart. Verified in Chrome
// by driving the animation's own clock: radius from centre held at 49.97-49.98
// across all four washes at all thirteen stops.
ok("the orbit is generated from the circle, not typed out",
  /orbitKeyframes\(\)/.test(liquid) && /50 \+ 50 \* Math\.cos/.test(SRC));
ok("the four washes are a quarter turn apart",
  /ORBIT_STOPS \/ 4/.test(SRC));
// A closed lap: the last keyframe must land back on the first, or every loop
// snaps. The generator runs k from 0 to ORBIT_STOPS inclusive, which is what
// makes that true -- an exclusive loop would stop one step short.
ok("the lap closes", /k <= ORBIT_STOPS/.test(SRC));

const orbitDecl = (liquid.match(/tqLiquidOrbit[^;]*/) || [""])[0];
// THE TRAP. `alternate` runs every second lap backwards, so the colours sweep
// one way, reverse, and never actually go round -- which still looks like
// motion, so it passes a glance. And an eased curve makes a circle surge and
// stall twice a lap.
ok("it goes round rather than reversing", !/alternate/.test(orbitDecl));
ok("at constant speed, and forever", /linear/.test(orbitDecl) && /infinite/.test(orbitDecl));

// ── the dispersal ────────────────────────────────────────────────────────────
// It has to finish exactly as the next screen lands, or the signup wizard
// inherits a half-cleared ground.
const num = (k) => {
  const m = SRC.match(new RegExp("const " + k + " = (\\d+);"));
  return m ? +m[1] : null;
};
const disperseMs = (liquid.match(/tqLiquidOut (\d+)ms/) || [])[1];
ok("the dispersal is as long as the exit plus the hold",
  +disperseMs === num("SCREEN_OUT_MS") + num("SCREEN_HOLD_MS"));
// THE SNAP. The dispersal rule rewrites animation-name, and dropping the orbit
// from that list stops it -- background-position then falls back to the static
// value in the base rule, which is the start of the lap. Measured in Chrome: a
// quarter of the way round, every wash jumped 70.76% of the viewport in the
// click frame and dispersed from there. Listing the orbit again holds them in
// place (0.19% of drift, which is one frame of ordinary travel).
const disperseRule = SRC.slice(SRC.indexOf(".tq-liquid-disperse::before"),
  SRC.indexOf("}", SRC.indexOf(".tq-liquid-disperse::before")));
ok("the dispersal keeps the orbit running, so the washes do not snap first",
  /tqLiquidOrbit/.test(disperseRule));
ok("it expands as it clears, rather than just fading",
  /transform: scale\(2/.test(liquid) && /opacity: 0;/.test(liquid));
// Every screen the welcome screen can leave for must arrive clear, or the wash
// disperses and then reappears.
ok("the welcome screen triggers it on the way out",
  /tq-page tq-liquid-disperse/.test(SRC));

// ── the mark, in email ───────────────────────────────────────────────────────
// A Netlify function cannot import from the React bundle, so the invite email
// restates the four colours. Two copies of a palette is exactly the drift this
// file exists to stop, so they are compared here -- the only place that sees
// both.
const EMAIL = readFileSync(new URL("../netlify/functions/_utils/email-invite.js", import.meta.url), "utf8");
const emailBars = EMAIL.slice(EMAIL.indexOf("const BARS = ["), EMAIL.indexOf("];", EMAIL.indexOf("const BARS = [")));
const emailHexes = [...emailBars.matchAll(/"(#[0-9A-F]{6})"/g)].map((m) => m[1]);
const emailWidths = [...emailBars.matchAll(/w: ([\d.]+)/g)].map((m) => +m[1]);
ok("the invite email uses the same four colours, in the same order",
  JSON.stringify(emailHexes) === JSON.stringify(hexes));
ok("...and the same bar proportions",
  JSON.stringify(emailWidths) === JSON.stringify(widths));

// ── typefaces ────────────────────────────────────────────────────────────────
// ASKING FOR A FONT THAT IS NOT LOADED FAILS SILENTLY. The computed style still
// reports the family you wrote; the browser just draws a fallback. These screens
// had accumulated three faces -- JetBrains Mono on the field labels, Space Mono
// on the step counter, a bare ui-monospace on the org code -- and index.html
// loads DM Sans and Space Grotesk only, so each rendered in whatever the machine
// happened to have. Nothing in the build, the lint or the console said a word.
//
// TRAQS has one typeface. Every theme in TRAQS.jsx sets both its font and its
// mono to DM Sans; Space Grotesk is the wordmark and is loaded.
const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const loaded = new Set(
  [...HTML.matchAll(/family=([A-Za-z+]+)/g)].map((m) => m[1].replace(/\+/g, " ")));
ok("index.html loads the faces the design uses", loaded.has("DM Sans") && loaded.has("Space Grotesk"));

// Generic families and system stacks are instructions to the browser, not
// requests for a file, so they need no loading.
const GENERIC = new Set(["system-ui", "sans-serif", "serif", "monospace", "cursive", "fantasy",
  "ui-monospace", "ui-sans-serif", "ui-serif", "-apple-system", "BlinkMacSystemFont",
  "inherit", "initial", "unset"]);
// Faces that ship with the OS. Naming one of these is a deliberate choice that
// works without a stylesheet -- TRAQS.jsx uses Georgia for the italic glyph in
// the formatting toolbar, which is exactly what a web-safe serif is for.
const WEB_SAFE = new Set(["Georgia", "Arial", "Helvetica", "Helvetica Neue", "Times New Roman",
  "Courier New", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Menlo", "Consolas",
  "Monaco", "SFMono-Regular"]);

const stacksIn = (rel) => {
  const text = readFileSync(new URL(rel, import.meta.url), "utf8")
    // Comments name the removed fonts on purpose, explaining why they went.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");
  return [...text.matchAll(/(?:fontFamily|font|mono):\s*"([^"]*(?:sans|serif|mono|Mono|Sans|Grotesk|Georgia)[^"]*)"/g)]
    .map((m) => m[1].split(",").map((f) => f.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean));
};

// RULE ONE, everywhere: the FIRST family in a stack is the one that gets used,
// so it has to actually exist. Later entries are fallbacks and may name anything.
const notReal = [];
for (const rel of ["../src/App.jsx", "../src/SignupSteps.jsx", "../src/TRAQS.jsx"]) {
  for (const stack of stacksIn(rel)) {
    const first = stack[0];
    if (GENERIC.has(first) || WEB_SAFE.has(first) || loaded.has(first)) continue;
    notReal.push(rel.replace("../", "") + ": " + first);
  }
}
ok("every stack leads with a face that exists"
  + (notReal.length ? " -- found " + [...new Set(notReal)].join(", ") : ""),
  notReal.length === 0);

// RULE TWO, on the auth screens: ONE TYPEFACE. This is the check that would have
// caught all three drifted faces, including the bare ui-monospace on the org
// code -- which passes rule one, since a generic monospace does resolve to
// something. It just resolves to something that is not TRAQS.
const OK_HERE = new Set([...GENERIC].filter((g) => g !== "monospace" && g !== "ui-monospace"));
const foreign = [];
for (const rel of ["../src/App.jsx", "../src/SignupSteps.jsx"]) {
  for (const stack of stacksIn(rel)) {
    for (const fam of stack) {
      if (OK_HERE.has(fam) || loaded.has(fam)) continue;
      foreign.push(rel.replace("../", "") + ": " + fam);
    }
  }
}
ok("the auth screens name no face but DM Sans and the wordmark's"
  + (foreign.length ? " -- found " + [...new Set(foreign)].join(", ") : ""),
  foreign.length === 0);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
