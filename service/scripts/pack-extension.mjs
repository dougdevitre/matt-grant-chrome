#!/usr/bin/env node
// Package the built extension into a downloadable zip, with no npm dependency
// and no `zip` binary required (so it runs in the App Runner build image).
//
// A .zip is just length-prefixed records: a local header + DEFLATE-compressed
// bytes per file, then a central directory, then an end-of-central-directory
// record. Node's `node:zlib` gives raw DEFLATE and we hand-roll the headers —
// the same "encode the binary format ourselves" approach as
// extension/scripts/make-icons.mjs.
//
// Input:  extension/dist  (produced by `npm run build:extension`)
// Output: service/public/download/matt-grant-clerk-extension.zip
//         (entries live under a top-level `matt-grant-clerk-extension/` folder
//          so unzipping yields one clean folder to "Load unpacked").
// Run after building the extension: `node service/scripts/pack-extension.mjs`.

import { deflateRawSync } from "node:zlib";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../../extension/dist");
const OUT_DIR = resolve(HERE, "../public/download");
const OUT = resolve(OUT_DIR, "matt-grant-clerk-extension.zip");
const TOP = "matt-grant-clerk-extension"; // folder name inside the zip

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

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`error: ${DIST} not found — run \`npm run build:extension\` first`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`error: ${DIST} is empty`);
  process.exit(1);
}

const locals = [];
const central = [];
let offset = 0;

for (const abs of files.sort()) {
  const name = `${TOP}/${relative(DIST, abs).split("\\").join("/")}`;
  const nameBuf = Buffer.from(name, "utf8");
  const data = readFileSync(abs);
  const crc = crc32(data);
  const comp = deflateRawSync(data, { level: 9 });

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); // local file header signature
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0, 6); // flags
  lh.writeUInt16LE(8, 8); // method: deflate
  lh.writeUInt16LE(0, 10); // mod time (fixed)
  lh.writeUInt16LE(0x21, 12); // mod date (fixed, 1980-01-01)
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28); // extra length
  locals.push(lh, nameBuf, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); // central dir header signature
  ch.writeUInt16LE(20, 4); // version made by
  ch.writeUInt16LE(20, 6); // version needed
  ch.writeUInt16LE(0, 8); // flags
  ch.writeUInt16LE(8, 10); // method
  ch.writeUInt16LE(0, 12); // mod time
  ch.writeUInt16LE(0x21, 14); // mod date
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30); // extra length
  ch.writeUInt16LE(0, 32); // comment length
  ch.writeUInt16LE(0, 34); // disk number start
  ch.writeUInt16LE(0, 36); // internal attrs
  ch.writeUInt32LE(0, 38); // external attrs
  ch.writeUInt32LE(offset, 42); // local header offset
  central.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + comp.length;
}

const localBuf = Buffer.concat(locals);
const centralBuf = Buffer.concat(central);

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
eocd.writeUInt16LE(0, 4); // disk number
eocd.writeUInt16LE(0, 6); // disk with central dir
eocd.writeUInt16LE(files.length, 8); // entries on this disk
eocd.writeUInt16LE(files.length, 10); // total entries
eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
eocd.writeUInt32LE(localBuf.length, 16); // central dir offset
eocd.writeUInt16LE(0, 20); // comment length

mkdirSync(OUT_DIR, { recursive: true });
const zip = Buffer.concat([localBuf, centralBuf, eocd]);
writeFileSync(OUT, zip);
console.log(`wrote ${OUT} (${files.length} files, ${zip.length} bytes)`);
