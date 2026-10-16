// Resize grips are a thin fixed strip, so the middle of a pill always MOVES it (#550).
//
// The grip used to be a third of the bar's width, up to 10px, on every bar 12px or wider. On a
// 30px pill that is two-thirds grip: a sideways move started near either end resized the op
// instead, rewrote its hours, and saved without a word. Ruled 2026-10-16 (plan D1): a fixed 6px
// grip, and only on bars at least 36px wide, so the move area is never under two-thirds.
// PTO bars keep the old widths — their resize is a different path and was not the complaint.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = await import(pathToFileURL(path.join(root, "src/dragMove.js")).href);
const WEB = fs.readFileSync(path.join(root, "src/TRAQS.jsx"), "utf8");

let pass = 0, fail = 0;
const check = (name, fn) => {
  let ok = false, why = "";
  try { const r = fn(); ok = r === true; if (!ok) why = ` (got ${JSON.stringify(r)})`; } catch (e) { why = ` (threw ${e.message})`; }
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${why}`); }
};
const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : { got: a, want: b });
const count = (src, s) => src.split(s).length - 1;

console.log("resizeGripPx: the rule");
check("a 10px op bar has no grip", () => eq(D.resizeGripPx(10), 0));
check("a 30px op bar has no grip (was 10px each end)", () => eq(D.resizeGripPx(30), 0));
check("35.9px: still none", () => eq(D.resizeGripPx(35.9), 0));
check("36px: a 6px grip", () => eq(D.resizeGripPx(36), 6));
check("200px: still 6px, it does not grow with the bar", () => eq(D.resizeGripPx(200), 6));
check("every op bar with grips keeps two-thirds of itself for moving", () => {
  for (let px = 0; px <= 400; px += 0.5) { const g = D.resizeGripPx(px); if (g > 0 && px - 2 * g < (2 / 3) * px) return { px, g }; }
  return true;
});
check("PTO 30px keeps the old third: 10px", () => eq(D.resizeGripPx(30, { pto: true }), 10));
check("PTO 9px keeps the old 3px floor", () => eq(D.resizeGripPx(9, { pto: true }), 3));
check("PTO 200px keeps the old 10px cap", () => eq(D.resizeGripPx(200, { pto: true }), 10));

console.log("TRAQS.jsx: every week/month grip reads the rule");
check("the head bar's grip width comes from resizeGripPx", () => count(WEB, "const _handleW = resizeGripPx(_renderPx, { pto: bar.type === \"pto\" });") === 1);
check("a bar with no grip is the narrow (move-only) bar", () => count(WEB, "const _isNarrowBar = _handleW === 0;") === 1);
check("the tail's grip width comes from resizeGripPx (PTO on its old rule)", () => count(WEB, "const _tailGripW = isPto2 ? (_tailPx >= 12 ? resizeGripPx(_tailPx, { pto: true }) : 0) : resizeGripPx(_tailPx);") === 1);
check("the tail grip only renders when it has a width", () => count(WEB, "{isLastSeg && _tailGripW > 0 && can(\"moveJobs\")") === 1);
check("no grip is a third of its bar any more", () => eq([count(WEB, "_renderPx / 3"), count(WEB, "_tailPx / 3")], [0, 0]));

console.log("TRAQS.jsx: grips show while the pill is hovered (C1)");
check("one stylesheet rule shows a pill's grips on hover", () => count(WEB, ".tq-pill:hover .grip { opacity: 1 !important; }") === 1);
check("the head bar and the tail both carry the class", () => count(WEB, "className=\"tq-pill\"") === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
