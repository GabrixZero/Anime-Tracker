// Testes da S06 (animes e busca): Jikan com respostas SIMULADAS (nenhuma requisição real), fila/throttle/429, deduplicação,
// relevância, franquia (temporadas pelas relações Sequel/Prequel) e TMDB opcional. Nada escreve em server/data real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s06-'));
process.env.SHOWVAULT_DATA_DIR = path.join(ROOT, 'singleton');
fs.mkdirSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true });
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

const { MediaService } = require('../server/services/mediaService');
const JikanClient = require('../server/services/jikanClient');
const { mediaErrors } = require('../server/utils/errors');
const { normalizeTitle, franchiseKey, relevance, sameWork } = require('../server/utils/titles');
const { toInternalId, describeId } = require('../server/utils/ids');

let counter = 0;
const newDir = () => { const d = path.join(ROOT, `c${++counter}`); fs.mkdirSync(d, { recursive: true }); return d; };

// ---------- Fábrica de respostas simuladas da Jikan ----------------------------------------------------------------------

function anime(id, o = {}) {
  return {
    mal_id: id,
    title: `Anime ${id}`,
    title_english: null,
    title_japanese: null,
    title_synonyms: [],
    titles: [],
    type: 'TV',
    episodes: 12,
    status: 'Finished Airing',
    aired: { from: '2013-04-07T00:00:00+00:00' },
    duration: '24 min per ep',
    score: 8.5,
    season: 'spring',
    year: 2013,
    synopsis: 'Sinopse em inglês. [Written by MAL Rewrite]',
    images: { jpg: { large_image_url: `https://cdn.myanimelist.net/images/anime/${id}l.jpg` } },
    genres: [{ name: 'Action' }],
    themes: [],
    relations: [],
    ...o
  };
}
const rel = (relation, ...ids) => ({ relation, entry: ids.map(i => ({ mal_id: i, type: 'anime', name: `Anime ${i}` })) });

const FRIEREN = anime(52991, {
  title: 'Sousou no Frieren', title_english: "Frieren: Beyond Journey's End", title_japanese: '葬送のフリーレン',
  episodes: 28, aired: { from: '2023-09-29T00:00:00+00:00' }, season: 'fall', year: 2023, score: 9.3,
  relations: [rel('Sequel', 59978), rel('Adaptation', 118586)]
});
const FRIEREN_2 = anime(59978, {
  title: 'Sousou no Frieren 2nd Season', title_english: "Frieren: Beyond Journey's End Season 2", episodes: 10, status: 'Currently Airing',
  aired: { from: '2026-01-16T00:00:00+00:00' }, season: 'winter', year: 2026, score: null, relations: [rel('Prequel', 52991)]
});

const AOT = [
  anime(16498, { title: 'Shingeki no Kyojin', title_english: 'Attack on Titan', title_japanese: '進撃の巨人', episodes: 25, aired: { from: '2013-04-07T00:00:00+00:00' }, season: 'spring', year: 2013, score: 8.55, relations: [rel('Sequel', 25777), rel('Summary', 99001), rel('Side story', 99002)] }),
  anime(25777, { title: 'Shingeki no Kyojin Season 2', title_english: 'Attack on Titan Season 2', title_japanese: '進撃の巨人 Season2', episodes: 12, aired: { from: '2017-04-01T00:00:00+00:00' }, season: 'spring', year: 2017, relations: [rel('Prequel', 16498), rel('Sequel', 35760)] }),
  anime(35760, { title: 'Shingeki no Kyojin Season 3', title_english: 'Attack on Titan Season 3', episodes: 12, aired: { from: '2018-07-23T00:00:00+00:00' }, season: 'summer', year: 2018, relations: [rel('Prequel', 25777), rel('Sequel', 38524)] }),
  anime(38524, { title: 'Shingeki no Kyojin Season 3 Part 2', title_english: 'Attack on Titan Season 3 Part 2', episodes: 10, aired: { from: '2019-04-29T00:00:00+00:00' }, season: 'spring', year: 2019, relations: [rel('Prequel', 35760), rel('Sequel', 40028)] }),
  anime(40028, { title: 'Shingeki no Kyojin: The Final Season', title_english: 'Attack on Titan: Final Season', episodes: 16, aired: { from: '2020-12-07T00:00:00+00:00' }, season: 'fall', year: 2020, relations: [rel('Prequel', 38524), rel('Sequel', 99003)] }),
  // filme ligado por Sequel, e um anúncio que ainda não estreou
  anime(99003, { title: 'Shingeki no Kyojin: Movie', title_english: 'Attack on Titan: The Last Attack', type: 'Movie', episodes: 1, duration: '1 hr 25 min', aired: { from: '2024-11-08T00:00:00+00:00' }, season: null, year: 2024, relations: [rel('Prequel', 40028), rel('Sequel', 99004)] }),
  anime(99004, { title: 'Shingeki no Kyojin: Futuro', type: 'TV', episodes: null, status: 'Not yet aired', aired: { from: null }, season: null, year: null, relations: [rel('Prequel', 99003)] })
];
const AOT_JUNIOR = anime(31, { title: 'Shingeki! Kyojin Chuugakkou', title_english: 'Attack on Titan: Junior High', episodes: 12, aired: { from: '2015-10-04T00:00:00+00:00' }, score: 6.9 });

const NARUTO = anime(20, { title: 'Naruto', title_english: 'Naruto', episodes: 220, aired: { from: '2002-10-03T00:00:00+00:00' }, year: 2002, relations: [rel('Sequel', 1735)] });
const SHIPPUDEN = anime(1735, { title: 'Naruto: Shippuuden', title_english: 'Naruto Shippuden', episodes: 500, aired: { from: '2007-02-15T00:00:00+00:00' }, year: 2007, relations: [rel('Prequel', 20)] });
const NARUTO_LAST = anime(10589, { title: 'The Last: Naruto the Movie', title_english: 'The Last: Naruto the Movie', type: 'Movie', episodes: 1, aired: { from: '2014-12-06T00:00:00+00:00' }, year: 2014 });
const BORUTO = anime(34566, { title: 'Boruto: Naruto Next Generations', title_english: 'Boruto: Naruto Next Generations', episodes: 293, aired: { from: '2017-04-05T00:00:00+00:00' }, year: 2017 });

const ONE_PIECE = anime(21, { title: 'One Piece', title_english: 'One Piece', episodes: null, status: 'Currently Airing', aired: { from: '1999-10-20T00:00:00+00:00' }, season: 'fall', year: 1999 });
const ONE_PIECE_RED = anime(50410, { title: 'One Piece Film: Red', title_english: 'One Piece Film: Red', type: 'Movie', episodes: 1, aired: { from: '2022-08-06T00:00:00+00:00' }, year: 2022 });

// Roteador: monta o `fetchJson` de um MediaService de teste. `epCount` = quantos episódios cada anime tem na listagem.
function jikanDb(animes, { searches = {}, epCount = {} } = {}) {
  const byId = new Map(animes.map(a => [a.mal_id, a]));
  const calls = [];
  const handler = (url) => {
    calls.push(url);
    const u = new URL(url);
    let m;
    if (u.pathname === '/v4/anime') {
      const ids = searches[u.searchParams.get('q').toLowerCase()] || [];
      return { pagination: {}, data: ids.map(i => byId.get(i)) };
    }
    if ((m = /^\/v4\/anime\/(\d+)\/full$/.exec(u.pathname))) {
      const a = byId.get(Number(m[1]));
      if (!a) throw mediaErrors.notFound();
      return { data: a };
    }
    if ((m = /^\/v4\/anime\/(\d+)\/episodes$/.exec(u.pathname))) {
      const a = byId.get(Number(m[1]));
      const total = epCount[a.mal_id] ?? (Number.isInteger(a.episodes) ? a.episodes : 0);
      const page = Number(u.searchParams.get('page') || 1);
      const from = (page - 1) * 100;
      const data = [];
      for (let n = from + 1; n <= Math.min(total, from + 100); n++) data.push({ mal_id: n, title: `Ep ${n}`, aired: '2013-04-07T00:00:00+00:00', duration: 1440 });
      return { pagination: { has_next_page: from + 100 < total }, data };
    }
    throw new Error(`URL inesperada na Jikan simulada: ${url}`);
  };
  return { handler, calls };
}

function tvmazeShow(id, name, o = {}) {
  return { show: { id, name, type: 'Scripted', genres: ['Drama'], premiered: '2020-01-01', status: 'Ended', rating: { average: null }, image: null, summary: '', ...o } };
}

// Serviço com Jikan simulada (rápida: sem espera real) e TVMaze/TMDB roteados pelo mesmo `fetchJson`.
function newService({ animes = [], searches = {}, epCount = {}, tvmaze = {}, tmdb = null, tmdbKey = '', extra = {} } = {}) {
  const jdb = jikanDb(animes, { searches, epCount });
  const svc = new MediaService({
    dataDir: newDir(), tvmazeBase: 'http://tvmaze.invalid', jikanBase: 'http://jikan.invalid/v4', tmdbBase: 'http://tmdb.invalid/3',
    tmdbKey, sleep: async () => {}, jikan: { minIntervalMs: 0 }, ...extra
  });
  svc.urls = [];
  svc.fetchJson = async (url, opts) => {
    svc.urls.push(url);
    if (url.startsWith('http://jikan.invalid')) return jdb.handler(url);
    if (url.startsWith('http://tvmaze.invalid/search/shows')) {
      const q = new URL(url).searchParams.get('q').toLowerCase();
      return (tvmaze[q] || []);
    }
    if (url.startsWith('http://tmdb.invalid') && tmdb) return tmdb(url, opts);
    throw new Error(`URL inesperada: ${url}`);
  };
  svc.jikanDb = jdb;
  return svc;
}

const names = items => items.map(i => i.name);
const ids = items => items.map(i => i.id);
const assertUnique = items => assert.equal(new Set(ids(items)).size, items.length, `ids repetidos: ${ids(items)}`);

// =====================================================================================================================
// Títulos: normalização, relevância e chave de franquia
// =====================================================================================================================

test('normalizeTitle: sem acentos/pontuação, preserva japonês e números', () => {
  assert.equal(normalizeTitle('Frieren e a Jornada para o Além'), 'frieren e a jornada para o alem');
  assert.equal(normalizeTitle("Frieren: Beyond Journey's End"), 'frieren beyond journey s end');
  assert.equal(normalizeTitle('進撃の巨人'), '進撃の巨人');
  assert.equal(normalizeTitle('ブラック・クローバー'), 'ブラック クローバー'.replace('・', ' ').replace(/\s+/g, ' '));
  assert.equal(normalizeTitle(null), '');
});

test('relevância: "Frieren" não casa com Frieden, Friheden, 2 frères, Oscar Freire 279; casa com os títulos da obra', () => {
  for (const noise of ['Frieden', 'Friheden', '2 frères', 'Oscar Freire 279', 'Freezing', 'Frierens']) {
    assert.equal(relevance('Frieren', { name: noise }), 0, noise);
  }
  const frieren = { name: "Frieren: Beyond Journey's End", alt_titles: ['Sousou no Frieren', '葬送のフリーレン'] };
  assert.ok(relevance('Frieren', frieren) >= 55);
  assert.ok(relevance('sousou no frieren', frieren) >= 80);
  assert.equal(relevance('葬送のフリーレン', frieren), 100);
  assert.ok(relevance('葬送', frieren) > 0);
  assert.equal(relevance('', frieren), 0);
});

test('relevância: título igual vence título que só começa com a consulta', () => {
  const exact = relevance('Naruto', { name: 'Naruto' });
  const starts = relevance('Naruto', { name: 'Naruto Shippuden' });
  const inside = relevance('Naruto', { name: 'Boruto: Naruto Next Generations' });
  assert.equal(exact, 100);
  assert.ok(exact > starts && starts > inside && inside > 0);
});

test('franchiseKey junta temporadas/partes da mesma obra e separa subtítulos e spin-offs', () => {
  const k = franchiseKey('Attack on Titan');
  for (const t of ['Attack on Titan Season 2', 'Attack on Titan Season 3 Part 2', 'Attack on Titan: The Final Season', 'Attack on Titan: Final Season', 'Attack on Titan 2nd Season', 'Attack on Titan Part 2']) {
    assert.equal(franchiseKey(t), k, t);
  }
  assert.notEqual(franchiseKey('Attack on Titan: Junior High'), k);
  assert.equal(franchiseKey('Shingeki no Kyojin 2'), franchiseKey('Shingeki no Kyojin'));
  assert.equal(franchiseKey('Mob Psycho 100'), 'mob psycho 100'); // número grande faz parte do título
  assert.equal(franchiseKey('Sousou no Frieren 2nd Season'), franchiseKey('Sousou no Frieren'));
});

test('sameWork: mesmo id da MAL, ou mesmo tipo + título em comum + anos próximos; tipos/anos diferentes não se misturam', () => {
  assert.ok(sameWork({ id: 1, type: 'anime', mal_id: 5, name: 'A' }, { id: 2, type: 'anime', mal_ids: [4, 5], name: 'B' }));
  assert.ok(sameWork({ id: 1, type: 'tv', name: 'Severance', first_air_date: '2022-02-18' }, { id: 2, type: 'tv', name: 'Ruptura', original_name: 'Severance', first_air_date: '2022-02-17' }));
  assert.equal(sameWork({ id: 1, type: 'movie', name: 'Death Note' }, { id: 2, type: 'anime', name: 'Death Note' }), false);
  assert.equal(sameWork({ id: 1, type: 'tv', name: 'The Office', first_air_date: '2001-07-09' }, { id: 2, type: 'tv', name: 'The Office', first_air_date: '2005-03-24' }), false);
});

// =====================================================================================================================
// Cliente Jikan: fila, teto por minuto, cache, 429
// =====================================================================================================================

function fakeClock() {
  const c = { t: 1_000_000, slept: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.slept.push(ms); c.t += ms; };
  return c;
}

test('Jikan: a fila espaça as requisições (respeita ~3 req/s) mesmo com pedidos simultâneos', async () => {
  const clock = fakeClock();
  const stamps = [];
  const client = new JikanClient({ fetchJson: async () => { stamps.push(clock.now()); return { data: [] }; }, sleep: clock.sleep, now: clock.now, minIntervalMs: 400 });
  await Promise.all([1, 2, 3, 4, 5].map(i => client.get(`/anime?q=a${i}`)));
  assert.equal(stamps.length, 5);
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= 400, `intervalo ${stamps[i] - stamps[i - 1]}`);
});

test('Jikan: teto por minuto — acima dele o pedido espera a janela ou, se a espera for longa, vira RATE_LIMITED sem tocar na rede', async () => {
  const clock = fakeClock();
  let calls = 0;
  const client = new JikanClient({ fetchJson: async () => { calls++; return { data: [] }; }, sleep: clock.sleep, now: clock.now, minIntervalMs: 0, perMinute: 3, maxWaitMs: 5000 });
  for (let i = 0; i < 3; i++) await client.get(`/anime?q=x${i}`);
  await assert.rejects(client.get('/anime?q=x9'), err => err.code === 'RATE_LIMITED' && err.httpStatus === 429 && err.retryAfterMs > 0);
  assert.equal(calls, 3);

  // com uma espera aceitável (<= maxWaitMs) ele espera e segue
  const client2 = new JikanClient({ fetchJson: async () => { calls++; return { data: [] }; }, sleep: clock.sleep, now: clock.now, minIntervalMs: 0, perMinute: 2, maxWaitMs: 70000 });
  await client2.get('/anime?q=a'); await client2.get('/anime?q=b');
  const before = clock.now();
  await client2.get('/anime?q=c');
  assert.ok(clock.now() - before >= 59000, 'esperou a janela de 60 s');
});

test('Jikan: fila lotada recusa em vez de acumular', async () => {
  const clock = fakeClock();
  let release;
  const gate = new Promise(r => { release = r; });
  const client = new JikanClient({ fetchJson: async () => { await gate; return { data: [] }; }, sleep: clock.sleep, now: clock.now, minIntervalMs: 0, maxQueue: 3 });
  const ps = [1, 2, 3].map(i => client.get(`/anime?q=q${i}`));
  await assert.rejects(client.get('/anime?q=extra'), err => err.code === 'RATE_LIMITED');
  release();
  await Promise.all(ps);
});

test('Jikan: 429 tenta de novo com espera crescente e Retry-After; esgotadas as tentativas, erro tipado', async () => {
  const clock = fakeClock();
  let n = 0;
  const flaky = new JikanClient({
    fetchJson: async () => { n++; if (n <= 2) throw mediaErrors.rateLimited(n === 1 ? undefined : 3000); return { data: ['ok'] }; },
    sleep: clock.sleep, now: clock.now, minIntervalMs: 0
  });
  assert.deepEqual((await flaky.get('/anime?q=a')).data, ['ok']);
  assert.equal(n, 3);
  assert.deepEqual(clock.slept, [1000, 3000]); // 1ª: backoff 1000 · 2ª: Retry-After 3000 (maior que 2000)

  let m = 0;
  const dead = new JikanClient({ fetchJson: async () => { m++; throw mediaErrors.rateLimited(); }, sleep: clock.sleep, now: clock.now, minIntervalMs: 0 });
  await assert.rejects(dead.get('/anime?q=a'), err => err.code === 'RATE_LIMITED');
  assert.equal(m, 3, '1 tentativa + 2 novas');

  // 404 não repete
  let k = 0;
  const missing = new JikanClient({ fetchJson: async () => { k++; throw mediaErrors.notFound(); }, sleep: clock.sleep, now: clock.now, minIntervalMs: 0 });
  await assert.rejects(missing.getAnimeFull(1), err => err.code === 'NOT_FOUND');
  assert.equal(k, 1);
});

test('Jikan: cache com validade e pedidos iguais simultâneos viram uma requisição; falhas não são cacheadas', async () => {
  const clock = fakeClock();
  let calls = 0;
  const client = new JikanClient({ fetchJson: async () => { calls++; return { data: [{ mal_id: 1 }] }; }, sleep: clock.sleep, now: clock.now, minIntervalMs: 0, searchTtlMs: 1000 });
  await Promise.all([client.searchAnime('a'), client.searchAnime('a'), client.searchAnime('a')]);
  assert.equal(calls, 1);
  await client.searchAnime('a');
  assert.equal(calls, 1, 'cache');
  clock.t += 1001;
  await client.searchAnime('a');
  assert.equal(calls, 2, 'cache expirou');

  let fails = 0;
  const bad = new JikanClient({ fetchJson: async () => { fails++; throw mediaErrors.upstream(); }, sleep: clock.sleep, now: clock.now, minIntervalMs: 0, retries: 0 });
  await assert.rejects(bad.searchAnime('z'));
  await assert.rejects(bad.searchAnime('z'));
  assert.equal(fails, 2);
});

test('Jikan: respostas malformadas ou de erro viram erros tipados', async () => {
  const clock = fakeClock();
  const mk = (resp) => new JikanClient({ fetchJson: async () => resp, sleep: clock.sleep, now: clock.now, minIntervalMs: 0 });
  await assert.rejects(mk({ status: 400, message: 'x' }).searchAnime('a'), err => err.code === 'UPSTREAM');
  await assert.rejects(mk({ data: { mal_id: 999, title: 'outro' } }).getAnimeFull(1), err => err.code === 'NOT_FOUND');
  await assert.rejects(mk({ status: 404, type: 'BadResponseException' }).getAnimeFull(1), err => err.code === 'NOT_FOUND');
  assert.deepEqual(await mk({ data: [] }).searchAnime('   '), []);
});

// =====================================================================================================================
// Busca (etapa 1): Frieren, Naruto, Attack on Titan, One Piece, japonês
// =====================================================================================================================

test('busca "Frieren": a obra aparece UMA vez (local em PT + MAL + TVMaze) e o ruído difuso do TVMaze some', async () => {
  const svc = newService({
    animes: [FRIEREN, FRIEREN_2],
    searches: { frieren: [52991, 59978] },
    tvmaze: {
      frieren: [
        tvmazeShow(900, 'Frieden'), tvmazeShow(901, 'Friheden'), tvmazeShow(902, '2 frères'), tvmazeShow(903, 'Oscar Freire 279'),
        tvmazeShow(904, "Frieren: Beyond Journey's End", { type: 'Animation', language: 'Japanese', genres: ['Anime', 'Fantasy'], premiered: '2023-09-29' })
      ]
    }
  });
  assert.equal(svc.findLocal(209867).name, 'Frieren e a Jornada para o Além'); // a amostra do seed existe localmente

  const items = await svc.search('Frieren', 'all');
  assert.equal(items.length, 1, names(items).join(' | '));
  const f = items[0];
  assert.equal(f.id, toInternalId('jikan', 52991));
  assert.equal(f.type, 'anime');
  assert.equal(f.name, "Frieren: Beyond Journey's End");
  assert.equal(f.related_count, 1, 'a 2ª temporada foi agrupada');
  assert.deepEqual(f.mal_ids.sort(), [52991, 59978]);
  assert.equal(f.season_label, 'Outono 2023');
  assert.equal(f.vote_average, 9.3);
  assert.equal(f.status, 'Finalizada');
  assert.ok(f.alt_titles.includes('葬送のフリーレン'));
  assert.equal(f.isExternal, true);
});

test('busca "Frieren" com a Jikan fora do ar: o seed (amostra) continua aparecendo, só uma vez, com aviso', async () => {
  const svc = newService({
    animes: [], searches: {}, extra: { jikan: { minIntervalMs: 0, retries: 0 } },
    tvmaze: { frieren: [tvmazeShow(904, "Frieren: Beyond Journey's End", { type: 'Animation', language: 'Japanese', genres: ['Anime'], premiered: '2023-09-29' })] }
  });
  const jikanFetch = svc.fetchJson;
  svc.fetchJson = async (url, o) => { if (url.startsWith('http://jikan.invalid')) throw mediaErrors.upstream(); return jikanFetch(url, o); };

  const { items, warnings } = await svc.searchDetailed('Frieren', 'all');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 209867, 'o local vence o TVMaze (mesmo título alternativo)');
  assert.equal(warnings[0].source, 'jikan');
  assert.equal(warnings[0].code, 'UPSTREAM');
});

test('busca "Naruto": cada entrada uma vez, "Naruto" primeiro; depois de ingerir a franquia, Shippuden não reaparece', async () => {
  const svc = newService({
    animes: [NARUTO, SHIPPUDEN, NARUTO_LAST, BORUTO],
    searches: { naruto: [1735, 20, 10589, 34566, 20] }, // inclui um id repetido de propósito
    epCount: { 20: 220, 1735: 500, 34566: 293 }
  });
  const first = await svc.search('Naruto', 'all');
  assertUnique(first);
  assert.equal(first[0].name, 'Naruto', 'título igual à consulta vem primeiro, mesmo que a Jikan tenha mandado Shippuden antes');
  assert.deepEqual(names(first).slice(0, 2), ['Naruto', 'Naruto Shippuden']);
  assert.ok(names(first).includes('Boruto: Naruto Next Generations'));

  const work = await svc.ingest(first[0].id);
  assert.equal(work.type, 'anime');
  assert.deepEqual(work.mal_ids.sort((a, b) => a - b), [20, 1735]);
  const second = await svc.search('Naruto', 'all');
  assertUnique(second);
  assert.equal(second.filter(i => i.mal_ids ? i.mal_ids.includes(1735) || i.mal_id === 1735 : false).length, 1, 'Shippuden só aparece dentro da obra já ingerida');
  assert.equal(second[0].id, work.id);
});

test('busca "Attack on Titan": a franquia vira um resultado só, o spin-off continua separado e a amostra do seed some', async () => {
  const svc = newService({
    animes: [...AOT, AOT_JUNIOR],
    searches: { 'attack on titan': [16498, 25777, 35760, 38524, 40028, 31, 99003] }
  });
  assert.equal(svc.findLocal(1429).mal_id, 16498, 'seed antigo ganha mal_id mesmo sem estar no runtime antigo');

  const items = await svc.search('Attack on Titan', 'all');
  assertUnique(items);
  assert.equal(items[0].name, 'Attack on Titan');
  assert.equal(items[0].id, toInternalId('jikan', 16498));
  assert.equal(items[0].related_count, 4);
  assert.ok(!items.some(i => i.id === 1429), 'amostra local do seed substituída pela versão real');
  assert.ok(names(items).includes('Attack on Titan: Junior High'));
  assert.ok(items.length <= 3);
  // todos os resultados contêm a consulta em algum título
  for (const i of items) assert.ok(relevance('Attack on Titan', i) > 0, i.name);
});

test('busca "One Piece": a série (título igual) vem antes do filme', async () => {
  const svc = newService({ animes: [ONE_PIECE, ONE_PIECE_RED], searches: { 'one piece': [50410, 21] } });
  const items = await svc.search('One Piece', 'anime');
  assertUnique(items);
  assert.deepEqual(names(items), ['One Piece', 'One Piece Film: Red']);
  assert.equal(items[0].episode_count, null, 'em exibição, sem total conhecido: nada inventado');
  assert.equal(items[1].anime_kind, 'Filme');
});

test('busca em japonês: acha pelo título japonês, uma vez, e o local do seed é a mesma obra', async () => {
  const svc = newService({ animes: AOT.slice(0, 3), searches: { '進撃の巨人': [16498, 25777, 35760] } });
  const items = await svc.search('進撃の巨人', 'anime');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, toInternalId('jikan', 16498));
});

test('busca por tipo: anime não chama TVMaze; série não chama a Jikan; sem chave TMDB filme só avisa', async () => {
  const svc = newService({ animes: [NARUTO], searches: { naruto: [20] }, tvmaze: { naruto: [tvmazeShow(10, 'Naruto Series')] } });
  await svc.search('Naruto', 'anime');
  assert.ok(svc.urls.every(u => u.startsWith('http://jikan.invalid')));
  svc.urls.length = 0;
  const tv = await svc.search('Naruto', 'tv');
  assert.ok(svc.urls.every(u => u.startsWith('http://tvmaze.invalid')));
  assert.deepEqual(names(tv), ['Naruto Series']);

  const movies = await svc.searchDetailed('Dune', 'movie');
  assert.equal(movies.warnings[0].code, 'NOT_CONFIGURED');
  assert.ok(movies.items.every(i => i.type === 'movie'));
});

test('em "série", animação ocidental continua série e anime do TVMaze não aparece se a Jikan respondeu', async () => {
  const svc = newService({
    animes: [NARUTO], searches: { naruto: [20] },
    tvmaze: { naruto: [tvmazeShow(495, 'Naruto', { type: 'Animation', language: 'Japanese', genres: ['Anime'], premiered: '2002-10-03' })], simpsons: [tvmazeShow(83, 'The Simpsons', { type: 'Animation', language: 'English', genres: ['Comedy'], premiered: '1989-12-17' })] }
  });
  assert.deepEqual(names(await svc.search('Naruto', 'tv')), [], 'anime não é série');
  const all = await svc.search('Naruto', 'all');
  assert.equal(all.length, 1);
  assert.equal(all[0].id, toInternalId('jikan', 20));

  const simp = await svc.search('simpsons', 'tv');
  assert.equal(simp[0].type, 'tv');
});

test('uma fonte com 429 não derruba as outras (aviso); se TODAS falham e nada local casa, o erro tipado sobe', async () => {
  const svc = newService({ animes: [], tvmaze: { zzzz: [tvmazeShow(5, 'Zzzz Show')] }, extra: { jikan: { minIntervalMs: 0, retries: 0 } } });
  const orig = svc.fetchJson;
  svc.fetchJson = async (url, o) => { if (url.startsWith('http://jikan.invalid')) throw mediaErrors.rateLimited(4000); return orig(url, o); };

  const ok = await svc.searchDetailed('zzzz', 'all');
  assert.deepEqual(names(ok.items), ['Zzzz Show']);
  assert.equal(ok.warnings[0].code, 'RATE_LIMITED');
  assert.equal(ok.warnings[0].retryAfterSec, 4);

  svc.fetchJson = async () => { throw mediaErrors.rateLimited(4000); };
  await assert.rejects(svc.searchDetailed('qqqqqq', 'all'), err => err.code === 'RATE_LIMITED' && err.httpStatus === 429);
  // resultados locais continuam saindo mesmo com tudo fora do ar
  const local = await svc.searchDetailed('breaking bad', 'all');
  assert.equal(local.items[0].id, 1396);
});

test('consulta vazia devolve o catálogo; consulta só com espaços também', async () => {
  const svc = newService();
  assert.equal((await svc.search('   ', 'all')).length, svc.catalog.length);
  assert.equal(svc.urls.length, 0);
});

// =====================================================================================================================
// Ingestão (etapa 1 e 2): obra única e franquia
// =====================================================================================================================

test('ingestão de anime de obra única: dados mapeados, nada inventado, episódios reais (paginados) e gravação em disco', async () => {
  const svc = newService({ animes: [ONE_PIECE], epCount: { 21: 250 } });
  const work = await svc.ingest(toInternalId('jikan', 21));
  assert.equal(work.id, 10000021);
  assert.equal(work.type, 'anime');
  assert.equal(work.name, 'One Piece');
  assert.equal(work.status, 'Em Exibição');
  assert.equal(work.overview, 'Sinopse em inglês.');
  assert.equal(work.seasons.length, 1);
  assert.equal(work.seasons[0].episodes.length, 250);
  assert.equal(work.seasons[0].episodes[0].runtime, 24);
  assert.equal(work.seasons[0].name, 'Temporada 1 (Outono 1999)');
  assert.equal(svc.urls.filter(u => u.includes('/episodes')).length, 3, '250 episódios = 3 páginas');
  assert.ok(work.ingestedAt);
  assert.equal(JSON.parse(fs.readFileSync(svc.catalogPath, 'utf-8')).find(m => m.id === 10000021).name, 'One Piece');

  const again = await svc.ingest(10000021);
  assert.equal(again, svc.findLocal(10000021));
  assert.equal(svc.urls.filter(u => u.includes('/full')).length, 1, 'já no catálogo: sem rede');
});

test('ingestão sem nota/imagem/gêneros: devolve null/[] (nada de 8.0, "Drama" ou foto de banco de imagens)', async () => {
  const bare = anime(777, { title: 'Obscuro', score: null, images: {}, genres: [], themes: [], synopsis: null, episodes: 2, status: 'Weird Status' });
  const svc = newService({ animes: [bare], epCount: { 777: 2 } });
  const w = await svc.ingest(toInternalId('jikan', 777));
  assert.equal(w.vote_average, null);
  assert.deepEqual(w.genres, []);
  assert.equal(w.poster_path, null);
  assert.equal(w.backdrop_path, null);
  assert.equal(w.overview, '');
  assert.equal(w.status, '');
});

test('TVMaze sem nota/imagem/gêneros também não inventa nada, e status vem em português', () => {
  const m = MediaService.mapTvmazeShow({ id: 1, name: 'X', type: 'Scripted', genres: [], rating: { average: null }, image: null, status: 'Running' });
  assert.equal(m.vote_average, null);
  assert.deepEqual(m.genres, []);
  assert.equal(m.poster_path, null);
  assert.equal(m.status, 'Em Exibição');
  assert.equal(MediaService.mapTvmazeShow({ id: 2, name: 'Y', status: 'Ended' }).status, 'Finalizada');
});

test('franquia (etapa 2): Attack on Titan vira UMA obra com temporadas na ordem de exibição; Summary/Side story ficam de fora', async () => {
  const svc = newService({ animes: AOT, epCount: { 99003: 0 } });
  // pedir pelo meio da cadeia (Season 2) devolve a franquia inteira, gravada com o id pedido
  const work = await svc.ingest(toInternalId('jikan', 25777));
  assert.equal(work.id, toInternalId('jikan', 25777));
  assert.equal(work.name, 'Attack on Titan', 'nome vem da 1ª entrada da franquia');
  assert.deepEqual(work.mal_ids.sort((a, b) => a - b), [16498, 25777, 35760, 38524, 40028, 99003, 99004].sort((a, b) => a - b));
  assert.deepEqual(work.seasons.map(s => s.season_number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(work.seasons.map(s => s.name), [
    'Temporada 1 (Primavera 2013)', 'Temporada 2 (Primavera 2017)', 'Temporada 3 (Verão 2018)', 'Temporada 4 (Primavera 2019)',
    'Temporada 5 (Outono 2020)', 'Filme: Attack on Titan: The Last Attack'
  ]);
  assert.deepEqual(work.seasons.map(s => s.episodes.length), [25, 12, 12, 10, 16, 1]);
  assert.equal(work.seasons[5].episodes[0].runtime, 85);
  assert.deepEqual(work.franchise.entries.map(e => e.mal_id), [16498, 25777, 35760, 38524, 40028, 99003]);
  assert.equal(work.franchise.truncated, false);
  assert.equal(work.status, 'Finalizada');
  assert.equal(work.vote_average, 8.55);
  assert.ok(work.alt_titles.includes('進撃の巨人'));
  // o anúncio que não estreou (99004) não gera temporada vazia, e nenhuma busca por /episodes foi feita para ele nem para o filme
  assert.ok(!svc.urls.some(u => u.includes('/99004/episodes') || u.includes('/99003/episodes')));
  assert.equal(svc.catalog.filter(m => m.id === work.id).length, 1);
});

test('franquia: pedir a 1ª entrada ou a última dá a mesma estrutura de temporadas (números estáveis)', async () => {
  const a = await newService({ animes: AOT }).ingest(toInternalId('jikan', 16498));
  const b = await newService({ animes: AOT }).ingest(toInternalId('jikan', 40028));
  assert.deepEqual(a.seasons.map(s => [s.season_number, s.name, s.episodes.length]), b.seasons.map(s => [s.season_number, s.name, s.episodes.length]));
});

test('franquia: o limite de entradas evita varrer o grafo inteiro e marca truncated', async () => {
  const chain = Array.from({ length: 30 }, (_, i) => anime(500 + i, {
    title: `Cadeia ${i + 1}`, episodes: 2, aired: { from: `${2000 + i}-01-01T00:00:00+00:00` }, year: 2000 + i,
    relations: [...(i > 0 ? [rel('Prequel', 499 + i)] : []), ...(i < 29 ? [rel('Sequel', 501 + i)] : [])]
  }));
  const svc = newService({ animes: chain });
  const w = await svc.ingest(toInternalId('jikan', 500));
  assert.equal(w.franchise.truncated, true);
  assert.equal(w.seasons.length, 12);
  assert.ok(svc.urls.filter(u => u.endsWith('/full')).length <= 12);
});

test('franquia: sem lista de episódios usa a contagem real da MAL (sem títulos inventados); falha numa entrada não grava nada', async () => {
  const noList = anime(600, { title: 'Sem Lista', episodes: 3 });
  const svc = newService({ animes: [noList], epCount: { 600: 0 } });
  const w = await svc.ingest(toInternalId('jikan', 600));
  assert.deepEqual(w.seasons[0].episodes.map(e => e.name), ['Episódio 1', 'Episódio 2', 'Episódio 3']);

  const a = anime(610, { title: 'Parte A', relations: [rel('Sequel', 611)] });
  const b = anime(611, { title: 'Parte B', relations: [rel('Prequel', 610)] });
  const flaky = newService({ animes: [a, b], extra: { jikan: { minIntervalMs: 0, retries: 0 } } });
  const orig = flaky.fetchJson;
  flaky.fetchJson = async (url, o) => { if (url.includes('/611/full')) throw mediaErrors.upstream(); return orig(url, o); };
  const before = fs.readFileSync(flaky.catalogPath, 'utf-8');
  await assert.rejects(flaky.ingest(toInternalId('jikan', 610)), err => err.code === 'UPSTREAM');
  assert.equal(fs.readFileSync(flaky.catalogPath, 'utf-8'), before, 'catálogo intacto');
  assert.equal(flaky.inflight.size, 0);

  // entrada relacionada que não existe mais (404) é ignorada; o pedido principal inexistente é 404
  const orphan = newService({ animes: [anime(620, { title: 'Órfão', relations: [rel('Sequel', 621)] })] });
  assert.equal((await orphan.ingest(toInternalId('jikan', 620))).seasons.length, 1);
  await assert.rejects(orphan.ingest(toInternalId('jikan', 654321)), err => err.code === 'NOT_FOUND');
});

test('textos da Jikan passam pelo sanitizador (HTML e URLs perigosas)', async () => {
  const evil = anime(700, {
    title: '<img src=x onerror=alert(1)>Mau', synopsis: '<script>alert(1)</script>Sinopse <b>ok</b> (Source: MAL)',
    images: { jpg: { large_image_url: 'javascript:alert(1)' } }, genres: [{ name: '<i>Ação</i>' }]
  });
  const w = await newService({ animes: [evil], epCount: { 700: 1 } }).ingest(toInternalId('jikan', 700));
  assert.equal(w.name, 'Mau');
  assert.equal(w.overview, 'Sinopse ok');
  assert.equal(w.poster_path, null);
  assert.deepEqual(w.genres, ['Ação']);
});

test('ids: Jikan e TMDB agora são ingeríveis; ids fora das faixas seguem inválidos; TMDB sem chave responde 503 tipado', async () => {
  assert.equal(describeId(10000020).ingestable, true);
  assert.equal(describeId(20001396).ingestable, true);
  assert.equal(describeId(30000155).ingestable, true);
  const svc = newService();
  await assert.rejects(svc.ingest(20001396), err => err.code === 'SOURCE_NOT_CONFIGURED' && err.httpStatus === 503);
  await assert.rejects(svc.ingest(30000155), err => err.code === 'SOURCE_NOT_CONFIGURED');
  await assert.rejects(svc.ingest(5000000), err => err.code === 'NOT_FOUND');
});

// =====================================================================================================================
// TMDB (opcional)
// =====================================================================================================================

function tmdbRouter() {
  const calls = [];
  const fn = (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    const p = u.pathname.replace('/3', '');
    if (p === '/search/tv') {
      return { results: [
        { id: 95396, name: 'Ruptura', original_name: 'Severance', overview: 'Sinopse', poster_path: '/p.jpg', backdrop_path: '/b.jpg', vote_average: 8.4, vote_count: 3000, first_air_date: '2022-02-18', genre_ids: [18, 9648], original_language: 'en' },
        { id: 1, name: 'Naruto do TMDB', original_name: 'ナルト', genre_ids: [16, 10759], original_language: 'ja', first_air_date: '2002-10-03' },
        { id: 2, name: 'Sem nota', poster_path: null, vote_average: 0, vote_count: 0, genre_ids: [], first_air_date: '' }
      ] };
    }
    if (p === '/search/movie') {
      return { results: [{ id: 155, title: 'Batman: O Cavaleiro das Trevas', original_title: 'The Dark Knight', overview: 'Filme', poster_path: '/m.jpg', vote_average: 8.5, vote_count: 30000, release_date: '2008-07-16', genre_ids: [28, 80], original_language: 'en' }] };
    }
    if (p === '/movie/155') return { id: 155, title: 'Batman: O Cavaleiro das Trevas', original_title: 'The Dark Knight', runtime: 152, status: 'Released', overview: 'Filme', poster_path: '/m.jpg', vote_average: 8.5, vote_count: 30000, release_date: '2008-07-16', genres: [{ id: 28, name: 'Ação' }] };
    if (p === '/tv/95396') return { id: 95396, name: 'Ruptura', original_name: 'Severance', status: 'Returning Series', overview: 'Sinopse', first_air_date: '2022-02-18', vote_average: 8.4, vote_count: 3000, genres: [{ id: 18, name: 'Drama' }], episode_run_time: [50], seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }] };
    let m;
    if ((m = /^\/tv\/95396\/season\/(\d+)$/.exec(p))) {
      return { name: `Temporada ${m[1]}`, episodes: [{ episode_number: 1, name: 'Bom Dia', runtime: 55, air_date: '2022-02-18', overview: 'x', still_path: '/e.jpg' }, { episode_number: 2, name: '<b>Metade</b>', air_date: '2022-02-18' }] };
    }
    throw mediaErrors.notFound();
  };
  fn.calls = calls;
  return fn;
}

test('TMDB desligado sem chave: série e filme não chamam o TMDB', async () => {
  const router = tmdbRouter();
  const svc = newService({ tmdb: router, tmdbKey: '', tvmaze: { severance: [tvmazeShow(1, 'Severance')] } });
  assert.equal(svc.tmdb.enabled, false);
  assert.deepEqual(names(await svc.search('severance', 'tv')), ['Severance']);
  assert.equal(router.calls.length, 0);
});

test('TMDB com chave: busca série+filme em pt-BR, deduplica com o TVMaze, exclui anime e não inventa nota', async () => {
  const router = tmdbRouter();
  const svc = newService({
    tmdb: router, tmdbKey: 'chave-de-teste',
    animes: [], tvmaze: { severance: [tvmazeShow(44, 'Severance', { premiered: '2022-02-18' })] }
  });
  const tv = await svc.search('severance', 'tv');
  // "Ruptura" (TMDB, original_name Severance) e "Severance" (TVMaze) são a mesma obra => fica a do TMDB
  assert.equal(tv.length, 1);
  assert.equal(tv[0].id, toInternalId('tmdb_tv', 95396));
  assert.equal(tv[0].name, 'Ruptura');
  assert.equal(tv[0].poster_path, 'https://image.tmdb.org/t/p/w500/p.jpg');
  assert.deepEqual(tv[0].genres, ['Drama', 'Mistério']);
  assert.ok(router.calls.every(c => c.url.includes('language=pt-BR')));
  assert.ok(router.calls.every(c => c.url.includes('api_key=chave-de-teste')), 'chave v3 vai na URL');

  const sem = await newService({ tmdb: router, tmdbKey: 'k' }).search('sem nota', 'tv');
  assert.equal(sem[0].vote_average, null);
  assert.equal(sem[0].poster_path, null);
  assert.ok(!(await newService({ tmdb: router, tmdbKey: 'k' }).search('naruto do tmdb', 'tv')).some(i => i.name === 'Naruto do TMDB'), 'animação japonesa é do domínio da Jikan');

  const movies = await svc.search('batman', 'movie');
  const dk = movies.find(m => m.id === toInternalId('tmdb_movie', 155));
  assert.ok(dk && dk.type === 'movie');
  assert.ok(movies.some(m => m.id === 155), 'o Batman do seed (mesmo filme) continua aparecendo uma vez');
  assert.ok(!dk || !movies.some(m => m.id === 155 && m !== movies.find(x => x.id === 155)), 'sem duplicata do seed');
  assertUnique(movies);
});

test('TMDB com token v4 usa cabeçalho Authorization (e nunca a chave na URL)', async () => {
  const router = tmdbRouter();
  const token = 'eyJhbGciOiJIUzI1NiJ9.teste.assinatura';
  const svc = newService({ tmdb: router, tmdbKey: token });
  await svc.search('severance', 'tv');
  assert.ok(router.calls.length > 0);
  for (const c of router.calls) {
    assert.ok(!c.url.includes('api_key') && !c.url.includes(token));
    assert.equal(c.opts.headers.Authorization, `Bearer ${token}`);
  }
});

test('ingestão TMDB: filme com duração e série com temporadas (sem a temporada 0), ids nas faixas tmdb', async () => {
  const router = tmdbRouter();
  const svc = newService({ tmdb: router, tmdbKey: 'k' });
  const movie = await svc.ingest(toInternalId('tmdb_movie', 155));
  assert.equal(movie.id, 30000155);
  assert.equal(movie.type, 'movie');
  assert.equal(movie.runtime, 152);
  assert.equal(movie.status, 'Lançado');
  assert.equal(svc.findLocal(155).id, 155, 'Batman do seed intacto');

  const tv = await svc.ingest(toInternalId('tmdb_tv', 95396));
  assert.equal(tv.id, 20095396);
  assert.deepEqual(tv.seasons.map(s => s.season_number), [1, 2]);
  assert.equal(tv.seasons[0].episodes[0].runtime, 55);
  assert.equal(tv.seasons[0].episodes[1].name, 'Metade');
  assert.equal(tv.seasons[0].episodes[1].runtime, 50, 'duração média da série quando o episódio não informa');
  assert.equal(tv.status, 'Em Exibição');
  assert.ok(!router.calls.some(c => c.url.includes('/season/0')));
  await assert.rejects(svc.ingest(toInternalId('tmdb_tv', 4040)), err => err.code === 'NOT_FOUND');
});

test('TMDB: 401 vira erro tipado sem expor a chave', async () => {
  const svc = newService({ tmdb: () => { throw mediaErrors.upstream('A fonte externa recusou o acesso (verifique a chave configurada no servidor).'); }, tmdbKey: 'segredo-123' });
  const { items, warnings } = await svc.searchDetailed('batman', 'movie');
  assert.ok(items.length >= 1, 'catálogo local continua respondendo');
  assert.equal(warnings[0].source, 'tmdb');
  assert.ok(!JSON.stringify(warnings).includes('segredo-123'));
});
