// Rasterises the app icon (same shapes as public/icon.svg) to PNGs without any dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const inRoundRect = (x, y, x0, y0, w, h, r) => {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
// Bookmark: rounded top (156..376, 112..), bottom notch from (136,400)->(256,324)->(376,400)
const inBookmark = (x, y) => {
  if (x < 136 || x > 376 || y < 112 || y > 400) return false;
  if (!inRoundRect(x, y, 136, 112, 240, 300, 20)) return false;
  const notchY = 324 + (Math.abs(x - 256) / 120) * 76; // V cut
  return y <= notchY;
};
const inAccent = (x, y) => inRoundRect(x, y, 196, 176, 120, 28, 14);

function render(size, { bleed = false } = {}) {
  const ss = 4, scale = 512 / size;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const x = (i + (sx + 0.5) / ss) * scale, y = (j + (sy + 0.5) / ss) * scale;
      if (!bleed && !inRoundRect(x, y, 0, 0, 512, 512, 112)) continue;
      let c = [17, 17, 17];
      if (inBookmark(x, y)) c = inAccent(x, y) ? [254, 44, 85] : [255, 255, 255];
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = ss * ss, k = (j * size + i) * 4, cov = a / n / 255 || 1;
    px[k] = r / n / cov; px[k + 1] = g / n / cov; px[k + 2] = b / n / cov; px[k + 3] = a / n;
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('public/icon-192.png', render(192));
writeFileSync('public/icon-512.png', render(512));
writeFileSync('public/apple-touch-icon.png', render(180, { bleed: true })); // iOS rounds corners itself
console.log('icons written');
