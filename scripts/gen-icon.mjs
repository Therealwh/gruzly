// Generates the Gruzly brand icon as a 1024×1024 PNG without external deps:
// rounded square with cyan→violet gradient, two bear ears, down-arrow muzzle.
// Pure Node (zlib) PNG encoder.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons-src", "gruzly-1024.png");

// ---- palette (cyan → violet diagonal gradient) ----
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function gradient(x, y) {
  const t = (x / SIZE) * 0.6 + (y / SIZE) * 0.4;
  const stops = [
    [34, 211, 238], // #22d3ee
    [129, 140, 248], // #818cf8
    [167, 139, 250], // #a78bfa
  ];
  const seg = t < 0.55 ? 0 : 1;
  const local = seg === 0 ? t / 0.55 : (t - 0.55) / 0.45;
  const [r1, g1, b1] = stops[seg];
  const [r2, g2, b2] = stops[seg + 1];
  return [lerp(r1, r2, local) | 0, lerp(g1, g2, local) | 0, lerp(b1, b2, local) | 0];
}

// rounded-rect SDF for anti-aliased edges
function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
}
function circleSdf(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}
function clamp01(v) {
  return Math.min(Math.max(v, 0), 1);
}
function coverage(sdf) {
  return clamp01(0.5 - sdf); // 1px feather
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // body: rounded square
    const body = coverage(roundedRectSdf(x + 0.5, y + 0.5, SIZE / 2, SIZE / 2 + 40, 460, 460, 190));
    // ears: two circles behind the body top
    const earL = coverage(circleSdf(x + 0.5, y + 0.5, 240, 210, 150));
    const earR = coverage(circleSdf(x + 0.5, y + 0.5, SIZE - 240, 210, 150));
    const shape = Math.max(body, Math.max(earL, earR));

    if (shape <= 0) {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = 0;
      continue;
    }

    let [r, g, b] = gradient(x, y);

    // down arrow "muzzle" in near-black of the app bg
    const arrow = arrowCoverage(x + 0.5, y + 0.5);
    if (arrow > 0) {
      const a = arrow;
      r = lerp(r, 11, a);
      g = lerp(g, 15, a);
      b = lerp(b, 26, a);
    }

    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = shape * 255;
  }
}

function arrowCoverage(px, py) {
  // stem: vertical bar, fully inside the body (32-grid units)
  const S = SIZE / 32;
  const stem = roundedRectSdf(px, py, 16 * S, 21.8 * S, 2.1 * S, 5.4 * S, 2.1 * S);
  // chevron head
  const headLeft = segmentSdf(px, py, 11.6 * S, 23.4 * S, 16 * S, 27.4 * S, 2.1 * S);
  const headRight = segmentSdf(px, py, 16 * S, 27.4 * S, 20.4 * S, 23.4 * S, 2.1 * S);
  return Math.min(1, Math.max(coverage(stem), coverage(headLeft), coverage(headRight)));
}

function segmentSdf(px, py, ax, ay, bx, by, r) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const h = clamp01((apx * abx + apy * aby) / (abx * abx + aby * aby));
  return Math.hypot(apx - abx * h, apy - aby * h) - r;
}

// ---- PNG encode ----
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
// rows with filter byte 0
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0;
  pixels.copy(raw, y * (1 + SIZE * 4) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`written: ${OUT} (${SIZE}×${SIZE})`);
