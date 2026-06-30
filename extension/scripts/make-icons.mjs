#!/usr/bin/env node
// Regenerates the extension's PNG icons with zero dependencies.
//
// Why hand-roll a PNG encoder: the Chrome Web Store requires 16/48/128px PNG
// icons, but we don't want to pull an image library (or a binary blob nobody
// can diff) into the repo just to draw a flat badge. Node's built-in `zlib`
// gives us DEFLATE; a PNG is just a few length-prefixed chunks around that.
// Run `node extension/scripts/make-icons.mjs` to rebuild public/icons/*.png.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../public/icons");

// Campaign palette: red badge (#C8102E), white ring + mark.
const RED = [0xc8, 0x10, 0x2e, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];

// CRC-32 (PNG uses the standard IEEE polynomial), table built once.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Encode an RGBA pixel buffer (size*size*4) as a non-interlaced 8-bit PNG.
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type 6 = RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Each scanline is prefixed with a filter byte (0 = none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Draw the badge into an RGBA buffer: a rounded-square red field with a white
// ring, anti-aliased by supersampling each pixel on a 4x4 grid. Coverage of
// the field controls alpha (so the outer edge is smooth); the white ring is
// alpha-blended over the red where it falls.
function drawBadge(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const half = size * 0.46; // half-extent of the square field
  const corner = size * 0.22; // rounded-square corner radius
  const ringOuter = size * 0.4;
  const ringInner = size * 0.3;

  const SS = 4; // supersampling factor per axis
  const total = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let field = 0;
      let ring = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - 0.5;
          const py = y + (sy + 0.5) / SS - 0.5;
          const dx = Math.abs(px - c);
          const dy = Math.abs(py - c);
          // Rounded-square coverage via a clamped corner radius.
          const qx = Math.max(dx - (half - corner), 0);
          const qy = Math.max(dy - (half - corner), 0);
          if (dx <= half && dy <= half && Math.hypot(qx, qy) <= corner) field++;
          const r = Math.hypot(px - c, py - c);
          if (r >= ringInner && r <= ringOuter) ring++;
        }
      }
      const fieldA = field / total;
      const ringA = ring / total;
      let color = fieldA > 0 ? RED : CLEAR;
      if (ringA > 0) {
        // Blend the white ring over the red field by ring coverage.
        color = [
          Math.round(RED[0] * (1 - ringA) + WHITE[0] * ringA),
          Math.round(RED[1] * (1 - ringA) + WHITE[1] * ringA),
          Math.round(RED[2] * (1 - ringA) + WHITE[2] * ringA),
          255,
        ];
      }
      const i = (y * size + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      // Outer edge anti-aliasing comes from the field coverage; full opacity
      // inside, fades to transparent at the rounded corners.
      rgba[i + 3] = Math.round(255 * fieldA);
    }
  }
  return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePng(size, drawBadge(size));
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
