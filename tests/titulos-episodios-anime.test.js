process.env.SHOWVAULT_SEED_PATH = require('path').join(__dirname, 'fixtures', 'seed-teste.json'); // seed de teste (textos fictícios)
// Títulos e miniaturas de episódio de ANIME vindos do TMDB (D-TE-1..6): mapa de ids, alinhamento com trava de datas, cliente do TMDB
// e migração "antes/depois" das obras já guardadas. Só dados FICTÍCIOS e pequenos; a "internet" é sempre uma função falsa e tudo
// roda em pastas temporárias (nunca em server/data, nunca com rede ou chave reais).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeService, tempRoot } = require('./helpers/anilistFixtures');
const T = tempRoot('showvault-titulos-ep-');
process.env.SHOWVAULT_DATA_DIR = path.join(T.root, 'singleton');
fs.mkdirSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true });

const { MediaService } = require('../server/services/mediaService');
const AnimeIdMap = require('../server/services/animeIdMap');
const TmdbClient = require('../server/services/tmdbClient');
const { alignEntry, applyTmdbEpisodes } = require('../server/services/animeTmdbEpisodes');
const anilistMapper = require('../server/services/anilistMapper');
const { mediaErrors } = require('../server/utils/errors');
const { toInternalId } = require('../server/utils/ids');

const MAP_URL = 'https://raw.githubusercontent.com/exemplo-ficticio/lista/master/lista.json';
const TMDB_BASE = 'http://tmdb.invalid/3';
const FAKE_KEY = 'chave-falsa-de-teste'; // não é segredo: só liga o cliente do TMDB
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Silencia os avisos esperados (console.warn/log) do teste.
function quiet(t) {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
}

// ------------------------------------------------------------------------------------------------- dados fictícios

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekly = (start, count) => Array.from({ length: count }, (_, i) => addDays(start, 7 * i));
const genericNames = (count, from = 1) => Array.from({ length: count }, (_, i) => `Episódio ${from + i}`);

// Mapa de ids fictício: >= 1000 entradas de enchimento + as entradas do teste (formato do arquivo externo).
function mapJson(extra = [], filler = 1100) {
  const list = [];
  for (let i = 1; i <= filler; i++) {
    list.push({
      anilist_id: 5_000_000 + i,
      mal_id: 6_000_000 + i,
      themoviedb_id: { tv: 100_000 + i },
      season: { tmdb: 1 },
      episode_offset: { tmdb: 0 }
    });
  }
  return [...list, ...extra];
}
const mapEntry = (anilist, mal, tv, season, offset = 0) => ({
  anilist_id: anilist,
  mal_id: mal,
  themoviedb_id: { tv },
  ...(season === null ? {} : { season: { tmdb: season } }),
  episode_offset: { tmdb: offset }
});

// Um "Media" da AniList fictício (TV, semanal). `start` AAAA-MM-DD, `related` = [{rel:'SEQUEL'|'PREQUEL', id, idMal}].
function fakeMedia({ id, idMal, name, start, episodes, status = 'FINISHED', related = [] }) {
  const [y, m, d] = start.split('-').map(Number);
  return {
    id,
    idMal,
    type: 'ANIME',
    format: 'TV',
    status,
    episodes,
    duration: 24,
    season: 'WINTER',
    seasonYear: y,
    isAdult: false,
    title: { romaji: name, english: name, native: null },
    synonyms: [],
    startDate: { year: y, month: m, day: d },
    averageScore: 70,
    genres: ['Aventura'],
    description: 'Obra inventada para teste.',
    coverImage: { large: 'https://img.exemplo.invalid/p.jpg', extraLarge: 'https://img.exemplo.invalid/g.jpg' },
    bannerImage: null,
    nextAiringEpisode: null,
    relations: {
      edges: related.map(r => ({ relationType: r.rel, node: { id: r.id, idMal: r.idMal, type: 'ANIME', format: 'TV', isAdult: false } }))
    },
    airingSchedule: {
      nodes: weekly(start, episodes).map((date, i) => ({ episode: i + 1, airingAt: Date.parse(`${date}T12:00:00Z`) / 1000 }))
    }
  };
}

// AniList falsa: responde por id ou idMal; a grade recente (obra em exibição) vem vazia.
function anilistHandler(medias) {
  return (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.query.includes('airingSchedules(')) return { data: { Page: { airingSchedules: [] } } };
    const v = body.variables;
    const hit = medias.find(m => (v.id ? m.id === v.id : m.idMal === v.idMal));
    if (!hit) throw mediaErrors.notFound();
    return { data: { Media: structuredClone(hit) } };
  };
}

// Franquia fictícia "Brasa Eterna": T1 (5 eps) e T2 (7 eps) na AniList; no TMDB é UMA série (id 777) de 1 temporada com 12 episódios.
const A = { id: 900001, idMal: 800001 };
const B = { id: 900002, idMal: 800002 };
const TMDB_ID = 777;
const datesA = weekly('2020-01-07', 5);
const datesB = weekly('2021-01-06', 7);
const brasaMedias = () => [
  fakeMedia({ ...A, name: 'Brasa Eterna', start: '2020-01-07', episodes: 5, related: [{ rel: 'SEQUEL', ...B }] }),
  fakeMedia({ ...B, name: 'Brasa Eterna 2', start: '2021-01-06', episodes: 7, related: [{ rel: 'PREQUEL', ...A }] })
];

// Episódio do TMDB falso. `pt`/`en` = título em cada língua; `still` = caminho como o TMDB de verdade manda ("/x.jpg").
const tmdbEp = (n, date, pt, en, still = `/brasa${n}.jpg`) => ({ episode_number: n, air_date: date, pt, en, still_path: still });
const ptTitle = n => `Brasa de número ${n}`;

// Série de 1 temporada com 12 episódios contínuos (5 da T1 + 7 da T2), como o "Jujutsu T2" do mundo real.
function flatSeason() {
  return [...datesA, ...datesB].map((date, i) => tmdbEp(i + 1, date, ptTitle(i + 1), `Ember ${i + 1}`));
}

// "Internet" do TMDB: series = { [tvId]: { name, seasons: { [n]: [episódio] } } }. Registra cada chamada em `calls`.
function tmdbFake(series, calls = []) {
  const fn = async url => {
    const u = new URL(url);
    const language = u.searchParams.get('language');
    const season = /^\/3\/tv\/(\d+)\/season\/(\d+)$/.exec(u.pathname);
    const show = /^\/3\/tv\/(\d+)$/.exec(u.pathname);
    if (season) {
      const s = series[season[1]] && series[season[1]].seasons[season[2]];
      calls.push({ kind: 'season', tv: Number(season[1]), season: Number(season[2]), language });
      if (!s) throw mediaErrors.notFound();
      return {
        name: `Temporada ${season[2]}`,
        episodes: s.map(e => ({
          episode_number: e.episode_number,
          air_date: e.air_date,
          name: language === 'en-US' ? e.en : e.pt,
          still_path: e.still_path,
          overview: ''
        }))
      };
    }
    if (show) {
      calls.push({ kind: 'tv', tv: Number(show[1]), language });
      const tv = series[show[1]];
      if (!tv) throw mediaErrors.notFound();
      const seasons = Object.entries(tv.seasons).map(([n, eps]) => ({ season_number: Number(n), episode_count: eps.length }));
      return { id: Number(show[1]), name: tv.name, original_name: tv.name, overview: '', seasons, status: 'Ended', genres: [] };
    }
    throw new Error(`URL inesperada no TMDB falso: ${url}`);
  };
  fn.calls = calls;
  return fn;
}

// Serviço de teste: AniList falsa (medias), TMDB falso (tmdb), mapa de ids falso (mapEntries). Sem Jikan.
function newService(dir, { medias = [], tmdb = null, key = FAKE_KEY, mapEntries = [], mapDownload = null } = {}) {
  const calls = [];
  const download = mapDownload || (async () => mapJson(mapEntries));
  const svc = makeService(MediaService, dir, {
    handlers: { anilist: anilistHandler(medias) },
    extra: {
      tmdbKey: key,
      tmdbBase: TMDB_BASE,
      jikanEnabled: false,
      idMapDownload: download,
      seedPath: path.join(__dirname, 'fixtures', 'seed-teste.json'),
      tmdbBudgetMs: 60_000
    }
  });
  const base = svc.fetchJson;
  const fakeTmdb = tmdb || tmdbFake({}, calls);
  svc.tmdbCalls = fakeTmdb.calls || calls;
  svc.fetchJson = async (url, opts) => (url.startsWith(TMDB_BASE) ? fakeTmdb(url, opts) : base(url, opts));
  return svc;
}

// ================================================================================================= 1. mapa de ids

function newMap(dir, o = {}) {
  const clock = o.clock || { t: Date.parse('2026-03-01T00:00:00Z') };
  const calls = [];
  const download =
    o.download ||
    (async url => {
      calls.push(url);
      return mapJson([mapEntry(910001, 810001, 4242, 2, 3)]);
    });
  const map = new AnimeIdMap({
    dataDir: dir,
    now: () => clock.t,
    url: o.url || MAP_URL,
    download: async url => {
      if (!o.download) return download(url);
      calls.push(url);
      return o.download(url);
    }
  });
  return { map, clock, calls };
}

test('mapa: download ok grava o arquivo e o lookup acha por AniList e por MAL', async t => {
  quiet(t);
  const dir = T.newDir();
  const { map, calls } = newMap(dir);
  assert.equal(map.ready, false);
  assert.equal(await map.ensure(), true);
  assert.equal(calls.length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'animeIdMap.runtime.json')));
  assert.deepEqual(map.lookup({ anilistId: 910001 }), { tmdbId: 4242, season: 2, offset: 3 });
  assert.deepEqual(map.lookup({ malId: 810001 }), { tmdbId: 4242, season: 2, offset: 3 });
  assert.deepEqual(
    map.lookup({ anilistId: 1, malId: 810001 }),
    { tmdbId: 4242, season: 2, offset: 3 },
    'na falta do id da AniList vale o da MAL'
  );
  assert.equal(map.lookup({ anilistId: 123 }), null);
  // o arquivo guarda só o necessário (não o JSON externo inteiro)
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'animeIdMap.runtime.json'), 'utf-8'));
  assert.deepEqual(saved.byAnilist['910001'], [4242, 2, 3]);
});

test('mapa: download falhando com cópia anterior no disco continua usando a cópia', async t => {
  quiet(t);
  const dir = T.newDir();
  const first = newMap(dir);
  await first.map.ensure();
  // semana e meia depois: nova execução do app, internet fora do ar
  const later = newMap(dir, { clock: { t: first.clock.t + 10 * DAY }, download: async () => Promise.reject(new Error('sem internet')) });
  assert.equal(later.map.ready, true, 'a cópia do disco já vale ao iniciar');
  assert.equal(await later.map.ensure(), true);
  assert.equal(later.calls.length, 1, 'tentou baixar (a cópia tinha mais de 7 dias)');
  assert.deepEqual(later.map.lookup({ anilistId: 910001 }), { tmdbId: 4242, season: 2, offset: 3 });
});

test('mapa: nunca baixou e falhou -> ready=false e lookup devolve null', async t => {
  quiet(t);
  const { map } = newMap(T.newDir(), { download: async () => Promise.reject(new Error('sem internet')) });
  assert.equal(await map.ensure(), false);
  assert.equal(map.ready, false);
  assert.equal(map.lookup({ anilistId: 910001, malId: 810001 }), null);
});

test('mapa: formato inválido ou lista pequena demais não substitui a cópia boa', async t => {
  quiet(t);
  const dir = T.newDir();
  const first = newMap(dir);
  await first.map.ensure();
  const file = path.join(dir, 'animeIdMap.runtime.json');
  const before = fs.readFileSync(file, 'utf-8');
  const bad = [
    { que: 'objeto no lugar de lista' }, // formato inesperado
    [mapEntry(920001, 820001, 9, 1)], // lista válida mas minúscula (< 1000 entradas)
    mapJson([], 10), // idem
    Array.from({ length: 1500 }, () => ({ lixo: true })) // 1500 itens, nenhum no formato conhecido
  ];
  let day = 8;
  for (const json of bad) {
    const o = newMap(dir, { clock: { t: first.clock.t + day * DAY }, download: async () => json });
    assert.equal(await o.map.ensure(), true, 'continua pronto com a cópia anterior');
    assert.deepEqual(o.map.lookup({ anilistId: 910001 }), { tmdbId: 4242, season: 2, offset: 3 });
    assert.equal(o.map.lookup({ anilistId: 920001 }), null, 'a lista rejeitada não entrou');
    assert.equal(fs.readFileSync(file, 'utf-8'), before, 'o arquivo bom ficou intacto');
    day += 8;
  }
});

test('mapa: endereço fora de raw.githubusercontent.com ou sem HTTPS é recusado (nem tenta baixar)', async t => {
  quiet(t);
  for (const url of [
    'https://exemplo-ruim.invalid/lista.json',
    'http://raw.githubusercontent.com/x/y/master/lista.json',
    'https://raw.githubusercontent.com.ruim.invalid/lista.json',
    'file:///etc/passwd'
  ]) {
    const { map, calls } = newMap(T.newDir(), { url, download: async () => mapJson() });
    assert.equal(await map.ensure(), false, url);
    assert.equal(calls.length, 0, `não pode baixar de ${url}`);
    assert.equal(map.lookup({ anilistId: 5_000_001 }), null);
  }
});

test('mapa: não baixa de novo antes de 7 dias e baixa depois', async t => {
  quiet(t);
  const { map, clock, calls } = newMap(T.newDir());
  await map.ensure();
  assert.equal(calls.length, 1);
  clock.t += 6 * DAY + 23 * HOUR;
  await map.ensure();
  assert.equal(calls.length, 1, 'com menos de 7 dias reaproveita');
  clock.t += 2 * HOUR; // passou de 7 dias
  await map.ensure();
  assert.equal(calls.length, 2, 'passou de 7 dias: baixa de novo');
});

test('mapa: download que falhou não é repetido antes de 1 hora', async t => {
  quiet(t);
  const { map, clock, calls } = newMap(T.newDir(), { download: async () => Promise.reject(new Error('fora do ar')) });
  await map.ensure();
  assert.equal(calls.length, 1);
  clock.t += 30 * 60 * 1000;
  await map.ensure();
  assert.equal(calls.length, 1, 'meia hora depois ainda não tenta');
  clock.t += 31 * 60 * 1000;
  await map.ensure();
  assert.equal(calls.length, 2, 'depois de 1 h tenta de novo');
});

// ================================================================================================= 2. alinhamento

const aniEps = (dates, from = 1) => dates.map((air_date, i) => ({ episode_number: from + i, air_date }));
// loadSeason falso a partir de { [temporada]: [episódio TMDB] }; registra as temporadas pedidas
function loaderOf(seasons, asked = []) {
  return async n => {
    asked.push(n);
    return (seasons[n] || []).map(e => ({ episode_number: e.episode_number, air_date: e.air_date, name: e.pt, still_path: e.still_path }));
  };
}
const IMG = n => `https://image.tmdb.org/t/p/w300/brasa${n}.jpg`;

test('alinhamento (a): caminho feliz com a temporada do mapa e o episode_offset', async () => {
  // TMDB: temporada 2 com 10 episódios; a entrada da AniList (4 eps) corresponde aos episódios 3..6 (offset 2)
  const dates = weekly('2022-04-01', 10);
  const season2 = dates.map((d, i) => tmdbEp(i + 1, d, ptTitle(i + 1), null, IMG(i + 1)));
  const tv = {
    seasons: [
      { season_number: 1, episode_count: 12 },
      { season_number: 2, episode_count: 10 }
    ]
  };
  const res = await alignEntry({
    entry: { episodes: aniEps(dates.slice(2, 6)) },
    info: { tmdbId: 1, season: 2, offset: 2 },
    tv,
    start: 0,
    loadSeason: loaderOf({ 2: season2 })
  });
  assert.equal(res.mode, 'season');
  assert.deepEqual(
    res.list.map(e => [e.episode_number, e.name]),
    [
      [1, ptTitle(3)],
      [2, ptTitle(4)],
      [3, ptTitle(5)],
      [4, ptTitle(6)]
    ]
  );
  assert.equal(res.list[0].still_path, IMG(3));
});

test('alinhamento (b): mapa aponta temporada que não existe no TMDB -> lista plana com o deslocamento das irmãs', async () => {
  // série de 1 temporada com 12 eps; T1 (5 eps) e T2 (7 eps); o mapa diz "season 2" para a T2, que não existe no TMDB
  const season1 = flatSeason().map(e => ({ ...e, still_path: IMG(e.episode_number) }));
  const tv = { seasons: [{ season_number: 1, episode_count: 12 }] };
  const t1 = await alignEntry({
    entry: { episodes: aniEps(datesA) },
    info: { tmdbId: TMDB_ID, season: 1, offset: 0 },
    tv,
    start: 0,
    loadSeason: loaderOf({ 1: season1 })
  });
  assert.equal(t1.mode, 'season');
  assert.deepEqual(
    t1.list.map(e => e.name),
    [1, 2, 3, 4, 5].map(ptTitle)
  );
  const t2 = await alignEntry({
    entry: { episodes: aniEps(datesB) },
    info: { tmdbId: TMDB_ID, season: 2, offset: 0 },
    tv,
    start: 5,
    loadSeason: loaderOf({ 1: season1 })
  });
  assert.equal(t2.mode, 'flat');
  assert.deepEqual(
    t2.list.map(e => [e.episode_number, e.name]),
    [
      [1, ptTitle(6)],
      [2, ptTitle(7)],
      [3, ptTitle(8)],
      [4, ptTitle(9)],
      [5, ptTitle(10)],
      [6, ptTitle(11)],
      [7, ptTitle(12)]
    ]
  );
});

test('alinhamento (c): contagem divergente ou datas que não batem -> nada é aplicado', async () => {
  const tv = { seasons: [{ season_number: 1, episode_count: 12 }] };
  const info = { tmdbId: TMDB_ID, season: 1, offset: 0 };
  // datas do TMDB 40 dias depois das da AniList (nenhuma bate)
  const shifted = flatSeason().map(e => ({ ...e, air_date: addDays(e.air_date, 40) }));
  assert.equal(await alignEntry({ entry: { episodes: aniEps(datesA) }, info, tv, start: 0, loadSeason: loaderOf({ 1: shifted }) }), null);
  // contagem divergente: a série do TMDB só tem 2 episódios para as 5 da AniList (poucas datas comparáveis)
  const tvShort = { seasons: [{ season_number: 1, episode_count: 2 }] };
  const short = flatSeason().slice(0, 2);
  assert.equal(
    await alignEntry({ entry: { episodes: aniEps(datesA) }, info, tv: tvShort, start: 0, loadSeason: loaderOf({ 1: short }) }),
    null
  );
  // AniList sem nenhuma data: não há como conferir, não arrisca
  const noDates = datesA.map((_, i) => ({ episode_number: i + 1, air_date: '' }));
  assert.equal(await alignEntry({ entry: { episodes: noDates }, info, tv, start: 0, loadSeason: loaderOf({ 1: flatSeason() }) }), null);
  // e, sem lista alinhada, os episódios continuam "Episódio N"
  const eps = datesA.map((d, i) => ({ episode_number: i + 1, name: `Episódio ${i + 1}`, air_date: d, still_path: null }));
  assert.deepEqual(applyTmdbEpisodes(eps, []), eps);
  assert.deepEqual(applyTmdbEpisodes(eps, null), eps);
});

test('alinhamento (c2): serviço - datas que não batem deixam os episódios como "Episódio N"', async t => {
  quiet(t);
  const shifted = flatSeason().map(e => ({ ...e, air_date: addDays(e.air_date, 40) }));
  const tmdb = tmdbFake({ [TMDB_ID]: { name: 'Brasa', seasons: { 1: shifted } } });
  const svc = newService(T.newDir(), {
    medias: brasaMedias(),
    tmdb,
    mapEntries: [mapEntry(A.id, A.idMal, TMDB_ID, 1), mapEntry(B.id, B.idMal, TMDB_ID, 2)]
  });
  await svc.idMap.ensure();
  const franchise = await svc.anilist.getFranchise({ id: A.id });
  const res = await svc.tmdbTitles(franchise);
  assert.equal(res.map.size, 0);
  assert.equal(res.complete, true, 'consultou tudo; apenas nada passou na trava');
  const work = anilistMapper.buildAnimeWork(1, { anilistId: A.id }, franchise, { tmdbFor: res.map });
  assert.deepEqual(
    work.seasons[0].episodes.map(e => e.name),
    genericNames(5)
  );
  assert.deepEqual(
    work.seasons[1].episodes.map(e => e.name),
    genericNames(7)
  );
});

test('alinhamento (d): sem entrada no mapa nada muda e o TMDB nem é consultado', async t => {
  quiet(t);
  const tmdb = tmdbFake({ [TMDB_ID]: { name: 'Brasa', seasons: { 1: flatSeason() } } });
  const svc = newService(T.newDir(), { medias: brasaMedias(), tmdb, mapEntries: [] });
  await svc.idMap.ensure();
  const franchise = await svc.anilist.getFranchise({ id: A.id });
  const res = await svc.tmdbTitles(franchise);
  assert.equal(res.map.size, 0);
  assert.equal(res.complete, true);
  assert.equal(tmdb.calls.length, 0, 'sem par no mapa não gasta chamada do TMDB');
});

test('alinhamento (a/b): serviço - com o mapa, T1 e T2 recebem os títulos certos (T2 pela lista plana)', async t => {
  quiet(t);
  const tmdb = tmdbFake({
    [TMDB_ID]: {
      name: 'Brasa',
      seasons: { 1: flatSeason().map(e => ({ ...e, still_path: `https://image.tmdb.org/t/p/w300/s${e.episode_number}.jpg` })) }
    }
  });
  const svc = newService(T.newDir(), {
    medias: brasaMedias(),
    tmdb,
    mapEntries: [mapEntry(A.id, A.idMal, TMDB_ID, 1), mapEntry(B.id, B.idMal, TMDB_ID, 2)]
  });
  await svc.idMap.ensure();
  const franchise = await svc.anilist.getFranchise({ id: A.id });
  const res = await svc.tmdbTitles(franchise);
  assert.equal(res.complete, true);
  assert.deepEqual(
    res.map.get(A.id).map(e => e.name),
    [1, 2, 3, 4, 5].map(ptTitle)
  );
  assert.deepEqual(
    res.map.get(B.id).map(e => e.name),
    [6, 7, 8, 9, 10, 11, 12].map(ptTitle)
  );
});

// --- (e) pt-BR vazio / genérico -> en-US, direto no cliente do TMDB ---

function newClient(series, calls = []) {
  return new TmdbClient({ apiKey: FAKE_KEY, baseUrl: TMDB_BASE, fetchJson: tmdbFake(series, calls) });
}

test('alinhamento (e): pt-BR vazio ou genérico cai para en-US, e só quando há lacuna num episódio já exibido', async () => {
  const today = '2026-06-01';
  const calls = [];
  const eps = [
    tmdbEp(1, '2026-01-05', ptTitle(1), 'Ember 1'), // pt-BR bom
    tmdbEp(2, '2026-01-12', '', 'Ember 2'), // pt-BR vazio
    tmdbEp(3, '2026-01-19', 'Episódio 3', 'Ember 3'), // pt-BR genérico
    tmdbEp(4, '2026-01-26', 'Episódio 4', 'Episode 4'), // genérico em ambas
    tmdbEp(5, '2026-02-02', '', '') // vazio em ambas
  ];
  const client = newClient({ 1: { name: 'X', seasons: { 1: eps } } }, calls);
  const res = await client.seasonEpisodes(1, 1, { today });
  assert.deepEqual(
    res.episodes.map(e => e.name),
    [ptTitle(1), 'Ember 2', 'Ember 3', '', ''],
    'título genérico/vazio nas duas línguas fica vazio (nunca "Episode 4")'
  );
  assert.deepEqual(
    calls.map(c => c.language),
    ['pt-BR', 'en-US'],
    'uma chamada extra de en-US'
  );

  // tudo bom em pt-BR: nenhuma chamada extra
  const good = [tmdbEp(1, '2026-01-05', ptTitle(1), 'Ember 1'), tmdbEp(2, '2026-01-12', ptTitle(2), 'Ember 2')];
  const callsGood = [];
  await newClient({ 1: { name: 'X', seasons: { 1: good } } }, callsGood).seasonEpisodes(1, 1, { today });
  assert.deepEqual(
    callsGood.map(c => c.language),
    ['pt-BR']
  );

  // lacuna só em episódio que AINDA NÃO foi exibido: sem chamada extra
  const future = [tmdbEp(1, '2026-01-05', ptTitle(1), 'Ember 1'), tmdbEp(2, '2026-12-12', '', 'Ember 2')];
  const callsFuture = [];
  await newClient({ 1: { name: 'X', seasons: { 1: future } } }, callsFuture).seasonEpisodes(1, 1, { today });
  assert.deepEqual(
    callsFuture.map(c => c.language),
    ['pt-BR'],
    'episódio futuro sem título não custa en-US'
  );
});

test('alinhamento (e2): serviço - o título em en-US (fallback) chega até o episódio e nunca grava título vazio', async t => {
  quiet(t);
  // pt-BR vazio no ep 1 (en-US: "Ember 1"); ep 2 genérico nas duas línguas; ep 3 vazio nas duas
  const season = [
    tmdbEp(1, datesA[0], '', 'Ember 1', '/e1.jpg'),
    tmdbEp(2, datesA[1], 'Episódio 2', 'Episode 2', '/e2.jpg'),
    tmdbEp(3, datesA[2], '', '', '/e3.jpg'),
    tmdbEp(4, datesA[3], ptTitle(4), 'Ember 4', '/e4.jpg'),
    tmdbEp(5, datesA[4], ptTitle(5), 'Ember 5', '/e5.jpg')
  ];
  const tmdb = tmdbFake({ [TMDB_ID]: { name: 'Brasa', seasons: { 1: season } } });
  const svc = newService(T.newDir(), {
    medias: brasaMedias()
      .slice(0, 1)
      .map(m => ({ ...m, relations: { edges: [] } })),
    tmdb,
    mapEntries: [mapEntry(A.id, A.idMal, TMDB_ID, 1)]
  });
  await svc.idMap.ensure();
  const franchise = await svc.anilist.getFranchise({ id: A.id });
  const res = await svc.tmdbTitles(franchise);
  const work = anilistMapper.buildAnimeWork(1, { anilistId: A.id }, franchise, { tmdbFor: res.map });
  const names = work.seasons[0].episodes.map(e => e.name);
  assert.ok(
    names.every(n => n.trim().length > 0),
    'nenhum título vazio'
  );
  // BUG? (ver relatório) seasonEpisodes devolve o título do en-US em `title`, mas alignEntry lê `name` (só o pt-BR)
  assert.deepEqual(names, ['Ember 1', 'Episódio 2', 'Episódio 3', ptTitle(4), ptTitle(5)]);
});

test('alinhamento (f): miniatura só aceita URL https://image.tmdb.org/...; outra URL é ignorada', async () => {
  const tv = { seasons: [{ season_number: 1, episode_count: 5 }] };
  const season = [
    { ...tmdbEp(1, datesA[0], ptTitle(1), null), still_path: 'https://image.tmdb.org/t/p/w300/ok1.jpg' },
    { ...tmdbEp(2, datesA[1], ptTitle(2), null), still_path: 'http://image.tmdb.org/t/p/w300/sem-https.jpg' },
    { ...tmdbEp(3, datesA[2], ptTitle(3), null), still_path: 'https://imagens.exemplo.invalid/t/p/w300/outro-host.jpg' },
    { ...tmdbEp(4, datesA[3], ptTitle(4), null), still_path: 'javascript:alert(1)' },
    { ...tmdbEp(5, datesA[4], ptTitle(5), null), still_path: 'https://image.tmdb.org.malvado.invalid/t/p/w300/x.jpg' }
  ];
  const res = await alignEntry({
    entry: { episodes: aniEps(datesA) },
    info: { tmdbId: 1, season: 1, offset: 0 },
    tv,
    start: 0,
    loadSeason: loaderOf({ 1: season })
  });
  assert.deepEqual(
    res.list.map(e => e.still_path),
    ['https://image.tmdb.org/t/p/w300/ok1.jpg', null, null, null, null]
  );
  assert.deepEqual(
    res.list.map(e => e.name),
    [1, 2, 3, 4, 5].map(ptTitle),
    'o título vale mesmo sem miniatura'
  );
});

test('alinhamento (f2): serviço - o still_path "/arquivo.jpg" do TMDB de verdade vira miniatura https://image.tmdb.org/...', async t => {
  quiet(t);
  const tmdb = tmdbFake({ [TMDB_ID]: { name: 'Brasa', seasons: { 1: flatSeason() } } }); // still_path = "/brasaN.jpg" (formato real da API)
  const svc = newService(T.newDir(), {
    medias: brasaMedias(),
    tmdb,
    mapEntries: [mapEntry(A.id, A.idMal, TMDB_ID, 1), mapEntry(B.id, B.idMal, TMDB_ID, 2)]
  });
  await svc.idMap.ensure();
  const franchise = await svc.anilist.getFranchise({ id: A.id });
  const res = await svc.tmdbTitles(franchise);
  const stills = res.map.get(A.id).map(e => e.still_path);
  // BUG? (ver relatório) seasonEpisodes devolve o caminho cru ("/brasa1.jpg") e alignEntry/safeStill só aceita URL completa
  assert.ok(
    stills.every(s => typeof s === 'string' && s.startsWith('https://image.tmdb.org/')),
    `miniaturas obtidas: ${JSON.stringify(stills)}`
  );
});

test('alinhamento (g): o TMDB nunca cria nem remove episódios da AniList', async () => {
  const eps = datesA.slice(0, 3).map((d, i) => ({ episode_number: i + 1, name: `Episódio ${i + 1}`, air_date: d, still_path: null }));
  // TMDB tem 12 episódios; a AniList só 3. A lista alinhada só pode ter os números 1..3
  const tv = { seasons: [{ season_number: 1, episode_count: 12 }] };
  const res = await alignEntry({
    entry: { episodes: aniEps(datesA.slice(0, 3)) },
    info: { tmdbId: 1, season: 1, offset: 0 },
    tv,
    start: 0,
    loadSeason: loaderOf({ 1: flatSeason() })
  });
  assert.deepEqual(
    res.list.map(e => e.episode_number),
    [1, 2, 3]
  );
  // mesmo uma lista com episódios "sobrando" não cria nada
  const withExtra = [
    ...res.list,
    { episode_number: 4, name: 'Intruso', still_path: null },
    { episode_number: 99, name: 'Intruso 99', still_path: null }
  ];
  const applied = applyTmdbEpisodes(eps, withExtra);
  assert.equal(applied.length, 3);
  assert.deepEqual(
    applied.map(e => e.episode_number),
    [1, 2, 3]
  );
  assert.ok(applied.every(e => e.name !== 'Intruso' && e.name !== 'Intruso 99'));
  // título já real (ex.: veio da Jikan) não é trocado; só o "Episódio N"
  const named = [{ ...eps[0], name: 'Título que já existia' }, eps[1], eps[2]];
  assert.equal(applyTmdbEpisodes(named, res.list)[0].name, 'Título que já existia');
});

// ================================================================================================= 3. antes/depois

const bySeasonEp = work => work.seasons.flatMap(s => s.episodes.map(e => ({ s: s.season_number, ...e })));
const libraryKeys = work => bySeasonEp(work).map(e => `${work.id}_s${e.s}_e${e.episode_number}`);
const omitTitle = ep => {
  const { name, still_path, ...rest } = ep;
  return rest;
};
const backupsIn = dir => fs.readdirSync(dir).filter(f => /^mediaCatalog\.backup-pre-titulos-episodios-.+\.json$/.test(f));
const readCatalog = dir => JSON.parse(fs.readFileSync(path.join(dir, 'mediaCatalog.runtime.json'), 'utf-8'));
const MAL_ID = A.idMal;
const WORK_ID = toInternalId('jikan', MAL_ID);

// Obra de anime guardada ANTES da funcionalidade: episódios "Episódio N", sem titlesVersion.
function storedBefore({ status = 'Finalizada', eps = [datesA, datesB], ids = [A, B], names = ['Brasa Eterna', 'Brasa Eterna 2'] } = {}) {
  return {
    id: WORK_ID,
    type: 'anime',
    name: names[0],
    original_name: '',
    alt_titles: [],
    overview: 'Obra inventada para teste.',
    poster_path: 'https://img.exemplo.invalid/p.jpg',
    backdrop_path: 'https://img.exemplo.invalid/g.jpg',
    vote_average: 7,
    first_air_date: eps[0][0],
    genres: ['Aventura'],
    status,
    mal_id: MAL_ID,
    anilist_id: A.id,
    mal_ids: ids.map(i => i.idMal),
    anilist_ids: ids.map(i => i.id),
    ingestedAt: '2026-01-10T00:00:00.000Z',
    refreshedAt: '2026-01-10T00:00:00.000Z',
    scheduleVersion: 2,
    seasons: eps.map((dates, i) => ({
      season_number: i + 1,
      name: `Temporada ${i + 1}`,
      category: 'season',
      episodes: dates.map((d, k) => ({
        episode_number: k + 1,
        name: `Episódio ${k + 1}`,
        runtime: 24,
        air_date: d,
        overview: '',
        still_path: null
      }))
    })),
    franchise: {
      entries: ids.map((i, k) => ({ anilist_id: i.id, mal_id: i.idMal, season_number: k + 1, kind: 'TV', title: names[k] })),
      truncated: false
    }
  };
}

function prepareDir(work) {
  const dir = T.newDir();
  fs.writeFileSync(path.join(dir, 'mediaCatalog.runtime.json'), JSON.stringify([work]));
  // biblioteca/marcações de um usuário fictício: chaves id_sN_eM de alguns episódios vistos
  const library = { items: { [work.id]: { watched: libraryKeys(work).filter((_, i) => i % 2 === 0) } } };
  fs.writeFileSync(path.join(dir, 'biblioteca-ficticia.json'), JSON.stringify(library));
  return dir;
}

const brasaTmdb = (calls = []) => tmdbFake({ [TMDB_ID]: { name: 'Brasa', seasons: { 1: flatSeason() } } }, calls);
const brasaMapEntries = [mapEntry(A.id, A.idMal, TMDB_ID, 1), mapEntry(B.id, B.idMal, TMDB_ID, 2)];

test('antes/depois: a migração só muda name e still_path; numeração e chaves id_sN_eM ficam idênticas', async t => {
  quiet(t);
  const before = storedBefore();
  const dir = prepareDir(before);
  const libBefore = fs.readFileSync(path.join(dir, 'biblioteca-ficticia.json'), 'utf-8');
  const calls = [];
  const svc = newService(dir, { medias: brasaMedias(), tmdb: brasaTmdb(calls), mapEntries: brasaMapEntries });

  const out = await svc.refreshDueWorks({ limit: 5 });
  assert.deepEqual(out.failed, []);
  assert.equal(out.refreshed.length, 1);

  const after = readCatalog(dir).find(m => m.id === WORK_ID);
  // numeração, quantidade e chaves de marcação idênticas
  assert.deepEqual(
    bySeasonEp(after).map(e => [e.s, e.episode_number]),
    bySeasonEp(before).map(e => [e.s, e.episode_number])
  );
  assert.deepEqual(
    after.seasons.map(s => s.season_number),
    before.seasons.map(s => s.season_number)
  );
  assert.deepEqual(
    after.seasons.map(s => s.episodes.length),
    [5, 7]
  );
  assert.deepEqual(libraryKeys(after), libraryKeys(before));
  // só name e still_path mudaram em cada episódio
  assert.deepEqual(bySeasonEp(after).map(omitTitle), bySeasonEp(before).map(omitTitle));
  // ...e o name de fato mudou (títulos do TMDB; T2 pela lista plana)
  const names = bySeasonEp(after).map(e => e.name);
  assert.deepEqual(
    names,
    Array.from({ length: 12 }, (_, i) => ptTitle(i + 1))
  );
  // marcas da migração e backup do catálogo como estava
  assert.equal(after.titlesVersion, 1);
  assert.ok(Date.parse(after.tmdbEpisodesAt) > 0);
  const backups = backupsIn(dir);
  assert.equal(backups.length, 1, 'um (e só um) backup antes de migrar');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, backups[0]), 'utf-8'));
  assert.deepEqual(saved.find(m => m.id === WORK_ID).seasons, before.seasons, 'o backup guarda o catálogo ANTES');
  // o arquivo de biblioteca nem foi tocado
  assert.equal(fs.readFileSync(path.join(dir, 'biblioteca-ficticia.json'), 'utf-8'), libBefore);
});

test('antes/depois: segunda passada não muda nada nem refaz backup (idempotente)', async t => {
  quiet(t);
  const dir = prepareDir(storedBefore());
  await newService(dir, { medias: brasaMedias(), tmdb: brasaTmdb(), mapEntries: brasaMapEntries }).refreshDueWorks({ limit: 5 });
  const catalogFile = path.join(dir, 'mediaCatalog.runtime.json');
  const afterFirst = fs.readFileSync(catalogFile, 'utf-8');
  const backupsFirst = backupsIn(dir);
  assert.equal(backupsFirst.length, 1);

  // "reabre o app": serviço novo sobre a mesma pasta (o mapa de ids vem da cópia do disco, não baixa de novo)
  const calls = [];
  const again = newService(dir, { medias: brasaMedias(), tmdb: brasaTmdb(calls), mapEntries: brasaMapEntries });
  const out = await again.refreshDueWorks({ limit: 5 });
  assert.deepEqual(out, { checked: 0, refreshed: [], failed: [] });
  assert.equal(calls.length, 0, 'nada a pedir ao TMDB');
  assert.equal(fs.readFileSync(catalogFile, 'utf-8'), afterFirst, 'catálogo idêntico byte a byte');
  assert.deepEqual(backupsIn(dir), backupsFirst, 'nenhum backup novo');
});

test('antes/depois: sem chave, sem mapa ou sem internet nada muda e a obra NÃO é marcada como processada', async t => {
  quiet(t);
  const before = storedBefore();

  // (1) sem chave do TMDB
  const dir1 = prepareDir(before);
  const out1 = await newService(dir1, { medias: brasaMedias(), tmdb: brasaTmdb(), key: '', mapEntries: brasaMapEntries }).refreshDueWorks({
    limit: 5
  });
  assert.equal(out1.checked, 0);
  assert.deepEqual(
    readCatalog(dir1).find(m => m.id === WORK_ID),
    before,
    'obra intacta'
  );
  assert.equal(backupsIn(dir1).length, 0);

  // (2) com chave mas o mapa nunca baixou (download falha)
  const dir2 = prepareDir(before);
  const calls2 = [];
  const out2 = await newService(dir2, {
    medias: brasaMedias(),
    tmdb: brasaTmdb(calls2),
    mapDownload: async () => Promise.reject(new Error('sem internet'))
  }).refreshDueWorks({ limit: 5 });
  assert.equal(out2.checked, 0);
  assert.equal(calls2.length, 0);
  assert.deepEqual(
    readCatalog(dir2).find(m => m.id === WORK_ID),
    before,
    'obra intacta'
  );
  assert.equal(backupsIn(dir2).length, 0);

  // (3) chave e mapa ok, mas o TMDB está fora do ar: a obra é atualizada pela AniList, os títulos continuam "Episódio N" e NÃO fica marcada
  const dir3 = prepareDir(before);
  const down = async () => {
    throw mediaErrors.upstream('Tempo esgotado na fonte externa.', { unreachable: true });
  };
  const svc3 = newService(dir3, { medias: brasaMedias(), tmdb: down, mapEntries: brasaMapEntries });
  await svc3.refreshDueWorks({ limit: 5 });
  const after3 = readCatalog(dir3).find(m => m.id === WORK_ID);
  assert.equal(after3.titlesVersion, undefined, 'não marcada como processada');
  assert.equal(after3.tmdbEpisodesAt, undefined);
  assert.deepEqual(
    bySeasonEp(after3).map(e => e.name),
    genericNames(5).concat(genericNames(7))
  );
  assert.deepEqual(libraryKeys(after3), libraryKeys(before));
  // e na próxima rodada ainda está pendente (será tentada de novo)
  assert.equal(svc3.titlesDue(after3), true);
});

test('antes/depois: obra em exibição já processada usa só as últimas temporadas do TMDB', async t => {
  quiet(t);
  // série fictícia "Maré Longa": 1 entrada em exibição com 12 eps; no TMDB são 3 temporadas de 4 eps (lista plana)
  const start = '2025-01-02';
  const dates = weekly(start, 12);
  const mare = { id: 910001, idMal: 810001 };
  const media = fakeMedia({ ...mare, name: 'Maré Longa', start, episodes: 12, status: 'RELEASING' });
  const season = n =>
    dates.slice((n - 1) * 4, n * 4).map((d, i) => tmdbEp(i + 1, d, `Maré ${(n - 1) * 4 + i + 1}`, null, `/mare${n}${i}.jpg`));
  const series = { 555: { name: 'Maré', seasons: { 1: season(1), 2: season(2), 3: season(3) } } };
  const entry = [mapEntry(mare.id, mare.idMal, 555, null)];

  const workId = toInternalId('jikan', mare.idMal);
  const before = {
    ...storedBefore({ status: 'Em Exibição', eps: [dates], ids: [mare], names: ['Maré Longa'] }),
    id: workId,
    mal_id: mare.idMal,
    anilist_id: mare.id
  };
  const dir = prepareDir(before);

  // 1ª passada (migração): obra sem titlesVersion baixa as 3 temporadas
  const calls1 = [];
  const first = newService(dir, { medias: [media], tmdb: tmdbFake(series, calls1), mapEntries: entry });
  await first.refreshDueWorks({ limit: 5 });
  assert.deepEqual(
    calls1
      .filter(c => c.kind === 'season' && c.language === 'pt-BR')
      .map(c => c.season)
      .sort(),
    [1, 2, 3]
  );
  const afterFirst = readCatalog(dir).find(m => m.id === workId);
  assert.equal(afterFirst.titlesVersion, 1);
  assert.deepEqual(
    bySeasonEp(afterFirst).map(e => e.name),
    Array.from({ length: 12 }, (_, i) => `Maré ${i + 1}`)
  );

  // Rotina de obra em exibição (um dia depois): serviço novo (sem cache), só as 2 últimas temporadas do TMDB
  const cat = readCatalog(dir).map(m => (m.id === workId ? { ...m, refreshedAt: new Date(Date.now() - DAY).toISOString() } : m));
  fs.writeFileSync(path.join(dir, 'mediaCatalog.runtime.json'), JSON.stringify(cat));
  const calls2 = [];
  const second = newService(dir, { medias: [media], tmdb: tmdbFake(series, calls2), mapEntries: entry });
  const res = await second.refresh(workId, { force: true });
  assert.equal(res.refreshed, true);
  const askedSeasons = calls2
    .filter(c => c.kind === 'season' && c.language === 'pt-BR')
    .map(c => c.season)
    .sort();
  assert.deepEqual(askedSeasons, [2, 3], 'a temporada 1 não é baixada de novo');
  const afterSecond = res.item;
  // os títulos da temporada 1 ficam (vêm do que já estava guardado) e a numeração segue igual
  assert.deepEqual(
    bySeasonEp(afterSecond).map(e => e.name),
    bySeasonEp(afterFirst).map(e => e.name)
  );
  assert.deepEqual(libraryKeys(afterSecond), libraryKeys(afterFirst));
  assert.equal(afterSecond.tmdbEpisodesAt, afterFirst.tmdbEpisodesAt, 'atualização parcial não renova a data de 90 dias');
});

// ================================================================================================= 4. getTv (série comum)

test('TMDB série comum (getTv): pt-BR vazio cai para en-US e a miniatura é preservada', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const calls = [];
  const eps = [
    tmdbEp(1, '2020-01-05', 'A noite chega', 'Night Falls', '/a1.jpg'),
    tmdbEp(2, '2020-01-12', '', 'The Long Road', '/a2.jpg'),
    tmdbEp(3, '2020-01-19', 'Episódio 3', 'Episode 3', null) // genérico nas duas: continua "Episódio 3"
  ];
  assert.ok(eps[2].air_date < today);
  const client = newClient({ 31: { name: 'Série Inventada', seasons: { 1: eps } } }, calls);
  const tv = await client.getTv(31);
  const s1 = tv.seasons[0].episodes;
  assert.deepEqual(
    s1.map(e => e.name),
    ['A noite chega', 'The Long Road', 'Episódio 3']
  );
  assert.equal(s1[0].still_path, 'https://image.tmdb.org/t/p/w300/a1.jpg');
  assert.equal(s1[1].still_path, 'https://image.tmdb.org/t/p/w300/a2.jpg');
  assert.equal(s1[2].still_path, null);
  assert.deepEqual(
    s1.map(e => e.episode_number),
    [1, 2, 3]
  );
  assert.equal(calls.filter(c => c.kind === 'season' && c.language === 'en-US').length, 1);
});
