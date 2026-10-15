// The engineering chip spans its panel's window — #109, ruled 2026-10-15 ("the chip spans the
// panel's whole window. A sign-off applies to the panel for as long as the panel is live, so a
// span is truer than a date").
//
// It sat on ONE day: the start of the op titled "Wire", falling back to the panel's start —
// data coupled to a display title, and a point where the thing it marks has a duration. A
// panel's own dates are rolled up from its ops (rollUpJobDates), so the window is
// panel.start..panel.end. Positioned by chipSpanPct over the visible day columns, clamped at
// both edges. A panel with no start has no window and gets no chip — which is also the end of
// #107's NaN position (no Wire op, null panel start).
//
//   node scripts/eng-chip-span-test.mjs

import { readFileSync } from "node:fs";
import { chipSpanPct } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// A seven-column window, Mon 2026-10-12 .. Sun 2026-10-18.
const DAYS = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
const r = chipSpanPct({ start: "2026-10-13", end: "2026-10-15" }, DAYS);
ok("#109 the chip starts at the panel's first day", near(r.leftPct, 100 / 7));
ok("#109 ...and spans to the end of its last day (three columns)", near(r.widthPct, 300 / 7));
const before = chipSpanPct({ start: "2026-10-01", end: "2026-10-13" }, DAYS);
ok("a panel that began before the window is clamped to its left edge", near(before.leftPct, 0) && near(before.widthPct, 200 / 7));
const after = chipSpanPct({ start: "2026-10-17", end: "2026-11-30" }, DAYS);
ok("...and one that runs past it to its right edge", near(after.leftPct, 500 / 7) && near(after.widthPct, 200 / 7));
ok("a single-day panel is one column", near(chipSpanPct({ start: "2026-10-14", end: "2026-10-14" }, DAYS).widthPct, 100 / 7));
ok("a panel with no end spans its start day", near(chipSpanPct({ start: "2026-10-14", end: null }, DAYS).widthPct, 100 / 7));
ok("a panel wholly outside the window has no chip", chipSpanPct({ start: "2026-09-01", end: "2026-09-05" }, DAYS) === null);
ok("#107 a panel with no start has no chip, rather than a NaN position", chipSpanPct({ start: null, end: null }, DAYS) === null);

// The builder no longer reads an op's title, and the render uses the span (comments stripped).
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = S.replace(/^\s*\/\/.*$/gm, "");
const bAt = code.indexOf("if (person && person.isEngineer) {");
const builder = code.slice(bAt, code.indexOf("bars.sort(", bAt));
ok("#109 the chip builder no longer looks for an op titled Wire", !/title === "Wire"/.test(builder));
ok("#109 ...and carries the panel's window", /start: panel\.start/.test(builder) && /chipEnd = panel\.end/.test(builder) && /end: chipEnd/.test(builder));
const cAt = code.indexOf('if (bar.type === "eng-chip") {');
const chip = code.slice(cAt, code.indexOf("</div>;", cAt));
ok("#109 the chip is positioned by chipSpanPct", /chipSpanPct\(/.test(chip));
ok("#109 ...its left edge is the span's", /left:[^,]*_chipSpan\.leftPct/.test(chip));
ok("#109 ...and its width is the span's, not a fixed pill", /width:[^,]*_chipSpan\.widthPct/.test(chip) && !/maxWidth: 160/.test(chip));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
