const fs = require('fs');
const path = require('path');
const config = require('../config/config');

class MediaService {
  constructor() {
    this.catalogPath = path.join(config.DATA_DIR, 'mediaCatalog.json');
    this.cache = new Map();
    this.loadCatalog();
  }

  loadCatalog() {
    try {
      const raw = fs.readFileSync(this.catalogPath, 'utf-8');
      this.catalog = JSON.parse(raw);
    } catch (err) {
      console.warn('Usando catálogo em memória fallback:', err.message);
      this.catalog = [];
    }
  }

  // Busca destaques / trending
  async getTrending(type = 'all') {
    if (type === 'all') return this.catalog;
    return this.catalog.filter(item => item.type === type);
  }

  // Busca por termo
  async search(query = '', type = 'all') {
    const q = query.trim().toLowerCase();
    let results = this.catalog;

    if (type !== 'all') {
      results = results.filter(item => item.type === type);
    }

    if (!q) return results;

    return results.filter(item => 
      item.name.toLowerCase().includes(q) ||
      (item.overview && item.overview.toLowerCase().includes(q)) ||
      (item.genres && item.genres.some(g => g.toLowerCase().includes(q)))
    );
  }

  // Busca detalhada por ID
  async getById(id) {
    const numId = Number(id);
    return this.catalog.find(item => item.id === numId) || null;
  }
}

module.exports = new MediaService();
