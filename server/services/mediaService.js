const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { stripHtml, stripHtmlList, safeHttpUrl } = require('../utils/sanitize');
const { readJson, writeJsonAtomic } = require('../utils/jsonStore');
const { parseId, describeId, toInternalId } = require('../utils/ids');
const { mediaErrors, MediaError, DataCorruptionError } = require('../utils/errors');
const { requestJson } = require('../utils/httpJson');
const TtlCache = require('../utils/ttlCache');
const { normalizeTitle, relevance, franchiseKey, sameWork } = require('../utils/titles');
const JikanClient = require('./jikanClient');
const TmdbClient = require('./tmdbClient');
const jikanMapper = require('./jikanMapper');

const TVMAZE_BASE = 'https://api.tvmaze.com';
const SEED_PATH = path.join(__dirname, '..', 'data', 'mediaCatalog.seed.json');
const MAX_RESULTS = 30;
const TVMAZE_STATUS_PT = { Running: 'Em Exibição', Ended: 'Finalizada', 'To Be Determined': 'A definir', 'In Development': 'Em desenvolvimento' };

// Catálogo de obras: seed versionado (somente leitura) + catálogo de runtime (ignorado pelo git) na pasta de dados.
// Obras novas entram por ingestão sob demanda (Jikan/MyAnimeList para animes, TVMaze e TMDB para séries, TMDB para filmes).
// Os ids seguem as faixas de utils/ids.js.
class MediaService {
  constructor(opts = {}) {
    const dataDir = opts.dataDir || config.DATA_DIR;
    this.seedPath = opts.seedPath || SEED_PATH;
    this.catalogPath = path.join(dataDir, 'mediaCatalog.runtime.json');
    this.tvmazeBase = opts.tvmazeBase || TVMAZE_BASE;
    this.cache = new TtlCache({ ttlMs: opts.cacheTtlMs ?? 10 * 60 * 1000, max: 200 }); // buscas no TVMaze
    this.inflight = new Map();        // ingestões em andamento: id -> Promise
    this.sleep = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.writeBlockedBy = null;       // preenchido se o catálogo de runtime estiver ilegível: leitura segue, gravação não

    // Fontes externas. Jikan (animes) está sempre ligada; o TMDB (séries/filmes) só com TMDB_API_KEY (D-17).
    const fetchJson = (url, o) => this.fetchJson(url, o);
    this.jikanEnabled = opts.jikanEnabled !== false;
    this.jikan = new JikanClient({ fetchJson, sleep: this.sleep, baseUrl: opts.jikanBase, ...(opts.jikan || {}) });
    this.tmdb = new TmdbClient({ apiKey: opts.tmdbKey !== undefined ? opts.tmdbKey : config.TMDB_API_KEY, baseUrl: opts.tmdbBase, fetchJson });

    this.loadCatalog();
  }

  get cacheTtlMs() { return this.cache.ttlMs; }
  set cacheTtlMs(v) { this.cache.ttlMs = v; }

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
    this.seedById = new Map(seed.map(m => [m.id, m]));
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

    const items = (runtime || []).filter(MediaService.isValidItem).map(m => this.withSeedHints(m));
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

  // Obras do seed já copiadas para o runtime antes da S06 não têm `mal_id`/`alt_titles` (usados na deduplicação da busca):
  // completa só esses dois campos, em memória, sem mexer no resto da obra.
  withSeedHints(item) {
    const seed = this.seedById && this.seedById.get(item.id);
    if (!seed) return item;
    const patch = {};
    if (item.mal_id === undefined && seed.mal_id !== undefined) patch.mal_id = seed.mal_id;
    if (item.alt_titles === undefined && seed.alt_titles !== undefined) patch.alt_titles = seed.alt_titles;
    return Object.keys(patch).length ? { ...item, ...patch } : item;
  }

  // Grava de forma atômica (tmp + rename, com .bak). Lança se falhar: quem chama decide; o estado em memória só muda depois.
  saveCatalog(items) {
    if (this.writeBlockedBy) throw mediaErrors.catalogUnavailable();
    writeJsonAtomic(this.catalogPath, items);
  }

  // --- Acesso HTTP às fontes externas -----------------------------------------------------------

  // GET JSON com timeout, limite de tamanho e status HTTP tratado (404 => NOT_FOUND, 429 => RATE_LIMITED, resto => UPSTREAM).
  // Em 429 espera (Retry-After, no máximo 5 s) e tenta de novo `retries429` vez(es) (padrão 1; 0 = quem chama cuida disso, como a Jikan).
  async fetchJson(url, opts = {}) {
    const retries429 = opts.retries429 ?? 1;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestJson(url, opts.headers);
      } catch (err) {
        if (err.code === 'RATE_LIMITED' && attempt < retries429) {
          await this.sleep(Math.min(err.retryAfterMs || 1500, 5000));
          continue;
        }
        throw err;
      }
    }
  }

  requestJson(url, headers) {
    return requestJson(url, { headers });
  }

  // --- Mapeamento TVMaze -> obra do catálogo (tudo passa pelo sanitizador da S01) -----------------

  // Detecção ÚNICA de anime para o caminho TVMaze (busca e ingestão). Conservadora: gênero "Anime" ou animação japonesa.
  // Desenho ocidental (tipo Animation, idioma/país não japonês) continua sendo série.
  static isAnimeShow(show) {
    const genres = Array.isArray(show.genres) ? show.genres : [];
    if (genres.includes('Anime')) return true;
    const japanese = show.language === 'Japanese'
      || [show.network, show.webChannel].some(c => c && c.country && c.country.code === 'JP');
    return show.type === 'Animation' && japanese;
  }

  static mapTvmazeShow(show) {
    const image = show.image && (show.image.original || show.image.medium);
    const poster = safeHttpUrl(image, null);
    const rating = Number(show.rating && show.rating.average);
    const status = stripHtml(show.status, 40);
    return {
      id: toInternalId('tvmaze', show.id),
      type: MediaService.isAnimeShow(show) ? 'anime' : 'tv',
      name: stripHtml(show.name, 300),
      overview: stripHtml(show.summary),
      poster_path: poster,
      backdrop_path: poster,
      vote_average: rating > 0 ? rating : null,
      first_air_date: stripHtml(show.premiered, 20),
      genres: stripHtmlList(show.genres),
      status: TVMAZE_STATUS_PT[status] || status
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

  // Compatível com o formato antigo: só a lista de obras. A rota usa searchDetailed (avisos de fontes que falharam).
  async search(query = '', type = 'all') {
    return (await this.searchDetailed(query, type)).items;
  }

  // Busca combinada (S06):
  //  anime -> Jikan (se cair, TVMaze só com o que é anime) · série -> TVMaze (+ TMDB com chave) · filme -> TMDB (com chave)
  //  todos -> tudo isso junto. Cada fonte tem cache; uma fonte que falha não derruba as outras (vira aviso em `warnings`).
  // Resultado = catálogo local + fontes, sem repetições (mesma obra por id da MAL ou título normalizado + títulos alternativos),
  // sem correspondências fracas (a consulta precisa aparecer no título ou em um título alternativo) e em ordem de relevância.
  async searchDetailed(query = '', type = 'all') {
    const raw = String(query || '').trim();
    if (!raw) return { items: await this.getTrending(type), warnings: [] };

    const localCandidates = this.catalog
      .filter(item => type === 'all' || item.type === type)
      .map(item => ({ item, source: 'local', score: this.localScore(raw, item) }))
      .filter(c => c.score > 0);
    const strongLocal = localCandidates.filter(c => c.score >= 30);
    if (strongLocal.length >= 8) {
      return { items: MediaService.sortCandidates(localCandidates).map(c => c.item), warnings: [] };
    }

    const wantsAnime = type === 'all' || type === 'anime';
    const wantsTv = type === 'all' || type === 'tv';
    const wantsMovie = type === 'all' || type === 'movie';
    const warnings = [];
    const failures = [];
    const note = (source, err) => {
      const typed = err instanceof MediaError;
      failures.push(err);
      warnings.push({
        source,
        code: typed ? err.code : 'UPSTREAM',
        message: typed ? err.message : 'Uma fonte externa está indisponível no momento.',
        ...(typed && err.retryAfterMs ? { retryAfterSec: Math.ceil(err.retryAfterMs / 1000) } : {})
      });
      if (!typed) console.warn(`Busca externa (${source}) falhou:`, err && err.message);
    };

    // Fase 1: tudo em paralelo (a fila da Jikan e os caches de cada fonte cuidam do ritmo).
    const jobs = [];
    if (wantsAnime && this.jikanEnabled) jobs.push(['jikan', () => this.searchJikan(raw)]);
    if (wantsTv) jobs.push(['tvmaze', () => this.searchExternal(raw)]);
    if (wantsTv && this.tmdb.enabled) jobs.push(['tmdb', () => this.tmdb.searchTv(raw)]);
    if (wantsMovie && this.tmdb.enabled) jobs.push(['tmdb', () => this.tmdb.searchMovie(raw)]);
    const settled = await Promise.allSettled(jobs.map(([, run]) => run()));

    const bySource = { jikan: [], tvmaze: [], tmdb: [] };
    const jikanOk = { value: false };
    settled.forEach((res, i) => {
      const source = jobs[i][0];
      if (res.status === 'fulfilled') {
        bySource[source].push(...res.value.map(item => ({ ...item, isExternal: true })));
        if (source === 'jikan') jikanOk.value = true;
      } else {
        note(source, res.reason);
      }
    });

    // Fase 2: anime sem Jikan (desligada ou fora do ar) => o TVMaze serve de reserva, só com o que é anime.
    const animeFallback = wantsAnime && !jikanOk.value;
    if (animeFallback && !wantsTv) {
      try {
        bySource.tvmaze.push(...await this.searchExternal(raw));
      } catch (err) {
        note('tvmaze', err);
      }
    }
    if (wantsMovie && !wantsTv && !wantsAnime && !this.tmdb.enabled) {
      warnings.push({ source: 'tmdb', code: 'NOT_CONFIGURED', message: 'A busca de filmes novos precisa da chave do TMDB (TMDB_API_KEY) no servidor. Mostrando só o catálogo local.' });
    }

    // Filtros por tipo: TVMaze só entrega anime como reserva da Jikan; em "série" nunca; em "anime" só anime.
    const tvmaze = bySource.tvmaze.filter((item) => {
      if (item.type === 'anime') return wantsAnime && animeFallback;
      return wantsTv;
    });

    const external = [
      ...MediaService.groupJikan(raw, bySource.jikan).map(item => ({ item, source: 'jikan' })),
      ...bySource.tmdb.map(item => ({ item, source: 'tmdb' })),
      ...tvmaze.map(item => ({ item, source: 'tvmaze' }))
    ]
      .filter(c => type === 'all' || c.item.type === type)
      .map(c => ({ ...c, score: relevance(raw, c.item) }))
      .filter(c => c.score > 0);   // correspondência fraca/difusa ("Frieden" para "Frieren") não entra

    const items = this.mergeCandidates([...localCandidates, ...external]).slice(0, MAX_RESULTS).map(c => c.item);

    // Nada para mostrar e alguma fonte falhou: devolve o erro de verdade (429 com "tente de novo", 502...) em vez de "nenhuma obra".
    if (items.length === 0 && failures.length > 0) {
      const typed = failures.find(e => e instanceof MediaError && e.code === 'RATE_LIMITED') || failures.find(e => e instanceof MediaError) || failures[0];
      throw typed instanceof MediaError ? typed : mediaErrors.upstream();
    }
    return { items, warnings };
  }

  localScore(query, item) {
    let score = relevance(query, item, { overviewHit: true });
    if (score === 0) {
      const q = normalizeTitle(query);
      if (q && (item.genres || []).some(g => normalizeTitle(g) === q)) score = 20;
    }
    return score;
  }

  // Ordem: relevância (maior primeiro); empate => local, depois Jikan, TMDB, TVMaze (ordem de entrada, estável).
  static sortCandidates(list) {
    return list.map((c, i) => ({ c, i })).sort((a, b) => (b.c.score - a.c.score) || (a.i - b.i)).map(x => x.c);
  }

  // Tira as repetições (prioridade: local > Jikan > TMDB > TVMaze) e ordena por relevância.
  // Exceção: uma obra de amostra do seed (anime com poucos episódios de exemplo) cede lugar à versão real da Jikan.
  mergeCandidates(candidates) {
    const priority = { local: 0, jikan: 1, tmdb: 2, tvmaze: 3 };
    const ordered = candidates.map((c, i) => ({ c, i })).sort((a, b) => (priority[a.c.source] - priority[b.c.source]) || (a.i - b.i)).map(x => x.c);
    const kept = [];
    for (const cand of ordered) {
      const dup = kept.findIndex(k => sameWork(k.item, cand.item));
      if (dup < 0) { kept.push(cand); continue; }
      if (cand.source === 'jikan' && kept[dup].source === 'local' && MediaService.isSeedSample(kept[dup].item)) {
        kept[dup] = { ...cand, score: Math.max(cand.score, kept[dup].score) };
      }
    }
    return MediaService.sortCandidates(kept);
  }

  // Anime do seed (ids 1..999.999) nunca ingerido da Jikan: tem só 1-2 episódios de exemplo.
  static isSeedSample(item) {
    return item.type === 'anime' && !item.ingestedAt && describeId(item.id).source === 'seed' && Number.isSafeInteger(item.mal_id);
  }

  // --- Jikan: busca ------------------------------------------------------------------------------

  async searchJikan(q) {
    const entries = await this.jikan.searchAnime(q, { limit: 25 });
    return entries.map(jikanMapper.mapAnimeSearchEntry);
  }

  // Várias entradas da MAL da mesma franquia (temporadas/partes: mesma chave de título sem "Season 2", "Part 2", "Final Season"...)
  // viram UM resultado: a entrada mais antiga (TV primeiro) com `related_count` e o conjunto de ids/títulos do grupo.
  // Receber um id do meio da cadeia também funciona: a ingestão caminha pelas relações Sequel/Prequel para os dois lados.
  static groupJikan(query, items) {
    const parent = items.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const keyOwner = new Map();
    items.forEach((item, i) => {
      for (const k of new Set([franchiseKey(item.name), franchiseKey(item.original_name)].filter(Boolean))) {
        if (keyOwner.has(k)) parent[find(i)] = find(keyOwner.get(k));
        else keyOwner.set(k, i);
      }
    });

    const groups = new Map();
    items.forEach((item, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(item);
    });

    const dateKey = it => it.first_air_date || '9999-12-31';
    const out = [];
    for (const members of groups.values()) {
      const scoreOf = it => relevance(query, it);
      const best = Math.max(...members.map(scoreOf));
      if (best === 0) continue;
      const tvFirst = [...members].sort((a, b) => ((a.anime_kind ? 1 : 0) - (b.anime_kind ? 1 : 0)) || dateKey(a).localeCompare(dateKey(b)) || a.mal_id - b.mal_id);
      const rep = tvFirst[0];
      const alt = new Set(rep.alt_titles);
      members.forEach(m => [m.name, m.original_name, ...m.alt_titles].forEach(t => t && t !== rep.name && alt.add(t)));
      out.push({
        ...rep,
        alt_titles: [...alt].slice(0, 40),
        mal_ids: members.map(m => m.mal_id),
        related_count: members.length - 1,
        _order: Math.min(...members.map(m => items.indexOf(m)))
      });
    }
    return out.sort((a, b) => a._order - b._order).map(({ _order, ...rest }) => rest);
  }

  // --- TVMaze: busca -----------------------------------------------------------------------------

  // Resultados do TVMaze já mapeados (ids na faixa do TVMaze). Falhas sobem (quem chama transforma em aviso) e não entram no cache.
  async searchExternal(q) {
    const key = q.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return hit;

    const data = await this.fetchJson(`${this.tvmazeBase}/search/shows?q=${encodeURIComponent(q)}`);
    if (!Array.isArray(data)) return [];
    const results = data.slice(0, 10)
      .map(entry => entry && entry.show)
      .filter(s => s && Number.isSafeInteger(s.id) && s.id > 0 && s.id < 1000000 && typeof s.name === 'string' && s.name)
      .map(s => ({ ...MediaService.mapTvmazeShow(s), isExternal: true }));
    this.cache.set(key, results);
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
    if ((source.source === 'tmdb_tv' || source.source === 'tmdb_movie') && !this.tmdb.enabled) {
      return Promise.reject(mediaErrors.notConfigured('Séries e filmes do TMDB não estão habilitados neste servidor (falta a chave TMDB_API_KEY).'));
    }
    if (this.writeBlockedBy) return Promise.reject(mediaErrors.catalogUnavailable());

    if (this.inflight.has(numId)) return this.inflight.get(numId);
    const run = {
      tvmaze: () => this.ingestTvmaze(numId, source.externalId),
      jikan: () => this.ingestJikan(numId, source.externalId),
      tmdb_tv: () => this.ingestTmdb(numId, () => this.tmdb.getTv(source.externalId)),
      tmdb_movie: () => this.ingestTmdb(numId, () => this.tmdb.getMovie(source.externalId))
    }[source.source];
    const promise = run().finally(() => this.inflight.delete(numId));
    this.inflight.set(numId, promise);
    return promise;
  }

  // Grava primeiro; só depois a memória muda (se a gravação falhar, nada fica pela metade).
  commitIngested(numId, fullMedia) {
    const index = this.catalog.findIndex(m => m.id === numId);
    const next = index >= 0
      ? this.catalog.map(m => (m.id === numId ? fullMedia : m))
      : [...this.catalog, fullMedia];
    this.saveCatalog(next);
    this.catalog = next;
    console.log(`[MediaService] Obra ingerida: ${fullMedia.name} (id ${numId}, ${(fullMedia.seasons || []).length} temporadas)`);
    return fullMedia;
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
      const runtime = Number(ep.runtime || data.averageRuntime);
      seasonsMap.get(sNum).episodes.push({
        episode_number: Number.isInteger(ep.number) ? ep.number : 1,
        name: stripHtml(ep.name, 300) || `Episódio ${ep.number}`,
        runtime: runtime > 0 ? runtime : null,
        air_date: stripHtml(ep.airdate, 20),
        overview: stripHtml(ep.summary),
        still_path: safeHttpUrl(ep.image && (ep.image.medium || ep.image.original), safeHttpUrl(data.image && data.image.original, null))
      });
    });

    return this.commitIngested(numId, {
      ...MediaService.mapTvmazeShow(data),
      seasons: Array.from(seasonsMap.values()).sort((a, b) => a.season_number - b.season_number),
      ingestedAt: new Date().toISOString()
    });
  }

  // Anime: a obra reúne a franquia inteira (cadeia Sequel/Prequel da MAL) como temporadas (D-18, etapa 2).
  async ingestJikan(numId, malId) {
    const franchise = await this.jikan.getFranchise(malId);
    const work = jikanMapper.buildAnimeWork(numId, malId, franchise);
    return this.commitIngested(numId, { ...work, ingestedAt: new Date().toISOString() });
  }

  async ingestTmdb(numId, load) {
    const media = await load();
    return this.commitIngested(numId, { ...media, id: numId, ingestedAt: new Date().toISOString() });
  }
}

module.exports = new MediaService();
module.exports.MediaService = MediaService;
