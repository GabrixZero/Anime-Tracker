// Rotas HTTP gerais (S10): /health, 404 de API, arquivos estáticos e fallback, catálogo (sem rede) e
// casos de borda da biblioteca (corpo quebrado, grande demais, conta que deixou de existir).
// Roda em pasta temporária (SHOWVAULT_DATA_DIR); nenhuma chamada a fontes externas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-routes-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.STORAGE;
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const app = require('../server/app');
const UserModel = require('../server/models/UserModel');
const { issueToken } = require('../server/middleware/auth');

let server;
let base;
test.before(async () => {
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const empty = () => ({ trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: { shows: {}, watched: {}, notes: {} } });

test('/health responde ok sem login, sem cache e sem expor dados', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['status', 'storage', 'uptimeSec']);
  assert.equal(body.status, 'ok');
  assert.equal(body.storage, 'json');
  assert.equal((await fetch(`${base}/health`, { method: 'HEAD' })).status, 200);
});

test('rota /api desconhecida responde 404 em JSON (não o index.html)', async () => {
  for (const [method, route] of [
    ['GET', '/api/nao-existe'],
    ['POST', '/api/media/xyz/abc'],
    ['DELETE', '/api']
  ]) {
    const res = await fetch(`${base}${route}`, { method });
    assert.equal(res.status, 404, `${method} ${route}`);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.ok((await res.json()).error);
  }
});

test('arquivos estáticos e fallback da SPA', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const html = await index.text();
  assert.match(html, /<title>/);

  const css = await fetch(`${base}/css/variables.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const placeholder = await fetch(`${base}/img/poster-placeholder.svg`);
  assert.equal(placeholder.status, 200);

  // rota desconhecida (não /api) volta para a página inicial
  const fallback = await fetch(`${base}/qualquer/coisa`);
  assert.equal(fallback.status, 200);
  assert.equal(await fallback.text(), html);

  // não serve o código/dados do servidor
  for (const p of ['/server/data/users.json', '/server.js', '/package.json', '/../server.js', '/%2e%2e/server.js']) {
    const r = await fetch(`${base}${p}`);
    const text = await r.text();
    assert.ok(!text.includes('require('), `${p} não pode expor código do servidor`);
    assert.ok(!text.includes('"dependencies"'), `${p} não pode expor o package.json`);
  }
});

test('catálogo: destaques por tipo, obra do seed e erros de entrada (sem rede)', async () => {
  const all = await (await fetch(`${base}/api/media/trending`)).json();
  assert.equal(all.count, all.data.length);
  assert.ok(all.count >= 10);

  const movies = await (await fetch(`${base}/api/media/trending?type=movie`)).json();
  assert.ok(movies.data.length > 0 && movies.data.every(m => m.type === 'movie'));

  assert.equal((await fetch(`${base}/api/media/trending?type=musica`)).status, 400);
  assert.equal((await fetch(`${base}/api/media/search?q=${'a'.repeat(101)}`)).status, 400);
  assert.equal((await fetch(`${base}/api/media/search?type=xyz`)).status, 400);
  assert.equal((await fetch(`${base}/api/media/search?q=a&q=b`)).status, 400);

  // busca vazia = catálogo local (sem consultar fontes externas)
  const empty = await fetch(`${base}/api/media/search?q=`);
  assert.equal(empty.status, 200);

  const known = await (await fetch(`${base}/api/media/1396`)).json();
  assert.equal(known.data.id, 1396);
  assert.ok(Array.isArray(known.data.seasons));
  assert.equal((await fetch(`${base}/api/media/abc`)).status, 400);
  assert.equal((await fetch(`${base}/api/media/0`)).status, 400);
  assert.equal((await fetch(`${base}/api/media/99999`)).status, 404);
});

test('POST /api/media/ingest: exige login e id', async () => {
  const post = (headers = {}, body = '{}') =>
    fetch(`${base}/api/media/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post()).status, 401);
  const user = await UserModel.create({ name: 'Rotas', email: 'rotas@exemplo.test', password: 'senha-de-teste-1' });
  const auth = { Authorization: `Bearer ${issueToken(user)}` };
  assert.equal((await post(auth)).status, 400);
});

test('biblioteca: corpo quebrado, grande demais e sem data dão erro 4xx claro (nunca 500)', async () => {
  const user = await UserModel.create({ name: 'Biblioteca', email: 'biblioteca@exemplo.test', password: 'senha-de-teste-1' });
  const headers = { Authorization: `Bearer ${issueToken(user)}`, 'Content-Type': 'application/json' };
  const url = `${base}/api/user/library`;
  const put = body => fetch(url, { method: 'PUT', headers, body });

  const broken = await put('{"data": {');
  assert.equal(broken.status, 400);
  assert.ok((await broken.json()).error);

  assert.equal((await put('{}')).status, 400);
  assert.equal((await put(JSON.stringify({ data: [] }))).status, 400);
  assert.equal((await put(JSON.stringify({ data: { ...empty(), trackedShows: [{ showId: 'x' }] } }))).status, 400);

  const big = JSON.stringify({ data: { ...empty(), episodeNotes: { '1_s1_e1': { text: 'x'.repeat(3 * 1024 * 1024) } } } });
  assert.equal((await put(big)).status, 413);

  const ok = await put(JSON.stringify({ data: empty(), stateVersion: 2 }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(Date.parse(body.updatedAt) > 0);
  assert.deepEqual(body.data.trackedShows, []);
  assert.equal((await fetch(url, { headers })).status, 200);
});

test('biblioteca: token de conta que deixou de existir ou token inválido = 401', async () => {
  const user = await UserModel.create({ name: 'Efêmera', email: 'efemera@exemplo.test', password: 'senha-de-teste-1' });
  const token = issueToken(user);
  const get = t => fetch(`${base}/api/user/library`, { headers: { Authorization: `Bearer ${t}` } });
  assert.equal((await get(token)).status, 200);
  UserModel.delete(user.id);
  assert.equal((await get(token)).status, 401);
  assert.equal((await get('lixo.lixo.lixo')).status, 401);
  assert.equal((await fetch(`${base}/api/user/library`, { headers: { Authorization: 'Basic abc' } })).status, 401);
});
