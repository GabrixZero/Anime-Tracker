// S13 · frontend: id canônico ao adicionar (a obra pode voltar do servidor com
// outro id: a amostra do seed trocada pela obra real) e avisos de fonte cobertos pela reserva. Os scripts reais do app rodam em `vm`
// com um DOM mínimo simulado e uma API falsa; nada de rede, nada em server/data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'public');

// ---------------------------------------------------------------- HTML / acessibilidade (estático)

// ---------------------------------------------------------------- um "aparelho" com os scripts reais

class FakeClassList {
  constructor(initial = []) {
    this.set = new Set(initial);
  }
  add(c) {
    this.set.add(c);
  }
  remove(c) {
    this.set.delete(c);
  }
  toggle(c, on) {
    if (on === undefined ? !this.set.has(c) : on) this.set.add(c);
    else this.set.delete(c);
  }
  contains(c) {
    return this.set.has(c);
  }
}

function makeEl(id, classes = []) {
  const attrs = new Map();
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    dataset: {},
    style: {},
    classList: new FakeClassList(classes),
    focused: 0,
    addEventListener() {},
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: k => attrs.delete(k),
    querySelector: () => null,
    querySelectorAll: () => [],
    click() {},
    append() {},
    remove() {},
    contains: () => false,
    focus() {
      el.focused++;
      doc.activeElement = el;
    }
  };
  return el;
}
let doc = null;

function makeApp({ catalog = [] } = {}) {
  const store = new Map();
  const els = new Map();
  const heading = makeEl('h2');
  const el = id => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  const app = { els, toasts: [], apiCalls: [], byId: new Map(catalog.map(m => [m.id, m])), heading };
  doc = {
    getElementById: el,
    querySelector: sel => (sel === '#view-watchlist h2' ? heading : null),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => makeEl('x'),
    body: makeEl('body'),
    activeElement: null
  };
  const ctx = {
    console,
    JSON,
    Promise,
    Math,
    Object,
    Array,
    Number,
    String,
    Map,
    Set,
    WeakMap,
    Error,
    TypeError,
    SyntaxError,
    Date,
    Intl,
    isNaN,
    parseInt,
    Symbol,
    Boolean,
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        store.set(k, String(v));
      },
      removeItem: k => {
        store.delete(k);
      }
    },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    document: doc,
    addEventListener() {},
    dispatchEvent() {},
    confirm: () => true,
    prompt: () => 'APAGAR'
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ctx.apiClient = {
    async getById(id) {
      app.apiCalls.push(['byId', id]);
      const found = app.resolveId ? app.resolveId(id) : app.byId.get(id);
      if (!found) throw Object.assign(new Error('Entre na sua conta para adicionar novas obras ao catálogo.'), { status: 401 });
      return { data: JSON.parse(JSON.stringify(found)) };
    },
    async getBatch(ids) {
      app.apiCalls.push(['batch', ids.slice()]);
      return { count: 0, data: ids.map(id => app.byId.get(id)).filter(Boolean), missing: [] };
    }
  };
  store.set(
    'showvault_state_mvc_v1',
    JSON.stringify({
      trackedShows: [],
      watchedEpisodes: {},
      episodeNotes: {},
      tombstones: { shows: {}, watched: {}, notes: {} },
      resetAt: ''
    })
  );
  store.set('showvault_state_version', '2');
  const run = (...f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', ...f), 'utf-8'), ctx, { filename: f.join('/') });
  [
    'utils/dom.js',
    'utils/emotions.js',
    'utils/markdown.js',
    'utils/mediaDisplay.js',
    'utils/viewKit.js',
    'utils/libraryMerge.js',
    'utils/rating.js',
    'utils/watchStatus.js',
    'utils/backupValidator.js',
    'utils/migrations.js',
    'models/state.js'
  ].forEach(f => run(...f.split('/')));
  ['nextUpView', 'watchlistView', 'diaryView', 'statsView', 'exploreView', 'detailModalView'].forEach(v => run('views', `${v}.js`));
  run('controllers', 'appController.js');
  vm.runInContext(
    'window.appController = Object.create(AppController.prototype); window.appController.activeTab = "watchlist"; window.appController.dirty = new Set(); window.appController.renderedRev = {}; window.appController.detailChain = Promise.resolve();',
    ctx
  );
  ctx.appController.showToast = (msg, type) => app.toasts.push([type, msg]);
  app.window = ctx;
  app.state = ctx.appState;
  app.controller = ctx.appController;
  return app;
}

const SEED = [
  { id: 157336, type: 'movie', name: 'Interestelar', genres: [], runtime: 169 },
  { id: 872585, type: 'movie', name: 'Oppenheimer', genres: [], runtime: 180 },
  {
    id: 1396,
    type: 'tv',
    name: 'Breaking Bad',
    genres: [],
    seasons: [
      {
        season_number: 1,
        name: 'T1',
        episodes: [
          { episode_number: 1, name: 'Piloto' },
          { episode_number: 2, name: 'Dois' }
        ]
      }
    ]
  },
  {
    id: 1429,
    type: 'anime',
    name: 'Attack on Titan',
    genres: [],
    seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }] }]
  }
];
const OTHER = {
  id: 777,
  type: 'tv',
  name: 'Outra série',
  genres: [],
  seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }] }]
};
const withSeed = () => {
  const app = makeApp({ catalog: [...SEED, OTHER] });
  app.state.cacheMediaDetail(JSON.parse(JSON.stringify(SEED[2])));
  app.state.cacheMediaList(SEED.map(m => (m.id === 1396 ? { ...m, seasons: undefined, light: true } : m)));
  app.state.cacheMediaDetail(JSON.parse(JSON.stringify(SEED[2])));
  SEED.forEach(m => app.state.addShow(m.id));
  assert.deepEqual(ids(app), [1396, 1429, 157336, 872585]);
  return app;
};
const ids = app => app.state.data.trackedShows.map(t => t.showId).sort((a, b) => a - b);

// ---------------------------------------------------------------- adicionar: id canônico

test('adicionar um resultado externo que o servidor devolve com OUTRO id (amostra do seed trocada pela obra real): entra a obra real, sem duplicar', async () => {
  const real = {
    id: 1429,
    type: 'anime',
    name: 'Attack on Titan',
    genres: [],
    seasons: [
      {
        season_number: 1,
        name: 'T1',
        episodes: [
          { episode_number: 1, name: 'E1' },
          { episode_number: 2, name: 'E2' }
        ]
      }
    ]
  };
  const app = makeApp({ catalog: [] });
  app.resolveId = id => (id === 10016498 ? real : null);
  app.state.cacheMediaList([{ id: 10016498, type: 'anime', name: 'Attack on Titan', isExternal: true, catalog_id: 1429, genres: [] }]);

  await app.controller.addToList(10016498);
  assert.deepEqual(app.apiCalls, [['byId', 10016498]]);
  assert.deepEqual(ids(app), [1429], 'a obra entra com o id que o servidor devolveu');
  assert.equal(app.state.hasDetail(1429), true);
  assert.ok(app.toasts.some(([type, msg]) => type === 'success' && /Adicionado/.test(msg)));

  // de novo, pelo resultado externo: já está na lista (pelo catalog_id), nem pergunta ao servidor
  app.apiCalls.length = 0;
  await app.controller.addToList(10016498);
  assert.deepEqual(app.apiCalls, []);
  assert.ok(app.toasts.some(([, msg]) => /já está na sua lista/.test(msg)));
  assert.equal(ids(app).length, 1);
});

test('adicionar: quem já tem a obra (a amostra do seed) e pede o mesmo resultado externo não ganha uma segunda cópia', async () => {
  const app = withSeed();
  app.state.cacheMediaList([{ id: 10016498, type: 'anime', name: 'Attack on Titan', isExternal: true, catalog_id: 1429, genres: [] }]);
  await app.controller.addToList(10016498);
  assert.deepEqual(app.apiCalls, [], 'o catalog_id já está na lista: nada a fazer');
  assert.equal(ids(app).length, 4);

  // sem o catalog_id no cache (ex.: lista antiga) o servidor devolve a obra com o id da amostra: ainda assim não duplica
  const second = withSeed();
  second.resolveId = () => ({ ...SEED[3], seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }] }] });
  second.state.cacheMediaList([{ id: 10025777, type: 'anime', name: 'Attack on Titan Season 2', isExternal: true, genres: [] }]);
  await second.controller.addToList(10025777);
  assert.equal(ids(second).length, 4);
  assert.ok(second.toasts.some(([, msg]) => /já está na sua lista/.test(msg)));
});

test('adicionar sem login: a mensagem do servidor aparece e nada entra na lista', async () => {
  const app = makeApp({ catalog: [] });
  app.state.cacheMediaList([{ id: 10000020, type: 'anime', name: 'Naruto', isExternal: true, genres: [] }]);
  await app.controller.addToList(10000020);
  assert.deepEqual(ids(app), []);
  assert.ok(app.toasts.some(([type, msg]) => type === 'error' && /Entre na sua conta/.test(msg)));
});

// ---------------------------------------------------------------- Explorar: catalog_id e avisos

test('Explorar: resultado externo cuja obra (catalog_id) já está na lista mostra "Ver no Cofre" abrindo a obra da lista; senão "Adicionar" com o id externo', () => {
  const app = withSeed();
  const view = app.window.exploreView;
  view.container = makeEl('explore-container');
  view.hasMore = false;
  const item = {
    id: 10016498,
    type: 'anime',
    name: 'Attack on Titan',
    original_name: 'Shingeki no Kyojin',
    isExternal: true,
    catalog_id: 1429,
    genres: [],
    first_air_date: '2013-04-07',
    season_label: 'Primavera 2013'
  };
  view.render([item]);
  assert.match(view.container.innerHTML, /data-action="open-detail" data-show="1429"[^>]*>\s*Ver no Cofre/);
  assert.ok(!/data-action="add-to-list"/.test(view.container.innerHTML));

  app.state.removeShow(1429);
  view.render([item]);
  assert.match(view.container.innerHTML, /data-action="add-to-list" data-show="10016498"/);
  assert.ok(!/Ver no Cofre/.test(view.container.innerHTML));

  // obra sem catalog_id: comportamento de sempre
  view.render([{ id: 777, type: 'tv', name: 'Outra série', genres: [] }]);
  assert.match(view.container.innerHTML, /data-action="add-to-list" data-show="777"/);
});

test('Explorar: aviso cuja fonte reserva respondeu (fallback) não aparece; aviso sem reserva continua aparecendo', () => {
  const view = makeApp().window.exploreView;
  const covered = { source: 'anilist', code: 'UPSTREAM', message: 'x', fallback: 'jikan' };
  assert.equal(view.renderWarnings([covered]), '', 'a Jikan cobriu a AniList: resultados completos, nada a avisar');
  assert.match(
    view.renderWarnings([covered, { source: 'tvmaze', code: 'UPSTREAM', message: 'y' }]),
    /Uma fonte do catálogo está indisponível/
  );
  assert.match(
    view.renderWarnings([
      { source: 'anilist', code: 'UPSTREAM', message: 'x' },
      { source: 'jikan', code: 'UPSTREAM', message: 'x' }
    ]),
    /indisponível/
  );
  assert.match(
    view.renderWarnings([
      { source: 'anilist', code: 'RATE_LIMITED', retryAfterSec: 30, message: 'x', fallback: 'jikan' },
      { source: 'tmdb', code: 'RATE_LIMITED', retryAfterSec: 30, message: 'x' }
    ]),
    /~30 s/
  );
});

// ---------------------------------------------------------------- amostras só com título: aviso e créditos

const PENDING_TEXT = 'Dados ainda não carregados da fonte.';
const LIGHT_SAMPLE = { id: 95396, type: 'tv', name: 'Amostra Pendente', genres: [], poster_path: null, vote_average: null, light: true };

test('Explorar: amostra só com título mostra o aviso e "Sem nota"/"Sem imagem"; obra completa não mostra o aviso', () => {
  const view = makeApp().window.exploreView;
  view.container = makeEl('explore-container');
  view.hasMore = false;
  view.render([LIGHT_SAMPLE]);
  assert.ok(view.container.innerHTML.includes(PENDING_TEXT));
  assert.match(view.container.innerHTML, /Sem nota/);
  view.render([
    { ...LIGHT_SAMPLE, poster_path: '/x.jpg', vote_average: 8.1, genres: [{ id: 1, name: 'Drama' }], first_air_date: '2020-01-01' }
  ]);
  assert.ok(!view.container.innerHTML.includes(PENDING_TEXT));
});

test('detalhe: amostra pendente, anônimo = aviso escrito e sem nova busca; logado = tenta a obra real e a mostra', async () => {
  const app = makeApp();
  const modal = app.window.detailModalView;
  app.state.cacheMediaList([LIGHT_SAMPLE]);
  app.window.syncService = { isLoggedIn: () => false };
  modal.open(LIGHT_SAMPLE.id, 'explore');
  await new Promise(resolve => setImmediate(resolve));
  const text = () => app.els.get('show-modal-header').innerHTML + app.els.get('show-episodes-container').innerHTML;
  assert.ok(text().includes(PENDING_TEXT), 'aviso no detalhe');
  assert.ok(!app.apiCalls.some(c => c[0] === 'byId'), 'anônimo não pede a obra');

  // logado, o servidor devolve ainda pendente: segue o aviso
  const modal2 = makeApp();
  modal2.state.cacheMediaList([LIGHT_SAMPLE]);
  modal2.window.syncService = { isLoggedIn: () => true };
  modal2.resolveId = () => ({ ...LIGHT_SAMPLE, pending: true });
  modal2.window.detailModalView.open(LIGHT_SAMPLE.id, 'explore');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(modal2.apiCalls.some(c => c[0] === 'byId'));
  assert.ok(modal2.els.get('show-modal-header').innerHTML.includes(PENDING_TEXT));

  // logado, o servidor devolve a obra real: o aviso some
  const real = makeApp();
  real.state.cacheMediaList([LIGHT_SAMPLE]);
  real.window.syncService = { isLoggedIn: () => true };
  real.resolveId = () => ({
    id: 95396,
    type: 'tv',
    name: 'Obra Real',
    genres: [],
    overview: 'Sinopse falsa',
    seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }] }]
  });
  real.window.detailModalView.open(LIGHT_SAMPLE.id, 'explore');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(real.state.hasDetail(95396));
  assert.ok(!real.els.get('show-modal-header').innerHTML.includes(PENDING_TEXT));
  assert.ok(real.els.get('show-modal-header').innerHTML.includes('Obra Real'));
});

test('créditos: o rodapé saiu do app e da landing; a página creditos.html tem os textos, links seguros e nenhum script/style/imagem', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  assert.ok(!/<footer/i.test(html), 'sem <footer> no index.html');
  assert.ok(!/app-credits|lp-footer/.test(html));
  const page = fs.readFileSync(path.join(ROOT, 'creditos.html'), 'utf-8');
  assert.equal((page.match(/<h1[ >]/g) || []).length, 1);
  assert.match(page, /This product uses the TMDB API but is not endorsed or certified by TMDB./);
  assert.match(page, /Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB./);
  assert.match(page, /TVMaze/);
  assert.match(page, /CC BY-SA 4.0/);
  assert.match(page, /ODbL\s+1\.0/);
  for (const host of [
    'themoviedb.org/',
    'tvmaze.com/',
    'anilist.co/',
    'jikan.moe/',
    'github.com/Fribb/anime-lists',
    'github.com/manami-project/anime-offline-database',
    'github.com/Anime-Lists/anime-lists'
  ]) {
    assert.match(page, new RegExp('<a href="https://[^"]*' + host.replace(/[.]/g, '[.]') + '"[^>]*rel="noopener noreferrer"'), host);
  }
  assert.ok(!/<img|<script|style=|onclick=|logo/i.test(page), 'só texto e links (sem logo do TMDB)');
  assert.equal((html.match(/href="creditos.html"/g) || []).length, 3, 'links: Entrar/Cadastrar, Minha conta e o mockup da landing');
});
