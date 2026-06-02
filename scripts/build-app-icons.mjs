/**
 * App icon asset generator (quick task 260602-e4h).
 *
 * Rasterises build/icon.svg (the ivory-squircle "A" brand monogram) into the
 * platform app-icon assets electron-builder and the BrowserWindow need:
 *   - build/icon.png   1024x1024 — Linux app icon, BrowserWindow runtime icon,
 *                                  AND the source electron-builder auto-converts
 *                                  to .icns on the macOS runner.
 *   - build/icon.ico   multi-size (16/24/32/48/64/128/256) — Windows exe +
 *                                  installer + NSIS shortcut + taskbar icon.
 *
 * Run via `npm run icons:app`. Outputs are committed to git so packaged builds
 * pick them up: electron-builder auto-detects build/icon.ico (win) and
 * build/icon.png (mac→icns, linux), and both are copied to resources/ via the
 * extraResources filter so resolveBrandIcon() can load the runtime window icon.
 *
 * Why hand-rolled (not electron-icon-builder): electron-icon-builder relies on
 * Jimp which cannot decode SVG ("Could not find MIME for Buffer null"). sharp +
 * to-ico is the same one-shot path scripts/build-tray-icons.mjs already uses.
 */
import sharp from 'sharp';
import toIco from 'to-ico';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILD_DIR = path.resolve(__dirname, '..', 'build');

// .ico carries multiple resolutions; Windows picks the best for each surface
// (16/32 taskbar + tray, 48 alt-tab, 256 high-DPI / large-icons view).
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// macOS .icns + Linux app icon want a single large master; electron-builder
// requires the png master to be >=512 to derive the full icns ladder.
const PNG_SIZE = 1024;

async function svgToPng(svgPath, size) {
  // density 384 ≈ 256px viewBox upscaled cleanly to 1024 without blurring the
  // serif "A" edges (matches build-tray-icons.mjs).
  return sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  const iconSvg = path.join(BUILD_DIR, 'icon.svg');

  // build/icon.png (1024) — mac→icns source, linux icon, runtime window icon.
  const pngBuf = await svgToPng(iconSvg, PNG_SIZE);
  await fs.writeFile(path.join(BUILD_DIR, 'icon.png'), pngBuf);
  console.log('wrote icon.png', `(${PNG_SIZE}x${PNG_SIZE})`);

  // build/icon.ico — multi-size Windows app icon.
  const icoBuffers = await Promise.all(ICO_SIZES.map((s) => svgToPng(iconSvg, s)));
  const ico = await toIco(icoBuffers);
  await fs.writeFile(path.join(BUILD_DIR, 'icon.ico'), ico);
  console.log('wrote icon.ico', `(${ICO_SIZES.length} sizes: ${ICO_SIZES.join('/')})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
