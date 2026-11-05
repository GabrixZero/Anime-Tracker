process.env.SHOWVAULT_SEED_PATH = require('path').join(__dirname, 'fixtures', 'seed-teste.json'); // seed de teste (textos fictícios), não o catálogo real
// Amostras do seed x dados reais: o seed versionado é só uma lista de ids/títulos; a obra real (TMDB/AniList) ocupa o lugar da amostra
// com o MESMO id, sem quebrar as marcações da biblioteca. Fontes simuladas (nenhuma rede), pastas temporárias.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-amostras-'));
process.env.SHOWVAULT_DATA_DIR = path.join(ROOT, 'singleton');
fs.mkdirSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true });
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

const { MediaService } = require('../server/services/mediaService');
const { LibraryModel } = require('../server/models/LibraryModel');
const { toListItem, toSummaryItem } = require('../server/utils/mediaLight');
const { mediaErrors } = require('../server/utils/errors');

const REAL_SEED = path.join(__dirname, '..', 'server', 'data', 'mediaCatalog.seed.json'); // somente leitura
const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const newDir = () => {
  const d = path.join(ROOT, `c${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const backups = dir => fs.readdirSync(dir).filter(f => /^mediaCatalog\.backup-pre-seed-real-.+\.json$/.test(f));
const readRuntime = dir => JSON.parse(fs.readFileSync(path.join(dir, 'mediaCatalog.runtime.json'), 'utf-8'));

// TMDB falso: Breaking Bad (1396, 5 temporadas) e Batman (filme 155). /tv/155 não existe: se alguém o pedir, fica registrado em `calls`.
function tmdbFake() {
  const calls = [];
  const fn = url => {
    calls.push(url);
    const p = new URL(url).pathname.replace('/3', '');
    let m;
    if (p === '/tv/1396')
      return {
        id: 1396,
        name: 'Breaking Bad',
        overview: 'Sinopse falsa',
        poster_path: '/bb.jpg',
        vote_average: 8.9,
        vote_count: 1000,
        first_air_date: '2008-01-20',
        status: 'Ended',
        genres: [{ id: 18, name: 'Drama' }],
        seasons: [1, 2, 3, 4, 5].map(season_number => ({ season_number }))
      };
    if ((m = /^\/tv\/1396\/season\/(\d+)$/.exec(p))) {
      return {
        name: `Temporada ${m[1]}`,
        episodes: [1, 2, 3].map(episode_number => ({ episode_number, name: `Episódio ${episode_number}`, air_date: '2008-01-20' }))
      };
    }
    if (p === '/movie/155')
      return {
        id: 155,
        title: 'Batman: O Cavaleiro das Trevas',
        runtime: 152,
        status: 'Released',
        overview: 'Filme falso',
        poster_path: '/b.jpg',
        vote_average: 8.5,
        vote_count: 30000,
        release_date: '2008-07-16',
        genres: [{ id: 28, name: 'Ação' }]
      };
    throw mediaErrors.notFound();
  };
  fn.calls = calls;
  return fn;
}

function newService(dir, { tmdb = tmdbFake(), key = 'chave-falsa', seedPath = REAL_SEED } = {}) {
  const svc = new MediaService({
    dataDir: dir,
    seedPath,
    tmdbKey: key,
    tmdbBase: 'http://tmdb.invalid/3',
    tvmazeBase: 'http://tvmaze.invalid',
    anilistEnabled: false,
    jikanEnabled: false,
    sleep: async () => {}
  });
  svc.fetchJson = async url => {
    if (url.startsWith('http://tmdb.invalid')) return tmdb(url);
    throw new Error(`URL inesperada na fonte simulada: ${url}`);
  };
  svc.tmdbFake = tmdb;
  return svc;
}

// ---------------------------------------------------------------- (a) seed versionado

test('(a) o seed versionado só tem os campos permitidos (nada de sinopse, imagem, nota ou temporadas)', () => {
  const seed = JSON.parse(fs.readFileSync(REAL_SEED, 'utf-8'));
  assert.equal(seed.length, 16);
  const allowed = new Set(['id', 'type', 'name', 'alt_titles', 'source', 'tmdb_id', 'mal_id']);
  for (const m of seed) {
    for (const key of Object.keys(m)) assert.ok(allowed.has(key), `${m.name}: campo "${key}" não é permitido no seed`);
    assert.ok(['tmdb_tv', 'tmdb_movie', 'anime'].includes(m.source));
    if (m.source === 'anime') assert.ok(Number.isSafeInteger(m.mal_id));
    else assert.equal(m.tmdb_id, m.id);
  }
  const bySource = s => seed.filter(m => m.source === s).map(m => m.id);
  assert.deepEqual(bySource('tmdb_tv'), [1396, 136283, 95396, 66732, 94605, 100088]);
  assert.deepEqual(bySource('tmdb_movie'), [157336, 872585, 693134, 324857, 155]);
  assert.deepEqual(bySource('anime'), [1429, 85937, 95479, 209867, 13916]);
});

// ---------------------------------------------------------------- (b) série

test('(b) ingest(1396) grava 5 temporadas com o id 1396; ingest(20001396) devolve a mesma obra, sem duplicar', async () => {
  const dir = newDir();
  const svc = newService(dir);
  assert.equal(MediaService.isTitleOnly(svc.findLocal(1396)), true, 'começa só com o título');
  const work = await svc.ingest(1396);
  assert.equal(work.id, 1396);
  assert.equal(work.seasons.length, 5);
  assert.ok(work.ingestedAt);
  assert.equal(work.source, 'tmdb_tv');
  assert.equal(work.tmdb_id, 1396);
  assert.equal(MediaService.isUpgradedSeed(work), true);
  assert.equal(svc.isSeedSample(work), false);

  assert.equal((await svc.ingest(20001396)).id, 1396);
  assert.equal(svc.resolveExisting(20001396).id, 1396);
  assert.equal(svc.catalog.filter(m => m.name === 'Breaking Bad').length, 1);
  assert.equal(svc.findLocal(20001396), null);
  assert.equal(readRuntime(dir).filter(m => m.name === 'Breaking Bad').length, 1);
});

test('(b) pedir primeiro pelo id 2000xxxx troca a amostra e ocupa o id do seed', async () => {
  const svc = newService(newDir());
  assert.equal(svc.needsIngest(20001396), true);
  const work = await svc.ingest(20001396);
  assert.equal(work.id, 1396);
  assert.equal(work.seasons.length, 5);
  assert.equal(svc.needsIngest(20001396), false);
});

test('(b) busca do TMDB que é a obra do seed devolve o id do seed em catalog_id (nunca duas obras)', () => {
  const svc = newService(newDir());
  const sample = svc.findLocal(1396);
  const cand = { item: { id: 20001396, type: 'tv', name: 'Breaking Bad', isExternal: true }, source: 'tmdb', score: 100 };
  const local = { item: sample, source: 'local', score: 100 };
  const merged = svc.mergeCandidates([local, cand]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].item.catalog_id, 1396);
  // a amostra nem precisa estar entre os candidatos locais
  const only = svc.mergeCandidates([cand]);
  assert.equal(only.length, 1);
  assert.equal(only[0].item.catalog_id, 1396);
});

// ---------------------------------------------------------------- (c) filme x série

test('(c) ingest(155) chama /movie/155 e nunca /tv/155; filme 20000155 não é alias de série 155 e vice-versa', async () => {
  const svc = newService(newDir());
  const work = await svc.ingest(155);
  assert.equal(work.id, 155);
  assert.equal(work.type, 'movie');
  assert.equal(work.runtime, 152);
  assert.equal(work.source, 'tmdb_movie');
  assert.ok(svc.tmdbFake.calls.some(u => u.includes('/movie/155')));
  assert.ok(!svc.tmdbFake.calls.some(u => /\/tv\/155(\?|\/)/.test(u)), 'o filme 155 nunca é pedido como série');

  assert.equal(svc.findAlias(20000155), null, 'série TMDB 155 não é o filme 155');
  assert.equal(svc.findAlias(30000155).id, 155, 'filme TMDB 155 é o filme 155 do seed');
  // série TMDB 1396 não é filme: um "filme 1396" (31396 mil...) não existe no seed
  assert.equal(svc.findAlias(30001396), null);
  assert.equal(svc.findAlias(20001396).id, 1396);
});

test('(c) a série 20000155 (outra obra) não troca a amostra do filme 155', async () => {
  const svc = newService(newDir());
  assert.equal(svc.resolveExisting(20000155), null);
  assert.equal(svc.needsIngest(20000155), true);
  assert.equal(MediaService.isTitleOnly(svc.findLocal(155)), true);
});

// ---------------------------------------------------------------- (d) sem chave

test('(d) sem chave do TMDB a entrada continua só com título e ingest dá "não configurado"', async () => {
  const dir = newDir();
  const svc = newService(dir, { key: '' });
  const item = svc.findLocal(1396);
  assert.equal(MediaService.isTitleOnly(item), true);
  await assert.rejects(svc.ingest(1396), err => err.code === 'SOURCE_NOT_CONFIGURED');
  await assert.rejects(svc.ingest(155), err => err.code === 'SOURCE_NOT_CONFIGURED');
  assert.equal(svc.findLocal(1396).ingestedAt, undefined, 'nada foi inventado');
  assert.equal(backups(dir).length, 0);

  // o Explorar não quebra: nota/imagem null, gêneros vazios, temporadas vazias
  const light = toListItem(item);
  assert.equal(light.vote_average, null);
  assert.equal(light.poster_path, null);
  assert.deepEqual(light.genres, []);
  assert.equal(light.season_count, 0);
  assert.equal(light.episode_count, 0);
  const summary = toSummaryItem(item);
  assert.deepEqual(summary.seasons, []);
  assert.equal(svc.getMany([1396]).missing[0], 1396, 'não é obra completa');
  assert.equal((await svc.getTrending('tv')).length, 6);
  const found = await svc.searchDetailed('breaking', 'tv');
  assert.equal(found.items[0].id, 1396);
});

// ---------------------------------------------------------------- (e) marcações da biblioteca

test('(e) as marcações da biblioteca (1396_s1_e1..3, 1429_s1_e2, 155_movie) continuam valendo depois da troca', async () => {
  const dir = newDir();
  // runtime antigo: cópia de Breaking Bad com 1 temporada e 3 episódios, anime e filme de amostra
  const episode = k => ({
    episode_number: k,
    name: `Episódio ${k}`,
    air_date: '2008-01-20',
    overview: '',
    still_path: null,
    runtime: null
  });
  const old = [
    {
      id: 1396,
      type: 'tv',
      name: 'Breaking Bad',
      overview: 'Cópia antiga',
      poster_path: null,
      backdrop_path: null,
      vote_average: null,
      first_air_date: '2008-01-20',
      genres: [],
      status: 'Finalizada',
      seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [1, 2, 3].map(episode) }]
    },
    {
      id: 1429,
      type: 'anime',
      name: 'Attack on Titan (Shingeki no Kyojin)',
      overview: 'Cópia antiga',
      seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [1, 2].map(episode) }],
      mal_id: 16498
    },
    { id: 155, type: 'movie', name: 'Batman: O Cavaleiro das Trevas', overview: 'Cópia antiga', genres: [], seasons: [], runtime: 152 }
  ];
  fs.writeFileSync(path.join(dir, 'mediaCatalog.runtime.json'), JSON.stringify(old));
  const lib = new LibraryModel(dir);
  const stamp = new Date().toISOString();
  lib.save('usr_marcacoes', {
    trackedShows: [
      { showId: 1396, status: 'watching', addedAt: stamp, rating: 9.5 },
      { showId: 1429, status: 'watching', addedAt: stamp },
      { showId: 155, status: 'completed', addedAt: stamp }
    ],
    watchedEpisodes: Object.fromEntries(
      ['1396_s1_e1', '1396_s1_e2', '1396_s1_e3', '1429_s1_e2', '155_movie'].map(k => [
        k,
        { watched: true, watchedAt: stamp, rewatchCount: 1 }
      ])
    ),
    episodeNotes: { '1396_s1_e2': { text: 'anotação de teste', emotion: null, character: '', updatedAt: stamp, snapshots: [] } },
    tombstones: { shows: {}, episodes: {}, notes: {} },
    resetAt: ''
  });
  const libFile = lib.filePathFor('usr_marcacoes');
  const libBefore = fs.readFileSync(libFile, 'utf-8');
  const library = JSON.parse(libBefore);
  const keys = Object.keys(library.watchedEpisodes);
  assert.equal(keys.length, 5);

  const resolve = (svc, key) => {
    const m = /^(\d+)_(?:movie|s(\d+)_e(\d+))$/.exec(key);
    const work = svc.findLocal(Number(m[1]));
    if (!m[2]) return work.type === 'movie' ? 'movie' : null;
    const season = (work.seasons || []).find(s => s.season_number === Number(m[2]));
    const ep = season && season.episodes.find(e => e.episode_number === Number(m[3]));
    return ep ? `${work.id}:${ep.season_number ?? season.season_number}:${ep.episode_number}:${ep.name}` : null;
  };

  const svc = newService(dir);
  const antes = keys.map(k => resolve(svc, k));
  assert.ok(antes.every(Boolean), 'todas as chaves resolvem antes');
  assert.equal(svc.findLocal(1396).overview, 'Cópia antiga', 'a cópia antiga segue exibível');

  const work = await svc.ingest(20001396); // a obra real troca a amostra
  assert.equal(work.id, 1396);
  assert.equal(work.seasons.length, 5);
  assert.ok(
    work.seasons.some(s => s.season_number === 5),
    'existem 1396_s5_eN novos'
  );
  assert.ok(work.seasons.find(s => s.season_number === 5).episodes.length >= 1);
  await svc.ingest(155);
  assert.equal(svc.findLocal(155).type, 'movie');

  const depois = keys.map(k => resolve(svc, k));
  assert.deepEqual(depois, antes, 'as mesmas chaves resolvem para os mesmos episódios (temporada 1, episódios 1-3)');
  assert.equal(depois[0], '1396:1:1:Episódio 1');
  assert.equal(svc.findLocal(1429).overview, 'Cópia antiga', 'o anime não foi tocado');
  assert.equal(fs.readFileSync(libFile, 'utf-8'), libBefore, 'a biblioteca não foi alterada');
  assert.equal(backups(dir).length, 1, 'um só backup, antes da primeira troca');
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(
          dir,
          fs.readdirSync(dir).find(f => f.includes('backup-pre-seed-real'))
        ),
        'utf-8'
      )
    )[0].overview,
    'Cópia antiga'
  );
});

// ---------------------------------------------------------------- (f) segunda partida

test('(f) a segunda partida do servidor não muda nada e não faz novo backup', async () => {
  const dir = newDir();
  const first = newService(dir);
  await first.ingest(1396);
  await first.ingest(155);
  assert.equal(backups(dir).length, 1, 'no máximo um backup por execução');
  const file = path.join(dir, 'mediaCatalog.runtime.json');
  const before = fs.readFileSync(file, 'utf-8');

  const second = newService(dir);
  assert.equal(fs.readFileSync(file, 'utf-8'), before);
  assert.equal(backups(dir).length, 1);
  assert.equal(second.findLocal(1396).seasons.length, 5);
  assert.equal(await second.ingest(1396), second.findLocal(1396), 'obra já trocada não é refeita');
  assert.equal(second.tmdbFake.calls.length, 0, 'sem nova chamada à fonte');
  assert.equal(backups(dir).length, 1);
});

// ---------------------------------------------------------------- (g) validade de 90 dias

test('(g) obras do TMDB (seed, 20M, 30M) vencem em até 90 dias e o seed é atualizável pelo TMDB', async () => {
  const dir = newDir();
  const svc = newService(dir);
  const work = await svc.ingest(1396);
  const movie = await svc.ingest(155);
  assert.equal(svc.refreshTtlMs(work), 90 * DAY, 'série finalizada do seed');
  assert.equal(svc.refreshTtlMs(movie), 90 * DAY, 'filme lançado do seed');
  const base = { ingestedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(svc.refreshTtlMs({ ...base, id: 20000010, type: 'tv', status: 'Finalizada' }), 90 * DAY);
  assert.equal(svc.refreshTtlMs({ ...base, id: 30000010, type: 'movie', status: 'Lançado', first_air_date: '2000-01-01' }), 90 * DAY);
  assert.equal(
    svc.refreshTtlMs({ ...base, id: 20000010, type: 'tv', status: 'Em Exibição', scheduleVersion: 2 }),
    svc.airingTtlMs,
    'o menor vale'
  );
  assert.equal(svc.refreshTtlMs({ ...base, id: 1000010, type: 'tv', status: 'Finalizada' }), null, 'TVMaze não muda');

  const now = Date.now();
  assert.equal(svc.isRefreshDue(work, now + 89 * DAY), false);
  assert.equal(svc.isRefreshDue(work, now + 91 * DAY), true);

  // atualização do seed pelo TMDB: mesma obra, mesmo id, mesma ingestedAt
  svc.catalog = svc.catalog.map(m => (m.id === 1396 ? { ...m, refreshedAt: new Date(now - 91 * DAY).toISOString() } : m));
  const res = await svc.refresh(1396, { force: true });
  assert.equal(res.refreshed, true);
  assert.equal(res.item.id, 1396);
  assert.equal(res.item.ingestedAt, work.ingestedAt);
  assert.equal(res.item.source, 'tmdb_tv');
  assert.ok(Date.parse(res.item.refreshedAt) > now - 90 * DAY, 'refreshedAt renovado');
  assert.equal(svc.catalog.filter(m => m.name === 'Breaking Bad').length, 1);
  assert.equal(svc.findLocal(155).type, 'movie');

  // sem chave não há como atualizar: não vence
  const offline = newService(dir, { key: '' });
  assert.equal(offline.refreshTtlMs(offline.findLocal(1396)), null);
});

// ---------------------------------------------------------------- (h) pré-busca em segundo plano

test('(h) pré-busca: uma de cada vez, com pausa entre elas, no limite da rodada, pulando fonte desligada (animes)', async () => {
  const svc = newService(newDir());
  const sleeps = [];
  svc.sleep = async ms => sleeps.push(ms);
  const order = [];
  let running = 0;
  let maxRunning = 0;
  const realIngest = svc.ingest.bind(svc);
  svc.ingest = async id => {
    order.push(id);
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise(resolve => setImmediate(resolve));
    try {
      return await realIngest(id);
    } finally {
      running--;
    }
  };
  const out = await svc.prefetchSamples({ limit: 3, pauseMs: 2000 });
  assert.equal(out.checked, 3);
  assert.equal(order.length, 3);
  assert.equal(maxRunning, 1, 'nunca duas ao mesmo tempo');
  assert.deepEqual(sleeps, [2000, 2000], 'pausa entre as obras (não depois da última)');
  const anime = new Set([1429, 85937, 95479, 209867, 13916]);
  assert.ok(!order.some(id => anime.has(id)), 'AniList/Jikan desligadas: animes pulados');
  assert.ok(out.fetched.includes(1396), 'a série que a fonte falsa conhece foi trocada pela real');
  assert.equal(MediaService.isTitleOnly(svc.findLocal(1396)), false);
});

test('(h) pré-busca: sem chave do TMDB (e animes desligados) não tenta nada', async () => {
  const svc = newService(newDir(), { key: '' });
  svc.ingest = async () => assert.fail('não deveria ingerir');
  assert.deepEqual(await svc.prefetchSamples({ limit: 16, pauseMs: 0 }), { checked: 0, fetched: [], failed: [] });
});

test('(h) pré-busca: respeita a espera de 30 min depois de uma falha', async () => {
  const svc = newService(newDir());
  svc.tmdbFake.calls.length = 0;
  const only = svc.catalog.filter(m => m.id === 872585); // a fonte falsa não conhece este filme: falha
  svc.catalog = only;
  const t0 = Date.now();
  const first = await svc.prefetchSamples({ limit: 5, pauseMs: 0, now: t0 });
  assert.equal(first.failed.length, 1);
  const again = await svc.prefetchSamples({ limit: 5, pauseMs: 0, now: t0 + 10 * 60 * 1000 });
  assert.equal(again.checked, 0, 'ainda dentro dos 30 min');
  const later = await svc.prefetchSamples({ limit: 5, pauseMs: 0, now: t0 + 31 * 60 * 1000 });
  assert.equal(later.checked, 1, 'passados 30 min tenta de novo');
});

test('(h) pré-busca: fonte com disjuntor aberto é pulada', async () => {
  const anilistSvc = new MediaService({ dataDir: newDir(), seedPath: REAL_SEED, tmdbKey: '', anilistEnabled: true, jikanEnabled: false });
  const anime = anilistSvc.findLocal(1429);
  assert.equal(anilistSvc.isSampleSourceReady(anime), true);
  anilistSvc.anilist.breaker.failure(Object.assign(new Error('x'), { unreachable: true }));
  if (!anilistSvc.anilist.breaker.isOpen) {
    for (let i = 0; i < 5; i++) anilistSvc.anilist.breaker.failure(new Error('x'));
  }
  assert.equal(anilistSvc.anilist.breaker.isOpen, true);
  assert.equal(anilistSvc.isSampleSourceReady(anime), false);
});

test('(h) laço: intervalo 0 não liga nada; com intervalo, cada rodada chama a pré-busca com o limite e a pausa configurados', async () => {
  const off = newService(newDir());
  off.startRefreshLoop({ intervalMs: 0, initialDelayMs: 1, log: () => {} });
  assert.equal(off.refreshTimers.length, 0);

  const svc = newService(newDir());
  const seen = [];
  svc.refreshDueWorks = async () => ({ checked: 0, refreshed: [], failed: [] });
  svc.prefetchSamples = async opts => {
    seen.push(opts);
    return { checked: 0, fetched: [], failed: [] };
  };
  svc.startRefreshLoop({ intervalMs: 20, initialDelayMs: 5, sampleLimit: 4, samplePauseMs: 7, log: () => {} });
  await new Promise(resolve => setTimeout(resolve, 120));
  svc.stopRefreshLoop();
  assert.ok(seen.length >= 1);
  assert.deepEqual(seen[0], { limit: 4, pauseMs: 7 });
});

// ---------------------------------------------------------------- (i) GET /api/media/:id de amostra

function callGetById(controller, id, userId) {
  const res = {
    code: 200,
    body: null,
    set() {
      return this;
    },
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    }
  };
  return controller.getById({ params: { id: String(id) }, query: {}, userId }, res).then(() => res);
}

test('(i) GET de amostra só-título: anônimo recebe pending sem 401; logado troca pela obra real; sem chave devolve o que existe', async () => {
  const mediaService = require('../server/services/mediaService');
  const controller = require('../server/controllers/mediaController');
  const donor = newService(newDir());
  Object.assign(mediaService, { catalog: donor.catalog, seedById: donor.seedById, writeBlockedBy: null });
  mediaService.dataDir = donor.dataDir;
  mediaService.saveCatalog = donor.saveCatalog.bind(donor);
  mediaService.backupBeforeMigration = () => true;
  mediaService.tmdb.fetchJson = async url => donor.tmdbFake(url);
  mediaService.tmdb.apiKey = '';

  // anônimo
  let res = await callGetById(controller, 1396, undefined);
  assert.equal(res.code, 200);
  assert.equal(res.body.data.pending, true);
  assert.equal(res.body.data.name, 'Breaking Bad');
  assert.equal(res.body.data.overview, undefined, 'nada inventado');

  // logado, mas sem chave: devolve o que existe
  res = await callGetById(controller, 1396, 'u1');
  assert.equal(res.code, 200);
  assert.equal(res.body.data.pending, true);

  // logado, com a fonte configurada: a obra real ocupa o lugar
  mediaService.tmdb.apiKey = 'chave-falsa';
  res = await callGetById(controller, 1396, 'u2');
  assert.equal(res.code, 200);
  assert.equal(res.body.data.pending, undefined);
  assert.equal(res.body.data.seasons.length, 5);
  assert.ok(res.body.data.ingestedAt);

  // depois da troca, o anônimo já lê a obra real
  res = await callGetById(controller, 1396, undefined);
  assert.equal(res.body.data.pending, undefined);
  assert.equal(res.body.data.seasons.length, 5);
});
