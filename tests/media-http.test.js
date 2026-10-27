// Rotas /api/media (S06): avisos de fontes, erro 429 da fonte externa com Retry-After, limite de buscas por IP,
// ingestão exige login. Fontes externas SIMULADAS (nenhuma requisição real); tudo em diretório temporário.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-mediahttp-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const app = require('../server/app');
const mediaService = require('../server/services/mediaService');
const mediaController = require('../server/controllers/mediaController');
const { mediaErrors } = require('../server/utils/errors');

let server;
let base;
test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/media`;
  for (const client of [mediaService.anilist, mediaService.jikan]) { client.minIntervalMs = 0; client.retries = 0; }
  mediaService.sleep = async () => {};
});
test.after(() => server.close());
test.beforeEach(() => {
  mediaController.searchLimiter.reset();
  mediaService.cache.clear();
  for (const client of [mediaService.anilist, mediaService.jikan]) { client.cache.clear(); client.breaker.success(); }
});

test('busca devolve resultados e a lista de avisos (fonte que falhou não derruba a resposta)', async () => {
  mediaService.fetchJson = async (url) => {
    if (url.includes('anilist') || url.includes('jikan')) throw mediaErrors.upstream();
    return [{ show: { id: 77, name: 'Zzyzx Show', type: 'Scripted', genres: [], status: 'Running' } }];
  };
  const res = await fetch(`${base}/search?q=zzyzx&type=all`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.data[0].name, 'Zzyzx Show');
  assert.equal(body.data[0].status, 'Em Exibição');
  assert.equal(body.data[0].vote_average, null);
  assert.deepEqual(body.warnings.map(w => w.source), ['anilist', 'jikan'], 'AniList caiu, a reserva (Jikan) também: um aviso por fonte');
  assert.ok(body.warnings.every(w => w.code === 'UPSTREAM' && !w.fallback));
});

test('todas as fontes limitadas (429) e nada local: HTTP 429 com mensagem em português e Retry-After', async () => {
  mediaService.fetchJson = async () => { throw mediaErrors.rateLimited(7000); };
  const res = await fetch(`${base}/search?q=qwertyuiop&type=all`);
  const body = await res.json();
  assert.equal(res.status, 429);
  assert.equal(body.code, 'RATE_LIMITED');
  assert.equal(res.headers.get('retry-after'), '7');
  assert.match(body.error, /aguardar|instantes/);
});

test('limite de buscas por IP: depois de 60 em 1 minuto responde 429 sem consultar as fontes', async () => {
  let calls = 0;
  mediaService.fetchJson = async () => { calls++; return []; };
  let last;
  for (let i = 0; i < 61; i++) last = await fetch(`${base}/search?q=abc${i}&type=tv`);
  assert.equal(last.status, 429);
  assert.equal((await last.json()).code, 'TOO_MANY_REQUESTS');
  assert.equal(calls, 60);
});

test('ingestão de anime exige login (401) e id fora das faixas é 404, sem rede', async () => {
  let calls = 0;
  mediaService.fetchJson = async () => { calls++; return {}; };
  const res = await fetch(`${base}/10000020`);
  assert.equal(res.status, 401);
  const post = await fetch(`${base}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 10000020 }) });
  assert.equal(post.status, 401);
  assert.equal(calls, 0);
  assert.equal((await fetch(`${base}/5000000`)).status, 404);
});
