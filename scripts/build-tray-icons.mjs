/**
 * Phase 12 / Plan 12-02 Task 0 — Tray icon asset generator.
 *
 * Rasterises build/icon.svg + build/icon-badged.svg into platform tray assets:
 *   - build/tray-icon.ico            (Windows plain, multi-size 16/24/32/48)
 *   - build/tray-icon-badged.ico     (Windows queued, multi-size)
 *   - build/tray-iconTemplate.png    (macOS @1x, 22x22, Template-named for auto-invert)
 *   - build/tray-iconTemplate@2x.png (macOS @2x, 44x44)
 *
 * Run via `npm run icons:tray`. Outputs are committed to git so packaged builds
 * pick them up via electron-builder's `extraResources` (see package.json).
 *
 * Why hand-rolled: electron-icon-builder relies on Jimp which does not handle
 * SVG ("Could not find MIME for Buffer null"). sharp + to-ico is a one-shot
 * fallback the project memo `project_aria_brand_icon.md` flagged would be
 * needed eventually. See 12-02-PLAN.md Task 0 fallback path.
 */
import sharp from 'sharp';
import toIco from 'to-ico';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILD_DIR = path.resolve(__dirname, '..', 'build');

const ICO_SIZES = [16, 24, 32, 48];

async function svgToPng(svgPath, size) {
  return sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function makeIco(svgPath, outPath) {
  const buffers = await Promise.all(ICO_SIZES.map((s) => svgToPng(svgPath, s)));
  const ico = await toIco(buffers);
  await fs.writeFile(outPath, ico);
  console.log('wrote', path.relative(BUILD_DIR, outPath), `(${buffers.length} sizes)`);
}

async function makePng(svgPath, size, outPath) {
  const buf = await svgToPng(svgPath, size);
  await fs.writeFile(outPath, buf);
  console.log('wrote', path.relative(BUILD_DIR, outPath), `(${size}x${size})`);
}

async function main() {
  const iconSvg = path.join(BUILD_DIR, 'icon.svg');
  const badgedSvg = path.join(BUILD_DIR, 'icon-badged.svg');

  // Windows .ico — plain + badged
  await makeIco(iconSvg, path.join(BUILD_DIR, 'tray-icon.ico'));
  await makeIco(badgedSvg, path.join(BUILD_DIR, 'tray-icon-badged.ico'));

  // macOS Template PNGs — filename MUST end in `Template` so AppKit auto-inverts
  await makePng(iconSvg, 22, path.join(BUILD_DIR, 'tray-iconTemplate.png'));
  await makePng(iconSvg, 44, path.join(BUILD_DIR, 'tray-iconTemplate@2x.png'));
  await makePng(badgedSvg, 22, path.join(BUILD_DIR, 'tray-iconBadgedTemplate.png'));
  await makePng(badgedSvg, 44, path.join(BUILD_DIR, 'tray-iconBadgedTemplate@2x.png'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
