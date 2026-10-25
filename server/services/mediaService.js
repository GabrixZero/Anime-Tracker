const fs = require('fs');
const path = require('path');
const https = require('https');
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

  saveCatalog() {
    try {
      fs.writeFileSync(this.catalogPath, JSON.stringify(this.catalog, null, 2), 'utf-8');
    } catch (err) {
      console.error('Falha ao salvar mediaCatalog.json:', err.message);
    }
  }

  // Utilitário para chamadas HTTPS externas com timeout
  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'ShowVault/2.0' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Resposta inválida da API externa'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error('Timeout na API externa'));
      });
    });
  }

  // Busca destaques / trending
  async getTrending(type = 'all') {
    if (type === 'all') return this.catalog;
    return this.catalog.filter(item => item.type === type);
  }

  // Busca híbrida: Procura no catálogo local primeiro. Se necessário, busca na API externa.
  async search(query = '', type = 'all') {
    const q = query.trim().toLowerCase();
    if (!q) {
      return this.getTrending(type);
    }

    // 1. Busca Local no mediaCatalog
    let localResults = this.catalog.filter(item => 
      item.name.toLowerCase().includes(q) ||
      (item.overview && item.overview.toLowerCase().includes(q)) ||
      (item.genres && item.genres.some(g => g.toLowerCase().includes(q)))
    );

    if (type !== 'all') {
      localResults = localResults.filter(item => item.type === type);
    }

    // Se encontramos várias obras locais correspondentes, retornamos
    if (localResults.length >= 8) {
      return localResults;
    }

    // 2. Busca na API externa (TVMaze) para enriquecer o catálogo
    const externalResults = [];
    try {
      const searchUrl = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`;
      const tvmazeData = await this.fetchJson(searchUrl);

      if (Array.isArray(tvmazeData)) {
        tvmazeData.slice(0, 10).forEach(entry => {
          const s = entry.show;
          if (!s) return;

          // Se já existe localmente, evita duplicata
          const alreadyLocal = this.catalog.some(c => c.id === s.id || c.name.toLowerCase() === s.name.toLowerCase());
          if (alreadyLocal) return;

          const isAnime = s.type === 'Animation' || (s.genres && s.genres.some(g => ['Anime', 'Animation', 'Action'].includes(g) && s.webChannel?.country?.code === 'JP'));
          const mediaType = isAnime ? 'anime' : 'tv';

          if (type !== 'all' && type !== mediaType) return;

          externalResults.push({
            id: s.id,
            type: mediaType,
            name: s.name,
            overview: s.summary ? s.summary.replace(/<[^>]*>?/gm, '').trim() : 'Sem descrição cadastrada.',
            poster_path: s.image ? (s.image.original || s.image.medium) : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500',
            backdrop_path: s.image ? (s.image.original || s.image.medium) : 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?w=600',
            vote_average: s.rating?.average || 8.0,
            first_air_date: s.premiered || '',
            genres: (s.genres && s.genres.length) ? s.genres : ['Drama'],
            status: s.status || 'Em Exibição',
            isExternal: true
          });
        });
      }
    } catch (err) {
      console.warn('Busca externa TVMaze falhou ou indisponível:', err.message);
    }

    return [...localResults, ...externalResults];
  }

  // Busca detalhada por ID
  async getById(id) {
    const numId = Number(id);
    let item = this.catalog.find(m => m.id === numId);
    if (item) return item;

    // Se não estiver no catálogo, tenta ingestão imediata
    try {
      item = await this.ingest(numId);
      return item;
    } catch (e) {
      return null;
    }
  }

  // Ingestão sob demanda: Baixa todos os episódios e grava permanentemente no mediaCatalog.json
  async ingest(id) {
    const numId = Number(id);
    const existing = this.catalog.find(m => m.id === numId);
    if (existing && existing.seasons && existing.seasons.length > 0) {
      return existing;
    }

    const detailUrl = `https://api.tvmaze.com/shows/${numId}?embed=episodes`;
    const data = await this.fetchJson(detailUrl);
    if (!data || !data.name) {
      throw new Error(`Obra externa ${id} não encontrada para ingestão.`);
    }

    const seasonsMap = new Map();
    const rawEpisodes = data._embedded?.episodes || [];

    rawEpisodes.forEach(ep => {
      const sNum = ep.season || 1;
      if (!seasonsMap.has(sNum)) {
        seasonsMap.set(sNum, {
          season_number: sNum,
          name: `Temporada ${sNum}`,
          episodes: []
        });
      }

      seasonsMap.get(sNum).episodes.push({
        episode_number: ep.number || 1,
        name: ep.name || `Episódio ${ep.number}`,
        runtime: ep.runtime || data.averageRuntime || 45,
        air_date: ep.airdate || '',
        overview: ep.summary ? ep.summary.replace(/<[^>]*>?/gm, '').trim() : '',
        still_path: ep.image ? (ep.image.medium || ep.image.original) : (data.image?.original || '')
      });
    });

    const isAnime = data.type === 'Animation' || (data.genres && data.genres.includes('Anime'));
    const mediaType = isAnime ? 'anime' : 'tv';

    const fullMedia = {
      id: data.id,
      type: mediaType,
      name: data.name,
      overview: data.summary ? data.summary.replace(/<[^>]*>?/gm, '').trim() : '',
      poster_path: data.image ? (data.image.original || data.image.medium) : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500',
      backdrop_path: data.image ? (data.image.original || data.image.medium) : 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?w=600',
      vote_average: data.rating?.average || 8.0,
      first_air_date: data.premiered || '',
      genres: (data.genres && data.genres.length) ? data.genres : ['Drama'],
      status: data.status || 'Em Exibição',
      seasons: Array.from(seasonsMap.values())
    };

    if (existing) {
      Object.assign(existing, fullMedia);
    } else {
      this.catalog.push(fullMedia);
    }

    this.saveCatalog();
    console.log(`[MediaService] Mídia ingerida e gravada com sucesso em mediaCatalog.json: ${fullMedia.name} (${fullMedia.seasons.length} temporadas)`);
    return fullMedia;
  }
}

module.exports = new MediaService();
