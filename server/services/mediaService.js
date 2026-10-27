const path = require('path');
const config = require('../config/config');
const { stripHtml, stripHtmlList, safeHttpUrl } = require('../utils/sanitize');
const { readJson, writeJsonAtomic } = require('../storage');
const { parseId, describeId, toInternalId } = require('../utils/ids');
const { mediaErrors, MediaError, DataCorruptionError } = require('../utils/errors');
const { requestJson } = require('../utils/httpJson');
const TtlCache = require('../utils/ttlCache');
const { normalizeTitle, relevance, franchiseKey, sameWork, malIdsOf, anilistIdsOf } = require('../utils/titles');
const AniListClient = require('./anilistClient');
const JikanClient = require('./jikanClient');
const TmdbClient = require('./tmdbClient');
const anilistMapper = require('./anilistMapper');
const jikanMapper = require('./jikanMapper');
const { migrateLegacyCatalog } = require('./catalogMigration');

const TVMAZE_BASE = 'https://api.tvmaze.com';
const SEED_PATH = path.join(__dirname, '..', 'data', 'mediaCatalog.seed.json');
const MAX_RESULTS = 30;
const TVMAZE_STATUS_PT = { Running: 'Em Exibição', Ended: 'Finalizada', 'To Be Determined': 'A definir', 'In Development': 'Em desenvolvimento' };
// Formatos da AniList cujos episódios a Jikan lista (títulos reais); filme = 1 episódio, sem consulta.
const JIKAN_EPISODE_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL']);
const AIRING_STATUS = 'Em Exibição';
const UPCOMING_STATUS = 'Em breve';
const FORCE_REFRESH_MIN_MS = 10 * 60 * 1000;      // atualização forçada da mesma obra: no máximo 1 vez a cada 10 min
const REFRESH_RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000; // a conferência automática não insiste numa obra que acabou de falhar

// Catálogo de obras: seed versionado (somente leitura) + catálogo de runtime (ignorado pelo git) na pasta de dados.
// Obras novas entram por ingestão sob demanda (AniList para animes, com a Jikan/MyAnimeList de reserva — D-26; TVMaze e TMDB para séries,
// TMDB para filmes). Obras em exibição têm validade (TTL) e buscam episódios novos (refresh, S13).
// Os ids seguem as faixas de utils/ids.js.
class MediaService {
  constructor(opts = {}) {
    const dataDir = opts.dataDir || config.DATA_DIR;
    this.seedPath = opts.seedPath || SEED_PATH;
    this.catalogPath = path.join(dataDir, 'mediaCatalog.runtime.json');
    this.tvmazeBase = opts.tvmazeBase || config.TVMAZE_BASE_URL || TVMAZE_BASE;
    this.cache = new TtlCache({ ttlMs: opts.cacheTtlMs ?? 10 * 60 * 1000, max: 200 }); // buscas no TVMaze
    this.inflight = new Map();        // ingestões em andamento: id -> Promise
    this.sleep = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.writeBlockedBy = null;       // preenchido se o catálogo de runtime estiver ilegível: leitura segue, gravação não

    // Fontes externas. Anime: AniList (principal) e Jikan (reserva), ambas sempre ligadas; o TMDB (séries/filmes) só com TMDB_API_KEY (D-17).
    const fetchJson = (url, o) => this.fetchJson(url, o);
    this.anilistEnabled = opts.anilistEnabled !== false;
    this.anilist = new AniListClient({ fetchJson, sleep: this.sleep, baseUrl: opts.anilistBase || config.ANILIST_BASE_URL || undefined, ...(opts.anilist || {}) });
    this.jikanEnabled = opts.jikanEnabled !== false;
    this.jikan = new JikanClient({ fetchJson, sleep: this.sleep, baseUrl: opts.jikanBase || process.env.JIKAN_BASE_URL, ...(opts.jikan || {}) });
    this.tmdb = new TmdbClient({ apiKey: opts.tmdbKey !== undefined ? opts.tmdbKey : config.TMDB_API_KEY, baseUrl: opts.tmdbBase || config.TMDB_BASE_URL || undefined, fetchJson });

    // Atualização de obras em exibição (S13): validade por obra, tentativas recentes e orçamento de tempo dos títulos da Jikan.
    this.airingTtlMs = opts.airingTtlMs ?? config.AIRING_TTL_MS;
    this.upcomingTtlMs = opts.upcomingTtlMs ?? 24 * 60 * 60 * 1000;
    this.enrichBudgetMs = opts.enrichBudgetMs ?? 15000;     // quanto tempo, no total, a ingestão espera pelos títulos da Jikan
    this.enrichTimeoutMs = opts.enrichTimeoutMs ?? 3000;    // e quanto espera por CADA resposta dela (Jikan fora do ar custa só isto, uma vez)
    this.refreshAttempts = new Map();   // id -> quando falhou a última atualização automática
    this.refreshTimers = [];
    this.refreshing = false;

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

    let items = (runtime || []).filter(MediaService.isValidItem).map(m => this.withSeedHints(m));
    if (runtime && items.length !== runtime.length) {
      console.warn(`[MediaService] ${runtime.length - items.length} item(ns) inválido(s) ignorado(s) no catálogo de runtime.`);
    }

    // S13: obras gravadas pelo mapper antigo (nota 8.0 / "Drama" / fotos do Unsplash inventadas) são limpas e marcadas para
    // atualização. Idempotente (uma segunda partida não acha nada) e SEMPRE depois de um backup do arquivo como estava.
    let migrated = false;
    if (runtime) {
      const result = migrateLegacyCatalog(items);
      if (result.changed.length > 0 && this.backupBeforeMigration(runtime, result.changed)) {
        items = result.items;
        migrated = true;
      }
    }

    const known = new Set(items.map(m => m.id));
    const missing = seed.filter(m => !known.has(m.id));
    this.catalog = [...items, ...missing];

    if (!runtime || missing.length > 0 || items.length !== (runtime || []).length || migrated) {
      try {
        this.saveCatalog(this.catalog);
      } catch (err) {
        console.error('[MediaService] Não foi possível gravar o catálogo de runtime (seguindo em memória):', err.message);
      }
    }
  }

  // Cópia do catálogo de runtime COMO ESTAVA, antes da migração mexer em qualquer obra (mediaCatalog.backup-pre-s13-<data>.json, ao lado
  // do original, ignorada pelo git). Sem a cópia a migração não acontece: tenta de novo na próxima partida.
  backupBeforeMigration(original, changed) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(path.dirname(this.catalogPath), `mediaCatalog.backup-pre-s13-${stamp}.json`);
    try {
      writeJsonAtomic(file, original);
      console.log(`[MediaService] Migração S13: ${changed.length} obra(s) do catálogo antigo marcadas para atualização (backup: ${path.basename(file)}).`);
      return true;
    } catch (err) {
      console.error('[MediaService] Migração S13 adiada: não foi possível gravar o backup do catálogo:', err.message);
      return false;
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
        return await this.requestJson(url, opts.headers, opts);
      } catch (err) {
        if (err.code === 'RATE_LIMITED' && attempt < retries429) {
          await this.sleep(Math.min(err.retryAfterMs || 1500, 5000));
          continue;
        }
        throw err;
      }
    }
  }

  // opts.method / opts.body: a AniList (GraphQL) é POST com corpo JSON; as outras fontes são GET.
  requestJson(url, headers, opts = {}) {
    return requestJson(url, { headers, method: opts.method, body: opts.body, timeoutMs: opts.timeoutMs });
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
    // S09: o cartão usa o tamanho médio do pôster (bem menor); o fundo do modal segue com a imagem grande.
    const poster = safeHttpUrl(show.image && (show.image.medium || show.image.original), null);
    const backdrop = safeHttpUrl(show.image && (show.image.original || show.image.medium), null);
    const rating = Number(show.rating && show.rating.average);
    const status = stripHtml(show.status, 40);
    return {
      id: toInternalId('tvmaze', show.id),
      type: MediaService.isAnimeShow(show) ? 'anime' : 'tv',
      name: stripHtml(show.name, 300),
      overview: stripHtml(show.summary),
      poster_path: poster,
      backdrop_path: backdrop,
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

  // A obra já está no catálogo? Pelo próprio id (completa) ou por OUTRO id que cobre a mesma entrada da MAL/AniList (a franquia foi
  // ingerida por outra temporada). Uma amostra do seed não conta por esse caminho: ela precisa ser trocada pela obra real (ingestão).
  resolveExisting(id) {
    const local = this.findLocal(id);
    if (local && MediaService.isComplete(local)) return local;
    const alias = this.findAlias(id);
    return alias && !MediaService.isSeedSample(alias) ? alias : null;
  }

  // O id pode virar uma obra nova no catálogo (precisa de login)?
  needsIngest(id) {
    return !this.resolveExisting(id);
  }

  // Obra do catálogo, com id DIFERENTE, que já cobre a entrada da MAL (faixa da Jikan) ou da AniList (faixa própria) deste id.
  findAlias(id, source = describeId(id)) {
    let covers;
    if (source.source === 'jikan') covers = m => malIdsOf(m).has(source.externalId);
    else if (source.source === 'anilist') covers = m => anilistIdsOf(m).has(source.externalId);
    else return null;
    return this.catalog.find(m => m.id !== id && covers(m)) || null;
  }

  // Obra do catálogo (outro id) que já cobre alguma entrada da franquia recém-baixada: ids em comum, ou — só para amostras do seed —
  // o mesmo tipo + título + ano (D-S06-4). Evita gravar a mesma franquia duas vezes quando dois pedidos correm ao mesmo tempo.
  findTwin(work) {
    const mal = malIdsOf(work);
    const ani = anilistIdsOf(work);
    return this.catalog.find((m) => {
      if (m.id === work.id) return false;
      for (const id of malIdsOf(m)) if (mal.has(id)) return true;
      for (const id of anilistIdsOf(m)) if (ani.has(id)) return true;
      return MediaService.isSeedSample(m) && sameWork(m, work);
    }) || null;
  }

  canIngest(id) {
    return describeId(id).ingestable;
  }

  // Várias obras COMPLETAS do catálogo de uma vez (S09: o app carrega o detalhe das obras da lista em lote ao abrir).
  // Nunca ingere nada: o que não está completo no catálogo volta em `missing`.
  getMany(ids) {
    const data = [];
    const missing = [];
    for (const id of ids) {
      const item = this.findLocal(id);
      if (item && MediaService.isComplete(item)) data.push(item);
      else missing.push(id);
    }
    return { data, missing };
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
  //  anime -> AniList (se falhar, Jikan; se as duas falharem, TVMaze só com o que é anime) · série -> TVMaze (+ TMDB com chave) · filme -> TMDB (com chave)
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
    // covered = fonte reserva que respondeu no lugar desta: o aviso fica na resposta (`fallback`), mas não conta como erro.
    const note = (source, err, covered = null) => {
      const typed = err instanceof MediaError;
      if (!covered) failures.push(err);
      warnings.push({
        source,
        code: typed ? err.code : 'UPSTREAM',
        message: typed ? err.message : 'Uma fonte externa está indisponível no momento.',
        ...(typed && err.retryAfterMs ? { retryAfterSec: Math.ceil(err.retryAfterMs / 1000) } : {}),
        ...(covered ? { fallback: covered } : {})
      });
      if (!typed) console.warn(`Busca externa (${source}) falhou:`, err && err.message);
    };

    // Fase 1: tudo em paralelo (as filas e os caches de cada fonte cuidam do ritmo). Anime: AniList e, se ela falhar, a Jikan.
    const jobs = [];
    if (wantsAnime && (this.anilistEnabled || this.jikanEnabled)) jobs.push(['anime', () => this.searchAnimeSources(raw)]);
    if (wantsTv) jobs.push(['tvmaze', () => this.searchExternal(raw)]);
    if (wantsTv && this.tmdb.enabled) jobs.push(['tmdb', () => this.tmdb.searchTv(raw)]);
    if (wantsMovie && this.tmdb.enabled) jobs.push(['tmdb', () => this.tmdb.searchMovie(raw)]);
    const settled = await Promise.allSettled(jobs.map(([, run]) => run()));

    const bySource = { anime: [], tvmaze: [], tmdb: [] };
    let animeOk = false;
    let animeSource = 'anilist';
    settled.forEach((res, i) => {
      const source = jobs[i][0];
      if (res.status !== 'fulfilled') { note(source, res.reason); return; }
      if (source === 'anime') {
        const { items: found, source: used, failed } = res.value;
        failed.forEach(f => note(f.source, f.err, found ? used : null));
        if (found) {
          animeOk = true;
          animeSource = used;
          bySource.anime.push(...found.map(item => ({ ...item, isExternal: true })));
        }
        return;
      }
      bySource[source].push(...res.value.map(item => ({ ...item, isExternal: true })));
    });

    // Fase 2: anime sem AniList nem Jikan (desligadas ou fora do ar) => o TVMaze serve de reserva, só com o que é anime.
    const animeFallback = wantsAnime && !animeOk;
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
      ...MediaService.groupAnime(raw, bySource.anime).map(item => ({ item, source: animeSource })),
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

  // Ordem: relevância (maior primeiro); empate => local, depois AniList/Jikan, TMDB, TVMaze (ordem de entrada, estável).
  static sortCandidates(list) {
    return list.map((c, i) => ({ c, i })).sort((a, b) => (b.c.score - a.c.score) || (a.i - b.i)).map(x => x.c);
  }

  // Tira as repetições (prioridade: local > AniList = Jikan > TMDB > TVMaze) e ordena por relevância.
  // Exceção: uma obra de amostra do seed (anime com poucos episódios de exemplo) cede lugar à versão real da AniList/Jikan, mas o
  // resultado leva `catalog_id` = id da amostra: é a MESMA obra (quem já a tem na lista a vê como "na lista", e adicionar troca
  // a amostra pela obra real, sem criar uma segunda — D-S06-4).
  mergeCandidates(candidates) {
    const priority = { local: 0, anilist: 1, jikan: 1, tmdb: 2, tvmaze: 3 };
    const ordered = candidates.map((c, i) => ({ c, i })).sort((a, b) => (priority[a.c.source] - priority[b.c.source]) || (a.i - b.i)).map(x => x.c);
    const kept = [];
    for (const cand of ordered) {
      const dup = kept.findIndex(k => sameWork(k.item, cand.item));
      if (dup < 0) { kept.push(cand); continue; }
      if ((cand.source === 'anilist' || cand.source === 'jikan') && kept[dup].source === 'local' && MediaService.isSeedSample(kept[dup].item)) {
        kept[dup] = { ...cand, item: { ...cand.item, catalog_id: kept[dup].item.id }, score: Math.max(cand.score, kept[dup].score) };
      }
    }
    return MediaService.sortCandidates(kept);
  }

  // Anime do seed (ids 1..999.999) nunca ingerido da Jikan: tem só 1-2 episódios de exemplo.
  static isSeedSample(item) {
    return item.type === 'anime' && !item.ingestedAt && describeId(item.id).source === 'seed' && Number.isSafeInteger(item.mal_id);
  }

  // --- Anime: busca (AniList principal, Jikan reserva) -----------------------------------------------

  // Tenta a AniList; se ela falhar tenta a Jikan. Nunca lança: devolve {items (null = nenhuma respondeu), source, failed:[{source, err}]}.
  // Uma lista vazia É uma resposta (a obra não existe): a reserva só entra quando a fonte principal FALHA.
  async searchAnimeSources(q) {
    const failed = [];
    if (this.anilistEnabled) {
      try {
        return { items: await this.searchAniList(q), source: 'anilist', failed };
      } catch (err) {
        failed.push({ source: 'anilist', err });
      }
    }
    if (this.jikanEnabled) {
      try {
        return { items: await this.searchJikan(q), source: 'jikan', failed };
      } catch (err) {
        failed.push({ source: 'jikan', err });
      }
    }
    return { items: null, source: null, failed };
  }

  async searchAniList(q) {
    const entries = await this.anilist.searchAnime(q, { limit: 25 });
    return entries.map(anilistMapper.mapAnimeSearchEntry);
  }

  async searchJikan(q) {
    const entries = await this.jikan.searchAnime(q, { limit: 25 });
    return entries.map(jikanMapper.mapAnimeSearchEntry);
  }

  // Várias entradas da MAL/AniList da mesma franquia (temporadas/partes: mesma chave de título sem "Season 2", "Part 2", "Final Season"...)
  // viram UM resultado: a entrada mais antiga (TV primeiro) com `related_count` e o conjunto de ids/títulos do grupo.
  // Receber um id do meio da cadeia também funciona: a ingestão caminha pelas relações Sequel/Prequel para os dois lados.
  // (Agrupador da S06, agora para as duas fontes de anime; entradas só da AniList não têm `mal_id`.)
  static groupAnime(query, items) {
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
      const tvFirst = [...members].sort((a, b) => ((a.anime_kind ? 1 : 0) - (b.anime_kind ? 1 : 0)) || dateKey(a).localeCompare(dateKey(b)) || a.id - b.id);
      const rep = tvFirst[0];
      const alt = new Set(rep.alt_titles);
      members.forEach(m => [m.name, m.original_name, ...m.alt_titles].forEach(t => t && t !== rep.name && alt.add(t)));
      const anilistIds = members.map(m => m.anilist_id).filter(Number.isSafeInteger);
      out.push({
        ...rep,
        alt_titles: [...alt].slice(0, 40),
        mal_ids: members.map(m => m.mal_id).filter(Number.isSafeInteger),
        ...(anilistIds.length ? { anilist_ids: anilistIds } : {}),
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

  // Detalhes por id: obra do catálogo (ou a mesma obra com outro id) ou, se for de uma fonte ingerível, ingestão sob demanda.
  // (O controller só chama a ingestão para usuários logados; aqui os erros sobem tipados.)
  async getById(id) {
    const numId = parseId(id);
    const existing = this.resolveExisting(numId);
    if (existing) return existing;
    return this.ingest(numId);
  }

  // --- Ingestão sob demanda ------------------------------------------------------------------------

  // Baixa a obra completa (todos os episódios) e grava de forma atômica no catálogo de runtime.
  // Chamadas simultâneas do mesmo id compartilham a mesma operação (um único download e uma única gravação).
  // Anime que já existe no catálogo com outro id (a franquia foi ingerida por outra temporada) devolve a obra existente; anime que
  // é uma AMOSTRA do seed (D-S06-4) é baixado e grava no lugar da amostra, com o MESMO id dela: nunca duas obras para um anime.
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
    if (source.source === 'anilist' && !this.anilistEnabled) {
      return Promise.reject(mediaErrors.notConfigured('A AniList está desligada neste servidor.'));
    }
    if (this.writeBlockedBy) return Promise.reject(mediaErrors.catalogUnavailable());

    const alias = this.findAlias(numId, source);
    if (alias && !MediaService.isSeedSample(alias)) return Promise.resolve(alias);

    if (this.inflight.has(numId)) return this.inflight.get(numId);
    const targetId = alias ? alias.id : numId;
    const run = {
      tvmaze: () => this.ingestTvmaze(numId, source.externalId),
      jikan: () => this.ingestAnime(targetId, { malId: source.externalId }),
      anilist: () => this.ingestAnime(targetId, { anilistId: source.externalId }),
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

  // Marcas de tempo de uma ingestão: `ingestedAt` = primeira vez (não muda nas atualizações); `refreshedAt` = última vez que os dados vieram da fonte.
  static stamps(previous) {
    const now = new Date().toISOString();
    return { ingestedAt: (previous && previous.ingestedAt) || now, refreshedAt: now };
  }

  async ingestTvmaze(numId, tvmazeId, { previous = null } = {}) {
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
        still_path: safeHttpUrl(ep.image && (ep.image.medium || ep.image.original), safeHttpUrl(data.image && (data.image.medium || data.image.original), null))
      });
    });

    return this.commitIngested(numId, {
      ...MediaService.mapTvmazeShow(data),
      seasons: Array.from(seasonsMap.values()).sort((a, b) => a.season_number - b.season_number),
      ...MediaService.stamps(previous)
    });
  }

  // Anime: a obra reúne a franquia inteira (cadeia SEQUEL/PREQUEL) como temporadas (D-18). A AniList é a fonte principal (D-26); se ela
  // falhar ou não conhecer a obra e houver id da MAL, a Jikan faz o mesmo trabalho. `req` = {malId} ou {anilistId}.
  // `previous` (atualização): obra já gravada, de onde saem as marcas de tempo e os títulos de episódio que a Jikan já tinha dado.
  async ingestAnime(targetId, req, { fresh = false, previous = null } = {}) {
    const errors = [];
    let work = null;
    if (this.anilistEnabled) {
      try {
        work = await this.buildAnimeFromAniList(targetId, req, { fresh });
      } catch (err) {
        if (!(err instanceof MediaError) || !req.malId) throw err;   // sem id da MAL a Jikan não consegue ajudar
        errors.push(err);
      }
    }
    if (!work) {
      if (!req.malId) throw errors[0] || mediaErrors.notConfigured('A AniList está desligada neste servidor.');
      try {
        work = await this.buildAnimeFromJikan(targetId, req.malId, { fresh });
      } catch (err) {
        errors.push(err);
        throw MediaService.pickError(errors);
      }
    }

    if (previous) {
      work = anilistMapper.carryOverEpisodeData(previous, work);
    } else {
      // Dois pedidos podem baixar a mesma franquia ao mesmo tempo (por temporadas diferentes): o 2º a chegar devolve a obra do 1º.
      const twin = this.findTwin(work);
      if (twin && !MediaService.isSeedSample(twin)) return twin;
      if (twin) work = { ...work, id: twin.id };
    }
    return this.commitIngested(work.id, { ...work, ...MediaService.stamps(previous) });
  }

  async buildAnimeFromAniList(id, req, { fresh = false } = {}) {
    const root = req.malId ? { idMal: req.malId } : { id: req.anilistId };
    const franchise = await this.anilist.getFranchise(root, { fresh });
    const titlesFor = await this.jikanTitles(franchise);
    return anilistMapper.buildAnimeWork(id, req, franchise, { titlesFor });
  }

  async buildAnimeFromJikan(id, malId, { fresh = false } = {}) {
    const franchise = await this.jikan.getFranchise(malId, { fresh });
    return jikanMapper.buildAnimeWork(id, malId, franchise);
  }

  // Títulos de episódio (a AniList não os tem): pergunta à Jikan, entrada por entrada (as que têm idMal). Melhor esforço: Jikan fora do
  // ar (disjuntor aberto), lenta (orçamento de tempo) ou com erro NUNCA atrapalha a ingestão; os episódios ficam "Episódio N".
  async jikanTitles(franchise) {
    const titles = new Map();
    if (!this.jikanEnabled || this.jikan.breaker.isOpen) return titles;
    const started = Date.now();
    for (const a of franchise.nodes) {
      if (!a.idMal || !JIKAN_EPISODE_FORMATS.has(a.format) || a.status === 'NOT_YET_RELEASED') continue;
      if (Date.now() - started > this.enrichBudgetMs) break;
      try {
        titles.set(a.id, await this.jikan.getEpisodes(a.idMal, { timeoutMs: this.enrichTimeoutMs }));
      } catch (err) {
        if (err instanceof MediaError && err.code === 'NOT_FOUND') continue;   // essa entrada não tem lista na MAL: segue com as outras
        console.warn(`[MediaService] Títulos de episódio da Jikan indisponíveis (${(err && err.code) || 'erro'}); seguindo só com a AniList.`);
        break;
      }
    }
    return titles;
  }

  // Dos erros das fontes, o mais útil para quem chamou: "aguarde" (429) > fonte fora do ar (502) > não encontrado (404).
  static pickError(errors) {
    const typed = errors.filter(e => e instanceof MediaError);
    return typed.find(e => e.code === 'RATE_LIMITED') || typed.find(e => e.code === 'UPSTREAM') || typed[0] || errors[0];
  }

  async ingestTmdb(numId, load, { previous = null } = {}) {
    const media = await load();
    return this.commitIngested(numId, { ...media, id: numId, ...MediaService.stamps(previous) });
  }

  // --- Atualização de obras em exibição (S13) -----------------------------------------------------------
  // Obra "Em Exibição" ganha episódios novos: cada uma tem uma validade (TTL). Vencida, a conferência automática (startRefreshLoop) ou
  // o endpoint POST /api/media/:id/refresh baixam tudo de novo da MESMA fonte. Obras finalizadas e filmes não vencem nunca.
  // Obras marcadas pela migração do catálogo antigo (`needsRefresh`) vencem na hora.

  // Validade da obra em ms (0 = vence agora, null = nunca vence).
  refreshTtlMs(item) {
    if (!item || !item.ingestedAt || item.type === 'movie') return null;
    if (item.needsRefresh) return 0;
    if (item.status === AIRING_STATUS) return this.airingTtlMs;
    if (item.status === UPCOMING_STATUS) return this.upcomingTtlMs;
    return null;
  }

  isRefreshDue(item, now = Date.now()) {
    const ttl = this.refreshTtlMs(item);
    if (ttl === null) return false;
    if (!describeId(item.id).ingestable && !MediaService.isUpgradedSeed(item)) return false;
    const last = Date.parse(item.refreshedAt || item.ingestedAt) || 0;
    return now - last >= ttl;
  }

  // Obra do seed (id do TMDB) que já foi trocada pela versão real da AniList/Jikan: tem `ingestedAt` e id da MAL ou da AniList.
  static isUpgradedSeed(item) {
    return item.type === 'anime' && Boolean(item.ingestedAt) && describeId(item.id).source === 'seed' && Boolean(item.mal_id || item.anilist_id);
  }

  static countEpisodes(item) {
    return (Array.isArray(item && item.seasons) ? item.seasons : []).reduce((n, s) => n + (Array.isArray(s && s.episodes) ? s.episodes.length : 0), 0);
  }

  // O que um pedido de atualização faria agora: {run: true} ou {run: false, reason: 'fresh' | 'recent'} (sem tocar na fonte).
  refreshCheck(id, { force = false, now = Date.now() } = {}) {
    const numId = parseId(id);
    const item = this.findLocal(numId);
    if (!item) throw mediaErrors.notFound();
    if (!item.ingestedAt || (!describeId(numId).ingestable && !MediaService.isUpgradedSeed(item))) throw mediaErrors.unsupportedSource();
    if (this.writeBlockedBy) throw mediaErrors.catalogUnavailable();
    if (this.inflight.has(numId)) return { run: true, item };
    const last = Date.parse(item.refreshedAt || item.ingestedAt) || 0;
    if (force) {
      return now - last < FORCE_REFRESH_MIN_MS ? { run: false, reason: 'recent', item } : { run: true, item };
    }
    return this.isRefreshDue(item, now) ? { run: true, item } : { run: false, reason: 'fresh', item };
  }

  // Atualiza UMA obra do catálogo. Devolve {refreshed, reason?, newEpisodes, item}. Falha da fonte sobe como erro tipado e a obra
  // continua como estava. `force` ignora a validade (no máximo 1 vez a cada 10 min por obra).
  async refresh(id, { force = false } = {}) {
    const numId = parseId(id);
    const check = this.refreshCheck(numId, { force });
    if (!check.run) return { refreshed: false, reason: check.reason, newEpisodes: 0, item: check.item };
    if (this.inflight.has(numId)) {
      const item = await this.inflight.get(numId);
      return { refreshed: true, newEpisodes: 0, item };
    }

    const before = MediaService.countEpisodes(check.item);
    const promise = this.refreshWork(check.item).finally(() => this.inflight.delete(numId));
    this.inflight.set(numId, promise);
    const item = await promise;
    this.refreshAttempts.delete(numId);
    return { refreshed: true, newEpisodes: Math.max(0, MediaService.countEpisodes(item) - before), item };
  }

  // Baixa de novo pela fonte de origem da obra (a faixa do id, ou o id da MAL/AniList guardado na obra).
  refreshWork(item) {
    const source = describeId(item.id);
    if (item.type === 'anime' && (item.mal_id || item.anilist_id) && ['jikan', 'anilist', 'seed'].includes(source.source)) {
      const req = item.mal_id ? { malId: item.mal_id } : { anilistId: item.anilist_id };
      return this.ingestAnime(item.id, req, { fresh: true, previous: item });
    }
    if (source.source === 'tvmaze') return this.ingestTvmaze(item.id, source.externalId, { previous: item });
    if (source.source === 'tmdb_tv') return this.ingestTmdb(item.id, () => this.tmdb.getTv(source.externalId), { previous: item });
    if (source.source === 'tmdb_movie') return this.ingestTmdb(item.id, () => this.tmdb.getMovie(source.externalId), { previous: item });
    return Promise.reject(mediaErrors.unsupportedSource());
  }

  // Atualiza as obras vencidas, uma de cada vez e as mais antigas primeiro (no máximo `limit` por rodada). Quem falhou só é tentado
  // de novo depois de 30 min. Devolve {checked, refreshed:[{id, name, newEpisodes}], failed:[{id, code}]}.
  async refreshDueWorks({ limit = 5, now = Date.now() } = {}) {
    const out = { checked: 0, refreshed: [], failed: [] };
    if (this.writeBlockedBy) return out;
    const lastOf = m => Date.parse(m.refreshedAt || m.ingestedAt) || 0;
    const due = this.catalog
      .filter(m => this.isRefreshDue(m, now) && now - (this.refreshAttempts.get(m.id) || 0) >= REFRESH_RETRY_AFTER_FAILURE_MS)
      .sort((a, b) => lastOf(a) - lastOf(b))
      .slice(0, limit);
    for (const item of due) {
      out.checked++;
      try {
        const res = await this.refresh(item.id);
        if (res.refreshed) out.refreshed.push({ id: item.id, name: res.item.name, newEpisodes: res.newEpisodes });
      } catch (err) {
        this.refreshAttempts.set(item.id, now);
        out.failed.push({ id: item.id, code: (err && err.code) || 'ERRO' });
        if (err && (err.unreachable || err.breakerOpen || err.code === 'RATE_LIMITED')) break;   // fonte fora do ar/limitada: tenta depois
      }
    }
    return out;
  }

  // Conferência automática: de tempos em tempos atualiza as obras vencidas. Só o servidor de verdade liga isto (server.js); os testes não.
  startRefreshLoop({ intervalMs = 30 * 60 * 1000, initialDelayMs = 60 * 1000, limit = 5, log = console.log } = {}) {
    this.stopRefreshLoop();
    const tick = async () => {
      if (this.refreshing) return;
      this.refreshing = true;
      try {
        const res = await this.refreshDueWorks({ limit });
        if (res.refreshed.length || res.failed.length) {
          log(`[MediaService] Atualização de obras: ${res.refreshed.length} atualizada(s)${res.failed.length ? `, ${res.failed.length} com falha (tenta depois)` : ''}.`);
        }
      } catch (err) {
        console.warn('[MediaService] Atualização de obras falhou:', err && err.message);
      } finally {
        this.refreshing = false;
      }
    };
    const first = setTimeout(() => {
      tick();
      const every = setInterval(tick, intervalMs);
      every.unref();
      this.refreshTimers.push(every);
    }, initialDelayMs);
    first.unref();
    this.refreshTimers.push(first);
    return this;
  }

  stopRefreshLoop() {
    for (const t of this.refreshTimers) { clearTimeout(t); clearInterval(t); }
    this.refreshTimers = [];
  }
}

MediaService.groupJikan = MediaService.groupAnime; // nome antigo (S06)

module.exports = new MediaService();
module.exports.MediaService = MediaService;
