const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('../config/config');
const { readJson, writeJsonAtomic } = require('../utils/jsonStore');
const { DataCorruptionError } = require('../utils/errors');

const scrypt = promisify(crypto.scrypt);
const DEMO_EMAIL = 'demo@showvault.local';

class EmailTakenError extends Error {
  constructor() {
    super('E-mail já cadastrado.');
    this.name = 'EmailTakenError';
    this.code = 'EMAIL_TAKEN';
  }
}

class UserModel {
  // seedDemo: cria a conta de demonstração do users.example.json na primeira execução (só com SEED_DEMO_USER=1; nunca em produção).
  constructor(dataDir = config.DATA_DIR, { seedDemo = config.SEED_DEMO_USER } = {}) {
    this.filePath = path.join(dataDir, 'users.json');
    this.examplePath = path.join(dataDir, 'users.example.json');
    this.seedDemo = seedDemo;
    this._authIndex = null;
    try {
      this.ensureFile();
    } catch (err) {
      // Não derruba o servidor, mas deixa o erro claro; getAll()/saveAll() falham enquanto o arquivo estiver ilegível.
      console.error('[UserModel] Não foi possível preparar users.json:', err.message);
    }
  }

  // Cria users.json só se NÃO existir (vazio, ou com a conta demo se SEED_DEMO_USER=1). Arquivo ilegível nunca é recriado.
  ensureFile() {
    const existing = readJson(this.filePath);
    if (existing !== null) {
      if (config.IS_PRODUCTION && Array.isArray(existing.data) && existing.data.some(u => u && u.email === DEMO_EMAIL)) {
        console.warn(`[UserModel] Existe a conta de demonstração (${DEMO_EMAIL}) em users.json: apague-a, a senha dela é pública.`);
      }
      return;
    }
    let initial = [];
    if (this.seedDemo && fs.existsSync(this.examplePath)) {
      const example = readJson(this.examplePath);
      if (example && Array.isArray(example.data)) initial = example.data;
    }
    writeJsonAtomic(this.filePath, initial);
  }

  // --- senhas (scrypt assíncrono: não trava o servidor) ---

  async hashPassword(password) {
    if (!password) return '';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt, 64);
    return `${salt}:${hash.toString('hex')}`;
  }

  isLegacyPassword(stored) {
    return !!stored && !stored.includes(':');
  }

  async verifyPassword(password, stored) {
    if (typeof password !== 'string' || !password || typeof stored !== 'string' || !stored) return false;
    // Compatibilidade com senha legada em texto puro (migrada para hash no login)
    if (this.isLegacyPassword(stored)) {
      const a = Buffer.from(password);
      const b = Buffer.from(stored);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    const [salt, key] = stored.split(':');
    const expected = Buffer.from(key || '', 'hex');
    if (!salt || expected.length === 0) return false;
    const hash = await scrypt(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, hash);
  }

  // Gasta o mesmo tempo de uma verificação real (usado quando o e-mail não existe, para o tempo de resposta não revelar contas).
  async verifyDummy(password) {
    if (!this._dummyHash) this._dummyHash = await this.hashPassword(crypto.randomBytes(16).toString('hex'));
    await this.verifyPassword(typeof password === 'string' ? password : 'x', this._dummyHash);
    return false;
  }

  // markChanged=true (troca de senha de verdade) invalida os tokens emitidos antes; a migração silenciosa de senha legada não.
  async updatePassword(id, password, { markChanged = false } = {}) {
    const hashed = await this.hashPassword(password);
    const users = this.getAll();
    const user = users.find(u => u.id === id);
    if (!user) return false;
    user.password = hashed;
    if (markChanged) user.passwordChangedAt = new Date().toISOString();
    this.saveAll(users);
    return true;
  }

  // --- arquivo ---

  // Lança DataCorruptionError se users.json existir mas estiver ilegível (e sem .bak válido): nunca devolve [] nesse caso,
  // senão o próximo cadastro sobrescreveria todas as contas.
  getAll() {
    const result = readJson(this.filePath);
    if (result === null) return [];
    if (!Array.isArray(result.data)) {
      throw new DataCorruptionError(this.filePath, new Error('users.json não é uma lista'));
    }
    return result.data;
  }

  saveAll(users) {
    if (!Array.isArray(users)) throw new Error('Lista de usuários inválida.');
    writeJsonAtomic(this.filePath, users);
    this._authIndex = null;
  }

  findByEmail(email) {
    if (typeof email !== 'string' || !email) return null;
    const wanted = email.toLowerCase();
    return this.getAll().find(u => typeof u.email === 'string' && u.email.toLowerCase() === wanted) || null;
  }

  findById(id) {
    if (!id) return null;
    return this.getAll().find(u => u.id === id) || null;
  }

  findByGoogleId(googleId) {
    if (typeof googleId !== 'string' || !googleId) return null;
    return this.getAll().find(u => u.googleId === googleId) || null;
  }

  // Dados mínimos para validar um token a cada requisição: { id, passwordChangedAtSec } ou null se a conta não existe mais.
  // Fica em cache enquanto users.json não muda (comparando tamanho e data de modificação).
  authInfo(id) {
    if (typeof id !== 'string' || !id) return null;
    let stamp = 'missing';
    try {
      const st = fs.statSync(this.filePath);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch { /* arquivo ainda não existe */ }

    if (!this._authIndex || this._authIndex.stamp !== stamp) {
      const map = new Map();
      for (const u of this.getAll()) {
        const changed = u.passwordChangedAt ? Math.floor(Date.parse(u.passwordChangedAt) / 1000) : 0;
        map.set(u.id, { id: u.id, passwordChangedAtSec: Number.isFinite(changed) ? changed : 0 });
      }
      this._authIndex = { stamp, map };
    }
    return this._authIndex.map.get(id) || null;
  }

  // O hash da senha é feito ANTES (assíncrono); a checagem de e-mail duplicado + gravação é síncrona,
  // então dois cadastros simultâneos com o mesmo e-mail não conseguem passar os dois.
  async create(userData) {
    const { password, ...rest } = userData;
    const hashed = password ? await this.hashPassword(password) : undefined;

    const users = this.getAll();
    const email = typeof rest.email === 'string' ? rest.email.toLowerCase() : '';
    if (email && users.some(u => typeof u.email === 'string' && u.email.toLowerCase() === email)) {
      throw new EmailTakenError();
    }

    const newUser = {
      id: `usr_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`,
      createdAt: new Date().toISOString(),
      ...rest,
      email,
      ...(hashed ? { password: hashed } : {})
    };
    users.push(newUser);
    this.saveAll(users);
    return newUser;
  }

  // Remove a conta. Devolve true se existia.
  delete(id) {
    const users = this.getAll();
    const remaining = users.filter(u => u.id !== id);
    if (remaining.length === users.length) return false;
    this.saveAll(remaining);
    return true;
  }

  // Versão sem a senha e sem campos internos, segura para devolver à API.
  toPublic(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      provider: user.provider,
      createdAt: user.createdAt
    };
  }
}

module.exports = new UserModel();
module.exports.UserModel = UserModel;
module.exports.EmailTakenError = EmailTakenError;
