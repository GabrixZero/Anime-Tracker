// Ajustes 3 · filmes "Em breve" na busca do Explorar: o TMDB manda o resultado de busca sem `status`; filme com data futura
// válida vira "Em breve" e o cartão mostra selo + data completa. Fonte TMDB falsa (fetchJson injetado): nenhum teste usa a internet.
// A Agenda já é coberta por tests/s15-calendar.test.js ("buildAgenda: filme com estreia futura entra como item Filme").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TmdbClient = require('../server/services/tmdbClient');

const HOJE = '2026-11-05';

// Resultado de busca de verdade não traz `status` nem `runtime`.
const searchItem = (id, title, extra = {}) => ({ id, title, original_title: title, overview: '', genre_ids: [], vote_count: 0, ...extra });

function tmdbWith(results) {
  return new TmdbClient({ apiKey: 'chave-falsa', fetchJson: async () => ({ results }) });
}

// searchMovie usa a data de hoje de verdade; as datas de teste ficam bem longe (2099) ou bem no passado.
test('busca TMDB: filme futuro vem como "Em breve", com a data e sem nota', async () => {
  const [m] = await tmdbWith([
    searchItem(1, 'Jogos Futuros', { release_date: '2099-11-18', poster_path: '/p.jpg', vote_average: 0 })
  ]).searchMovie('jogos');
  assert.equal(m.status, 'Em breve');
  assert.equal(m.first_air_date, '2099-11-18');
  assert.equal(m.vote_average, null);
  assert.ok(m.poster_path);
});

test('busca TMDB: filme futuro sem pôster continua aparecendo', async () => {
  const out = await tmdbWith([searchItem(2, 'Sem Pôster', { release_date: '2099-01-02', poster_path: null })]).searchMovie('x');
  assert.equal(out.length, 1);
  assert.equal(out[0].poster_path, null);
  assert.equal(out[0].status, 'Em breve');
});

test('busca TMDB: filme futuro sem nota continua aparecendo (nota nula)', async () => {
  const out = await tmdbWith([searchItem(3, 'Sem Nota', { release_date: '2099-03-04', vote_average: 7.5, vote_count: 0 })]).searchMovie(
    'x'
  );
  assert.equal(out[0].vote_average, null);
  assert.equal(out[0].status, 'Em breve');
});

test('busca TMDB: filme passado sem status fica com status vazio', async () => {
  const [m] = await tmdbWith([searchItem(4, 'Antigo', { release_date: '2001-05-06' })]).searchMovie('x');
  assert.equal(m.status, '');
  assert.equal(m.first_air_date, '2001-05-06');
});

test('busca TMDB: filme sem data (ou com data inválida) não inventa status nem data', async () => {
  const out = await tmdbWith([
    searchItem(5, 'Sem Data', { release_date: '' }),
    searchItem(6, 'Data Ruim', { release_date: '2099-13-45' })
  ]).searchMovie('x');
  assert.equal(out.length, 2);
  assert.equal(out[0].status, '');
  assert.equal(out[0].first_air_date, '');
  assert.equal(out[1].status, '', 'mês 13 não é data válida');
});

test('mapMovie: segundo parâmetro `today`; estreia hoje não é futura; status da fonte é mantido', () => {
  const base = { id: 9, title: 'F' };
  assert.equal(TmdbClient.mapMovie({ ...base, release_date: '2026-11-06' }, HOJE).status, 'Em breve');
  assert.equal(TmdbClient.mapMovie({ ...base, release_date: HOJE }, HOJE).status, '');
  assert.equal(TmdbClient.mapMovie({ ...base, release_date: '2026-11-06', status: 'Released' }, HOJE).status, 'Lançado');
  assert.equal(TmdbClient.mapMovie({ ...base, release_date: '2026-11-06', status: 'Planned' }, HOJE).status, 'Planejado');
});

// ---- Interface: cartão do Explorar (scripts reais em `vm`, DOM mínimo) -----------------------------------------------------------

function makeView() {
  const container = { innerHTML: '' };
  const ctx = { console, JSON, Map, Set, Date, Number, String, Array, Object, Math, Intl, RegExp, Error };
  ctx.window = ctx;
  ctx.document = {
    getElementById: id => (id === 'explore-container' ? container : null),
    querySelectorAll: () => [],
    querySelector: () => null
  };
  vm.createContext(ctx);
  const ROOT = path.join(__dirname, '..', 'public', 'js');
  ['utils/dom.js', 'utils/mediaDisplay.js', 'utils/viewKit.js', 'views/exploreView.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf-8'), ctx, { filename: f })
  );
  const view = ctx.exploreView;
  view.container = container;
  view.hasMore = false;
  return view;
}

test('Explorar: filme "Em breve" mostra o selo e a data dd/mm/aaaa; sem nota continua "Sem nota"', () => {
  const view = makeView();
  view.render([
    {
      id: 1,
      type: 'movie',
      name: 'Jogos Futuros',
      genres: [],
      first_air_date: '2026-11-18',
      status: 'Em breve',
      vote_average: null,
      poster_path: null
    }
  ]);
  const html = view.container.innerHTML;
  assert.match(html, /<span class="badge-type-tag badge-type-soon">Em breve<\/span>/);
  assert.match(html, /<span class="show-year">18\/11\/2026<\/span>/);
  assert.match(html, /Sem nota/);
});

test('Explorar: filme lançado ou sem status não mostra selo e segue com o ano; "Em breve" sem data não inventa data', () => {
  const view = makeView();
  view.render([
    { id: 2, type: 'movie', name: 'Antigo', genres: [], first_air_date: '2001-05-06', status: '' },
    { id: 3, type: 'movie', name: 'Lançado', genres: [], first_air_date: '2020-01-02', status: 'Lançado' },
    { id: 4, type: 'movie', name: 'Sem Data', genres: [], first_air_date: '', status: 'Em breve' }
  ]);
  const html = view.container.innerHTML;
  assert.equal((html.match(/badge-type-soon/g) || []).length, 1, 'só o "Em breve" tem selo');
  assert.match(html, /<span class="show-year">2001<\/span>/);
  assert.match(html, /<span class="show-year">2020<\/span>/);
  assert.match(html, /<span class="show-year"><\/span>/);
});
