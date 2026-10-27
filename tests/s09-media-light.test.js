// S09 · lista leve × detalhe, paginação, /batch, compressão e cabeçalhos de cache (rotas reais, dados sintéticos em pasta temporária).
// Nenhuma requisição externa: as fontes são simuladas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s09-media-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
process.env.STATIC_MAX_AGE_SEC = '120';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const { buildCatalog } = require('../scripts/bench-s09');
const SYNTHETIC = buildCatalog('atual'); // 19 obras (~530 episódios), ids 1.001.000+
fs.writeFileSync(path.join(DATA_DIR, 'mediaCatalog.runtime.json'), JSON.stringify(SYNTHETIC));

const app = require('../server/app');
const mediaService = require('../server/services/mediaService');
const mediaController = require('../server/controllers/mediaController');
const { toListItem } = require('../server/utils/mediaLight');

let server;
let origin;
test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
  mediaService.jikan.minIntervalMs = 0;
  mediaService.jikan.retries = 0;
  mediaService.sleep = async () => {};
});
test.after(() => server.close());
test.beforeEach(() => { mediaController.searchLimiter.reset(); mediaService.jikan.cache.clear(); mediaService.cache.clear(); });

const api = (p, headers = {}) => new Promise((resolve, reject) => {
  http.get(origin + p, { headers }, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
      resolve({ status: res.statusCode, headers: res.headers, raw, text: body.toString('utf8'), json: () => JSON.parse(body.toString('utf8')) });
    });
  }).on('error', reject);
});

const totalEpisodes = m => m.seasons.reduce((n, s) => n + s.episodes.length, 0);

// ---------------------------------------------------------------- lista leve

test('trending devolve lista LEVE (sem temporadas, sinopse nem imagem de fundo) com contagens', async () => {
  const res = await api('/api/media/trending?type=all');
  assert.equal(res.status, 200);
  const body = res.json();
  assert.ok(body.total >= SYNTHETIC.length);
  assert.equal(body.count, body.data.length);
  const item = body.data.find(m => m.id === SYNTHETIC[0].id);
  assert.ok(item, 'obra sintética na lista');
  assert.equal(item.light, true);
  for (const heavy of ['seasons', 'overview', 'backdrop_path', 'alt_titles', 'franchise', 'ingestedAt']) {
    assert.equal(heavy in item, false, `${heavy} não deve ir na lista`);
  }
  assert.equal(item.season_count, SYNTHETIC[0].seasons.length);
  assert.equal(item.episode_count, totalEpisodes(SYNTHETIC[0]));
  for (const key of ['id', 'type', 'name', 'poster_path', 'vote_average', 'first_air_date', 'genres']) assert.ok(key in item, key);
});

test('a lista cai uma ordem de grandeza (>= 10x menor que o catálogo inteiro, antes e depois do gzip)', async () => {
  const oldBody = Buffer.from(JSON.stringify({ count: mediaService.catalog.length, data: mediaService.catalog }));
  const plain = await api('/api/media/trending?type=all&limit=200', { 'Accept-Encoding': 'identity' });
  const gz = await api('/api/media/trending?type=all&limit=200', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip', 'a API comprime');
  assert.ok(plain.raw.length * 10 <= oldBody.length, `sem gzip: ${plain.raw.length} x ${oldBody.length}`);
  assert.ok(gz.raw.length * 10 <= zlib.gzipSync(oldBody).length, `com gzip: ${gz.raw.length} x ${zlib.gzipSync(oldBody).length}`);
});

test('paginação: limit/offset/total/hasMore e validação (400)', async () => {
  const all = (await api('/api/media/trending?limit=200')).json();
  assert.equal(all.hasMore, false);
  const first = (await api('/api/media/trending?limit=5')).json();
  assert.equal(first.count, 5);
  assert.equal(first.total, all.total);
  assert.equal(first.hasMore, true);
  const second = (await api('/api/media/trending?limit=5&offset=5')).json();
  assert.deepEqual(second.data.map(m => m.id), all.data.slice(5, 10).map(m => m.id));
  const last = (await api(`/api/media/trending?limit=5&offset=${all.total - 2}`)).json();
  assert.equal(last.count, 2);
  assert.equal(last.hasMore, false);
  assert.equal((await api(`/api/media/trending?offset=${all.total + 10}`)).json().count, 0);
  for (const bad of ['limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'offset=-1', 'limit=1&limit=2', 'offset=1.5']) {
    assert.equal((await api(`/api/media/trending?${bad}`)).status, 400, bad);
  }
  assert.equal((await api('/api/media/trending?type=anime&limit=200')).json().data.every(m => m.type === 'anime'), true);
  assert.equal((await api('/api/media/trending?type=banana')).status, 400);
});

test('/trending guarda no navegador só com revalidação (ETag + no-cache) e responde 304', async () => {
  const first = await api('/api/media/trending');
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.ok(first.headers.etag);
  const again = await api('/api/media/trending', { 'If-None-Match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.raw.length, 0);
});

test('busca: obra do catálogo vem leve; resultado externo segue como a fonte devolveu (precisa da sinopse até ser adicionado)', async () => {
  mediaService.fetchJson = async (url) => {
    if (url.includes('jikan')) return { data: [] };
    return [{ show: { id: 4242, name: 'Zzyzx Show', type: 'Scripted', genres: ['Drama'], status: 'Running', summary: '<p>Sinopse externa</p>' } }];
  };
  const localBody = (await api('/api/media/search?q=' + encodeURIComponent('Obra Sintética 3') + '&type=tv')).json();
  const local = localBody.data.find(m => m.name === 'Obra Sintética 3');
  assert.ok(local && local.light && !('seasons' in local) && !('overview' in local));
  const body = (await api('/api/media/search?q=zzyzx&type=tv')).json();
  const external = body.data.find(m => m.isExternal);
  assert.ok(external, 'resultado externo presente');
  assert.equal(external.overview, 'Sinopse externa');
  assert.equal('light' in external, false);
});

// ---------------------------------------------------------------- detalhe

test('GET /:id continua devolvendo o detalhe completo (temporadas e episódios) e sinopse', async () => {
  const id = SYNTHETIC[2].id;
  const body = (await api(`/api/media/${id}`)).json();
  assert.equal(body.data.id, id);
  assert.equal(totalEpisodes(body.data), totalEpisodes(SYNTHETIC[2]));
  assert.ok(body.data.overview);
});

test('/batch: detalhe de várias obras de uma vez, sem ingerir; ids desconhecidos voltam em "missing"', async () => {
  let external = 0;
  mediaService.fetchJson = async () => { external++; return {}; };
  const ids = [SYNTHETIC[0].id, SYNTHETIC[1].id, 1396];
  const res = await api(`/api/media/batch?ids=${ids.join(',')}&x=1`);
  const body = res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.data.map(m => m.id).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b));
  assert.equal(body.data.find(m => m.id === SYNTHETIC[0].id).seasons.length, SYNTHETIC[0].seasons.length);
  assert.equal(res.headers['cache-control'], 'no-cache');

  const mixed = (await api(`/api/media/batch?ids=${SYNTHETIC[0].id},1001999,10000123,${SYNTHETIC[0].id}`)).json();
  assert.equal(mixed.count, 1, 'duplicado conta uma vez');
  assert.deepEqual(mixed.missing.sort((a, b) => a - b), [1001999, 10000123]);
  assert.equal(external, 0, 'o /batch nunca consulta fonte externa nem ingere');
});

test('/batch valida os ids (400) e limita a 50', async () => {
  for (const bad of ['', 'ids=', 'ids=abc', 'ids=1,,2', 'ids=-5', 'ids=1.5', 'ids=1&ids=2']) {
    assert.equal((await api(`/api/media/batch${bad && (bad.startsWith('ids') ? '?' + bad : '?ids=' + bad)}`)).status, 400, bad);
  }
  assert.equal((await api('/api/media/batch')).status, 400);
  const many = Array.from({ length: 51 }, (_, i) => i + 1).join(',');
  assert.equal((await api(`/api/media/batch?ids=${many}`)).status, 400);
  const fifty = Array.from({ length: 50 }, (_, i) => i + 1).join(',');
  assert.equal((await api(`/api/media/batch?ids=${fifty}`)).status, 200);
});

test('toListItem não altera a obra do catálogo e não vaza campos pesados', () => {
  const original = SYNTHETIC[0];
  const copy = JSON.parse(JSON.stringify(mediaService.findLocal(original.id)));
  const light = toListItem(mediaService.findLocal(original.id));
  assert.equal(light.light, true);
  assert.deepEqual(JSON.parse(JSON.stringify(mediaService.findLocal(original.id))), copy);
  assert.ok(JSON.stringify(light).length < 600);
  const bare = toListItem({ id: 5, type: 'movie', name: 'Sem nada' });
  assert.deepEqual([bare.poster_path, bare.vote_average, bare.genres, bare.season_count, bare.episode_count], [null, null, [], 0, 0]);
});

// ---------------------------------------------------------------- compressão e cache dos estáticos

test('estáticos: gzip, ETag, index.html sempre conferido e CSS/JS com o cache configurado; helmet continua ativo', async () => {
  const html = await api('/', { 'Accept-Encoding': 'gzip' });
  assert.equal(html.status, 200);
  assert.equal(html.headers['content-encoding'], 'gzip');
  assert.equal(html.headers['cache-control'], 'no-cache');
  assert.ok(html.headers.etag);
  assert.equal(html.headers['x-content-type-options'], 'nosniff', 'helmet segue ligado');
  assert.ok(html.raw.length < html.text.length / 2, 'o HTML comprimiu');

  const css = await api('/css/views.css', { 'Accept-Encoding': 'gzip' });
  assert.equal(css.headers['cache-control'], 'public, max-age=120');
  assert.ok(css.headers.etag);
  const cond = await api('/css/views.css', { 'If-None-Match': css.headers.etag });
  assert.equal(cond.status, 304);

  const js = await api('/js/models/state.js');
  assert.equal(js.headers['cache-control'], 'public, max-age=120');
  assert.equal(js.headers['content-type'].startsWith('text/javascript') || js.headers['content-type'].startsWith('application/javascript'), true);
});

test('a API não é guardada em cache além da revalidação e erros continuam em JSON', async () => {
  const notFound = await api('/api/nao-existe');
  assert.equal(notFound.status, 404);
  assert.match(notFound.headers['content-type'], /json/);
  assert.equal((await api('/api/media/abc')).status, 400);
});

// ---------------------------------------------------------------- imagens de tamanho médio

test('TVMaze e Jikan: pôster do cartão em tamanho médio e imagem grande só no fundo', () => {
  const { MediaService } = require('../server/services/mediaService');
  const jikanMapper = require('../server/services/jikanMapper');
  const tv = MediaService.mapTvmazeShow({ id: 1, name: 'X', type: 'Scripted', image: { medium: 'https://static.tvmaze.com/m.jpg', original: 'https://static.tvmaze.com/o.jpg' } });
  assert.equal(tv.poster_path, 'https://static.tvmaze.com/m.jpg');
  assert.equal(tv.backdrop_path, 'https://static.tvmaze.com/o.jpg');
  const onlyOriginal = MediaService.mapTvmazeShow({ id: 2, name: 'Y', type: 'Scripted', image: { original: 'https://static.tvmaze.com/o2.jpg' } });
  assert.equal(onlyOriginal.poster_path, 'https://static.tvmaze.com/o2.jpg');
  const none = MediaService.mapTvmazeShow({ id: 3, name: 'Z', type: 'Scripted' });
  assert.deepEqual([none.poster_path, none.backdrop_path], [null, null]);

  const anime = jikanMapper.mapAnimeBase({ mal_id: 7, title: 'A', images: { jpg: { image_url: 'https://cdn.myanimelist.net/s.jpg', large_image_url: 'https://cdn.myanimelist.net/l.jpg' } } });
  assert.equal(anime.poster_path, 'https://cdn.myanimelist.net/s.jpg');
  assert.equal(anime.backdrop_path, 'https://cdn.myanimelist.net/l.jpg');
  const onlyLarge = jikanMapper.mapAnimeBase({ mal_id: 8, title: 'B', images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/l2.jpg' } } });
  assert.deepEqual([onlyLarge.poster_path, onlyLarge.backdrop_path], ['https://cdn.myanimelist.net/l2.jpg', 'https://cdn.myanimelist.net/l2.jpg']);
});
