#!/usr/bin/env node
/**
 * build-logo-pngs.mjs
 *
 * Regenerates the two canonical PNG renders of the Kryton wordmark from the
 * canonical SVG at logos/kryton_logo.svg.
 *
 * Outputs (idempotent — running twice yields byte-identical PNGs):
 *   - logos/kryton_banner_dark.png       1200x400  bg #0d1117, ~80px padding
 *   - logos/kryton_logo_transparent.png  1024 wide, transparent bg
 *
 * Accent colour applied: #A78BFA (the sRGB approximation of oklch(0.72 0.18 295)
 * used elsewhere in the brand). The source SVG uses `currentColor`, which we
 * substitute textually before rasterisation so output does not depend on the
 * renderer's `color`/oklch handling.
 *
 * Dependency: `sharp` (already present in the kryton workspace root
 * node_modules — installed transitively). If sharp is unavailable the script
 * falls back to `rsvg-convert`. If neither is available we exit(1) with a
 * helpful message.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LOGOS_DIR = join(REPO_ROOT, 'logos');
const SRC_SVG = join(LOGOS_DIR, 'kryton_logo.svg');
const OUT_BANNER = join(LOGOS_DIR, 'kryton_banner_dark.png');
const OUT_TRANSPARENT = join(LOGOS_DIR, 'kryton_logo_transparent.png');

const ACCENT = '#A78BFA';        // oklch(0.72 0.18 295) approx in sRGB
const WORDMARK_FILL = '#F5F4F7'; // oklch(0.96 0.005 280) approx in sRGB
const BG_DARK = '#0d1117';

// --- Resolve sharp from the workspace root (script is ESM; sharp is CJS) ---
let sharp = null;
try {
  const require = createRequire(import.meta.url);
  sharp = require(join(REPO_ROOT, 'node_modules', 'sharp'));
} catch {
  try {
    const require = createRequire(import.meta.url);
    sharp = require('sharp');
  } catch {
    sharp = null;
  }
}

function haveRsvgConvert() {
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!sharp && !haveRsvgConvert()) {
  console.error(
    'ERROR: neither `sharp` nor `rsvg-convert` is available.\n' +
      'Install one of:\n' +
      '  - sharp (npm i sharp at the repo root), or\n' +
      '  - rsvg-convert (brew install librsvg).'
  );
  process.exit(1);
}

if (!existsSync(SRC_SVG)) {
  console.error(`ERROR: missing source SVG at ${SRC_SVG}`);
  process.exit(1);
}

// --- Prepare a deterministic, renderer-friendly variant of the source SVG ---
const rawSvg = readFileSync(SRC_SVG, 'utf8');

// Substitute currentColor -> ACCENT, and replace any oklch() colours with the
// sRGB hex approximations used by the brand. This makes the output deterministic
// regardless of whether the rasteriser supports oklch.
function normaliseSvg(svgText) {
  let s = svgText;
  // Drop root color attribute since we're inlining currentColor explicitly.
  s = s.replace(/\scolor="[^"]*"/g, '');
  s = s.replace(/currentColor/g, ACCENT);
  // Replace the wordmark oklch() with its sRGB hex approximation.
  s = s.replace(/fill="oklch\([^)]*\)"/g, `fill="${WORDMARK_FILL}"`);
  s = s.replace(/stroke="oklch\([^)]*\)"/g, `stroke="${WORDMARK_FILL}"`);
  return s;
}

const normalisedSvg = normaliseSvg(rawSvg);

// Parse intrinsic dimensions from the SVG (width="200" height="40").
const widthMatch = normalisedSvg.match(/\bwidth="(\d+(?:\.\d+)?)"/);
const heightMatch = normalisedSvg.match(/\bheight="(\d+(?:\.\d+)?)"/);
if (!widthMatch || !heightMatch) {
  console.error('ERROR: could not parse width/height from source SVG');
  process.exit(1);
}
const SRC_W = parseFloat(widthMatch[1]);
const SRC_H = parseFloat(heightMatch[1]);

// --- Rasterise helpers ---------------------------------------------------

async function rasteriseSharp(svgText, targetWidth) {
  const scale = targetWidth / SRC_W;
  const targetHeight = Math.round(SRC_H * scale);
  return sharp(Buffer.from(svgText), { density: Math.round(72 * scale) })
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

function rasteriseRsvg(svgText, targetWidth) {
  // Fallback: shell out to rsvg-convert. Write the normalised SVG to a temp
  // file then read PNG bytes from stdout.
  const tmpSvg = join(LOGOS_DIR, '.build-logo-pngs.tmp.svg');
  writeFileSync(tmpSvg, svgText);
  try {
    return execFileSync('rsvg-convert', ['-w', String(targetWidth), '-f', 'png', tmpSvg]);
  } finally {
    try {
      // best-effort cleanup
      execFileSync('rm', ['-f', tmpSvg], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
}

async function rasterise(svgText, targetWidth) {
  if (sharp) return rasteriseSharp(svgText, targetWidth);
  return rasteriseRsvg(svgText, targetWidth);
}

// --- Build the transparent PNG (1024 wide) -------------------------------

async function buildTransparent() {
  const buf = await rasterise(normalisedSvg, 1024);
  writeFileSync(OUT_TRANSPARENT, buf);
}

// --- Build the dark banner PNG (1200x400) --------------------------------

async function buildBanner() {
  const BANNER_W = 1200;
  const BANNER_H = 400;
  const PADDING = 80;

  // Width-fit the wordmark inside the banner with padding on both sides;
  // pick the smaller of width-fit and height-fit so the logo never overflows.
  const maxLogoW = BANNER_W - PADDING * 2;
  const maxLogoH = BANNER_H - PADDING * 2;
  const fitByWidth = maxLogoW / SRC_W;
  const fitByHeight = maxLogoH / SRC_H;
  const scale = Math.min(fitByWidth, fitByHeight);
  const logoW = Math.round(SRC_W * scale);
  const logoH = Math.round(SRC_H * scale);

  if (sharp) {
    const logoPng = await sharp(Buffer.from(normalisedSvg), {
      density: Math.round(72 * scale),
    })
      .resize(logoW, logoH, { fit: 'fill' })
      .png()
      .toBuffer();

    const banner = await sharp({
      create: {
        width: BANNER_W,
        height: BANNER_H,
        channels: 4,
        background: BG_DARK,
      },
    })
      .composite([
        {
          input: logoPng,
          top: Math.round((BANNER_H - logoH) / 2),
          left: Math.round((BANNER_W - logoW) / 2),
        },
      ])
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();

    writeFileSync(OUT_BANNER, banner);
    return;
  }

  // rsvg-convert fallback: wrap the source SVG in an outer SVG that paints
  // the dark background and translates the wordmark into the centre.
  const wrapped = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_W}" height="${BANNER_H}" viewBox="0 0 ${BANNER_W} ${BANNER_H}">
  <rect width="100%" height="100%" fill="${BG_DARK}"/>
  <g transform="translate(${(BANNER_W - logoW) / 2} ${(BANNER_H - logoH) / 2}) scale(${scale})">
    ${normalisedSvg.replace(/<\?xml[^?]*\?>/, '').replace(/<svg[^>]*>/, '<g>').replace(/<\/svg>/, '</g>')}
  </g>
</svg>`;
  const buf = rasteriseRsvg(wrapped, BANNER_W);
  writeFileSync(OUT_BANNER, buf);
}

// --- main ---------------------------------------------------------------

await buildTransparent();
await buildBanner();
console.log('wrote 2 PNGs');
