// S13 · rotas /api/media: atualização de obra em exibição (POST /:id/refresh), obra existente com outro id (alias público), amostra do
// seed trocada ao adicionar (catalog_id na busca) e avisos de fonte com reserva. Fontes SIMULADAS (AniList = respostas reais gravadas).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { tempRoot, respond } = require('./helpers/anilistFixtures');
const T = tempRoot('showvault-s13-http-');
process.env.SHOWVAULT_DATA_DIR = T.root;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;

const HOUR = 60 * 60 * 1000;
const airing = (id, hoursAgo) => ({
  id, type: 'tv', name: `Série em exibição ${id}`, overview: 'x', poster_path: 'https://static.tvmaze.com/p.jpg', backdrop_path: null, vote_average: 7, first_air_date: '2026-01-01',
  genres: ['Comédia'], status: 'Em Exibição', ingestedAt: new Date(Date.now() - 100 * HOUR).toISOString(), refreshedAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
  seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [{ episode_number: 1, name: 'E1', runtime: 30, air_date: '2026-01-01', overview: '', still_path: null }] }]
});
fs.writeFileSync(path.join(T.root, 'mediaCatalog.runtime.json'), JSON.stringify([airing(1000041, 8), airing(1000042, 1), airing(1000043, 9), airing(1000044, 10)]));

const app = require('../server/app');
const mediaService = require('../server/services/mediaService');
const mediaController = require('../server/controllers/mediaController');
const { issueToken } = require('../server/middleware/auth');
const { mediaErrors } = require('../server/utils/errors');

let server;
let base;
const auth = { Authorization: `Bearer ${issueToken({ id: 'usr_s13_http' })}` };
const external = [];   // requisições externas feitas (URL)
let anilistDown = false;

test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/media`;
  for (const client of [mediaService.anilist, mediaService.jikan]) { client.minIntervalMs = 0; client.retries = 0; }
  mediaService.sleep = async () => {};
  mediaService.fetchJson = async (url, opts = {}) => {
    external.push(url);
    if (url.includes('anilist')) {
      if (anilistDown) throw mediaErrors.upstream('Tempo esgotado na fonte externa.', { unreachable: true });
      return respond(JSON.parse(opts.body));
    }
    if (url.includes('jikan')) throw mediaErrors.upstream('Tempo esgotado na fonte externa.', { unreachable: true });
    const m = /\/shows\/(\d+)\?/.exec(url);
    if (m) {
      return { id: Number(m[1]), name: `Série em exibição ${m[1]}`, type: 'Scripted', status: 'Running', genres: ['Comédia'], rating: { average: 7 },
        _embedded: { episodes: [{ season: 1, number: 1, name: 'E1', runtime: 30 }, { season: 1, number: 2, name: 'E2', runtime: 30 }, { season: 1, number: 3, name: 'E3', runtime: 30 }] } };
    }
    return [];   // buscas do TVMaze
  };
});
test.after(() => { server.closeAllConnections(); server.close(); });
test.beforeEach(() => {
  external.length = 0;
  anilistDown = false;
  mediaController.searchLimiter.reset();
  mediaController.ingestLimiter.reset();
  mediaService.cache.clear();
  for (const client of [mediaService.anilist, mediaService.jikan]) { client.cache.clear(); client.breaker.success(); }
});

const post = (p, headers = auth) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
const json = async res => ({ status: res.status, body: await res.json(), headers: res.headers });

test('POST /:id/refresh exige login e valida o id (sem tocar nas fontes)', async () => {
  assert.equal((await post('/1000041/refresh', {})).status, 401);
  assert.equal((await json(await post('/abc/refresh'))).status, 400);
  const unknown = await json(await post('/1000099/refresh'));
  assert.equal(unknown.status, 404);
  const seed = await json(await post('/1396/refresh'));   // Breaking Bad do seed: sem fonte para atualizar
  assert.equal(seed.status, 404);
  assert.equal(seed.body.code, 'UNSUPPORTED_SOURCE');
  assert.equal(external.length, 0);
});

test('refresh: dentro da validade responde "fresh" sem consultar a fonte nem gastar o limite; vencida baixa de novo e informa os episódios novos', async () => {
  const fresh = await json(await post('/1000042/refresh'));
  assert.equal(fresh.status, 200);
  assert.deepEqual([fresh.body.success, fresh.body.refreshed, fresh.body.reason, fresh.body.newEpisodes], [true, false, 'fresh', 0]);
  assert.equal(fresh.body.data.id, 1000042);
  assert.equal(external.length, 0);

  const due = await json(await post('/1000041/refresh'));
  assert.equal(due.status, 200);
  assert.deepEqual([due.body.refreshed, due.body.newEpisodes], [true, 2], '1 episódio antes, 3 agora');
  assert.equal(due.body.data.seasons[0].episodes.length, 3);
  assert.ok(Date.parse(due.body.data.refreshedAt) > Date.now() - 10000);
  assert.equal(external.filter(u => u.includes('/shows/41?')).length, 1);

  const again = await json(await post('/1000041/refresh'));
  assert.equal(again.body.refreshed, false);
  const forced = await json(await post('/1000041/refresh?force=1'));
  assert.deepEqual([forced.body.refreshed, forced.body.reason], [false, 'recent'], 'forçar de novo em menos de 10 min não vale');
  assert.equal(external.filter(u => u.includes('/shows/41?')).length, 1);
});

test('refresh: o limite de ingestões por usuário vale só quando a fonte seria consultada; fonte fora do ar vira 502 e a obra não muda', async () => {
  const user = issueToken({ id: 'usr_s13_limite' });
  for (let i = 0; i < 30; i++) mediaController.ingestLimiter.hit('usr_s13_limite');
  const headers = { Authorization: `Bearer ${user}` };
  assert.equal((await post('/1000042/refresh', headers)).status, 200, 'dentro da validade: não consulta, não conta');
  const blocked = await json(await post('/1000043/refresh', headers));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'TOO_MANY_REQUESTS');

  const before = mediaService.findLocal(1000044);
  const original = mediaService.fetchJson;
  mediaService.fetchJson = async () => { throw mediaErrors.upstream(); };
  try {
    const down = await json(await post('/1000044/refresh'));
    assert.equal(down.status, 502);
    assert.equal(down.body.code, 'UPSTREAM');
  } finally {
    mediaService.fetchJson = original;
  }
  assert.equal(mediaService.findLocal(1000044), before, 'a obra continua como estava');
});

test('busca: Attack on Titan vem da AniList com catalog_id da amostra do seed; adicionar (ingestão, logado) troca a amostra e as outras temporadas viram a mesma obra, públicas', async () => {
  const search = await json(await fetch(`${base}/search?q=${encodeURIComponent('attack on titan')}&type=anime`));
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.warnings, []);
  const aot = search.body.data[0];
  assert.deepEqual([aot.id, aot.catalog_id, aot.isExternal, aot.related_count], [10016498, 1429, true, 5]);
  assert.ok(!search.body.data.some(i => i.id === 1429), 'a amostra não aparece de novo');

  assert.equal((await fetch(`${base}/10016498`)).status, 401, 'a amostra precisa ser trocada pela obra real: ingestão exige login');
  const added = await json(await fetch(`${base}/10016498`, { headers: auth }));
  assert.equal(added.status, 200);
  assert.equal(added.body.data.id, 1429, 'a obra real ocupa o lugar da amostra');
  assert.equal(added.body.data.seasons.reduce((n, s) => n + s.episodes.length, 0), 91);

  // outra temporada da mesma franquia, pelo id externo, sem login: é a mesma obra (já existe)
  const season2 = await json(await fetch(`${base}/10025777`));
  assert.equal(season2.status, 200);
  assert.equal(season2.body.data.id, 1429);
  const callsBefore = external.length;
  const again = await json(await fetch(`${base}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ id: 10016498 }) }));
  assert.equal(again.body.data.id, 1429);
  assert.equal(external.length, callsBefore, 'nada novo foi baixado');

  // daqui em diante a busca devolve a obra do catálogo (leve), sem resultado externo duplicado
  mediaController.searchLimiter.reset();
  const after = await json(await fetch(`${base}/search?q=${encodeURIComponent('attack on titan')}&type=anime`));
  assert.equal(after.body.data[0].id, 1429);
  assert.equal(after.body.data[0].light, true);
  assert.equal(after.body.data.filter(i => i.mal_id === 16498 || (i.mal_ids || []).includes(16498)).length, 1);
});

test('busca: AniList fora do ar e a Jikan também -> 200 com um aviso por fonte (e o catálogo local responde); só com a AniList fora, a Jikan cobre', async () => {
  anilistDown = true;
  const both = await json(await fetch(`${base}/search?q=${encodeURIComponent('death note')}&type=anime`));
  assert.equal(both.status, 200);
  assert.deepEqual(both.body.warnings.map(w => w.source), ['anilist', 'jikan']);
  assert.deepEqual(both.body.data.map(i => i.id), [13916]);

  // reserva respondendo: o aviso da AniList leva fallback = jikan
  mediaController.searchLimiter.reset();
  for (const client of [mediaService.anilist, mediaService.jikan]) client.breaker.success();
  const original = mediaService.fetchJson;
  mediaService.fetchJson = async (url, opts) => {
    if (url.includes('jikan')) return { data: [{ mal_id: 1535, title: 'Death Note', title_english: 'Death Note', type: 'TV', episodes: 37, status: 'Finished Airing', aired: { from: '2006-10-04T00:00:00+00:00' }, score: 8.6, season: 'fall', year: 2006, genres: [{ name: 'Mystery' }], themes: [], images: {} }] };
    return original(url, opts);
  };
  try {
    const covered = await json(await fetch(`${base}/search?q=${encodeURIComponent('death note')}&type=anime`));
    assert.deepEqual(covered.body.warnings.map(w => [w.source, w.fallback]), [['anilist', 'jikan']]);
    assert.equal(covered.body.data[0].catalog_id, 13916, 'a amostra do seed também cede lugar à reserva');
    assert.equal(covered.body.data[0].id, 10001535);
  } finally {
    mediaService.fetchJson = original;
  }
});
