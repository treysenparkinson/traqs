/* Generates the PWA / Microsoft Store icon set into public/icons/.
 *
 * Source is the brand icon spec sheet (Sky _ dark.png, 900×900), which is the
 * cream rounded-square mark centred on a dark card with a colour swatch label
 * printed underneath it. We crop the mark out by bounding-box rather than with
 * hardcoded offsets so a re-export of the spec sheet at a different size still
 * lands on the mark instead of silently baking in the swatch text.
 *
 * Deliberately separate from make-logos.cjs: that script owns src/logo.js (the
 * base64 wordmarks) and rewrites it wholesale. Sharing it would mean this icon
 * build could drop UL_LOGO_WHITE.
 */
import sharp from "sharp";
import { mkdirSync } from "fs";

const SRC =
  "C:/Users/treysen/OneDrive - Matrix Systems/Matrix System Files - Documents/0 Admin/Logo/TRAQS Logo/Sky _ dark.png";
const OUT = "public/icons";

// Matches theme_color / background_color in manifest.json and the Capacitor
// splash + status bar. Keep these three in step or the launch flashes.
const BRAND_DARK = "#0f172a";

// The mark is the only near-white region on the sheet; the swatch caption is
// mid-grey (~150) and the teal dot ~122, so 200 isolates the card cleanly.
const BRIGHT = 200;

async function markBounds() {
  const { data, info } = await sharp(SRC)
    .flatten({ background: "#000" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 <= BRIGHT) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const box = await markBounds();
  console.log(`▸ mark found at ${box.left},${box.top} — ${box.width}×${box.height}`);

  const mark = await sharp(SRC).extract(box).png().toBuffer();

  // "any" purpose: the mark fills the frame, since the OS draws it as-is.
  for (const size of [192, 512]) {
    await sharp(mark)
      .resize(size, size, { fit: "contain", background: BRAND_DARK })
      .png({ compressionLevel: 9 })
      .toFile(`${OUT}/icon-${size}.png`);
    console.log(`  icon-${size}.png`);
  }

  // "maskable": the OS may crop to a circle whose diameter is 80% of the frame,
  // which would shave the corners off the rounded square. Inset the mark to 72%
  // so the whole card survives the worst-case mask, and fill the margin with the
  // brand dark so the bleed reads as intentional rather than as a transparent gap.
  const inset = Math.round(512 * 0.72);
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: BRAND_DARK },
  })
    .composite([{ input: await sharp(mark).resize(inset, inset).toBuffer(), gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/icon-maskable-512.png`);
  console.log("  icon-maskable-512.png");

  // Browser tab / taskbar favicon. index.html previously pointed at a
  // /favicon.svg that was never in public/ — a 404 on every page load.
  await sharp(mark).resize(48, 48).png({ compressionLevel: 9 }).toFile(`${OUT}/favicon-48.png`);
  console.log("  favicon-48.png");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
