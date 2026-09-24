// THE BRAND'S FOUR COLOURS, and the four bars of the mark, in order.
//
// Measured off TRAQS Scheduling/.../AppIcon.icon/Assets/traqs-candy-bars.png
// rather than matched by eye -- the sky is #38BDF8, which is exactly the accent
// the rest of the app already uses, and that would have been easy to miss and
// then drift from. Widths are fractions of the mark's full width; they match the
// ratios the iOS lockup has always used.
//
// Shared between App.jsx (the auth/signup screens) and TRAQS.jsx (the main app
// header, post-login) rather than defined in either — TRAQS.jsx already imports
// FROM App.jsx (default export) for the main app component, so App.jsx importing
// this back from TRAQS.jsx would be circular. A third file both sides import
// from avoids that without duplicating the colour constants.
export const BRAND_BARS = [
  { c: "#FF6B57", w: 0.552 },   // coral
  { c: "#F0A819", w: 0.789 },   // amber
  { c: "#38BDF8", w: 1 },       // sky -- same value as the app's accent
  { c: "#1D7D5C", w: 0.448 },   // green
];

// Drawn, not another PNG. The mark is four rounded rectangles; the geometry came
// off the same file (650 tall, 223 apart, 225 radius, in a 3900x3276 box), and
// vector means it is sharp at 17px in a footer and at 84px on the auth screen
// without shipping a cut for each.
const BARS_BOX = { w: 3900, h: 3276, bar: 650, gap: 223, r: 225 };

// Exported so a caller sizing the mark by height alone (a plain <svg> has no
// intrinsic aspect ratio to fall back on) can compute the matching width —
// `.52em * BARS_ASPECT`, the same relationship App.jsx's own lockup uses.
export const BARS_ASPECT = BARS_BOX.w / BARS_BOX.h;

export function TraqsBars({ style }) {
  const { w, h, bar, gap, r } = BARS_BOX;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={style} aria-hidden="true" focusable="false">
      {BRAND_BARS.map((b, i) => (
        <rect key={b.c} x="0" y={i * (bar + gap)} width={w * b.w} height={bar} rx={r} fill={b.c} />
      ))}
    </svg>
  );
}
