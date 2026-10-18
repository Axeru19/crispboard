// Genera assets/icon.png, icon.ico e tray.png senza dipendenze (SDF + supersampling + zlib).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
fs.mkdirSync(out, { recursive: true });

const MINT = [70, 214, 160];
const INK = [11, 40, 32];

const rr = (px, py, cx, cy, hw, hh, r) => {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};

function render(size, { background = true } = {}) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          let col = null;
          if (!background || rr(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) <= 0) col = background ? MINT : null;
          // tavoletta
          if (rr(u, v, 0.5, 0.56, 0.25, 0.3, 0.07) <= 0) col = INK;
          // clip in alto
          if (rr(u, v, 0.5, 0.27, 0.13, 0.06, 0.03) <= 0) col = background ? MINT : INK;
          if (rr(u, v, 0.5, 0.27, 0.095, 0.035, 0.02) <= 0) col = INK;
          // righe di testo
          if (rr(u, v, 0.5, 0.5, 0.15, 0.02, 0.02) <= 0) col = MINT;
          if (rr(u, v, 0.46, 0.62, 0.11, 0.02, 0.02) <= 0) col = MINT;
          if (rr(u, v, 0.5, 0.74, 0.15, 0.02, 0.02) <= 0) col = MINT;
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const cov = a / (255 * n);
      buf[i] = cov ? Math.round(r / (cov * n)) : 0;
      buf[i + 1] = cov ? Math.round(g / (cov * n)) : 0;
      buf[i + 2] = cov ? Math.round(b / (cov * n)) : 0;
      buf[i + 3] = Math.round(cov * 255);
    }
  }
  return buf;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const dirs = images.map(({ size, data }) => {
    const d = Buffer.alloc(16);
    d[0] = size >= 256 ? 0 : size; d[1] = size >= 256 ? 0 : size;
    d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(data.length, 8); d.writeUInt32LE(offset, 12);
    offset += data.length;
    return d;
  });
  return Buffer.concat([head, ...dirs, ...images.map((i) => i.data)]);
}

const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => ({ size: s, data: png(s, render(s)) }));
fs.writeFileSync(path.join(out, 'icon.png'), pngs.at(-1).data);
fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));
fs.writeFileSync(path.join(out, 'tray.png'), png(32, render(32)));
console.log('icone generate in', out);
