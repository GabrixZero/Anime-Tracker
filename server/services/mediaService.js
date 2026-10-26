const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const config = require('../config/config');
const { stripHtml, stripHtmlList, safeHttpUrl } = require('../utils/sanitize');
const { readJson, writeJsonAtomic } = require('../utils/jsonStore');
const { parseId, describeId, toInternalId } = require('../utils/ids');
const { mediaErrors, DataCorruptionError } = require('../utils/errors');

const TVMAZE_BASE = 'https://api.tvmaze.com';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const POSTER_FALLBACK = 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500';
const BACKDROP_FALLBACK = 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?w=600';
const SEED_PATH = path.join(__dirname, '..', 'data', 'mediaCatalog.seed.json');

// Catálogo de obras: seed versionado (somente leitura) + catálogo de runtime (ignorado pelo git) na pasta de dados.
// Obras novas entram por ingestão sob demanda (hoje só TVMaze). Os ids seguem as faixas de utils/ids.js.
class MediaService {
  constructor(opts = {}) {
    const dataDir = opts.dataDir || config.DATA_DIR;
    this.seedPath = opts.seedPath || SEED_PATH;
    this.catalogPath = path.join(dataDir, 'mediaCatalog.runtime.json');
    this.tvmazeBase = opts.tvmazeBase || TVMAZE_BASE;
    this.cache = new Map();           // buscas externas: chave -> {at, results}
    this.cacheTtlMs = opts.cacheTtlMs ?? 10 * 60 * 1000;
    this.cacheMax = 200;
    this.inflight = new Map();        // ingestões em andamento: id -> Promise
    this.sleep = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.writeBlockedBy = null;       // preenchido se o catálogo de runtime estiver ilegível: leitura segue, gravação não
    this.loadCatalog();
  }

  loadSeed() {
    const result = readJson(this.seedPath);
    if (!result || !Array.isArray(result.data)) {
      throw new Error(`Seed do catálogo ausente ou inválido (${this.seedPath}).`);
    }
    return result.data.filter(MediaService.isValidItem);
  }

  static isValidItem(item) {
    return !!item && Number.isSafeInteger(item.id) && item.id > 0 && typeof item.name === 'string' && item.name.length > 0;
  }

  // Cria o catálogo de runtime a partir do seed na primeira execução e, depois, acrescenta obras novas do seed
  // (nunca sobrescreve uma obra que já está no runtime). Arquivo ilegível => leitura só do seed e gravação bloqueada.
  loadCatalog() {
    const seed = this.loadSeed();
    this.writeBlockedBy = null;

    let runtime = null;
    try {
      const result = readJson(this.catalogPath);
      if (result) {
        if (!Array.isArray(result.data)) throw new DataCorruptionError(this.catalogPath, new Error('catálogo não é uma lista'));
        runtime = result.data;
      }
    } catch (err) {
      if (!(err instanceof DataCorruptionError)) throw err;
      console.error(`[MediaService] ${err.message} O catálogo ficará SOMENTE LEITURA (só o seed) até o arquivo ser corrigido.`);
      this.writeBlockedBy = err;
      this.catalog = seed;
      return;
    }

    const items = (runtime || []).filter(MediaService.isValidItem);
    if (runtime && items.length !== runtime.length) {
      console.warn(`[MediaService] ${runtime.length - items.length} item(ns) inválido(s) ignorado(s) no catálogo de runtime.`);
    }
    const known = new Set(items.map(m => m.id));
    const missing = seed.filter(m => !known.has(m.id));
    this.catalog = [...items, ...missing];

    if (!runtime || missing.length > 0 || items.length !== (runtime || []).length) {
      try {
        this.saveCatalog(this.catalog);
      } catch (err) {
        console.error('[MediaService] Não foi possível gravar o catálogo de runtime (seguindo em memória):', err.message);
      }
    }
  }

  // Grava de forma atômica (tmp + rename, com .bak). Lança se falhar: quem chama decide; o estado em memória só muda depois.
  saveCatalog(items) {
    if (this.writeBlockedBy) throw mediaErrors.catalogUnavailable();
    writeJsonAtomic(this.catalogPath, items);
  }

  // --- Acesso HTTP à fonte externa -------------------------------------------------------------

  // GET JSON com timeout, limite de tamanho e status HTTP tratado (404 => NOT_FOUND, 429 => RATE_LIMITED, resto => UPSTREAM).
  // Em 429 espera (Retry-After, no máximo 5 s) e tenta UMA vez de novo.
  async fetchJson(url) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestJson(url);
      } catch (err) {
        if (err.code === 'RATE_LIMITED' && attempt === 0) {
          await this.sleep(Math.min(err.retryAfterMs || 1500, 5000));
          continue;
        }
        throw err;
      }
    }
  }

  requestJson(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('http://') ? http : https;
      const req = client.get(url, { headers: { 'User-Agent': 'ShowVault/2.0', Accept: 'application/json' } }, (res) => {
        const status = res.statusCode || 0;
        if (status === 404) { res.resume(); return reject(mediaErrors.notFound()); }
        if (status === 429) {
          res.resume();
          const retryAfter = Number(res.headers['retry-after']);
          return reject(mediaErrors.rateLimited(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined));
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(mediaErrors.upstream());
        }

        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            return reject(mediaErrors.upstream('Resposta grande demais da fonte externa.'));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch {
            reject(mediaErrors.upstream('Resposta inválida da fonte externa.'));
          }
        });
        res.on('error', () => reject(mediaErrors.upstream()));
      });
      req.on('error', () => reject(mediaErrors.upstream()));
      req.setTimeout(8000, () => {
        req.destroy();
        reject(mediaErrors.upstream('Tempo esgotado na fonte externa.'));
      });
    });
  }

  // --- Mapeamento TVMaze -> obra do catálogo (tudo passa pelo sanitizador da S01) -----------------

  static mapTvmazeShow(show) {
    const image = show.image && (show.image.original || show.image.medium);
    const genres = stripHtmlList(show.genres);
    const isAnime = show.type === 'Animation' || (Array.isArray(show.genres) && show.genres.includes('Anime'));
    return {
      id: toInternalId('tvmaze', show.id),
      type: isAnime ? 'anime' : 'tv',
      name: stripHtml(show.name, 300),
      overview: stripHtml(show.summary),
      poster_path: safeHttpUrl(image, POSTER_FALLBACK),
      backdrop_path: safeHttpUrl(image, BACKDROP_FALLBACK),
      vote_average: Number(show.rating && show.rating.average) || 8.0,
      first_air_date: stripHtml(show.premiered, 20),
      genres: genres.length ? genres : ['Drama'],
      status: stripHtml(show.status, 40) || 'Em Exibição'
    };
  }

  // --- Consultas ---------------------------------------------------------------------------------

  findLocal(id) {
    return this.catalog.find(m => m.id === id) || null;
  }

  // Uma obra "completa" não precisa ser ingerida de novo.
  static isComplete(item) {
    return item.type === 'movie'
      || Boolean(item.ingestedAt)
      || (Array.isArray(item.seasons) && item.seasons.length > 0)
      || !describeId(item.id).ingestable;
  }

  // O id pode virar uma obra nova no catálogo (precisa de login)?
  needsIngest(id) {
    const existing = this.findLocal(id);
    return !(existing && MediaService.isComplete(existing));
  }

  canIngest(id) {
    return describeId(id).ingestable;
  }

  async getTrending(type = 'all') {
    if (type === 'all') return this.catalog;
    return this.catalog.filter(item => item.type === type);
  }

  // Busca híbrida: catálogo local primeiro; com poucos resultados, complementa com o TVMaze (cache com TTL).
  async search(query = '', type = 'all') {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return this.getTrending(type);

    let localResults = this.catalog.filter(item =>
      item.name.toLowerCase().includes(q)
      || (item.overview && item.overview.toLowerCase().includes(q))
      || (item.genres && item.genres.some(g => g.toLowerCase().includes(q)))
    );
    if (type !== 'all') localResults = localResults.filter(item => item.type === type);
    if (localResults.length >= 8) return localResults;

    const external = await this.searchExternal(q);
    const externalResults = external.filter(item => {
      if (type !== 'all' && item.type !== type) return false;
      return !this.catalog.some(c => c.id === item.id || c.name.toLowerCase() === item.name.toLowerCase());
    });
    return [...localResults, ...externalResults];
  }

  // Resultados do TVMaze já mapeados (ids na faixa do TVMaze). Falhas não derrubam a busca e não entram no cache.
  async searchExternal(q) {
    const hit = this.cache.get(q);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.results;

    let results = [];
    try {
      const data = await this.fetchJson(`${this.tvmazeBase}/search/shows?q=${encodeURIComponent(q)}`);
      if (!Array.isArray(data)) return [];
      results = data.slice(0, 10)
        .map(entry => entry && entry.show)
        .filter(s => s && Number.isSafeInteger(s.id) && s.id > 0 && s.id < 1000000 && typeof s.name === 'string' && s.name)
        .map(s => ({ ...MediaService.mapTvmazeShow(s), isExternal: true }));
    } catch (err) {
      console.warn('Busca externa TVMaze falhou ou indisponível:', err.message);
      return [];
    }

    if (this.cache.size >= this.cacheMax) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(q, { at: Date.now(), results });
    return results;
  }

  // Detalhes por id: obra do catálogo ou, se for de uma fonte ingerível, ingestão sob demanda.
  // (O controller só chama a ingestão para usuários logados; aqui os erros sobem tipados.)
  async getById(id) {
    const numId = parseId(id);
    const existing = this.findLocal(numId);
    if (existing && MediaService.isComplete(existing)) return existing;
    return this.ingest(numId);
  }

  // --- Ingestão sob demanda ------------------------------------------------------------------------

  // Baixa a obra completa (todos os episódios) e grava de forma atômica no catálogo de runtime.
  // Chamadas simultâneas do mesmo id compartilham a mesma operação (um único download e uma única gravação).
  ingest(id) {
    let numId;
    try {
      numId = parseId(id);
    } catch (err) {
      return Promise.reject(err);
    }

    const existing = this.findLocal(numId);
    if (existing && MediaService.isComplete(existing)) return Promise.resolve(existing);

    const source = describeId(numId);
    if (!source.ingestable) return Promise.reject(source.source ? mediaErrors.unsupportedSource() : mediaErrors.notFound());
    if (this.writeBlockedBy) return Promise.reject(mediaErrors.catalogUnavailable());

    if (this.inflight.has(numId)) return this.inflight.get(numId);
    const promise = this.ingestTvmaze(numId, source.externalId).finally(() => this.inflight.delete(numId));
    this.inflight.set(numId, promise);
    return promise;
  }

  async ingestTvmaze(numId, tvmazeId) {
    const data = await this.fetchJson(`${this.tvmazeBase}/shows/${tvmazeId}?embed=episodes`);

    // O TVMaze responde {"name":"Not Found","status":404,...} em erros: só vale uma obra com o id pedido e um nome.
    if (!data || typeof data !== 'object' || data.id !== tvmazeId || typeof data.name !== 'string' || !data.name.trim()) {
      throw mediaErrors.notFound();
    }

    const seasonsMap = new Map();
    const rawEpisodes = Array.isArray(data._embedded && data._embedded.episodes) ? data._embedded.episodes : [];
    rawEpisodes.forEach((ep) => {
      if (!ep) return;
      const sNum = Number.isInteger(ep.season) ? ep.season : 1;
      if (!seasonsMap.has(sNum)) {
        seasonsMap.set(sNum, { season_number: sNum, name: `Temporada ${sNum}`, episodes: [] });
      }
      seasonsMap.get(sNum).episodes.push({
        episode_number: Number.isInteger(ep.number) ? ep.number : 1,
        name: stripHtml(ep.name, 300) || `Episódio ${ep.number}`,
        runtime: Number(ep.runtime || data.averageRuntime) || 45,
        air_date: stripHtml(ep.airdate, 20),
        overview: stripHtml(ep.summary),
        still_path: safeHttpUrl(ep.image && (ep.image.medium || ep.image.original), safeHttpUrl(data.image && data.image.original))
      });
    });

    const fullMedia = {
      ...MediaService.mapTvmazeShow(data),
      seasons: Array.from(seasonsMap.values()).sort((a, b) => a.season_number - b.season_number),
      ingestedAt: new Date().toISOString()
    };

    // Grava primeiro; só depois a memória muda (se a gravação falhar, nada fica pela metade).
    const index = this.catalog.findIndex(m => m.id === numId);
    const next = index >= 0
      ? this.catalog.map(m => (m.id === numId ? fullMedia : m))
      : [...this.catalog, fullMedia];
    this.saveCatalog(next);
    this.catalog = next;

    console.log(`[MediaService] Obra ingerida: ${fullMedia.name} (id ${numId}, ${fullMedia.seasons.length} temporadas)`);
    return fullMedia;
  }
}

module.exports = new MediaService();
module.exports.MediaService = MediaService;
