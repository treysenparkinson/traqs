// THE LIQUID GROUND. Four washes in the mark's own colours, drifting behind the
// sign-in screens (App.jsx). Its own module so the suites can import and run it.
//
// The colours are passed in from BRAND_BARS by each caller, not typed here -- one
// palette, and the background cannot drift away from the logo sitting on top of
// it. (This is plain JS so the suites can import it; brand.jsx is JSX.)
//
// SMALL AND SATURATED, NOT LARGE AND PALE. The first cut used blobs near a
// viewport across; at that size all four overlap everywhere and average out to
// one muddy orange-brown, which is the opposite of four brand colours. Shrinking
// them and raising the alpha is what makes them read as distinct -- less of the
// screen is covered, so the effect is subtler, while each colour is actually
// identifiable where it does appear.
//
// THE CENTRE IS MASKED CLEAR. Colours sliding around behind the wordmark made
// it look like it was moving; it reads as fixed only if what is
// behind it is. The mask is an ellipse over the content column, transparent in
// the middle and opaque at the edges, so the wash lives around the content
// rather than under it.
//
// Each blob is its own background layer with its own size and position, so they
// move independently; animating one transform on the whole layer would slide the
// four of them in lockstep, which reads as a texture being dragged rather than
// as anything liquid. The page ground stays underneath: these are washes over
// it, not a replacement for it.
const blob = (hex, a) => `radial-gradient(closest-side circle at 50% 50%, ${hex}${a}, ${hex}00)`;

// THE ORBIT. All four washes travel one shared circle, a quarter turn apart, so
// the colours sweep continuously past each other and past the content.
//
// Generated rather than typed. Thirteen keyframes of four positions each is 52
// numbers; by hand that is 52 chances to put one blob slightly off the circle,
// which shows up as a wobble nobody can find the source of. Here the circle is
// stated once, as an equation.
//
// The path is a circle in BACKGROUND-POSITION space, where 0% is flush left and
// 100% flush right. On a wide screen the horizontal travel is longer than the
// vertical, so what is drawn as a circle is seen as a wide ellipse -- which is
// what you want, since it follows the shape of the viewport rather than cutting
// a round hole out of the middle of it.
export const ORBIT_STOPS = 12;   // 30 degrees apart: smooth enough that the straight
                                 // interpolation between stops is not visible as a corner
export const ORBIT_SECONDS = 54;

// The dispersal. On the sign-in screens this is SCREEN_OUT_MS + SCREEN_HOLD_MS
// (App.jsx asserts it in brand-test), so the ground finishes clearing exactly as
// the next screen arrives on it.
export const LIQUID_OUT_MS = 900;

const orbitAt = (j) => {
  const t = (2 * Math.PI * j) / ORBIT_STOPS;
  // Radius 50 in each axis, so the blobs ride the edge of the viewport and stay
  // clear of the masked centre the whole way round.
  return `${(50 + 50 * Math.cos(t)).toFixed(1)}% ${(50 + 50 * Math.sin(t)).toFixed(1)}%`;
};

// Blob i starts a quarter turn (ORBIT_STOPS / 4) ahead of blob i-1.
const orbitPositions = (k, n) =>
  Array.from({ length: n }, (_, i) => orbitAt((k + i * (ORBIT_STOPS / 4)) % ORBIT_STOPS)).join(", ");

const orbitKeyframes = (n) => {
  const rows = [];
  for (let k = 0; k <= ORBIT_STOPS; k++) {
    // +(...) drops the trailing zeros without a regex.
    rows.push(`  ${+((k * 100) / ORBIT_STOPS).toFixed(3)}% { background-position: ${orbitPositions(k, n)}; }`);
  }
  return rows.join("\n");
};

// Transparent in the middle, opaque at the rim. Stated once and used for both
// the standard property and the WebKit one.
export const CENTRE_CLEAR =
  "radial-gradient(ellipse 40% 44% at 50% 48%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 58%, rgba(0,0,0,1) 100%)";

/**
 * The wash's CSS.
 *   colors   — the four BRAND_BARS colours, in order.
 *   layer    — the selector that draws it (a ::before, or an element of its own).
 *   disperse — the selector that, added, blows it away.
 *   position — "fixed" covers the window; "absolute" covers the layer's box.
 */
export function liquidCss({ colors, layer, disperse, position = "fixed" }) {
  const [c0, c1, c2, c3] = colors;
  return `
${layer} {
  content: "";
  position: ${position};
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    ${blob(c0, "d9")},
    ${blob(c1, "cc")},
    ${blob(c2, "e6")},
    ${blob(c3, "bf")};
  background-repeat: no-repeat;
  background-size: 30vmax 30vmax, 34vmax 34vmax, 38vmax 38vmax, 27vmax 27vmax;
  /* Where the orbit starts, so there is nothing to jump from on the first frame. */
  background-position: ${orbitPositions(0, 4)};
  -webkit-mask-image: ${CENTRE_CLEAR};
  mask-image: ${CENTRE_CLEAR};
  /* The gradients are already soft; the blur takes the last of the banding out
     of them and is what makes the edges read as liquid rather than as circles. */
  filter: blur(26px);
  /* LINEAR AND INFINITE, NOT ALTERNATE. A circle wants constant speed -- an
     eased curve makes the colours surge and stall twice a lap -- and alternate
     would run the second lap backwards, so they would sweep one way, reverse,
     and never actually go round. (No backticks in here: this comment lives
     inside a template literal, and one would end the string.) */
  animation: tqLiquidIn 900ms ease-out both,
             tqLiquidOrbit ${ORBIT_SECONDS}s linear infinite;
}

@keyframes tqLiquidOrbit {
${orbitKeyframes(4)}
}
@keyframes tqLiquidIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* DISPERSES LIKE SMOKE. The wash blows outward, thins and clears.

   THE ORBIT KEEPS RUNNING THROUGH IT, and that is load-bearing. Replacing the
   animation list with the dispersal alone stops tqLiquidOrbit, which drops
   background-position back to the static value in the base rule -- the start of
   the lap. Every blob snapped to that spot and dispersed from there, wherever it
   actually was. Listing the orbit again keeps it animating, so each wash blows
   apart from where it stands.

   Nothing fights: the orbit owns background-position, the dispersal owns
   opacity, transform and filter. And the dispersal is six degrees of a 54s lap,
   so the continued travel is not something you can see -- it is there to hold
   position, not to move. tqLiquidIn is dropped from the list on purpose: it
   fills opacity at 1 and would outrank the dispersal, which is later but loses
   to a filled animation earlier in the cascade of the same property. */
${disperse} {
  animation: tqLiquidOrbit ${ORBIT_SECONDS}s linear infinite,
             tqLiquidOut ${LIQUID_OUT_MS}ms cubic-bezier(.4,0,.6,1) both;
}
/* The midpoint is what makes it smoke rather than a fade. Expansion runs ahead
   of the thinning -- over half the growth is spent in the first 45% while the
   wash is still more than half there -- so you watch it billow outward and then
   thin, instead of it simply disappearing at its original size. A straight
   two-stop version cleared by 400ms and read as a blink. */
@keyframes tqLiquidOut {
  0%   { opacity: 1;    transform: scale(1);    filter: blur(26px); }
  45%  { opacity: 0.66; transform: scale(1.58); filter: blur(56px); }
  100% { opacity: 0;    transform: scale(2.2);  filter: blur(100px); }
}

@media (prefers-reduced-motion: reduce) {
  ${layer} { animation: tqLiquidIn 900ms ease-out both; }  /* orbit stopped */
  ${disperse} { animation: none; opacity: 0; }
}
`;
}
