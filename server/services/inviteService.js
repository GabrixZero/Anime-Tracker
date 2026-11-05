// Cadastro por convite (S14). Os códigos válidos vêm do ambiente (INVITE_CODES, separados por vírgula); cada um vale UMA vez.
// Os já usados ficam em invites.json (pela camada server/storage, na pasta de dados) só como hash SHA-256: o arquivo não revela códigos.
// Sem INVITE_CODES o convite está desligado e o cadastro é livre (uso local).
const crypto = require('crypto');
const path = require('path');
const config = require('../config/config');
const storage = require('../storage');

const CODE_MAX = 128;
const sha256 = value => crypto.createHash('sha256').update(String(value), 'utf8').digest();

const usedFile = () => path.join(config.DATA_DIR, 'invites.json');

function readUsed() {
  const stored = storage.readJson(usedFile());
  return stored && Array.isArray(stored.data) ? stored.data : [];
}

const isEnabled = () => config.INVITE_CODES.length > 0;

// O código informado é um dos configurados? Compara os hashes (tamanho fixo) em tempo constante e sempre percorre a lista toda.
function matchConfigured(code) {
  if (typeof code !== 'string' || code === '' || code.length > CODE_MAX) return null;
  const probe = sha256(code.trim());
  let found = null;
  for (const configured of config.INVITE_CODES) {
    const digest = sha256(configured);
    if (crypto.timingSafeEqual(probe, digest)) found = digest.toString('hex');
  }
  return found;
}

// Reserva o código (marca como usado) ANTES de criar a conta, de forma síncrona: dois cadastros simultâneos com o mesmo código não passam os dois.
// Devolve o identificador a passar para release() se o cadastro falhar, ou null se o código é inválido/já usado.
function reserve(code) {
  const id = matchConfigured(code);
  if (!id) return null;
  const used = readUsed();
  if (used.includes(id)) return null;
  storage.writeJsonAtomic(usedFile(), [...used, id]);
  return id;
}

// Devolve o código quando o cadastro não aconteceu (ex.: e-mail já usado), para a pessoa poder tentar de novo.
function release(id) {
  if (!id) return;
  storage.writeJsonAtomic(
    usedFile(),
    readUsed().filter(x => x !== id)
  );
}

module.exports = { isEnabled, reserve, release, CODE_MAX };
