const sharp = require('sharp');
const fs = require('fs');

const SRC = 'C:/Users/treysen/OneDrive - Matrix Systems/Matrix System Files - Documents/0 Admin/Logo/TRAQS Logo/TRAQS Logo Black.png';
const OUT_DIR = 'C:/Users/treysen/traqs/src';

// Target height for the exported images.
// Header shows at 32px, sidebar at 40px.
// Width scales proportionally from the bounding box crop.
const TARGET_H = 40;

async function run() {
  // ── Step 1: find tight bounding box of dark pixels ──────────────────────
  const { data, info } = await sharp(SRC)
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let minX = width, maxX = 0, minY = height, maxY = 0;
  const THRESH = 240;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i] < THRESH || data[i+1] < THRESH || data[i+2] < THRESH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const PAD = 30;
  const left   = Math.max(0, minX - PAD);
  const top    = Math.max(0, minY - PAD);
  const cW     = Math.min(width,  maxX + PAD + 1) - left;
  const cH     = Math.min(height, maxY + PAD + 1) - top;
  const aspect = cW / cH;
  const tW     = Math.round(TARGET_H * aspect);
  console.log(`Crop ${cW}×${cH} → resize to ${tW}×${TARGET_H}`);

  // ── Step 2: black logo (dark text, transparent bg) ─────────────────────
  const croppedBuf = await sharp(SRC)
    .extract({ left, top, width: cW, height: cH })
    .resize(tW, TARGET_H, { kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert to RGBA: dark pixels = black+opaque, light pixels = transparent
  const rgbaBlack = Buffer.alloc(tW * TARGET_H * 4);
  for (let i = 0; i < tW * TARGET_H; i++) {
    const r = croppedBuf.data[i * croppedBuf.info.channels];
    const g = croppedBuf.data[i * croppedBuf.info.channels + 1];
    const b = croppedBuf.data[i * croppedBuf.info.channels + 2];
    const brightness = (r + g + b) / 3;
    const alpha = brightness < 250 ? Math.min(255, Math.round((250 - brightness) * 3)) : 0;
    // Dark pixel → near black; light → transparent
    rgbaBlack[i*4]   = Math.round(r * (alpha/255));
    rgbaBlack[i*4+1] = Math.round(g * (alpha/255));
    rgbaBlack[i*4+2] = Math.round(b * (alpha/255));
    rgbaBlack[i*4+3] = alpha;
  }
  await sharp(rgbaBlack, { raw: { width: tW, height: TARGET_H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT_DIR}/traqs-logo-black.png`);

  // ── Step 3: white logo (white text, transparent bg) ────────────────────
  const rgbaWhite = Buffer.alloc(tW * TARGET_H * 4);
  for (let i = 0; i < tW * TARGET_H; i++) {
    const r = croppedBuf.data[i * croppedBuf.info.channels];
    const g = croppedBuf.data[i * croppedBuf.info.channels + 1];
    const b = croppedBuf.data[i * croppedBuf.info.channels + 2];
    const brightness = (r + g + b) / 3;
    const alpha = brightness < 250 ? Math.min(255, Math.round((250 - brightness) * 3)) : 0;
    // Text pixels → white
    rgbaWhite[i*4] = 255; rgbaWhite[i*4+1] = 255; rgbaWhite[i*4+2] = 255;
    rgbaWhite[i*4+3] = alpha;
  }
  await sharp(rgbaWhite, { raw: { width: tW, height: TARGET_H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT_DIR}/traqs-logo-white.png`);

  // ── Step 4: encode and write logo.js ───────────────────────────────────
  const blackB64 = fs.readFileSync(`${OUT_DIR}/traqs-logo-black.png`).toString('base64');
  const whiteB64 = fs.readFileSync(`${OUT_DIR}/traqs-logo-white.png`).toString('base64');
  console.log(`Black: ${(blackB64.length/1024).toFixed(1)}KB  White: ${(whiteB64.length/1024).toFixed(1)}KB`);

  fs.writeFileSync(`${OUT_DIR}/logo.js`,
`// Shared TRAQS logo assets — high-res PNG (${tW}×${TARGET_H}) for crisp rendering on all displays
export const TRAQS_LOGO_BLUE  = "data:image/png;base64,${blackB64}";
export const TRAQS_LOGO_WHITE = "data:image/png;base64,${whiteB64}";
`, 'utf8');

  console.log(`logo.js written — ${tW}×${TARGET_H}px, 4× display quality`);
}

run().catch(e => { console.error(e); process.exit(1); });
