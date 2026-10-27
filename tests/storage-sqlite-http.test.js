// Fluxo completo da API com STORAGE=sqlite (S10): cadastro, login, biblioteca, exclusão de conta, catálogo e /health,
// mais a partida real do servidor (server.js) migrando JSON antigos. Tudo em pasta temporária.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-sqlitehttp-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
process.env.STORAGE = 'sqlite';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
for (const k of ['AUTH_LOGIN_MAX', 'AUTH_LOGIN_IP_MAX', 'AUTH_REGISTER_MAX', 'AUTH_SENSITIVE_MAX']) process.env[k] = '1000';

const storage = require('../server/storage');
const app = require('../server/app');
const LibraryModel = require('../server/models/LibraryModel');

const PASS = 'senha-de-teste-1';
let server;
let base;
const cleanup = [DATA_DIR];
process.on('exit', () => cleanup.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); storage.close(); });

const api = async (method, route, { body, token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json };
};

test('modo sqlite: /health informa o armazenamento e nada vira arquivo JSON', async () => {
  const { status, body } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.storage, 'sqlite');
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'showvault.sqlite')));
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'users.json')), false);
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'mediaCatalog.runtime.json')), false);
});

test('modo sqlite: cadastro, login, biblioteca (PUT mescla, GET, DELETE) e exclusão de conta', async () => {
  const reg = await api('POST', '/api/auth/register', { body: { email: 'sqlite@exemplo.test', password: PASS, name: 'Teste SQLite' } });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  assert.equal((await api('POST', '/api/auth/register', { body: { email: 'SQLITE@exemplo.test', password: PASS } })).status, 409);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'sqlite@exemplo.test', password: 'errada-1234' } })).status, 401);
  const login = await api('POST', '/api/auth/login', { body: { email: 'sqlite@exemplo.test', password: PASS } });
  assert.equal(login.status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: login.body.token })).body.user.email, 'sqlite@exemplo.test');

  const t0 = new Date(Date.now() - 1000).toISOString();
  const data = { trackedShows: [{ showId: 1396, status: 'watching', addedAt: t0, updatedAt: t0 }], watchedEpisodes: {}, episodeNotes: {}, tombstones: { shows: {}, watched: {}, notes: {} } };
  assert.equal((await api('PUT', '/api/user/library', { token, body: { data, stateVersion: 2 } })).status, 200);
  const got = await api('GET', '/api/user/library', { token });
  assert.deepEqual(got.body.data.trackedShows.map(s => s.showId), [1396]);

  // a biblioteca está no banco, não em arquivo
  const userId = reg.body.user.id;
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'libraries')), false);
  assert.deepEqual(storage.storeFor(DATA_DIR).list('libraries/'), [`libraries/${userId}.json`]);

  assert.equal((await api('DELETE', '/api/user/library', { token })).status, 200);
  assert.deepEqual((await api('GET', '/api/user/library', { token })).body.data.trackedShows, []);

  // excluir a conta apaga usuário e biblioteca do banco
  const del = await api('DELETE', '/api/auth/account', { token, body: { password: PASS } });
  assert.equal(del.status, 200);
  assert.deepEqual(storage.storeFor(DATA_DIR).list('libraries/'), []);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'sqlite@exemplo.test', password: PASS } })).status, 401);
  assert.equal((await api('GET', '/api/user/library', { token })).status, 401);
});

test('modo sqlite: o catálogo vivo é gravado no banco e a lista/obra funcionam (sem rede)', async () => {
  const store = storage.storeFor(DATA_DIR);
  const catalog = store.read('mediaCatalog.runtime.json');
  assert.ok(catalog && Array.isArray(catalog.data) && catalog.data.length >= 10, 'catálogo copiado do seed para o banco');
  const item = await api('GET', '/api/media/1396');
  assert.equal(item.status, 200);
  assert.equal(item.body.data.id, 1396);
  const trending = await api('GET', '/api/media/trending');
  assert.equal(trending.status, 200);
  assert.ok(trending.body.data.some(m => m.id === 1396));
});

test('modo sqlite: LibraryModel.migrateAll percorre as bibliotecas do banco', () => {
  LibraryModel.save('usr_migra_1', { trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: { shows: {}, watched: {}, notes: {} } }, { stateVersion: 2 });
  const summary = LibraryModel.migrateAll();
  assert.equal(summary.failed, 0);
  assert.ok(summary.skipped >= 1);
});

// ---- Partida real do servidor: migra JSON antigos para o SQLite antes de subir ----

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

test('server.js com STORAGE=sqlite migra os JSON existentes, mantém as contas e responde /health', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-boot-'));
  cleanup.push(dir);
  // Dados "antigos" em JSON, criados pelo modelo no modo de arquivos (processo filho sem STORAGE).
  const seedScript = `
    const UserModel = require('./server/models/UserModel');
    const LibraryModel = require('./server/models/LibraryModel');
    UserModel.create({ name: 'Antigo', email: 'antigo@exemplo.test', password: '${PASS}' }).then(u => {
      LibraryModel.save(u.id, { trackedShows: [{ showId: 7, status: 'watching', addedAt: new Date().toISOString() }], watchedEpisodes: {}, episodeNotes: {}, tombstones: { shows: {}, watched: {}, notes: {} } }, { stateVersion: 2 });
      console.log(u.id);
    });`;
  const { execFileSync } = require('child_process');
  const cwd = path.join(__dirname, '..');
  const env = { ...process.env, SHOWVAULT_DATA_DIR: dir, NODE_ENV: 'test' };
  delete env.STORAGE;
  const userId = execFileSync(process.execPath, ['-e', seedScript], { cwd, env }).toString().trim();
  assert.ok(fs.existsSync(path.join(dir, 'users.json')));

  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], { cwd, env: { ...env, STORAGE: 'sqlite', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  t.after(() => new Promise(resolve => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 3000).unref(); }));

  const url = `http://127.0.0.1:${port}`;
  let health = null;
  for (let i = 0; i < 100 && !health; i++) {
    try { health = await (await fetch(`${url}/health`)).json(); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(health, `servidor não subiu:\n${output}`);
  assert.equal(health.storage, 'sqlite');
  assert.match(output, /Migração JSON -> SQLite: 1 usuário\(s\), 1 biblioteca\(s\)/);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('backup-pre-sqlite-')), 'backup criado');
  assert.ok(fs.existsSync(path.join(dir, 'users.json')), 'JSON original mantido');

  const login = await (await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'antigo@exemplo.test', password: PASS }) })).json();
  assert.equal(login.user.id, userId, 'a conta antiga entra com a mesma senha');
  const lib = await (await fetch(`${url}/api/user/library`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
  assert.deepEqual(lib.data.trackedShows.map(s => s.showId), [7]);
});
