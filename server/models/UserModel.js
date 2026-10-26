const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');

class UserModel {
  constructor() {
    this.filePath = path.join(config.DATA_DIR, 'users.json');
    this.examplePath = path.join(config.DATA_DIR, 'users.example.json');
    this.ensureFile();
  }

  ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      if (fs.existsSync(this.examplePath)) {
        fs.copyFileSync(this.examplePath, this.filePath);
      } else {
        fs.writeFileSync(this.filePath, JSON.stringify([]), 'utf-8');
      }
    }
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

  getAll() {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  saveAll(users) {
    fs.writeFileSync(this.filePath, JSON.stringify(users, null, 2), 'utf-8');
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
