// Destaques da landing (D-CL-3): 3 títulos fixos com pôster do TMDB. Somente leitura, sem login.
// Cache: memória + arquivo na pasta de dados (ignorado pelo Git). Vale 7 dias; os termos do TMDB permitem guardar por no máximo 6 meses,
// então nada mais velho que isso é usado. Só guardamos o ENDEREÇO do pôster (image.tmdb.org), nunca o arquivo da imagem.
// Qualquer falha (sem chave, rede, resposta estranha, sem pôster) vira "título sem pôster": o endpoint nunca devolve erro.
const fs = require('fs');
const path = require('path');
const { LANDING_FEATURED } = require('../config/landingFeatured');

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 7 * DAY_MS;
const MAX_AGE_MS = 180 * DAY_MS; // limite dos termos do TMDB (6 meses)
const RETRY_AFTER_FAIL_MS = 60 * 1000; // depois de uma falha, não insiste por 1 minuto
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const POSTER_PATH = /^\/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/;
const CACHE_FILE = 'landing-featured.cache.json';

class LandingFeatured {
  constructor({ tmdb, dataDir, items = LANDING_FEATURED, now = Date.now } = {}) {
    this.tmdb = tmdb;
    this.items = items;
    this.now = now;
    this.file = dataDir ? path.join(dataDir, CACHE_FILE) : null;
    this.memory = null; // { [tmdbId]: { path, at } } — `path` null = TMDB não tem pôster para o título
    this.loaded = false;
    this.inflight = null;
    this.failedAt = 0;
  }

  loadFile() {
    if (this.loaded) return;
    this.loaded = true;
    this.memory = {};
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      for (const [id, v] of Object.entries(raw || {})) {
        if (v && Number.isFinite(v.at) && (v.path === null || POSTER_PATH.test(String(v.path))))
          this.memory[id] = { path: v.path, at: v.at };
      }
    } catch {
      /* sem arquivo (ou ilegível): começa vazio */
    }
  }

  saveFile() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.memory));
      fs.renameSync(tmp, this.file);
    } catch {
      /* cache é só otimização: se não gravar, segue em memória */
    }
  }

  entry(item) {
    const e = this.memory[item.tmdbId];
    return e && this.now() - e.at < MAX_AGE_MS ? e : null; // mais velho que 6 meses: descartado
  }

  fresh(item) {
    const e = this.entry(item);
    return e && this.now() - e.at < TTL_MS ? e : null;
  }

  async fetchPoster(item) {
    const data = await this.tmdb.get(`/${item.kind}/${item.tmdbId}`, {}, { ttlMs: 0 });
    if (!data || data.id !== item.tmdbId) throw new Error('resposta inesperada');
    const p = typeof data.poster_path === 'string' && POSTER_PATH.test(data.poster_path) ? data.poster_path : null;
    return p;
  }

  async refresh(stale) {
    let failed = false;
    await Promise.all(
      stale.map(async item => {
        try {
          this.memory[item.tmdbId] = { path: await this.fetchPoster(item), at: this.now() };
        } catch {
          failed = true; // mantém o que havia (se ainda dentro de 6 meses)
        }
      })
    );
    if (failed) this.failedAt = this.now();
    this.saveFile();
  }

  async get() {
    this.loadFile();
    const canAsk = this.tmdb && this.tmdb.enabled && this.now() - this.failedAt >= RETRY_AFTER_FAIL_MS;
    const stale = this.items.filter(i => !this.fresh(i));
    if (stale.length && canAsk) {
      if (!this.inflight) this.inflight = this.refresh(stale).finally(() => (this.inflight = null));
      try {
        await this.inflight;
      } catch {
        /* refresh já trata os erros */
      }
    }
    return this.items.map(item => {
      const e = this.entry(item);
      return { type: item.type, title: item.title, ...(e && e.path ? { posterUrl: `${IMAGE_BASE}${e.path}` } : {}) };
    });
  }
}

module.exports = { LandingFeatured, TTL_MS, MAX_AGE_MS, CACHE_FILE };
