const fs = require('fs');
const path = require('path');
const config = require('../config/config');

class UserModel {
  constructor() {
    this.filePath = path.join(config.DATA_DIR, 'users.json');
    this.ensureFile();
  }

  ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([]));
    }
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
    fs.writeFileSync(this.filePath, JSON.stringify(users, null, 2));
  }

  findByEmail(email) {
    const users = this.getAll();
    return users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  findById(id) {
    const users = this.getAll();
    return users.find(u => u.id === id);
  }

  create(userData) {
    const users = this.getAll();
    const newUser = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      ...userData
    };
    users.push(newUser);
    this.saveAll(users);
    return newUser;
  }
}

module.exports = new UserModel();
