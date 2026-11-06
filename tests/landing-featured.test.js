// Destaques da landing (D-CL-3): fonte falsa do TMDB (nenhuma requisição real, nenhuma chave real), pasta temporária.
process.env.SHOWVAULT_SEED_PATH = require('path').join(__dirname, 'fixtures', 'seed-teste.json');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-landing-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const { LandingFeatured, TTL_MS, MAX_AGE_MS, CACHE_FILE } = require('../server/services/landingFeatured');
const { LANDING_FEATURED } = require('../server/config/landingFeatured');

const DAY = 24 * 60 * 60 * 1000;

function fakeTmdb({ enabled = true, posters = {}, fail = false } = {}) {
  const calls = [];
  return {
    enabled,
    calls,
    async get(p) {
      calls.push(p);
      if (fail) throw new Error('rede caiu');
      const m = /^\/(tv|movie)\/(\d+)$/.exec(p);
      return { id: Number(m[2]), poster_path: posters[m[2]] === undefined ? '/abc123.jpg' : posters[m[2]] };
    }
  };
}
const make = (tmdb, clock, dir) =>
  new LandingFeatured({ tmdb, dataDir: dir || fs.mkdtempSync(path.join(DATA_DIR, 'c-')), now: () => clock.t });

test('a lista fixa tem 3 títulos reais (série, anime e filme) com ids do TMDB', () => {
  assert.deepEqual(
    LANDING_FEATURED.map(i => [i.type, i.kind, i.tmdbId, i.title]),
    [
      ['tv', 'tv', 224377, 'Harry Potter'],
      ['anime', 'tv', 31910, 'Naruto Shippuden'],
      ['movie', 'movie', 569094, 'Homem-Aranha: Através do Aranhaverso']
    ]
  );
});

test('sucesso: devolve tipo, título e pôster w342 do image.tmdb.org', async () => {
  const clock = { t: 1e12 };
  const svc = make(fakeTmdb(), clock);
  const data = await svc.get();
  assert.equal(data.length, 3);
  for (const item of data) {
    assert.deepEqual(Object.keys(item).sort(), ['posterUrl', 'title', 'type']);
    assert.equal(item.posterUrl, 'https://image.tmdb.org/t/p/w342/abc123.jpg');
  }
  assert.equal(data[1].title, 'Naruto Shippuden');
});

test('sem chave: títulos fixos sem posterUrl e nenhuma chamada', async () => {
  const tmdb = fakeTmdb({ enabled: false });
  const data = await make(tmdb, { t: 1e12 }).get();
  assert.deepEqual(
    data.map(d => d.posterUrl),
    [undefined, undefined, undefined]
  );
  assert.equal(data.length, 3);
  assert.equal(tmdb.calls.length, 0);
});

test('falha de rede: não lança, devolve só os títulos e não insiste por 1 minuto', async () => {
  const clock = { t: 1e12 };
  const tmdb = fakeTmdb({ fail: true });
  const svc = make(tmdb, clock);
  const data = await svc.get();
  assert.equal(data.length, 3);
  assert.ok(data.every(d => !('posterUrl' in d)));
  const n = tmdb.calls.length;
  await svc.get();
  assert.equal(tmdb.calls.length, n, 'não tenta de novo na hora');
  clock.t += 61 * 1000;
  await svc.get();
  assert.ok(tmdb.calls.length > n, 'tenta de novo depois de 1 minuto');
});

test('sem pôster no TMDB (ou caminho estranho): só o título', async () => {
  const tmdb = fakeTmdb({ posters: { 224377: null, 31910: 'http://evil.example/x.jpg', 569094: '/ok.png' } });
  const data = await make(tmdb, { t: 1e12 }).get();
  assert.equal(data[0].posterUrl, undefined);
  assert.equal(data[1].posterUrl, undefined);
  assert.equal(data[2].posterUrl, 'https://image.tmdb.org/t/p/w342/ok.png');
});

test('cache válido (7 dias) não chama o TMDB de novo, nem em outra instância (arquivo)', async () => {
  const clock = { t: 1e12 };
  const dir = fs.mkdtempSync(path.join(DATA_DIR, 'c-'));
  const tmdb = fakeTmdb();
  const a = make(tmdb, clock, dir);
  await a.get();
  assert.equal(tmdb.calls.length, 3);
  clock.t += TTL_MS - DAY;
  await a.get();
  assert.equal(tmdb.calls.length, 3);
  const raw = fs.readFileSync(path.join(dir, CACHE_FILE), 'utf-8');
  assert.ok(!/api_key|http/.test(raw), 'o arquivo guarda só o caminho do pôster');
  const tmdb2 = fakeTmdb();
  const data = await make(tmdb2, clock, dir).get();
  assert.equal(tmdb2.calls.length, 0);
  assert.ok(data.every(d => d.posterUrl));
});

test('cache vencido (> 7 dias) busca de novo; se falhar, usa o antigo até 6 meses; depois some', async () => {
  const clock = { t: 1e12 };
  const dir = fs.mkdtempSync(path.join(DATA_DIR, 'c-'));
  await make(fakeTmdb(), clock, dir).get();
  clock.t += TTL_MS + DAY;
  const novo = fakeTmdb({ posters: { 224377: '/novo.jpg', 31910: '/novo.jpg', 569094: '/novo.jpg' } });
  const svc = make(novo, clock, dir);
  assert.match((await svc.get())[0].posterUrl, /novo\.jpg$/);
  assert.equal(novo.calls.length, 3);

  const clock2 = { t: 1e12 };
  const dir2 = fs.mkdtempSync(path.join(DATA_DIR, 'c-'));
  await make(fakeTmdb(), clock2, dir2).get();
  clock2.t += 30 * DAY;
  const falho = make(fakeTmdb({ fail: true }), clock2, dir2);
  assert.match((await falho.get())[0].posterUrl, /abc123\.jpg$/, 'cópia antiga ainda vale se a fonte falha');
  clock2.t += MAX_AGE_MS;
  assert.equal((await falho.get())[0].posterUrl, undefined, 'passou de 6 meses: descartada');
});

test('arquivo de cache corrompido não derruba nada', async () => {
  const dir = fs.mkdtempSync(path.join(DATA_DIR, 'c-'));
  fs.writeFileSync(path.join(dir, CACHE_FILE), '{nao é json');
  const data = await make(fakeTmdb(), { t: 1e12 }, dir).get();
  assert.equal(data.length, 3);
});

test('GET /api/landing/featured: público, sem parâmetros, resposta pequena e sem erro mesmo sem chave', async () => {
  const app = require('../server/app');
  const controller = require('../server/controllers/landingController');
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/landing/featured`;
    controller.featuredLimiter.reset();
    controller.featured.tmdb = fakeTmdb({ enabled: false });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 3);
    assert.ok(JSON.stringify(body).length < 600);
    assert.ok(body.data.every(d => !d.posterUrl));

    controller.featured.tmdb = fakeTmdb();
    controller.featured.failedAt = 0;
    const ok = await (await fetch(url)).json();
    assert.match(ok.data[0].posterUrl, /^https:\/\/image\.tmdb\.org\/t\/p\/w342\//);

    // limite de taxa: passou do máximo, continua 200, sem erro
    for (let i = 0; i < 310; i++) await fetch(url);
    const limited = await fetch(url);
    assert.equal(limited.status, 200);
    assert.equal(limited.headers.get('cache-control'), 'no-store');
  } finally {
    server.close();
  }
});
