// S09 · frontend: detalhe sob demanda (lista leve × detalhe), cache de progresso, render incremental.
// Os scripts reais do app (state.js, views, appController.js) rodam em `vm` com um DOM mínimo simulado e uma API falsa
// ligada a um catálogo sintético; nada de rede e nada em server/data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildCatalog, buildLibrary } = require('../scripts/bench-s09');
const { toListItem } = require('../server/utils/mediaLight');

const ROOT = path.join(__dirname, '..', 'public', 'js');
const clone = (v) => JSON.parse(JSON.stringify(v));
const plain = (v) => JSON.parse(JSON.stringify(v));
const flush = () => new Promise(resolve => setImmediate(resolve));

const MOVIE = { id: 777, type: 'movie', name: 'Filme Sintético', overview: 'Sinopse do filme', runtime: 100, genres: ['Ação'], poster_path: null, vote_average: null, first_air_date: '2020-01-01', status: '' };
const catalogFor = () => [...clone(buildCatalog('atual')), clone(MOVIE)];

// ---- DOM mínimo --------------------------------------------------------------------------------

// Contêiner de cartões: guarda o HTML como lista de cartões e responde às consultas por data-show-id que as views fazem.
class FakeCards {
  constructor() { this.cards = []; this.renders = 0; this.textContent = ''; this.classList = FakeCards.classList(); this.style = {}; this.dataset = {}; }
  static classList() { const s = new Set(); return { add: (c) => s.add(c), remove: (c) => s.delete(c), toggle: (c, on) => (on === undefined ? (s.has(c) ? s.delete(c) : s.add(c)) : (on ? s.add(c) : s.delete(c))), contains: (c) => s.has(c) }; }
  set innerHTML(html) {
    this.renders++;
    this._html = html;
    this.cards = html.split(/(?=<div class="(?:next-up-card|show-card)")/).filter(part => /data-show-id="\d+"/.test(part)).map((part) => this.makeCard(part));
  }
  get innerHTML() { return this._html || ''; }
  makeCard(html) {
    const card = { html, id: Number(/data-show-id="(\d+)"/.exec(html)[1]), removed: false };
    const self = this;
    Object.defineProperty(card, 'outerHTML', { set(v) { card.html = v; card.id = Number(/data-show-id="(\d+)"/.exec(v)[1]); self.replaced.push(card.id); } });
    card.remove = () => { card.removed = true; self.cards = self.cards.filter(c => c !== card); self.removedIds.push(card.id); };
    return card;
  }
  get replaced() { return this._replaced || (this._replaced = []); }
  get removedIds() { return this._removed || (this._removed = []); }
  querySelector(sel) { const m = /\[data-show-id="(\d+)"\]/.exec(sel); return m ? (this.cards.find(c => c.id === Number(m[1])) || null) : null; }
  querySelectorAll(sel) { return sel === '[data-show-id]' ? this.cards : []; }
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
}

function makeEl(id) {
  const attrs = new Map();
  return {
    id, textContent: '', innerHTML: '', value: '', checked: false, dataset: {}, style: {}, classList: FakeCards.classList(),
    addEventListener() {}, setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), removeAttribute: (k) => attrs.delete(k),
    querySelector: () => null, querySelectorAll: () => [], focus() {}, click() {}, append() {}, remove() {}, contains: () => false
  };
}

// Um "aparelho": navegador com os scripts reais + API falsa. `catalog` = obras completas do "servidor".
function makeApp({ catalog = catalogFor(), library = null, withController = true, apiFails = false } = {}) {
  const store = new Map();
  const els = new Map();
  const cards = { 'next-up-container': new FakeCards(), 'watchlist-container': new FakeCards() };
  const el = (id) => {
    if (cards[id]) return cards[id];
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  const app = { els, cards, store, apiCalls: [], fail: apiFails, toasts: [], catalog };
  const byId = new Map(catalog.map(m => [m.id, m]));
  const ctx = {
    console, JSON, Promise, Math, Object, Array, Number, String, Map, Set, WeakMap, Error, TypeError, SyntaxError, Date, Intl, isNaN, parseInt, Symbol, Boolean,
    setTimeout: (fn) => { app.timers = (app.timers || 0) + 1; return 0; }, clearTimeout: () => {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => makeEl('x'), body: makeEl('body') },
    addEventListener() {}, dispatchEvent() {}, confirm: () => true, prompt: () => 'APAGAR'
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  ctx.apiClient = {
    async getBatch(ids) {
      app.apiCalls.push(['batch', ids.slice()]);
      if (app.fail) throw Object.assign(new TypeError('fetch failed'), {});
      const data = ids.map(id => byId.get(id)).filter(Boolean);
      return { count: data.length, data: clone(data), missing: ids.filter(id => !byId.has(id)) };
    },
    async getById(id) {
      app.apiCalls.push(['byId', id]);
      if (app.fail) throw new TypeError('fetch failed');
      return { data: clone(byId.get(id)) };
    },
    async ingest(id) { app.apiCalls.push(['ingest', id]); return { data: clone(byId.get(id)) }; },
    async getTrending(type, opts = {}) {
      app.apiCalls.push(['trending', type, opts]);
      const all = catalog.filter(m => type === 'all' || m.type === type);
      const offset = opts.offset || 0;
      const limit = opts.limit || 60;
      const data = all.slice(offset, offset + limit).map(toListItem);
      return { count: data.length, total: all.length, offset, limit, hasMore: offset + data.length < all.length, data };
    },
    async search() { return { count: 0, data: [], warnings: [] }; }
  };

  const files = ['utils/dom.js', 'utils/emotions.js', 'utils/markdown.js', 'utils/mediaDisplay.js', 'utils/viewKit.js', 'utils/libraryMerge.js', 'utils/watchStatus.js', 'utils/backupValidator.js', 'utils/migrations.js'];
  if (library) store.set('showvault_state_mvc_v1', JSON.stringify(library));
  else store.set('showvault_state_mvc_v1', JSON.stringify({ trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: { shows: {}, watched: {}, notes: {} }, resetAt: '' }));
  store.set('showvault_state_version', '2');
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf-8'), ctx, { filename: f });
  files.forEach(run);
  run('models/state.js');
  ['views/nextUpView.js', 'views/watchlistView.js', 'views/diaryView.js', 'views/statsView.js', 'views/exploreView.js', 'views/detailModalView.js'].forEach(run);
  if (withController) {
    run('controllers/appController.js');
    vm.runInContext('window.appController = Object.create(AppController.prototype); window.appController.activeTab = "next-up"; window.appController.dirty = new Set(); window.appController.renderedRev = {}; window.appController.detailChain = Promise.resolve();', ctx);
    ctx.appController.showToast = (msg, type) => app.toasts.push([type, msg]);
  }
  app.window = ctx;
  app.state = ctx.appState;
  app.text = (id) => String(els.get(id) ? els.get(id).textContent : '');
  return app;
}

// Biblioteca com as obras do catálogo: metade dos episódios assistidos (a obra grande: 300).
const libraryFor = (catalog) => buildLibrary(catalog.filter(m => m.type !== 'movie'));

// Algoritmo ANTIGO do "A Seguir" (antes da S09), usado como referência de correção.
function referenceQueue(state, W) {
  const queue = [];
  state.data.trackedShows.forEach((tracked) => {
    if (!W.isQueueStatus(state.getStatus(tracked))) return;
    const media = state.getMedia(tracked.showId);
    if (!media) return;
    if (media.type === 'movie') { if (!state.isWatched(media.id)) queue.push({ showId: media.id, isMovie: true }); return; }
    if (!media.seasons) return;
    for (const season of media.seasons) {
      let found = false;
      for (const ep of season.episodes || []) {
        if (!state.isWatched(media.id, season.season_number, ep.episode_number)) {
          queue.push({ showId: media.id, seasonNumber: season.season_number, episodeNumber: ep.episode_number, title: ep.name });
          found = true;
          break;
        }
      }
      if (found) break;
    }
  });
  return queue;
}

async function loadAll(app) {
  await app.window.appController.onLibraryChanged();
}

// ---------------------------------------------------------------- estado: lista leve × detalhe

test('estado: item leve não rebaixa o detalhe já carregado; só o detalhe tem episódios', () => {
  const app = makeApp();
  const s = app.state;
  const full = app.catalog[0];
  s.cacheMediaList([toListItem(full)]);
  assert.equal(s.hasDetail(full.id), false);
  assert.equal(s.getMedia(full.id).seasons, undefined);
  s.cacheMediaDetail(clone(full));
  assert.equal(s.hasDetail(full.id), true);
  s.cacheMediaList([toListItem(full), { ...clone(full), isExternal: true }]); // explorar de novo / resultado de busca
  assert.equal(s.hasDetail(full.id), true, 'o detalhe continua lá');
  assert.ok(Array.isArray(s.getMedia(full.id).seasons));
  // item completo vindo sem a marca `light` (formato antigo/testes) conta como completo
  s.cacheMediaList([clone(app.catalog[1])]);
  assert.equal(s.hasDetail(app.catalog[1].id), true);
  // item novo que não está no mapa entra normalmente
  s.cacheMediaList([toListItem(app.catalog[2])]);
  assert.equal(s.getMedia(app.catalog[2].id).light, true);
});

test('progresso em cache: igual ao cálculo direto, e invalida ao marcar, desmarcar, em lote, ao trocar dados e ao trocar o catálogo', () => {
  const catalog = catalogFor();
  const app = makeApp({ catalog });
  const s = app.state;
  const W = app.window.WatchStatus;
  const media = catalog[0];
  s.cacheMediaDetail(clone(media));
  s.addShow(media.id);
  const direct = () => W.computeProgress(s.getMedia(media.id), (se, ep) => s.isWatched(media.id, se, ep));
  const cached = () => { const { next, ...rest } = s.getProgress(media.id); return plain(rest); };
  assert.deepEqual(cached(), plain(direct()));
  assert.deepEqual(plain(s.getNextEpisode(media.id)), { seasonNumber: 1, episodeNumber: 1 });

  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const eps = media.seasons.flatMap(se => se.episodes.map(e => [se.season_number, e.episode_number]));
  for (let i = 0; i < 60; i++) {
    const [se, ep] = eps[Math.floor(rand() * eps.length)];
    s.toggleWatched(media.id, se, ep);
    assert.deepEqual(cached(), plain(direct()), `depois de alternar S${se}E${ep}`);
    const first = eps.find(([a, b]) => !s.isWatched(media.id, a, b));
    assert.deepEqual(plain(s.getNextEpisode(media.id)), first ? { seasonNumber: first[0], episodeNumber: first[1] } : null);
  }
  s.batchSetSeason(media.id, 1, true);
  assert.deepEqual(cached(), plain(direct()));
  s.batchSetSeason(media.id, 1, false);
  assert.deepEqual(cached(), plain(direct()));

  // trocar os dados (login, importar backup, resetar) limpa o cache
  const ok = clone(s.data);
  ok.watchedEpisodes = {};
  eps.slice(0, 7).forEach(([se, ep]) => { ok.watchedEpisodes[`${media.id}_s${se}_e${ep}`] = { watched: true, watchedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', rewatchCount: 1 }; });
  s.replaceData(ok);
  assert.equal(s.getProgress(media.id).watched, 7);
  s.resetLocal();
  assert.equal(s.getProgress(media.id).watched, 0);
  // alteração direta (fora dos métodos) + invalidateProgress
  s.data.watchedEpisodes[`${media.id}_s1_e1`] = { watched: true, watchedAt: 'x', rewatchCount: 1 };
  s.invalidateProgress(media.id);
  assert.equal(s.getProgress(media.id).watched, 1);
  // chegou um detalhe novo da obra (mais episódios): o cache acompanha o objeto novo
  const bigger = clone(media);
  bigger.seasons[0].episodes.push({ episode_number: 999, name: 'Extra', runtime: 10 });
  const total = s.getProgress(media.id).total;
  s.cacheMediaDetail(bigger);
  assert.equal(s.getProgress(media.id).total, total + 1);
});

test('getStatus: item antigo (sem updatedAt) com tudo assistido continua "Finalizado"; os demais não varrem episódios', () => {
  const catalog = catalogFor();
  const app = makeApp({ catalog });
  const s = app.state;
  const m = catalog.find(x => x.seasons && totalEps(x) < 40);
  s.cacheMediaDetail(clone(m));
  s.data.trackedShows.push({ showId: m.id, status: 'watching', addedAt: '2026-10-01T00:00:00.000Z' });
  for (const se of m.seasons) for (const ep of se.episodes) s.data.watchedEpisodes[`${m.id}_s${se.season_number}_e${ep.episode_number}`] = { watched: true, watchedAt: 'x', rewatchCount: 1 };
  s.invalidateProgress();
  assert.equal(s.getStatus(s.getTracked(m.id)), 'completed');
  s.setShowStatus(m.id, 'watching');
  assert.equal(s.getStatus(s.getTracked(m.id)), 'watching', 'depois de escolher, o status vale como escolhido');
});

function totalEps(m) { return m.seasons.reduce((n, se) => n + se.episodes.length, 0); }

test('getEpisode: índice por obra (o primeiro quando há repetido) e null fora do catálogo', () => {
  const app = makeApp();
  const s = app.state;
  const m = clone(app.catalog[0]);
  m.seasons[0].episodes.push({ episode_number: 1, name: 'Repetido' });
  s.cacheMediaDetail(m);
  assert.equal(s.getEpisode(m.id, 1, 1).name, m.seasons[0].episodes[0].name);
  assert.equal(s.getEpisode(m.id, 99, 1), null);
  assert.equal(s.getEpisode(424242, 1, 1), null);
  s.cacheMediaList([toListItem(app.catalog[3])]);
  assert.equal(s.getEpisode(app.catalog[3].id, 1, 1), null, 'item leve não tem episódios');
});

// ---------------------------------------------------------------- carregar o detalhe sob demanda

test('ao abrir: as obras da lista carregam o detalhe em lotes de 50, uma única vez; A Seguir/Lista/Estatísticas batem com o cálculo antigo', async () => {
  const catalog = catalogFor();
  const library = libraryFor(catalog);
  const app = makeApp({ catalog, library });
  const w = app.window;
  const ids = library.trackedShows.map(t => t.showId);
  assert.equal(app.state.mediaMap.size, 0, 'nada do catálogo é carregado de antemão');

  await loadAll(app);
  const batches = app.apiCalls.filter(c => c[0] === 'batch');
  assert.equal(batches.length, Math.ceil(ids.length / 50));
  assert.ok(batches.every(c => c[1].length <= 50));
  assert.deepEqual(batches.flatMap(c => c[1]).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b));
  assert.equal(app.apiCalls.filter(c => c[0] === 'trending').length, 0, 'a lista do catálogo não é buscada ao abrir');
  assert.equal(app.state.detailsStatus, 'idle');
  assert.ok(ids.every(id => app.state.hasDetail(id)));

  // chegou outra sincronização, nada novo: nenhuma requisição a mais
  await w.appController.onLibraryChanged();
  assert.equal(app.apiCalls.filter(c => c[0] === 'batch').length, batches.length);

  // A Seguir: mesma fila do algoritmo antigo
  const W = w.WatchStatus;
  const expected = referenceQueue(app.state, W);
  const got = plain(w.nextUpView.calculateQueue());
  assert.deepEqual(got.map(q => [q.showId, q.seasonNumber, q.episodeNumber, q.title]), expected.map(q => [q.showId, q.seasonNumber, q.episodeNumber, q.title]));
  assert.ok(got.length > 5);
  assert.equal(app.cards['next-up-container'].cards.length, got.length);
  assert.equal(app.text('badge-next-up'), String(got.length));

  // Estatísticas: minutos e episódios iguais ao cálculo antigo (busca linear por temporada/episódio)
  let minutes = 0;
  let count = 0;
  for (const [key, item] of Object.entries(app.state.data.watchedEpisodes)) {
    if (!item.watched) continue;
    count++;
    const [sid, se, ep] = key.split('_');
    const media = app.state.getMedia(Number(sid));
    const season = media.seasons.find(s => s.season_number === Number(se.slice(1)));
    if (season) {
      const e = season.episodes.find(x => x.episode_number === Number(ep.slice(1)));
      minutes += ((e && e.runtime) ? e.runtime : 45) * (item.rewatchCount || 1);
    }
  }
  w.statsView.render();
  assert.equal(app.text('stat-episodes-count'), String(count));
  assert.equal(app.text('stat-minutes-subtext'), `${minutes.toLocaleString('pt-BR')} minutos assistidos`);

  // Minha Lista: progresso por obra
  w.watchlistView.render();
  const big = catalog[0];
  const bigCard = app.cards['watchlist-container'].querySelector(`[data-show-id="${big.id}"]`);
  const prog = app.state.getProgress(big.id);
  assert.ok(bigCard.html.includes(`${prog.watched}/${prog.total} eps`));
  assert.equal(app.text('badge-watchlist'), String(ids.length));
});

test('diário: o episódio da anotação vem do detalhe (título e imagem), e sem detalhe cai no "Episódio N"', async () => {
  const catalog = catalogFor();
  const m = catalog[1];
  const library = libraryFor(catalog);
  library.episodeNotes[`${m.id}_s1_e2`] = { text: 'Gostei', emotion: 'love', character: '', updatedAt: '2026-10-02T00:00:00.000Z', snapshots: [] };
  const app = makeApp({ catalog, library });
  app.state.cacheMediaList([toListItem(m)]); // só a versão leve
  const entriesLight = app.window.diaryView.buildEntries();
  assert.equal(entriesLight[0].epTitle, 'Episódio 2');
  await loadAll(app);
  const entries = app.window.diaryView.buildEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].epTitle, m.seasons[0].episodes[1].name);
});

test('falha ao carregar o detalhe: A Seguir mostra aviso com "Tentar de novo", e a nova tentativa recupera', async () => {
  const catalog = catalogFor();
  const library = libraryFor(catalog);
  const app = makeApp({ catalog, library, apiFails: true });
  const w = app.window;
  await loadAll(app);
  assert.equal(app.state.detailsStatus, 'error');
  const html = app.els.get('next-up-container') || app.cards['next-up-container'];
  assert.match(app.cards['next-up-container'].innerHTML, /Não foi possível carregar os episódios/);
  assert.match(app.cards['next-up-container'].innerHTML, /type="button"[^>]*data-focus-key="nuload:retry"/);
  assert.equal(html !== undefined, true);

  app.fail = false;
  await w.appController.retryDetails();
  assert.equal(app.state.detailsStatus, 'idle');
  assert.ok(app.cards['next-up-container'].cards.length > 5, 'a fila apareceu');
});

test('"Carregar exemplo" busca o detalhe das obras de exemplo antes de adicionar', async () => {
  const catalog = catalogFor();
  const ids = [157336, 872585, 1396, 1429];
  const examples = ids.map(id => ({ id, type: id === 1396 ? 'tv' : (id === 1429 ? 'anime' : 'movie'), name: `Exemplo ${id}`, genres: [], seasons: id === 1396 || id === 1429 ? [{ season_number: 1, episodes: [{ episode_number: 1, name: 'E1' }] }] : undefined }));
  const app = makeApp({ catalog: [...catalog, ...examples] });
  await app.window.appController.loadExample();
  assert.deepEqual(app.apiCalls.filter(c => c[0] === 'batch').flatMap(c => c[1]).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b));
  assert.deepEqual(app.state.data.trackedShows.map(t => t.showId).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b));
  assert.ok(app.toasts.some(([, m]) => /Exemplo carregado/.test(m)));
});

test('adicionar uma obra do catálogo vinda da lista leve busca o detalhe (público, sem ingestão) e só então entra na lista', async () => {
  const catalog = catalogFor();
  const app = makeApp({ catalog });
  const m = catalog[2];
  app.state.cacheMediaList([toListItem(m)]);
  await app.window.appController.addToList(m.id);
  assert.deepEqual(app.apiCalls.filter(c => c[0] === 'byId'), [['byId', m.id]]);
  assert.equal(app.apiCalls.filter(c => c[0] === 'ingest').length, 0);
  assert.equal(app.state.hasDetail(m.id), true);
  assert.equal(app.state.getTracked(m.id).status, 'plan_to_watch');
  // já com detalhe: não pede de novo
  await app.window.appController.addToList(catalog[3].id);
  await app.window.appController.addToList(catalog[3].id);
  assert.equal(app.apiCalls.filter(c => c[0] === 'byId').length, 2);
});

// ---------------------------------------------------------------- render incremental

test('marcar um episódio troca só o cartão da obra; abas ocultas não são desenhadas e os números continuam certos', async () => {
  const catalog = catalogFor();
  const library = libraryFor(catalog);
  const app = makeApp({ catalog, library });
  const w = app.window;
  await loadAll(app);
  const nu = app.cards['next-up-container'];
  const wl = app.cards['watchlist-container'];
  assert.equal(wl.renders, 0, 'Minha Lista oculta nunca foi desenhada');
  const rendersBefore = nu.renders;
  const target = nu.cards[3];
  const others = nu.cards.filter(c => c !== target).map(c => c.html);
  const next = app.state.getNextEpisode(target.id);

  w.appController.quickCheck(target.id, next.seasonNumber, next.episodeNumber);
  assert.equal(nu.renders, rendersBefore, 'a lista de cartões não foi reconstruída');
  assert.deepEqual(nu.replaced, [target.id], 'só o cartão da obra foi trocado');
  assert.deepEqual(nu.cards.filter(c => c !== target).map(c => c.html), others);
  const after = app.state.getNextEpisode(target.id);
  assert.match(target.html, new RegExp(`T${after.seasonNumber}:E${after.episodeNumber}`), 'o cartão mostra o episódio seguinte');
  assert.equal(wl.renders, 0, 'aba oculta continua sem desenhar');
  assert.equal(app.text('badge-next-up'), String(w.nextUpView.calculateQueue().length));

  // ao abrir Minha Lista, ela desenha já com o progresso novo (e só uma vez)
  w.appController.switchTab('watchlist');
  assert.equal(wl.renders, 1);
  const prog = app.state.getProgress(target.id);
  assert.ok(wl.querySelector(`[data-show-id="${target.id}"]`).html.includes(`${prog.watched}/${prog.total} eps`));
  w.appController.switchTab('watchlist'); // nada mudou: não redesenha
  assert.equal(wl.renders, 1);

  // com Minha Lista visível, marcar um episódio troca só o cartão dela
  const other = wl.cards[5].id;
  const nextOther = app.state.getNextEpisode(other);
  w.appController.quickCheck(other, nextOther.seasonNumber, nextOther.episodeNumber);
  assert.equal(wl.renders, 1);
  assert.deepEqual(wl.replaced, [other]);
  // e o "A Seguir" oculto fica certo quando voltar
  const nuRenders = nu.renders;
  w.appController.switchTab('next-up');
  assert.equal(nu.renders, nuRenders + 1, 'A Seguir estava desatualizada e redesenhou ao abrir');
  assert.deepEqual(nu.cards.map(c => c.id), plain(w.nextUpView.calculateQueue().map(q => q.showId)));
});

test('terminar a obra tira o cartão da fila sem reconstruir a lista; o último cartão cai no estado "em dia"', async () => {
  const catalog = catalogFor().slice(0, 3);
  const library = libraryFor(catalog);
  // deixa cada obra com UM episódio faltando
  for (const m of catalog) {
    for (const se of m.seasons) for (const ep of se.episodes) library.watchedEpisodes[`${m.id}_s${se.season_number}_e${ep.episode_number}`] = { watched: true, watchedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', rewatchCount: 1 };
    const last = m.seasons[m.seasons.length - 1];
    delete library.watchedEpisodes[`${m.id}_s${last.season_number}_e${last.episodes[last.episodes.length - 1].episode_number}`];
  }
  const app = makeApp({ catalog, library });
  const w = app.window;
  await loadAll(app);
  const nu = app.cards['next-up-container'];
  assert.equal(nu.cards.length, 3);
  const finish = (m) => {
    const last = m.seasons[m.seasons.length - 1];
    w.appController.quickCheck(m.id, last.season_number, last.episodes[last.episodes.length - 1].episode_number);
  };
  const renders = nu.renders;
  finish(catalog[0]);
  assert.equal(nu.renders, renders, 'sem reconstruir');
  assert.deepEqual(nu.removedIds, [catalog[0].id]);
  assert.equal(nu.cards.length, 2);
  assert.equal(app.text('badge-next-up'), '2');
  assert.equal(app.text('next-up-counter-pill'), '2 títulos na fila');
  finish(catalog[1]);
  assert.equal(app.text('next-up-counter-pill'), '1 título na fila');
  finish(catalog[2]);
  assert.equal(nu.renders, renders + 1, 'o último cartão cai no render completo (estado vazio)');
  assert.equal(nu.cards.length, 0);
  assert.equal(app.text('badge-next-up'), '0');
});

test('mudar o status de uma obra com a Lista aberta troca só o cartão; se ela sai do filtro, a lista é redesenhada', async () => {
  const catalog = catalogFor().slice(0, 4);
  const app = makeApp({ catalog, library: libraryFor(catalog) });
  const w = app.window;
  await loadAll(app);
  w.appController.switchTab('watchlist');
  const wl = app.cards['watchlist-container'];
  const renders = wl.renders;
  const id = catalog[1].id;
  w.appController.setStatus(id, 'paused');
  assert.equal(wl.renders, renders, 'filtro "Todos": o cartão só é trocado');
  assert.deepEqual(wl.replaced, [id]);
  assert.match(wl.querySelector(`[data-show-id="${id}"]`).html, /<option value="paused" selected>/);
  assert.equal(app.text('count-paused'), '1');
  // a obra pausada sai da fila "A Seguir" (aba oculta: redesenha ao abrir)
  w.appController.switchTab('next-up');
  assert.ok(!app.cards['next-up-container'].cards.some(c => c.id === id));
  // filtro "Em andamento": pausar tira a obra da lista visível => redesenho completo
  w.appController.switchTab('watchlist');
  w.watchlistView.statusFilter = 'watching';
  w.watchlistView.render();
  const r2 = wl.renders;
  w.appController.setStatus(catalog[0].id, 'dropped');
  assert.equal(wl.renders, r2 + 1);
  assert.ok(!wl.cards.some(c => c.id === catalog[0].id));
});

test('refreshAll desenha só a aba visível, mas os números das abas ficam em dia', async () => {
  const catalog = catalogFor();
  const app = makeApp({ catalog, library: libraryFor(catalog) });
  const w = app.window;
  await loadAll(app);
  const counts = { nu: app.cards['next-up-container'].renders, wl: app.cards['watchlist-container'].renders };
  w.appController.refreshAll();
  assert.equal(app.cards['next-up-container'].renders, counts.nu + 1);
  assert.equal(app.cards['watchlist-container'].renders, counts.wl);
  assert.equal(app.text('badge-watchlist'), String(app.state.data.trackedShows.length));
  // anotação gravada com outra aba aberta: o diário redesenha ao abrir (revisão do estado) e o número da aba está certo
  const m = catalog[0];
  app.state.saveNote(m.id, 1, 1, { text: 'nota', emotion: 'love', character: '' });
  assert.equal(app.text('badge-diary'), '0', 'sem passar pelo controlador ainda não mudou');
  w.appController.refreshAll();
  assert.equal(app.text('badge-diary'), '1');
});

test('regressão de custo: marcar 1 episódio com 2.800+ rastreados varre só os episódios da obra alterada', async () => {
  const catalog = buildCatalog('grande');
  const library = buildLibrary(catalog);
  const app = makeApp({ catalog, library });
  const w = app.window;
  await loadAll(app);
  const trackedEpisodes = Object.keys(app.state.data.watchedEpisodes).length;
  assert.ok(trackedEpisodes > 1000, `rastreados: ${trackedEpisodes}`);
  let calls = 0;
  const original = app.state.isWatched.bind(app.state);
  app.state.isWatched = (...args) => { calls++; return original(...args); };
  const small = catalog[7];
  const next = app.state.getNextEpisode(small.id);
  w.appController.quickCheck(small.id, next.seasonNumber, next.episodeNumber);
  const smallTotal = totalEps(small);
  assert.ok(calls <= smallTotal * 2 + 20, `isWatched chamado ${calls}x (obra tem ${smallTotal} episódios)`);

  // a obra gigante (1.100 episódios numa temporada): o custo é o dela, não o da biblioteca inteira
  calls = 0;
  const big = catalog[0];
  w.appController.quickCheck(big.id, 1, 900);
  assert.ok(calls <= totalEps(big) * 2 + 20, `obra grande: isWatched chamado ${calls}x`);
});

// ---------------------------------------------------------------- modal de detalhes

test('modal: marcar um episódio atualiza só a linha, o rótulo da temporada e o resumo (sem reconstruir a lista)', async () => {
  const catalog = buildCatalog('grande'); // a 1ª obra tem 1.100 episódios numa só temporada
  const m = catalog[0];
  const app = makeApp({ catalog, library: buildLibrary(catalog) });
  const w = app.window;
  await loadAll(app);
  const dv = w.detailModalView;
  dv.currentShowId = m.id;
  dv.currentSeasonNum = 1;

  const rowAttrs = new Map([['aria-checked', 'false']]);
  const mark = { textContent: '' };
  const classes = FakeCards.classList();
  const check = { setAttribute: (k, v) => rowAttrs.set(k, v), querySelector: () => mark };
  const row = { classList: classes, querySelector: (sel) => (sel === '.episode-check' ? check : null), getAttribute: () => '700' };
  const container = makeEl('show-episodes-container');
  container.querySelector = (sel) => (sel === '[data-ep="700"]' ? row : null);
  container.querySelectorAll = (sel) => (sel === '[data-ep]' ? [row] : []);
  app.els.set('show-episodes-container', container);
  const tab = makeEl('season-tab-1');
  app.els.set('season-tab-1', tab);
  const summary = makeEl('season-stats-summary');
  app.els.set('season-stats-summary', summary);

  const before = app.state.getProgress(m.id).watched;
  w.appController.quickCheck(m.id, 1, 700); // 700 ainda não assistido (a obra grande tem 300)
  assert.equal(classes.contains('watched'), true);
  assert.equal(rowAttrs.get('aria-checked'), 'true');
  assert.equal(mark.textContent, '✓');
  assert.equal(tab.textContent, `Temporada 1 (${before + 1}/${totalEps(m)})`);
  assert.match(summary.innerHTML, new RegExp(`${before + 1}/${totalEps(m)} assistidos`));
  w.appController.quickCheck(m.id, 1, 700); // desmarca
  assert.equal(classes.contains('watched'), false);
  assert.equal(rowAttrs.get('aria-checked'), 'false');
  assert.equal(mark.textContent, '');
  assert.equal(tab.textContent, `Temporada 1 (${before}/${totalEps(m)})`);
});

test('modal: obra da lista leve mostra "Carregando", busca o detalhe e redesenha; se falhar, avisa', async () => {
  const catalog = catalogFor();
  const m = catalog[2];
  const app = makeApp({ catalog });
  const w = app.window;
  app.state.cacheMediaList([toListItem(m)]);
  const dv = w.detailModalView;
  let opens = 0;
  const realOpen = dv.open.bind(dv);
  dv.open = (id) => { opens++; return realOpen(id); };
  dv.open(m.id);
  assert.equal(opens, 1);
  assert.match(app.els.get('show-episodes-container').innerHTML, /Carregando episódios/);
  await flush(); await flush(); await flush();
  assert.equal(app.state.hasDetail(m.id), true);
  assert.equal(opens, 2, 'redesenhou uma vez com o detalhe');
  assert.match(app.els.get('show-episodes-container').innerHTML || '', /episode-row|^$/);

  // falha de rede
  const app2 = makeApp({ catalog, apiFails: true });
  app2.state.cacheMediaList([toListItem(m)]);
  app2.window.detailModalView.open(m.id);
  await flush(); await flush(); await flush();
  assert.match(app2.els.get('show-episodes-container').innerHTML, /Não foi possível carregar os episódios/);
  assert.equal(app2.state.detailsStatus, 'error');
});

test('modal: resultado externo (ainda não adicionado) não tenta buscar o detalhe e explica que os episódios vêm depois', () => {
  const app = makeApp();
  app.state.cacheMediaList([{ id: 1004242, type: 'tv', name: 'Externa', isExternal: true, overview: 'Sinopse', genres: [] }]);
  app.window.detailModalView.open(1004242);
  assert.match(app.els.get('show-episodes-container').innerHTML, /depois que a obra é adicionada/);
  assert.equal(app.apiCalls.length, 0);
});

// ---------------------------------------------------------------- Explorar

test('Explorar: a lista leve mostra o nº de temporadas e o "Mostrar mais" acrescenta a próxima página', async () => {
  const many = [];
  for (let i = 0; i < 130; i++) many.push({ ...clone(catalogFor()[0]), id: 2000 + i, name: `Obra ${i}` });
  const app = makeApp({ catalog: many });
  const w = app.window;
  const ev = w.exploreView;
  ev.container = app.els.get('explore-container') || (app.els.set('explore-container', makeEl('explore-container')), app.els.get('explore-container'));
  ev.titleEl = makeEl('title');
  await ev.loadMedia();
  assert.equal(ev.titleEl.textContent, 'Catálogo (130)');
  assert.equal(ev.items.length, 60);
  assert.equal(ev.hasMore, true);
  assert.match(ev.container.innerHTML, /data-focus-key="ex:more:load"/);
  assert.match(ev.container.innerHTML, /<button type="button"[^>]*data-focus-key="ex:more:load"/);
  assert.match(ev.container.innerHTML, /\d+ temporadas?/);
  await ev.loadMore();
  assert.equal(ev.items.length, 120);
  assert.deepEqual(plain(app.apiCalls.filter(c => c[0] === 'trending').map(c => c[2])), [{ limit: 60 }, { limit: 60, offset: 60 }]);
  await ev.loadMore();
  assert.equal(ev.items.length, 130);
  assert.equal(ev.hasMore, false);
  assert.doesNotMatch(ev.container.innerHTML, /ex:more:load/);
  // itens leves no mapa: nunca contam como completos
  assert.equal(app.state.hasDetail(2000), false);
  assert.equal(ev.metaText({ type: 'tv', season_count: 1 }), '1 temporada');
  assert.equal(ev.metaText({ type: 'movie', runtime: 120 }), w.MediaDisplay.runtimeText(120));
});

test('Explorar redesenha os cartões já carregados depois de adicionar/remover uma obra (S10), sem nova busca', async () => {
  const app = makeApp({ catalog: clone(catalogFor()) });
  const w = app.window;
  const ev = w.exploreView;
  ev.container = app.els.get('explore-container') || (app.els.set('explore-container', makeEl('explore-container')), app.els.get('explore-container'));
  ev.titleEl = makeEl('title');
  await ev.loadMedia();
  const id = ev.items[0].id;
  assert.match(ev.container.innerHTML, new RegExp(`data-action="add-to-list" data-show="${id}"`));
  const calls = app.apiCalls.length;

  app.state.addShow(id);
  ev.refresh();
  assert.doesNotMatch(ev.container.innerHTML, new RegExp(`data-action="add-to-list" data-show="${id}"`), 'agora é "Ver no Cofre"');
  assert.match(ev.container.innerHTML, new RegExp(`data-focus-key="ex:${id}:action" data-action="open-detail" data-show="${id}"`));

  app.state.removeShow(id);
  ev.refresh();
  assert.match(ev.container.innerHTML, new RegExp(`data-action="add-to-list" data-show="${id}"`));
  assert.equal(app.apiCalls.length, calls, 'não buscou de novo');

  ev.items = [];
  ev.container.innerHTML = 'mensagem';
  ev.refresh(); // sem cartões: não mexe
  assert.equal(ev.container.innerHTML, 'mensagem');
});

// ---------------------------------------------------------------- compatibilidade

test('nenhuma view usa style= em template (S10: as larguras dinâmicas viraram classes .pct-N) e imagens lazy têm decoding async', () => {
  const views = ['nextUpView', 'watchlistView', 'diaryView', 'statsView', 'exploreView', 'detailModalView'];
  const allowed = {}; // S10: nenhuma view usa style= (as larguras viraram classes .pct-N)
  for (const v of views) {
    const code = fs.readFileSync(path.join(ROOT, 'views', `${v}.js`), 'utf8');
    const styles = (code.match(/\sstyle="/g) || []).length;
    assert.ok(styles <= (allowed[v] || 0), `${v}: ${styles} style= em template`);
    for (const m of code.matchAll(/<img\b[^>]*>/g)) {
      if (/loading="lazy"/.test(m[0])) assert.match(m[0], /loading="lazy" decoding="async"/, `${v}: img lazy sem decoding async`);
    }
  }
});
