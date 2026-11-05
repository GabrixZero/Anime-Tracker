// Gera os ícones do app instalável (S18): PNG 192/512 e "maskable" 512, sem dependências (zlib do Node).
// Uso: node scripts/make-icons.js  -> grava em public/img/icons/. Desenho: fundo escuro e um "play" amarelo.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [10, 11, 16];
const FG = [255, 208, 0];

function crc32(buf) {
  let c,
    crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// scale = parte da imagem ocupada pelo triângulo (menor no "maskable", que o sistema recorta)
function png(size, scale) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cx = size / 2,
    h = size * scale;
  const x0 = cx - h * 0.3,
    x1 = cx + h * 0.45,
    ytop = cx - h / 2,
    ybot = cx + h / 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      let inside = false;
      if (x >= x0 && x <= x1 && y >= ytop && y <= ybot) {
        const t = (x - x0) / (x1 - x0); // 0..1 da base à ponta
        const half = (h / 2) * (1 - t);
        inside = Math.abs(y - cx) <= half;
      }
      const c = inside ? FG : BG;
      raw.set(c, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = path.join(__dirname, '..', 'public', 'img', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, 0.5));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, 0.5));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), png(512, 0.34));
console.log('Ícones gravados em', out);
