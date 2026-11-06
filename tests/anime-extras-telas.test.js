// Anime com extras separados (telas): o modal mostra só as temporadas normais nas abas e, abaixo, "Filmes" e "OVAs e especiais";
// a Agenda rotula o extra como FILME / OVA/ESPECIAL. O script real das views roda em `vm` com um DOM mínimo (sem jsdom e sem rede).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'public', 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf-8');
const count = (html, re) => (html.match(re) || []).length;

const eps = (n, prefix, airDate) =>
  Array.from({ length: n }, (_, i) => ({ episode_number: i + 1, name: `${prefix} ${i + 1}`, air_date: airDate }));

const ANIME = {
  id: 601,
  type: 'anime',
  name: 'Anime <Teste>',
  overview: 'Sinopse',
  genres: ['Ação'],
  first_air_date: '2020-01-01',
  vote_average: 8,
  seasons: [
    { season_number: 1, name: 'Temporada 1', category: 'season', episodes: eps(12, 'Ep', '2020-01-01') },
    { season_number: 2, name: 'Temporada 2', category: 'season', episodes: eps(12, 'Ep', '2021-01-01') },
    {
      season_number: 3,
      name: 'Filme: O Filme',
      category: 'movie',
      episodes: [{ episode_number: 1, name: 'O Filme <b>', air_date: '2022-03-05' }]
    },
    {
      season_number: 4,
      name: 'OVA: Extra Especial',
      category: 'special',
      episodes: [{ episode_number: 1, name: '', air_date: '' }]
    }
  ]
};

function makeApp(media, { watched = [] } = {}) {
  const els = new Map();
  const stub = id => {
    if (!els.has(id)) {
      els.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        style: {},
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        addEventListener() {},
        setAttribute() {},
        removeAttribute() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        insertAdjacentHTML(where, html) {
          this.innerHTML += html;
        }
      });
    }
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
    getMedia: id => (Number(id) === media.id ? media : null),
    getTracked: () => null,
    hasDetail: () => true,
    isWatched: (id, s, e) => watched.includes(`${id}_s${s}_e${e}`),
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
  ].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  return { view: ctx.detailModalView, els };
}

test('modo completo: 2 abas (só as temporadas normais) e seções Filmes e OVAs e especiais', () => {
  const { view, els } = makeApp(ANIME);
  view.open(ANIME.id, 'full');
  const tabs = els.get('show-seasons-tabs').innerHTML;
  assert.equal(count(tabs, /<button/g), 2);
  assert.ok(!/season-tab-3|season-tab-4/.test(tabs));
  assert.equal(view.currentSeasonNum, 1);
  const extras = els.get('show-extras-container').innerHTML;
  assert.match(extras, /<h3[^>]*>Filmes<\/h3>/);
  assert.match(extras, /<h3[^>]*>OVAs e especiais<\/h3>/);
  assert.match(extras, /O Filme &lt;b&gt;/);
  assert.ok(!/<b>/.test(extras), 'título escapado');
  assert.match(extras, /05\/03\/2022/);
  assert.match(extras, /Extra Especial/, 'sem nome de episódio: usa o nome da temporada sem o prefixo');
  assert.ok(!/OVA: Extra/.test(extras));
  assert.match(extras, /Sem data/);
});

test('modo completo: caixa de assistido por item com a chave certa (season_number e episode_number do extra)', () => {
  const { view, els } = makeApp(ANIME, { watched: ['601_s3_e1'] });
  view.open(ANIME.id, 'full');
  const extras = els.get('show-extras-container').innerHTML;
  assert.equal(count(extras, /<button type="button" class="episode-check" role="checkbox"/g), 2);
  assert.match(
    extras,
    /role="checkbox" aria-checked="true"[^>]*data-action="quick-check" data-show="601" data-season="3" data-episode="1"/
  );
  assert.match(
    extras,
    /role="checkbox" aria-checked="false"[^>]*data-action="quick-check" data-show="601" data-season="4" data-episode="1"/
  );
  assert.ok(!/onclick|style=/.test(extras));
});

test('Explorar: temporadas normais em details; extras só como texto, sem botão nem caixa', () => {
  const { view, els } = makeApp(ANIME);
  view.open(ANIME.id, 'explore');
  const list = els.get('show-episodes-container').innerHTML;
  assert.equal(count(list, /<details class="season-block"/g), 2);
  const extras = els.get('show-extras-container').innerHTML;
  assert.match(extras, /Filmes/);
  assert.match(extras, /OVAs e especiais/);
  assert.match(extras, /O Filme/);
  assert.ok(!/<button|checkbox|quick-check|data-action/.test(extras));
});

test('obra só de extras mantém a lista normal; obra sem category é tudo temporada', () => {
  const only = { ...ANIME, id: 602, seasons: ANIME.seasons.slice(2) };
  const a = makeApp(only);
  a.view.open(only.id, 'full');
  assert.equal(count(a.els.get('show-seasons-tabs').innerHTML, /<button/g), 2);
  assert.equal(a.els.get('show-extras-container').innerHTML, '');

  const old = { ...ANIME, id: 603, seasons: ANIME.seasons.map(({ category, ...s }) => s) };
  const b = makeApp(old);
  b.view.open(old.id, 'full');
  assert.equal(count(b.els.get('show-seasons-tabs').innerHTML, /<button/g), 4);
  assert.equal(b.els.get('show-extras-container').innerHTML, '');
});

test('Agenda: extra mostra FILME ou OVA/ESPECIAL no lugar de T:E e mantém data-season/data-episode', () => {
  const ctx = { document: { getElementById: () => null, querySelectorAll: () => [] }, console, Date };
  ctx.window = ctx;
  ctx.ViewKit = { typeBadge: () => '' };
  ctx.MediaDisplay = require('../public/js/utils/mediaDisplay.js'); // D-TE-1: título atenuado quando é só "Episódio N"
  vm.createContext(ctx);
  vm.runInContext(read('utils/dom.js'), ctx);
  vm.runInContext(read('views/calendarView.js'), ctx);
  const view = ctx.calendarView;
  const base = { showId: 601, showName: 'Anime', type: 'anime', title: 'X', daysFromToday: 3, watched: false, extra: true };
  const filme = view.renderItem({ ...base, seasonNumber: 3, episodeNumber: 1, extraKind: 'movie' });
  assert.match(filme, /<span class="calendar-item-code">FILME<\/span>/);
  assert.match(filme, /data-show="601" data-season="3" data-episode="1"/);
  const ova = view.renderItem({ ...base, seasonNumber: 4, episodeNumber: 1, extraKind: 'special' });
  assert.match(ova, /<span class="calendar-item-code">OVA\/ESPECIAL<\/span>/);
  assert.match(ova, /data-season="4" data-episode="1"/);
  const ep = view.renderItem({ ...base, extra: false, seasonNumber: 2, episodeNumber: 5 });
  assert.match(ep, /T2:E5/);
  const avulso = view.renderItem({ ...base, type: 'movie', extra: false });
  assert.match(avulso, /FILME/);
  assert.ok(!/data-season/.test(avulso));
});
