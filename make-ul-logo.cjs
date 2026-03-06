const sharp = require('sharp');
const fs = require('fs');

const SRC = 'C:/Users/treysen/OneDrive - Matrix Systems/Matrix System Files - Documents/0 Admin/Logo/TRAQS Logo/UL-logo.png';
const OUT_DIR = 'C:/Users/treysen/traqs/src';
const TARGET_H = 40;

async function run() {
  // ── Step 1: read raw RGBA, detect content pixels ─────────────────────────
  const { data, info } = await sharp(SRC)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info; // channels = 4 (RGBA)

  // Determine whether the source uses alpha transparency or white bg
  let usesAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) { usesAlpha = true; break; }
  }
  console.log(`Source: ${width}×${height}, ${channels}ch, usesAlpha=${usesAlpha}`);

  // Find tight bounding box of content pixels
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      let isContent;
      if (usesAlpha) {
        isContent = data[i + 3] > 10; // alpha-based detection
      } else {
        // RGB-based: any pixel noticeably non-white
        isContent = data[i] < 252 || data[i+1] < 252 || data[i+2] < 252;
      }
      if (isContent) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const PAD = 40;
  const left = Math.max(0, minX - PAD);
  const top  = Math.max(0, minY - PAD);
  const cW   = Math.min(width,  maxX + PAD + 1) - left;
  const cH   = Math.min(height, maxY + PAD + 1) - top;
  const tW   = Math.round(TARGET_H * (cW / cH));
  console.log(`Crop ${cW}×${cH} → resize to ${tW}×${TARGET_H}`);

  // ── Step 2: crop + resize, keep RGBA ─────────────────────────────────────
  const croppedBuf = await sharp(SRC)
    .extract({ left, top, width: cW, height: cH })
    .resize(tW, TARGET_H, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = croppedBuf.info.channels; // 4 if RGBA preserved

  // ── Step 3: white version (white fill, transparent bg) ───────────────────
  const rgbaWhite = Buffer.alloc(tW * TARGET_H * 4);
  for (let i = 0; i < tW * TARGET_H; i++) {
    let alpha;
    if (usesAlpha && ch === 4) {
      alpha = croppedBuf.data[i * ch + 3]; // use source alpha directly
    } else {
      const r = croppedBuf.data[i * ch];
      const g = croppedBuf.data[i * ch + 1];
      const b = croppedBuf.data[i * ch + 2];
      const brightness = (r + g + b) / 3;
      alpha = brightness < 252 ? Math.min(255, Math.round((252 - brightness) * 8)) : 0;
    }
    rgbaWhite[i*4]   = 255;
    rgbaWhite[i*4+1] = 255;
    rgbaWhite[i*4+2] = 255;
    rgbaWhite[i*4+3] = alpha;
  }

  await sharp(rgbaWhite, { raw: { width: tW, height: TARGET_H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT_DIR}/ul-logo-white.png`);

  const whiteB64 = fs.readFileSync(`${OUT_DIR}/ul-logo-white.png`).toString('base64');
  console.log(`White: ${(whiteB64.length / 1024).toFixed(1)}KB`);

  // ── Step 4: append export to logo.js ─────────────────────────────────────
  let logoJs = fs.readFileSync(`${OUT_DIR}/logo.js`, 'utf8');

  // Remove any previous UL_LOGO_WHITE export
  logoJs = logoJs.replace(/\nexport const UL_LOGO_WHITE[^\n]*\n?/g, '');

  logoJs += `\nexport const UL_LOGO_WHITE = "data:image/png;base64,${whiteB64}";\n`;
  fs.writeFileSync(`${OUT_DIR}/logo.js`, logoJs, 'utf8');

  console.log(`Done — ul-logo-white.png + logo.js updated (${tW}×${TARGET_H}px)`);
}

run().catch(e => { console.error(e); process.exit(1); });
