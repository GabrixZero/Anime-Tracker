// S18 · resumo por obra (/batch?summary=1), migração de imagens, service worker e manifesto. Sem rede externa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s18-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const { buildCatalog } = require('../scripts/bench-s09');
const SYNTHETIC = buildCatalog('atual');
// um pôster grande do AniList para provar a migração de imagens na partida
SYNTHETIC[0].poster_path = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/extraLarge/bx1-abc.jpg';
fs.writeFileSync(path.join(DATA_DIR, 'mediaCatalog.runtime.json'), JSON.stringify(SYNTHETIC));

const app = require('../server/app');
const { shrinkPosterUrl, migrateCatalogImages } = require('../server/services/imageMigration');
const { buildCspDirectives } = require('../server/config/csp');

let server;
let origin;
test.before(async () => {
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const get = p =>
  new Promise((resolve, reject) => {
    http
      .get(origin + p, { headers: { 'accept-encoding': 'gzip' } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const body = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
          resolve({ status: res.statusCode, headers: res.headers, size: raw.length, text: body.toString('utf8') });
        });
      })
      .on('error', reject);
  });

test('/batch?summary=1: episódios enxutos (sem sinopses) e bem menor que o detalhe', async () => {
  const ids = SYNTHETIC.slice(0, 10)
    .map(i => i.id)
    .join(',');
  const full = await get(`/api/media/batch?ids=${ids}`);
  const sum = await get(`/api/media/batch?ids=${ids}&summary=1`);
  assert.equal(sum.status, 200);
  const data = JSON.parse(sum.text).data;
  assert.equal(data.length, 10);
  const item = data[0];
  assert.equal(item.summary, true);
  assert.equal(item.light, undefined);
  assert.equal(item.overview, undefined);
  const source = SYNTHETIC.find(s => s.id === item.id);
  assert.equal(item.seasons.length, source.seasons.length);
  const ep = item.seasons[0].episodes[0];
  assert.deepEqual(Object.keys(ep).sort(), ['air_date', 'episode_number', 'name', 'runtime', 'still_path']);
  assert.equal(
    item.seasons.reduce((n, s) => n + s.episodes.length, 0),
    item.episode_count
  );
  assert.ok(sum.text.length < full.text.length * 0.7, `resumo (${sum.text.length}) deve ser bem menor que o detalhe (${full.text.length})`);
  assert.equal(JSON.parse(full.text).data[0].overview, source.overview, 'sem summary o detalhe segue completo');
});

test('migração de imagens: pôster grande vira médio na partida, idempotente', async () => {
  const res = await get('/api/media/trending?limit=100');
  const first = JSON.parse(res.text).data.find(i => i.id === SYNTHETIC[0].id);
  assert.match(first.poster_path, /\/cover\/large\//);
  assert.equal(shrinkPosterUrl(first.poster_path), first.poster_path);
  assert.ok(
    fs.readdirSync(DATA_DIR).some(f => f.startsWith('mediaCatalog.backup-pre-s18-')),
    'backup antes da migração'
  );
});

test('shrinkPosterUrl: cada fonte e valores vazios', () => {
  assert.equal(
    shrinkPosterUrl('https://cdn.myanimelist.net/images/anime/1/2345l.jpg'),
    'https://cdn.myanimelist.net/images/anime/1/2345.jpg'
  );
  assert.equal(shrinkPosterUrl('https://image.tmdb.org/t/p/original/a.jpg'), 'https://image.tmdb.org/t/p/w500/a.jpg');
  assert.equal(
    shrinkPosterUrl('https://static.tvmaze.com/uploads/images/original_untouched/1.jpg'),
    'https://static.tvmaze.com/uploads/images/medium_portrait/1.jpg'
  );
  assert.equal(shrinkPosterUrl(null), null);
  const once = migrateCatalogImages([
    { id: 1, poster_path: 'https://image.tmdb.org/t/p/w780/a.jpg', backdrop_path: 'https://image.tmdb.org/t/p/original/b.jpg' }
  ]);
  assert.equal(once.changed, 1);
  assert.equal(once.items[0].backdrop_path, 'https://image.tmdb.org/t/p/original/b.jpg');
  assert.equal(migrateCatalogImages(once.items).changed, 0);
});

test('PWA: manifesto, service worker sem cache longo, CSP com worker e manifesto', async () => {
  const man = await get('/manifest.webmanifest');
  assert.equal(man.status, 200);
  const manifest = JSON.parse(man.text);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(i => i.sizes === '512x512'));
  for (const icon of manifest.icons) assert.equal((await get(icon.src)).status, 200);
  const sw = await get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers['cache-control'], /no-cache/);
  assert.match(sw.headers['content-security-policy'], /worker-src 'self'/);
  const csp = buildCspDirectives({ isProduction: false });
  assert.deepEqual(csp.workerSrc, ["'self'"]);
});

test('service worker: nunca intercepta/guarda /api/auth nem /api/user', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const match = src.match(/const PUBLIC_MEDIA = (\/.*\/);/);
  assert.ok(match);
  const re = eval(match[1]);
  for (const ok of ['/api/media/trending', '/api/media/batch', '/api/media/search', '/api/media/123']) assert.ok(re.test(ok), ok);
  for (const no of ['/api/user/library', '/api/auth/me', '/api/media/123/refresh', '/api/user/media/1']) assert.ok(!re.test(no), no);
  assert.ok(!/cache\.put[^;]*api\/(user|auth)/.test(src));
});
