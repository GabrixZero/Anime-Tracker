// Títulos e miniaturas de episódio (D-TE-1, D-TE-6): telas. O script real da view roda em `vm` com um DOM mínimo (sem jsdom nem rede).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'public', 'js');
const MD = require('../public/js/utils/mediaDisplay.js');

function loadView() {
  const el = () => ({
    innerHTML: '',
    textContent: '',
    style: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener() {},
    setAttribute() {},
    querySelector: () => null
  });
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
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
  };
  ctx.window = ctx;
  ctx.appState = { isWatched: () => false, getNote: () => null };
  vm.createContext(ctx);
  [
    'utils/dom.js',
    'utils/mediaDisplay.js',
    'utils/viewKit.js',
    'utils/rating.js',
    'utils/watchStatus.js',
    'views/detailModalView.js'
  ].forEach(f => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf-8'), ctx, { filename: f }));
  return ctx.detailModalView;
}

test('"Episódio N" (e vazio) é reconhecido como sem título; título de verdade não', () => {
  assert.equal(MD.isPlaceholderEpisodeName('Episódio 7'), true);
  assert.equal(MD.isPlaceholderEpisodeName('Episodio 1180'), true);
  assert.equal(MD.isPlaceholderEpisodeName(''), true);
  assert.equal(MD.isPlaceholderEpisodeName(null), true);
  assert.equal(MD.isPlaceholderEpisodeName('Ryomen Sukuna'), false);
  assert.equal(MD.isPlaceholderEpisodeName('Episódio 1-2'), false);
  assert.equal(MD.episodeNameClass('Episódio 3'), ' is-placeholder');
  assert.equal(MD.episodeNameClass('Cúmplices'), '');
});

test('Explorar: título atenuado sem título; miniatura só quando existe, com tamanho reservado, lazy e reserva sem ícone', () => {
  const view = loadView();
  const html = view.episodeLinesHtml([
    { episode_number: 1, name: 'Ryomen Sukuna', air_date: '2020-10-03', still_path: 'https://image.tmdb.org/t/p/w300/abc.jpg' },
    { episode_number: 2, name: 'Episódio 2', air_date: '' }
  ]);
  const [one, two] = html.split('</li>');
  assert.match(one, /<img [^>]*src="https:\/\/image\.tmdb\.org\/t\/p\/w300\/abc\.jpg"[^>]*>/);
  assert.match(one, /data-fallback="epthumb"/);
  assert.match(one, /width="64" height="36" loading="lazy"/);
  assert.match(one, /alt=""/);
  assert.match(one, /<span class="episode-name">Ryomen Sukuna<\/span>/);
  assert.ok(!/<img/.test(two), 'sem miniatura da fonte, sem <img>');
  assert.match(two, /<span class="episode-name is-placeholder">Episódio 2<\/span>/);
});

test('Quadro completo: miniatura do TMDB usa a reserva lisa; sem miniatura própria segue a reserva de antes', () => {
  const view = loadView();
  const media = { id: 5, name: 'Obra', backdrop_path: 'https://image.tmdb.org/t/p/w1280/fundo.jpg', poster_path: null };
  const season = { season_number: 1 };
  const html = view.episodeRowsHtml(media, season, [
    { episode_number: 1, name: 'Título real', still_path: 'https://image.tmdb.org/t/p/w300/ep1.jpg' },
    { episode_number: 2, name: 'Episódio 2', still_path: null }
  ]);
  const rows = html.split('<div class="episode-row').slice(1);
  assert.match(rows[0], /src="https:\/\/image\.tmdb\.org\/t\/p\/w300\/ep1\.jpg" data-fallback="epthumb"/);
  assert.match(rows[0], /width="80" height="50"[^>]*loading="lazy"/);
  assert.match(rows[0], /<div class="episode-name">Título real<\/div>/);
  assert.match(rows[1], /data-fallback="still"/);
  assert.match(rows[1], /<div class="episode-name is-placeholder">Episódio 2<\/div>/);
});

test('imagem que falha em miniatura de episódio vira quadrado liso (data URI, sem ícone), uma vez só', () => {
  const { createActionRouter } = require('../public/js/utils/actions.js');
  const listeners = {};
  const doc = { addEventListener: (type, fn) => (listeners[type] = fn) };
  const router = createActionRouter(doc);
  router.fallbacks.epthumb = MD.EP_THUMB_BLANK;
  assert.match(MD.EP_THUMB_BLANK, /^data:image\/svg\+xml,/);
  assert.ok(!/<text|<path|<circle/.test(decodeURIComponent(MD.EP_THUMB_BLANK)), 'sem desenho: só um retângulo liso');
  const attrs = { 'data-fallback': 'epthumb', src: 'https://image.tmdb.org/t/p/w300/quebrada.jpg' };
  const img = {
    tagName: 'IMG',
    getAttribute: k => attrs[k],
    setAttribute: (k, v) => (attrs[k] = v),
    removeAttribute: k => delete attrs[k]
  };
  listeners.error({ target: img });
  assert.equal(attrs.src, MD.EP_THUMB_BLANK);
  listeners.error({ target: img }); // a própria reserva falhando não gera laço
  assert.equal(attrs.src, MD.EP_THUMB_BLANK);
});

test('A Seguir e Agenda usam a mesma classe de título atenuado; filme nunca é atenuado', () => {
  const next = fs.readFileSync(path.join(JS, 'views', 'nextUpView.js'), 'utf-8');
  const cal = fs.readFileSync(path.join(JS, 'views', 'calendarView.js'), 'utf-8');
  assert.match(next, /next-up-ep-title\$\{item\.isMovie \? '' : window\.MediaDisplay\.episodeNameClass\(item\.title\)\}/);
  assert.match(cal, /calendar-item-title\$\{isMovie \? '' : window\.MediaDisplay\.episodeNameClass\(title\)\}/);
});
