/**
 * Generates the PWA icons.
 *
 * Written by hand rather than pulled from an image library: the mark is a few
 * rectangles, and a build-time dependency for that would be silly. Encodes a
 * minimal RGBA PNG (IHDR/IDAT/IEND) with node's zlib.
 *
 * Run: npm run icons
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BG = [0xf7, 0xf8, 0xf5, 0xff];
const ACCENT = [0x5f, 0x8f, 0x7b, 0xff];
const ACCENT_DIM = [0xc9, 0xdd, 0xcf, 0xff];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: compression, filter, interlace — all zero.

  // Each scanline is prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The mark: a trimester strip — bars rising toward the crunch weeks. It is the
 * app's central idea, and it stays legible at 48px.
 *
 * `safeRatio` keeps the art inside the maskable safe zone (the middle 80%),
 * so Android can crop it to a circle without eating the mark.
 */
function drawIcon(size, { maskable }) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels.set(BG, i * 4);
  }

  const safeRatio = maskable ? 0.6 : 0.72;
  const artWidth = Math.round(size * safeRatio);
  const artHeight = Math.round(size * safeRatio * 0.62);
  const left = Math.round((size - artWidth) / 2);
  const bottom = Math.round((size + artHeight) / 2);

  const bars = 5;
  const gap = Math.max(1, Math.round(artWidth * 0.06));
  const barWidth = Math.floor((artWidth - gap * (bars - 1)) / bars);
  // Rising heights, with the tallest bar last: the Week 12 wall.
  const heights = [0.28, 0.44, 0.36, 0.66, 1];

  for (let b = 0; b < bars; b += 1) {
    const x0 = left + b * (barWidth + gap);
    const h = Math.round(artHeight * heights[b]);
    const y0 = bottom - h;
    const colour = b === bars - 1 ? ACCENT : ACCENT_DIM;

    for (let y = y0; y < bottom; y += 1) {
      for (let x = x0; x < x0 + barWidth; x += 1) {
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        pixels.set(colour, (y * size + x) * 4);
      }
    }
  }

  return encodePng(size, size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192, maskable: false },
  { name: "icon-512.png", size: 512, maskable: false },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: false },
];

for (const target of targets) {
  const png = drawIcon(target.size, { maskable: target.maskable });
  writeFileSync(join(OUT_DIR, target.name), png);
  console.log(`${target.name} (${target.size}px, ${png.length} bytes)`);
}
