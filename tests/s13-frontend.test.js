// S13 · frontend: "Remover exemplo" (só as obras do exemplo ainda intocadas), id canônico ao adicionar (a obra pode voltar do servidor com
// outro id: a amostra do seed trocada pela obra real) e avisos de fonte cobertos pela reserva. Os scripts reais do app rodam em `vm`
// com um DOM mínimo simulado e uma API falsa; nada de rede, nada em server/data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf-8');
const html = read('index.html');
const plain = v => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------- HTML / acessibilidade (estático)

test('botão "Remover exemplo": type=button, nome acessível, descrito pelo texto da faixa, ação registrada, sem JS/estilo inline', () => {
  const m = /<button\b([^>]*\bid="btn-remove-example"[^>]*)>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(m, 'botão não encontrado no index.html');
  const [, attrs, label] = m;
  assert.match(attrs, /\btype="button"/);
  assert.match(attrs, /\bdata-action="remove-example"/);
  assert.equal(label.trim(), 'Remover exemplo', 'o nome acessível é o próprio texto');
  assert.ok(!/\son[a-z]+\s*=|\sstyle\s*=/i.test(attrs), 'sem onclick/style inline');
  const described = /aria-describedby="([^"]+)"/.exec(attrs);
  assert.ok(described && new RegExp(`id="${described[1]}"`).test(html), 'aria-describedby aponta para um id que existe');
  // a faixa nasce escondida e fica antes da grade da lista
  const bar = /<div class="example-bar hidden" id="watchlist-example-bar">/.exec(html);
  assert.ok(bar, 'a faixa nasce oculta');
  assert.ok(html.indexOf('id="watchlist-example-bar"') < html.indexOf('id="watchlist-container"'));
  assert.match(read('js', 'controllers', 'actionHandlers.js'), /A\.on\('remove-example'/);
  assert.match(read('css', 'views.css'), /\.example-bar\s*\{/);
});

// ---------------------------------------------------------------- um "aparelho" com os scripts reais

class FakeClassList {
  constructor(initial = []) { this.set = new Set(initial); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }
  contains(c) { return this.set.has(c); }
}

function makeEl(id, classes = []) {
  const attrs = new Map();
  const el = {
    id, textContent: '', innerHTML: '', value: '', checked: false, dataset: {}, style: {}, classList: new FakeClassList(classes), focused: 0,
    addEventListener() {}, setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), removeAttribute: (k) => attrs.delete(k),
    querySelector: () => null, querySelectorAll: () => [], click() {}, append() {}, remove() {}, contains: () => false,
    focus() { el.focused++; doc.activeElement = el; }
  };
  return el;
}
let doc = null;

function makeApp({ catalog = [] } = {}) {
  const store = new Map();
  const els = new Map();
  const heading = makeEl('h2');
  const el = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id, id === 'watchlist-example-bar' ? ['hidden'] : []));
    return els.get(id);
  };
  const app = { els, toasts: [], apiCalls: [], byId: new Map(catalog.map(m => [m.id, m])), heading };
  doc = { getElementById: el, querySelector: (sel) => (sel === '#view-watchlist h2' ? heading : null), querySelectorAll: () => [], addEventListener() {}, createElement: () => makeEl('x'), body: makeEl('body'), activeElement: null };
  const ctx = {
    console, JSON, Promise, Math, Object, Array, Number, String, Map, Set, WeakMap, Error, TypeError, SyntaxError, Date, Intl, isNaN, parseInt, Symbol, Boolean,
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: doc, addEventListener() {}, dispatchEvent() {}, confirm: () => true, prompt: () => 'APAGAR'
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
  store.set('showvault_state_mvc_v1', JSON.stringify({ trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: { shows: {}, watched: {}, notes: {} }, resetAt: '' }));
  store.set('showvault_state_version', '2');
  const run = (...f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', ...f), 'utf-8'), ctx, { filename: f.join('/') });
  ['utils/dom.js', 'utils/emotions.js', 'utils/markdown.js', 'utils/mediaDisplay.js', 'utils/viewKit.js', 'utils/libraryMerge.js', 'utils/watchStatus.js', 'utils/backupValidator.js', 'utils/migrations.js', 'models/state.js']
    .forEach(f => run(...f.split('/')));
  ['nextUpView', 'watchlistView', 'diaryView', 'statsView', 'exploreView', 'detailModalView'].forEach(v => run('views', `${v}.js`));
  run('controllers', 'appController.js');
  vm.runInContext('window.appController = Object.create(AppController.prototype); window.appController.activeTab = "watchlist"; window.appController.dirty = new Set(); window.appController.renderedRev = {}; window.appController.detailChain = Promise.resolve();', ctx);
  ctx.appController.showToast = (msg, type) => app.toasts.push([type, msg]);
  app.window = ctx;
  app.state = ctx.appState;
  app.controller = ctx.appController;
  app.bar = el('watchlist-example-bar');
  app.barText = el('watchlist-example-text');
  app.button = el('btn-remove-example');
  return app;
}

const EXAMPLE = [
  { id: 157336, type: 'movie', name: 'Interestelar', genres: [], runtime: 169 },
  { id: 872585, type: 'movie', name: 'Oppenheimer', genres: [], runtime: 180 },
  { id: 1396, type: 'tv', name: 'Breaking Bad', genres: [], seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'Piloto' }, { episode_number: 2, name: 'Dois' }] }] },
  { id: 1429, type: 'anime', name: 'Attack on Titan', genres: [], seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }] }] }
];
const OTHER = { id: 777, type: 'tv', name: 'Outra série', genres: [], seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }] }] };
const withExample = () => {
  const app = makeApp({ catalog: [...EXAMPLE, OTHER] });
  app.state.cacheMediaDetail(JSON.parse(JSON.stringify(EXAMPLE[2])));
  app.state.cacheMediaList(EXAMPLE.map(m => (m.id === 1396 ? { ...m, seasons: undefined, light: true } : m)));
  app.state.cacheMediaDetail(JSON.parse(JSON.stringify(EXAMPLE[2])));
  const out = app.state.loadExample();
  assert.deepEqual(plain(out.added), [157336, 872585, 1396, 1429]);
  return app;
};
const ids = app => app.state.data.trackedShows.map(t => t.showId).sort((a, b) => a - b);

// ---------------------------------------------------------------- estado: removeExample

test('"Remover exemplo": tira as 4 obras do exemplo intocadas de uma vez, grava uma vez só e deixa a marca de exclusão de cada uma', () => {
  const app = withExample();
  app.state.addShow(777);   // obra do usuário (não é do exemplo): nunca sai
  const saves = [];
  const realSave = app.state.save.bind(app.state);
  app.state.save = () => { saves.push(1); realSave(); };

  assert.deepEqual(plain(app.state.exampleStatus().removable), [157336, 872585, 1396, 1429]);
  const out = app.state.removeExample();
  assert.deepEqual(plain(out), { removed: [157336, 872585, 1396, 1429], kept: [] });
  assert.deepEqual(ids(app), [777]);
  assert.equal(saves.length, 1, 'uma gravação só (e um envio ao servidor)');
  for (const id of [157336, 872585, 1396, 1429]) assert.ok(app.state.data.tombstones.shows[String(id)], `marca de exclusão de ${id}`);
  assert.equal(app.state.data.tombstones.shows['777'], undefined);

  assert.deepEqual(plain(app.state.removeExample()), { removed: [], kept: [] }, 'repetir não faz nada');
  assert.equal(saves.length, 1, 'sem nada a tirar, nem grava');
  assert.deepEqual(plain(app.state.exampleStatus()), { inList: [], removable: [] });
});

test('"Remover exemplo": o que o usuário já usou fica (status mudado, episódio marcado, filme assistido, anotação); ids parecidos não enganam', () => {
  const app = withExample();
  app.state.setShowStatus(157336, 'watching');        // Interestelar: mudou o status
  app.state.toggleWatched(1396, 1, 1);                // Breaking Bad: marcou um episódio (também vira "Assistindo")
  app.state.toggleWatched(872585);                    // Oppenheimer: marcou como assistido
  assert.deepEqual(plain(app.state.exampleStatus().removable), [1429], 'só Attack on Titan continua intocada');

  app.state.saveNote(1429, 1, 1, { text: 'minha anotação', emotion: null, character: '' });
  assert.deepEqual(plain(app.state.exampleStatus().removable), [], 'anotação também conta como uso');
  assert.deepEqual(plain(app.state.removeExample()), { removed: [], kept: [157336, 872585, 1396, 1429] });
  assert.deepEqual(ids(app), [1396, 1429, 157336, 872585]);

  // "13960_s1_e1" é de outra obra (id 13960): não pode contar como uso da 1396; e "1429_" também não casa com 14290
  const app2 = withExample();
  app2.state.data.watchedEpisodes['13960_s1_e1'] = { watched: true, watchedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', rewatchCount: 1 };
  app2.state.data.episodeNotes['14290_s1_e1'] = { text: 'x', updatedAt: '2026-01-01T00:00:00.000Z', snapshots: [] };
  assert.deepEqual(plain(app2.state.exampleStatus().removable), [157336, 872585, 1396, 1429]);
});

test('"Remover exemplo": obras tocadas ficam e as intocadas saem; quem não carregou o exemplo não perde nada', () => {
  const app = withExample();
  app.state.toggleWatched(1396, 1, 2);
  const out = plain(app.state.removeExample());
  assert.deepEqual(out, { removed: [157336, 872585, 1429], kept: [1396] });
  assert.deepEqual(ids(app), [1396]);
  assert.equal(app.state.isWatched(1396, 1, 2), true, 'o progresso fica intacto');

  const fresh = makeApp({ catalog: [OTHER] });
  fresh.state.cacheMediaDetail(JSON.parse(JSON.stringify(OTHER)));
  fresh.state.addShow(777);
  assert.deepEqual(plain(fresh.state.removeExample()), { removed: [], kept: [] });
  assert.deepEqual(ids(fresh), [777]);
});

// ---------------------------------------------------------------- tela: a faixa e o controlador

test('faixa da Minha Lista: aparece só enquanto há exemplo sem uso e conta os títulos; some quando não há', () => {
  const app = makeApp({ catalog: [...EXAMPLE, OTHER] });
  const view = app.window.watchlistView;
  view.updateExampleBar();
  assert.equal(app.bar.classList.contains('hidden'), true, 'lista vazia: sem faixa');

  const loaded = withExample();
  loaded.window.watchlistView.render();
  assert.equal(loaded.bar.classList.contains('hidden'), false);
  assert.match(loaded.barText.textContent, /4 títulos do exemplo/);

  loaded.state.toggleWatched(1396, 1, 1);
  loaded.window.watchlistView.render();
  assert.match(loaded.barText.textContent, /3 títulos do exemplo/);

  loaded.state.removeExample();
  loaded.window.watchlistView.render();
  assert.equal(loaded.bar.classList.contains('hidden'), true);

  const one = makeApp({ catalog: EXAMPLE });
  one.state.cacheMediaDetail(JSON.parse(JSON.stringify(EXAMPLE[3])));
  one.state.addShow(1429);
  one.window.watchlistView.render();
  assert.match(one.barText.textContent, /1 título do exemplo/);
});

test('appController.removeExample: avisa quantos saíram, redesenha a lista e leva o foco ao título quando o botão some', () => {
  const app = withExample();
  app.state.toggleWatched(872585);
  app.button.focus();
  app.controller.removeExample();
  assert.deepEqual(ids(app), [872585]);
  assert.ok(app.toasts.some(([type, msg]) => type === 'success' && /Exemplo removido: 3 títulos\./.test(msg) && /ficou na lista/.test(msg)), JSON.stringify(app.toasts));
  assert.equal(app.bar.classList.contains('hidden'), true);
  assert.equal(app.heading.focused, 1, 'o foco foi para o título "Minha Lista"');
  assert.equal(app.heading.getAttribute('tabindex'), '-1');

  const none = makeApp({ catalog: [] });
  none.controller.removeExample();
  assert.ok(none.toasts.some(([type, msg]) => type === 'info' && /Não há títulos de exemplo/.test(msg)));
  assert.equal(none.heading.focused, 0, 'sem foco no botão, não mexe no foco');

  const used = withExample();
  for (const id of [157336, 872585, 1429]) used.state.setShowStatus(id, 'watching');
  used.state.toggleWatched(1396, 1, 1);
  used.controller.removeExample();
  assert.ok(used.toasts.some(([type, msg]) => type === 'info' && /já têm progresso ou anotações/.test(msg)));
  assert.equal(ids(used).length, 4);
});

// ---------------------------------------------------------------- adicionar: id canônico

test('adicionar um resultado externo que o servidor devolve com OUTRO id (amostra do seed trocada pela obra real): entra a obra real, sem duplicar', async () => {
  const real = { id: 1429, type: 'anime', name: 'Attack on Titan', genres: [], seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }, { episode_number: 2, name: 'E2' }] }] };
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

test('adicionar: quem já tem a obra (a amostra, do "Carregar exemplo") e pede o mesmo resultado externo não ganha uma segunda cópia', async () => {
  const app = withExample();
  app.state.cacheMediaList([{ id: 10016498, type: 'anime', name: 'Attack on Titan', isExternal: true, catalog_id: 1429, genres: [] }]);
  await app.controller.addToList(10016498);
  assert.deepEqual(app.apiCalls, [], 'o catalog_id já está na lista: nada a fazer');
  assert.equal(ids(app).length, 4);

  // sem o catalog_id no cache (ex.: lista antiga) o servidor devolve a obra com o id da amostra: ainda assim não duplica
  const second = withExample();
  second.resolveId = () => ({ ...EXAMPLE[3], seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'E1' }] }] });
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
  const app = withExample();
  const view = app.window.exploreView;
  view.container = makeEl('explore-container');
  view.hasMore = false;
  const item = { id: 10016498, type: 'anime', name: 'Attack on Titan', original_name: 'Shingeki no Kyojin', isExternal: true, catalog_id: 1429, genres: [], first_air_date: '2013-04-07', season_label: 'Primavera 2013' };
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
  assert.match(view.renderWarnings([covered, { source: 'tvmaze', code: 'UPSTREAM', message: 'y' }]), /Uma fonte do catálogo está indisponível/);
  assert.match(view.renderWarnings([{ source: 'anilist', code: 'UPSTREAM', message: 'x' }, { source: 'jikan', code: 'UPSTREAM', message: 'x' }]), /indisponível/);
  assert.match(view.renderWarnings([{ source: 'anilist', code: 'RATE_LIMITED', retryAfterSec: 30, message: 'x', fallback: 'jikan' }, { source: 'tmdb', code: 'RATE_LIMITED', retryAfterSec: 30, message: 'x' }]), /~30 s/);
});
