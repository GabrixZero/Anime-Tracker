// Foto de perfil por conta: <DATA_DIR>/avatars/<userId>.<ext> (png, jpg ou webp).
// O tipo é decidido pelos primeiros bytes do arquivo (nunca pelo nome nem pelo Content-Type enviado); SVG e qualquer outro formato são recusados.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');

const MAX_BYTES = 200 * 1024;
const TYPES = {
  png: { mime: 'image/png' },
  jpg: { mime: 'image/jpeg' },
  webp: { mime: 'image/webp' }
};
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/; // ids de conta (usr_...): impede path traversal

// Devolve 'png' | 'jpg' | 'webp' ou null (SVG, texto, bytes falsos...).
function detectType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

class AvatarService {
  constructor(dataDir = config.DATA_DIR) {
    this.dir = path.join(dataDir, 'avatars');
  }

  fileFor(userId, ext) {
    if (typeof userId !== 'string' || !ID_PATTERN.test(userId) || !TYPES[ext]) throw new Error('Identificador de foto inválido.');
    return path.join(this.dir, `${userId}.${ext}`);
  }

  // Grava de forma atômica (tmp + rename) e apaga a foto antiga de outra extensão. Devolve a extensão.
  save(userId, buf) {
    const ext = detectType(buf);
    if (!ext) return null;
    const target = this.fileFor(userId, ext);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, target);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    this.remove(userId, { except: ext });
    return ext;
  }

  // { buffer, mime } ou null se não houver foto.
  read(userId, ext) {
    if (!TYPES[ext]) return null;
    try {
      return { buffer: fs.readFileSync(this.fileFor(userId, ext)), mime: TYPES[ext].mime };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // Apaga a foto da conta (todas as extensões, menos `except`). Devolve quantos arquivos saíram.
  remove(userId, { except } = {}) {
    let removed = 0;
    for (const ext of Object.keys(TYPES)) {
      if (ext === except) continue;
      const file = this.fileFor(userId, ext);
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    }
    return removed;
  }
}

module.exports = new AvatarService();
module.exports.AvatarService = AvatarService;
module.exports.detectType = detectType;
module.exports.MAX_BYTES = MAX_BYTES;
