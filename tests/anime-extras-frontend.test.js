'use strict';
// Anime com extras (filmes/OVAs como temporadas com `category`): progresso, cascata, próximo episódio, Agenda e estatísticas.
// Roda sem internet: regras puras + estado/estatísticas num contexto vm simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WS = require('../public/js/utils/watchStatus');
const Cal = require('../public/js/utils/calendar');
const LM = require('../public/js/utils/libraryMerge');

const ROOT = path.join(__dirname, '..', 'public', 'js');
const TODAY = '2026-11-05';

const eps = (n, air = '2020-01-01', runtime) =>
  Array.from({ length: n }, (_, i) => ({ episode_number: i + 1, name: `Ep ${i + 1}`, air_date: air, ...(runtime ? { runtime } : {}) }));

// T1 (2 eps) + filme (season 2) + T2 (2 eps, season 3) + OVA (season 4)
function animeWithExtras(extra = {}) {
  return {
    id: 7,
    type: 'anime',
    name: 'Anime Teste',
    seasons: [
      { season_number: 1, name: 'T1', episodes: eps(2) },
      {
        season_number: 2,
        name: 'O Filme',
        category: 'movie',
        episodes: [{ episode_number: 1, name: 'O Filme', air_date: '2026-11-10', runtime: 100 }]
      },
      { season_number: 3, name: 'T2', category: 'season', episodes: eps(2) },
      {
        season_number: 4,
        name: 'OVA',
        category: 'special',
        episodes: [{ episode_number: 1, name: 'OVA 1', air_date: '2026-11-01' }]
      }
    ],
    ...extra
  };
}

const watchedSet = keys => (s, e) => keys.includes(`${s}:${e}`);

test('seasonCategory / isExtraSeason / mainSeasons', () => {
  assert.equal(WS.seasonCategory({ season_number: 1 }), 'season');
  assert.equal(WS.seasonCategory({ category: 'movie' }), 'movie');
  assert.equal(WS.isExtraSeason({ category: 'special' }), true);
  assert.equal(WS.isExtraSeason({ category: 'season' }), false);
  assert.equal(WS.isExtraSeason({}), false);
  assert.deepEqual(
    WS.mainSeasons(animeWithExtras()).map(s => s.season_number),
    [1, 3]
  );
});

test('progresso: filme/OVA não assistidos não impedem o Finalizado', () => {
  const media = animeWithExtras();
  const p = WS.computeProgress(media, watchedSet(['1:1', '1:2', '3:1', '3:2']));
  assert.deepEqual(p, { total: 4, watched: 4, complete: true });
  const partial = WS.computeProgress(media, watchedSet(['1:1', '2:1']));
  assert.equal(partial.total, 4);
  assert.equal(partial.watched, 1); // o filme assistido não soma
  assert.equal(partial.complete, false);
});

test('obra só de filme/OVA: os extras contam como principais', () => {
  const media = { type: 'anime', seasons: [{ season_number: 1, category: 'movie', episodes: eps(1) }] };
  assert.equal(WS.mainSeasons(media).length, 1);
  assert.deepEqual(WS.computeProgress(media, watchedSet([])), { total: 1, watched: 0, complete: false });
  assert.deepEqual(WS.computeProgress(media, watchedSet(['1:1'])), { total: 1, watched: 1, complete: true });
});

test('cascata: marcar T2E1 não marca o filme; marcar o filme devolve []', () => {
  const media = animeWithExtras();
  const out = WS.episodesToCascade(media, 3, 1, () => false, TODAY);
  assert.deepEqual(out, [
    { season: 1, episode: 1 },
    { season: 1, episode: 2 }
  ]);
  assert.equal(
    out.some(x => x.season === 2 || x.season === 4),
    false
  );
  assert.deepEqual(
    WS.episodesToCascade(media, 2, 1, () => false, TODAY),
    []
  );
  assert.deepEqual(
    WS.episodesToCascade(media, 4, 1, () => false, TODAY),
    []
  );
});

test('Agenda: temporada extra vira item extra com a chave certa; episódios normais seguem iguais', () => {
  const media = animeWithExtras();
  const asked = [];
  const items = Cal.buildAgenda(
    [{ showId: 7 }],
    () => media,
    (id, s, e) => {
      asked.push(`${id}_s${s}_e${e}`);
      return s === 4;
    },
    TODAY,
    { range: 'all' }
  );
  const movie = items.find(i => i.seasonNumber === 2);
  assert.equal(movie.extra, true);
  assert.equal(movie.extraKind, 'movie');
  assert.equal(movie.episodeNumber, 1);
  assert.equal(movie.title, 'O Filme');
  assert.equal(movie.airDate, '2026-11-10');
  assert.equal(movie.watched, false);
  const ova = items.find(i => i.seasonNumber === 4);
  assert.equal(ova.extraKind, 'special');
  assert.equal(ova.watched, true);
  assert.ok(asked.includes('7_s2_e1') && asked.includes('7_s4_e1'));
  // episódios normais (2020, fora da janela de 90 dias) não aparecem; os com data na janela continuam sem `extra`
  const media2 = animeWithExtras();
  media2.seasons[0].episodes[0].air_date = '2026-11-06';
  const again = Cal.buildAgenda(
    [{ showId: 7 }],
    () => media2,
    () => false,
    TODAY,
    { range: 'all' }
  );
  const normal = again.find(i => i.seasonNumber === 1);
  assert.equal(normal.extra, undefined);
  assert.equal(normal.title, 'Ep 1');
});

// ---------- estado e estatísticas (contexto simulado) ----------
function makeApp(media, watchedKeys) {
  const store = new Map();
  const elements = new Map();
  const el = () => ({
    textContent: '',
    innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    style: {},
    addEventListener() {}
  });
  const now = new Date().toISOString();
  const watchedEpisodes = {};
  for (const k of watchedKeys) watchedEpisodes[k] = { watched: true, watchedAt: now, updatedAt: now, rewatchCount: 1 };
  store.set(
    'showvault_state_mvc_v1',
    JSON.stringify({
      trackedShows: [{ showId: media.id, status: 'watching', addedAt: now, updatedAt: now }],
      watchedEpisodes,
      episodeNotes: {},
      tombstones: LM.emptyTombstones(),
      resetAt: ''
    })
  );
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
    Error,
    TypeError,
    SyntaxError,
    Date,
    performance,
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: k => void store.delete(k)
    },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    document: {
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, el());
        return elements.get(id);
      },
      querySelector: () => null,
      querySelectorAll: () => []
    },
    addEventListener() {},
    dispatchEvent() {},
    apiClient: {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const files = [
    'utils/dom.js',
    'utils/emotions.js',
    'utils/markdown.js',
    'utils/mediaDisplay.js',
    'utils/viewKit.js',
    'utils/libraryMerge.js',
    'utils/rating.js',
    'utils/genreStats.js',
    'utils/watchStatus.js',
    'utils/calendar.js',
    'utils/backupValidator.js',
    'utils/migrations.js',
    'models/state.js',
    'views/statsView.js'
  ];
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf-8'), ctx, { filename: f });
  ctx.appState.cacheMediaList([media]);
  return { ctx, state: ctx.appState, text: id => String(elements.get(id) ? elements.get(id).textContent : '') };
}

test('estado: próximo episódio ignora o filme e Finalizado ignora extras', () => {
  const media = animeWithExtras();
  const app = makeApp(media, ['7_s1_e1', '7_s1_e2']);
  const p = app.state.getProgress(7);
  assert.deepEqual({ ...p.next }, { seasonNumber: 3, episodeNumber: 1 }); // não é o filme (season 2)
  assert.equal(p.complete, false);

  const done = makeApp(media, ['7_s1_e1', '7_s1_e2', '7_s3_e1', '7_s3_e2']);
  assert.equal(done.state.getProgress(7).complete, true);
  assert.equal(done.state.getProgress(7).next, null);
});

test('estado: marcar T2E1 (markWatchedUpTo) não marca o filme e usa as chaves id_sN_eM', () => {
  const media = animeWithExtras();
  const app = makeApp(media, []);
  const { snapshot } = app.state.markWatchedUpTo(7, 3, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.map(s => s.key).sort())), ['7_s1_e1', '7_s1_e2', '7_s3_e1']);
  assert.equal(app.state.isWatched(7, 2, 1), false);
  assert.equal(app.state.markWatchedUpTo(7, 2, 1).count, 1); // o filme só marca ele mesmo
  assert.equal(app.state.isWatched(7, 2, 1), true);
  assert.equal(media.seasons[1].season_number, 2);
});

test('estatísticas: extras não contam como episódios, mas somam o tempo', () => {
  const media = animeWithExtras();
  media.seasons[0].episodes = eps(2, '2020-01-01', 20);
  // watched: 1 episódio normal (20 min), o filme (runtime 100) e o OVA (sem duração => 45)
  const app = makeApp(media, ['7_s1_e1', '7_s2_e1', '7_s4_e1']);
  app.ctx.statsView.render();
  assert.equal(app.text('stat-episodes-count'), '1');
  assert.equal(app.text('stat-minutes-subtext'), `${(20 + 100 + 45).toLocaleString('pt-BR')} minutos assistidos`);
});

test('estatísticas: filme sem duração = 90 min, OVA sem duração = 45 min', () => {
  const media = animeWithExtras();
  media.seasons[1].episodes[0].runtime = undefined;
  const app = makeApp(media, ['7_s2_e1']);
  app.ctx.statsView.render();
  assert.equal(app.text('stat-minutes-subtext'), '90 minutos assistidos');
  assert.equal(app.text('stat-episodes-count'), '0');
});
