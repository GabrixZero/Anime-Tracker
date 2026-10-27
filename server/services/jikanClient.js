// Cliente da Jikan v4 (API não oficial do MyAnimeList): https://api.jikan.moe/v4
// Limites da Jikan: ~3 requisições/s e 60/min. Aqui: fila com espaçamento mínimo + teto por minuto, cache com validade,
// nova tentativa com espera crescente em 429/5xx, e erros tipados (utils/errors.js). Nada é inventado: o que a fonte não trouxer fica nulo.
const TtlCache = require('../utils/ttlCache');
const { mediaErrors, MediaError } = require('../utils/errors');

// Tipos da MAL cujos episódios valem a pena buscar (Movie = 1 episódio, sem requisição; Music/CM/PV ficam de fora).
const EPISODE_TYPES = new Set(['TV', 'ONA', 'OVA', 'Special', 'TV Special']);

const DEFAULTS = {
  baseUrl: 'https://api.jikan.moe/v4',
  minIntervalMs: 400,        // ~2,5 req/s (a Jikan aceita 3)
  perMinute: 50,             // teto por minuto (a Jikan aceita 60)
  maxQueue: 40,              // pedidos esperando na fila; acima disso responde "tente de novo" em vez de acumular
  maxWaitMs: 25000,          // quanto um pedido aceita esperar na fila antes de desistir (RATE_LIMITED)
  retries: 2,                // novas tentativas em 429/5xx/timeout (além da primeira)
  backoffMs: 1000,           // espera inicial entre tentativas (dobra a cada uma, respeitando Retry-After)
  searchTtlMs: 10 * 60 * 1000,
  detailTtlMs: 6 * 60 * 60 * 1000,
  episodesTtlMs: 60 * 60 * 1000,
  maxEpisodePages: 30        // 30 x 100 episódios
};

class JikanClient {
  // fetchJson(url) => Promise<json>: injetado (o MediaService usa o dele, com timeout e erros tipados).
  constructor({ fetchJson, sleep, now, ...opts } = {}) {
    if (typeof fetchJson !== 'function') throw new Error('JikanClient precisa de fetchJson.');
    Object.assign(this, DEFAULTS, opts);
    this.fetchJson = fetchJson;
    this.now = now || Date.now;
    this.sleep = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.cache = new TtlCache({ max: 400, now: this.now });
    this.inflight = new Map();   // mesma URL pedida ao mesmo tempo = uma única requisição
    this.tail = Promise.resolve();
    this.pending = 0;
    this.lastAt = 0;
    this.stamps = [];
    this.requestCount = 0;       // quantas requisições reais foram feitas (diagnóstico e testes)
  }

  // Espera a vez na fila (espaçamento + teto por minuto). Rejeita se a espera for longa demais.
  _slot() {
    if (this.pending >= this.maxQueue) return Promise.reject(mediaErrors.rateLimited(this.minIntervalMs * this.pending));
    this.pending++;
    const run = this.tail.then(async () => {
      try {
        const t0 = this.now();
        this.stamps = this.stamps.filter(t => t0 - t < 60000);
        let wait = Math.max(0, this.lastAt + this.minIntervalMs - t0);
        if (this.stamps.length >= this.perMinute) wait = Math.max(wait, this.stamps[0] + 60000 - t0);
        if (wait > this.maxWaitMs) throw mediaErrors.rateLimited(wait);
        if (wait > 0) await this.sleep(wait);
        const t1 = this.now();
        this.lastAt = t1;
        this.stamps.push(t1);
      } finally {
        this.pending--;
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }

  // GET com fila, nova tentativa e erros tipados. Respostas boas ficam no cache; falhas nunca.
  async get(path, { ttlMs = this.searchTtlMs } = {}) {
    const cached = this.cache.get(path, ttlMs);
    if (cached !== undefined) return cached;
    if (this.inflight.has(path)) return this.inflight.get(path);

    const promise = this._getWithRetry(path).then((data) => {
      this.cache.set(path, data);
      return data;
    }).finally(() => this.inflight.delete(path));
    this.inflight.set(path, promise);
    return promise;
  }

  async _getWithRetry(path) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this._slot();
      this.requestCount++;
      try {
        // retries429: 0 => a espera/retentativa é decidida aqui (o fetchJson não repete por conta própria)
        return await this.fetchJson(`${this.baseUrl}${path}`, { retries429: 0 });
      } catch (err) {
        lastErr = err;
        const retryable = err instanceof MediaError && (err.code === 'RATE_LIMITED' || err.code === 'UPSTREAM');
        if (!retryable || attempt === this.retries) break;
        const wait = Math.max(err.retryAfterMs || 0, this.backoffMs * 2 ** attempt);
        await this.sleep(Math.min(wait, 8000));
      }
    }
    throw lastErr;
  }

  // --- Endpoints ------------------------------------------------------------------------------

  async searchAnime(query, { limit = 25 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const json = await this.get(`/anime?q=${encodeURIComponent(q)}&limit=${limit}&sfw=true`, { ttlMs: this.searchTtlMs });
    if (!json || !Array.isArray(json.data)) throw mediaErrors.upstream('Resposta inesperada da Jikan.');
    return json.data.filter(a => a && Number.isSafeInteger(a.mal_id) && a.mal_id > 0);
  }

  // /anime/{id}/full: dados completos + relações (Sequel/Prequel/...) numa única requisição.
  async getAnimeFull(malId) {
    const json = await this.get(`/anime/${malId}/full`, { ttlMs: this.detailTtlMs });
    // Em erro a Jikan responde {status, type, message}; só vale um objeto com o mal_id pedido e um título.
    const a = json && json.data;
    if (!a || a.mal_id !== malId || !(a.title || a.title_english)) throw mediaErrors.notFound();
    return a;
  }

  // Todas as páginas de episódios (100 por página). Devolve [{mal_id (= número do episódio), title, aired, duration, ...}].
  async getEpisodes(malId) {
    const all = [];
    for (let page = 1; page <= this.maxEpisodePages; page++) {
      const json = await this.get(`/anime/${malId}/episodes?page=${page}`, { ttlMs: this.episodesTtlMs });
      if (!json || !Array.isArray(json.data)) throw mediaErrors.upstream('Resposta inesperada da Jikan.');
      all.push(...json.data);
      const hasNext = json.pagination && json.pagination.has_next_page;
      if (!hasNext || json.data.length === 0) break;
    }
    return all;
  }

  // Franquia = componente ligado por relações Sequel/Prequel (Spin-off, Side story, Summary etc. ficam de fora de propósito:
  // o grafo da MAL é grande e misturaria obras diferentes). Busca em largura a partir do id pedido, no máximo maxNodes entradas.
  // Devolve {nodes:[full], episodes: Map(malId -> [ep]), visited:[malId], truncated}.
  // Erro em qualquer entrada (exceto 404 de uma entrada relacionada) aborta: melhor falhar do que gravar uma franquia pela metade.
  async getFranchise(malId, { maxNodes = 12 } = {}) {
    const nodes = new Map();
    const seen = new Set([malId]);
    const queue = [malId];
    let truncated = false;

    while (queue.length) {
      if (nodes.size >= maxNodes) { truncated = true; break; }
      const id = queue.shift();
      let full;
      try {
        full = await this.getAnimeFull(id);
      } catch (err) {
        if (id !== malId && err.code === 'NOT_FOUND') continue;
        throw err;
      }
      nodes.set(id, full);
      for (const rel of Array.isArray(full.relations) ? full.relations : []) {
        if (!rel || (rel.relation !== 'Sequel' && rel.relation !== 'Prequel')) continue;
        for (const entry of Array.isArray(rel.entry) ? rel.entry : []) {
          if (entry && entry.type === 'anime' && Number.isSafeInteger(entry.mal_id) && entry.mal_id > 0 && !seen.has(entry.mal_id)) {
            seen.add(entry.mal_id);
            queue.push(entry.mal_id);
          }
        }
      }
    }

    const episodes = new Map();
    for (const full of nodes.values()) {
      // Filmes viram um episódio só; o que ainda não estreou não tem lista.
      if (full.type === 'Movie' || full.status === 'Not yet aired' || !EPISODE_TYPES.has(full.type)) continue;
      episodes.set(full.mal_id, await this.getEpisodes(full.mal_id));
    }
    return { nodes: [...nodes.values()], episodes, visited: [...nodes.keys()], truncated };
  }
}

module.exports = JikanClient;
module.exports.DEFAULTS = DEFAULTS;
