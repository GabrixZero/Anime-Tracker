const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');
const { readJson, writeJsonAtomic } = require('../utils/jsonStore');
const { DataCorruptionError } = require('../utils/errors');

class UserModel {
  constructor(dataDir = config.DATA_DIR) {
    this.filePath = path.join(dataDir, 'users.json');
    this.examplePath = path.join(dataDir, 'users.example.json');
    try {
      this.ensureFile();
    } catch (err) {
      // Não derruba o servidor, mas deixa o erro claro; getAll()/saveAll() falham enquanto o arquivo estiver ilegível.
      console.error('[UserModel] Não foi possível preparar users.json:', err.message);
    }
  }

  // Cria users.json (a partir do exemplo versionado) só se NÃO existir. Arquivo ilegível nunca é recriado.
  ensureFile() {
    if (readJson(this.filePath) !== null) return;
    let initial = [];
    if (fs.existsSync(this.examplePath)) {
      const example = readJson(this.examplePath);
      if (example && Array.isArray(example.data)) initial = example.data;
    }
    writeJsonAtomic(this.filePath, initial);
  }

  hashPassword(password) {
    if (!password) return '';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  isLegacyPassword(stored) {
    return !!stored && !stored.includes(':');
  }

  verifyPassword(password, stored) {
    if (!password || !stored) return false;
    // Compatibilidade com senha legada em texto puro (migrada para hash no login)
    if (this.isLegacyPassword(stored)) {
      const a = Buffer.from(password);
      const b = Buffer.from(stored);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    const [salt, key] = stored.split(':');
    const hash = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(key, 'hex');
    return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
  }

  updatePassword(id, password) {
    const users = this.getAll();
    const user = users.find(u => u.id === id);
    if (!user) return false;
    user.password = this.hashPassword(password);
    this.saveAll(users);
    return true;
  }

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
  }

  findByEmail(email) {
    if (!email) return null;
    const users = this.getAll();
    return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
  }

  findById(id) {
    if (!id) return null;
    const users = this.getAll();
    return users.find(u => u.id === id) || null;
  }

  create(userData) {
    const users = this.getAll();
    const newUser = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      ...userData,
      password: userData.password ? this.hashPassword(userData.password) : undefined
    };
    users.push(newUser);
    this.saveAll(users);
    return newUser;
  }
}

module.exports = new UserModel();
module.exports.UserModel = UserModel;
