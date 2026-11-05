// Ajustes de avaliação 3b · o quadro de detalhe tem dois modos: 'explore' (enxuto, só na aba Explorar) e 'full' (completo, no resto).
// O script real da view roda em `vm` com um DOM mínimo simulado (sem jsdom e sem rede).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'public');
const JS = path.join(ROOT, 'js');

const episodes = (season, n) =>
  Array.from({ length: n }, (_, i) => ({ episode_number: i + 1, name: `Episódio ${season}-${i + 1}`, air_date: '2020-01-01' }));

function fakeEl(id) {
  const classes = new Set();
  const attrs = new Map();
  return {
    id,
    innerHTML: '',
    textContent: '',
    style: {},
    listeners: [],
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, force) => (force === undefined ? !classes.delete(c) && classes.add(c) : force ? classes.add(c) : classes.delete(c))
    },
    addEventListener(type, fn, capture) {
      this.listeners.push({ type, fn, capture });
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: k => attrs.delete(k),
    insertAdjacentHTML(where, html) {
      this.innerHTML += html;
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

function makeApp(medias, { watched = () => false, tracked = () => null } = {}) {
  const els = new Map();
  const stub = id => {
    if (!els.has(id)) els.set(id, fakeEl(id));
    return els.get(id);
  };
  const ctx = {
    console,
    JSON,
    Math,
    Object,
    Array,
    Number,
    String,
    Map,
    Set,
    Date,
    Intl,
    isNaN,
    parseInt,
    Boolean,
    setTimeout: () => 0,
    clearTimeout() {},
    document: { getElementById: stub, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
  };
  ctx.window = ctx;
  ctx.appState = {
    getMedia: id => medias.find(m => m.id === Number(id)) || null,
    getTracked: id => tracked(id),
    getStatus: () => 'watching',
    hasDetail: () => true,
    isWatched: (id, s, e) => watched(id, s, e),
    getNote: () => null
  };
  vm.createContext(ctx);
  [
    'utils/dom.js',
    'utils/mediaDisplay.js',
    'utils/viewKit.js',
    'utils/rating.js',
    'utils/watchStatus.js',
    'views/detailModalView.js'
  ].forEach(f => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf-8'), ctx, { filename: f }));
  const modal = stub('modal-show-detail');
  modal.classList.add('hidden'); // quadro fechado
  return { ctx, view: ctx.detailModalView, el: stub, modal };
}

const SERIE = {
  id: 601,
  type: 'tv',
  name: 'Série de Teste',
  overview: 'Sinopse',
  genres: ['Drama'],
  first_air_date: '2020-01-01',
  vote_average: 7.5,
  runtime: 45,
  seasons: [
    { season_number: 1, name: 'Temporada 1', episodes: episodes(1, 3) },
    { season_number: 2, name: 'Temporada 2', episodes: episodes(2, 2) }
  ]
};
const FILME = {
  id: 602,
  type: 'movie',
  name: 'Filme de Teste',
  overview: 'Sinopse',
  genres: ['Ação'],
  first_air_date: '2021-05-05',
  vote_average: 8,
  runtime: 120
};

test('modo completo (série): abas de temporada, resumo, caixa de assistido, anotar e botões de temporada', () => {
  const { view, el, modal } = makeApp([SERIE], { watched: (id, s, e) => s === 1 && e === 1 });
  view.open(SERIE.id, 'full');
  assert.equal(view.mode, 'full');
  assert.equal(modal.getAttribute('data-detail-mode'), 'full');
  const tabs = el('show-seasons-tabs');
  assert.ok(!tabs.classList.contains('hidden'));
  assert.ok(!el('season-summary-bar').classList.contains('hidden'));
  assert.match(tabs.innerHTML, /role="tab"[^>]*data-action="switch-season"/);
  assert.match(tabs.innerHTML, /Temporada 1 \(1\/3\)/);
  assert.match(tabs.innerHTML, /Temporada 2 \(0\/2\)/);
  assert.match(el('season-stats-summary').innerHTML, /Progresso da Temporada: <strong>1\/3 assistidos<\/strong>/);
  assert.equal(el('show-episodes-container').getAttribute('role'), 'tabpanel');
  const html = el('show-episodes-container').innerHTML;
  assert.equal((html.match(/class="episode-row/g) || []).length, 3);
  assert.match(html, /class="episode-check" role="checkbox" aria-checked="true"/);
  assert.match(html, /data-action="quick-check"/);
  assert.match(html, /data-action="open-note"/);
  assert.match(html, /<img /);
  assert.ok(!/<details/.test(html));
  // trocar de temporada repinta as linhas da outra temporada
  view.switchSeason(2);
  assert.equal((el('show-episodes-container').innerHTML.match(/class="episode-row/g) || []).length, 2);
});

test('modo completo (filme): caixa "Filme Pendente", aviso de duração, Marcar como Assistido e Anotar no Diário; sem o chip', () => {
  const { view, el } = makeApp([FILME], { tracked: () => ({ rating: null }) });
  view.open(FILME.id, 'full');
  const body = el('movie-detail-body');
  assert.ok(!body.classList.contains('hidden'));
  assert.match(body.innerHTML, /Filme Pendente para Assistir/);
  assert.match(body.innerHTML, /Duração: 120 minutos/);
  assert.match(body.innerHTML, /✓ Marcar como Assistido/);
  assert.match(body.innerHTML, /Anotar no Diário/);
  const header = el('show-modal-header').innerHTML;
  assert.ok(!/in-list-chip|Na sua lista/.test(header));
  assert.match(header, /data-action="remove-from-list"/);
  assert.match(header, /id="detail-status-select"/);
  assert.match(header, /detail-rating-602/);
  assert.match(header, /<span>120 min<\/span>/); // duração também no meta do filme (quadro completo)
  assert.ok(!/Nota do cat/.test(header + body.innerHTML), 'sem "Nota do catálogo" em nenhum modo');
});

test('modo completo (filme assistido): "Desmarcar Filme"', () => {
  const { view, el } = makeApp([FILME], { watched: () => true });
  view.open(FILME.id, 'full');
  assert.match(el('movie-detail-body').innerHTML, /✓ Filme Assistido no Seu Diário/);
  assert.match(el('movie-detail-body').innerHTML, /Desmarcar Filme/);
});

test('modo explore: sem abas, sem caixas de assistido, sem botões de temporada; filme só com o cabeçalho', () => {
  const s = makeApp([SERIE, FILME], { tracked: id => (id === FILME.id ? { rating: null } : null) });
  s.view.open(SERIE.id, 'explore');
  assert.equal(s.view.mode, 'explore');
  assert.ok(s.el('show-seasons-tabs').classList.contains('hidden'));
  assert.ok(s.el('season-summary-bar').classList.contains('hidden'));
  assert.equal(s.el('show-seasons-tabs').innerHTML, '');
  assert.equal(s.el('show-episodes-container').getAttribute('role'), null);
  const html = s.el('show-episodes-container').innerHTML;
  assert.match(html, /<details class="season-block"/);
  assert.ok(!/episode-check|role="checkbox"|role="tab"|quick-check|open-note|<img|episode-row/.test(html));

  s.view.open(FILME.id, 'explore');
  assert.equal(s.el('movie-detail-body').innerHTML, '');
  assert.ok(s.el('movie-detail-body').classList.contains('hidden'));
  assert.match(s.el('show-modal-header').innerHTML, /✓ Na sua lista/);
  assert.ok(!/Marcar como Assistido|Anotar no Diário/.test(s.el('show-modal-header').innerHTML));
});

test('trocar de modo entre aberturas não vaza elementos de um modo para o outro', () => {
  const { view, el } = makeApp([SERIE, FILME]);
  view.open(SERIE.id, 'full');
  view.open(SERIE.id, 'explore');
  assert.equal(el('show-seasons-tabs').innerHTML, '');
  assert.equal(el('season-stats-summary').innerHTML, '');
  assert.ok(!/episode-row|episode-check/.test(el('show-episodes-container').innerHTML));
  assert.match(el('show-episodes-container').innerHTML, /<details/);
  assert.ok(el('season-summary-bar').classList.contains('hidden'));

  view.open(SERIE.id, 'full');
  assert.ok(!/<details|episode-line/.test(el('show-episodes-container').innerHTML));
  assert.match(el('show-episodes-container').innerHTML, /episode-row/);
  assert.ok(!el('show-seasons-tabs').classList.contains('hidden'));
  assert.ok(!el('season-summary-bar').classList.contains('hidden'));
  assert.equal(el('show-episodes-container').getAttribute('role'), 'tabpanel');

  // filme completo -> filme explore: a caixa do filme some
  view.open(FILME.id, 'full');
  assert.match(el('movie-detail-body').innerHTML, /movie-actions-box/);
  view.open(FILME.id, 'explore');
  assert.equal(el('movie-detail-body').innerHTML, '');
  // série completa depois de filme completo: a caixa do filme não fica
  view.open(FILME.id, 'full');
  view.open(SERIE.id, 'full');
  assert.equal(el('movie-detail-body').innerHTML, '');
});

test('reabertura interna (sem informar o modo) mantém o modo do quadro aberto; fechado, volta ao completo', () => {
  const { view, modal } = makeApp([SERIE]);
  view.open(SERIE.id, 'explore');
  modal.classList.remove('hidden'); // open() já faz isso; o stub apenas confirma
  view.open(SERIE.id); // ex.: depois de adicionar/remover da lista
  assert.equal(view.mode, 'explore');
  modal.classList.add('hidden'); // fechado
  view.open(SERIE.id);
  assert.equal(view.mode, 'full');
});

test('"Mostrar mais" e atualização por episódio respeitam o modo', () => {
  const big = { ...SERIE, id: 603, seasons: [{ season_number: 1, name: 'Temporada 1', episodes: episodes(1, 150) }] };
  const { view, el } = makeApp([big]);
  view.open(big.id, 'full');
  assert.equal((el('show-episodes-container').innerHTML.match(/class="episode-row/g) || []).length, 60);
  assert.match(el('show-episodes-container').innerHTML, /data-focus-key="ep:more" data-action="more-episodes"/);
  view.showMoreEpisodes();
  assert.equal((el('show-episodes-container').innerHTML.match(/class="episode-row/g) || []).length, 120);
  // no modo explore, updateEpisode/syncEpisodeRows não fazem nada
  view.open(big.id, 'explore');
  assert.doesNotThrow(() => {
    view.updateEpisode(1, 1);
    view.syncEpisodeRows();
  });
});

test('o handler open-detail usa data-detail-mode; sem o atributo abre o quadro completo', () => {
  const handlers = new Map();
  const opened = [];
  const ctx = {
    console,
    window: null,
    Actions: {
      fallbacks: {},
      int: (el, name) => Number(el.getAttribute(`data-${name}`)),
      on: (name, fn) => handlers.set(name, fn),
      onChange: () => {}
    },
    MediaDisplay: { POSTER_PLACEHOLDER: 'p', STILL_PLACEHOLDER: 's' },
    detailModalView: { open: (...args) => opened.push(args), openNote() {}, switchSeason() {}, showMoreEpisodes() {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'controllers', 'actionHandlers.js'), 'utf-8'), ctx);
  const el = attrs => ({ getAttribute: k => (k in attrs ? attrs[k] : null) });
  handlers.get('open-detail')(el({ 'data-show': '7', 'data-detail-mode': 'explore' }));
  handlers.get('open-detail')(el({ 'data-show': '8' }));
  assert.deepEqual(opened, [
    [7, 'explore'],
    [8, 'full']
  ]);
});

test('só a aba Explorar pede o modo enxuto (os dois botões); as demais telas não têm data-detail-mode', () => {
  const read = (...p) => fs.readFileSync(path.join(JS, ...p), 'utf-8');
  const explore = read('views', 'exploreView.js');
  assert.equal(count(explore, /data-action="open-detail"[^>]*data-detail-mode="explore"/g), 2);
  assert.equal(count(explore, /data-action="open-detail"/g), 2);
  for (const f of ['watchlistView.js', 'nextUpView.js', 'calendarView.js']) {
    assert.ok(!/data-detail-mode/.test(read('views', f)), f);
  }
});

function count(s, re) {
  return (s.match(re) || []).length;
}
