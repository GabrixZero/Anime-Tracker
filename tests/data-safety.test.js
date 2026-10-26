// Testes S02: migração de bibliotecas (D-11), leitura corrompida em UserModel/LibraryModel e rotas da API (login na ingestão, validação).
// Nada aqui escreve em server/data real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-safety-'));
process.env.SHOWVAULT_DATA_DIR = path.join(ROOT, 'singleton');
fs.mkdirSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true });
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

const { STATE_VERSION, migrateLibrary } = require('../public/js/utils/migrations');
const { LibraryModel } = require('../server/models/LibraryModel');
const { UserModel } = require('../server/models/UserModel');
const { DataCorruptionError } = require('../server/utils/errors');
const RateLimiter = require('../server/utils/rateLimiter');
const { issueToken } = require('../server/middleware/auth');

let counter = 0;
const newDir = () => {
  const dir = path.join(ROOT, `case-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const watched = (extra = {}) => ({ watched: true, watchedAt: '2026-10-20T00:00:00Z', rewatchCount: 1, ...extra });
const note = { text: 'x', emotion: null, character: '', updatedAt: '', snapshots: [] };

function oldLibrary() {
  return {
    trackedShows: [
      { showId: 1396, status: 'watching', addedAt: 'a' },
      { showId: 555, status: 'watching', addedAt: 'a' },
      { showId: 13615, status: 'plan_to_watch', addedAt: 'a' },
      { showId: 495, status: 'completed', addedAt: 'a' },
      { showId: 155, status: 'watching', addedAt: 'a' }
    ],
    watchedEpisodes: {
      '1396_s1_e1': watched(), '555_s1_e1': watched(), '13615_s2_e3': watched(), '495_s1_e1': watched(),
      '155_s1_e1': watched(), '155_s4_e12': watched(), '5550_s1_e1': watched(), '1555_s1_e1': watched()
    },
    episodeNotes: { '1396_s1_e1': note, '495_s1_e2': note, '155_s2_e1': note, '55_s1_e1': note }
  };
}

// --- Migração ---------------------------------------------------------------------------------------------------------

test('migração v1 -> v2 remove só as referências às 4 obras antigas e preserva o resto', () => {
  const input = oldLibrary();
  const snapshot = JSON.stringify(input);
  const { data, changed, removed } = migrateLibrary(input, 1);

  assert.equal(changed, true);
  assert.equal(JSON.stringify(input), snapshot, 'não altera o objeto recebido');
  assert.deepEqual(data.trackedShows.map(t => t.showId), [1396]);
  assert.deepEqual(Object.keys(data.watchedEpisodes).sort(), ['1396_s1_e1', '1555_s1_e1', '5550_s1_e1']);
  assert.deepEqual(Object.keys(data.episodeNotes).sort(), ['1396_s1_e1', '55_s1_e1']);
  assert.deepEqual(removed, { trackedShows: 4, watchedEpisodes: 5, episodeNotes: 2 });
});

test('migração: 155_movie (Batman TMDB) fica; 155_sX_eY (série antiga) sai', () => {
  const lib = {
    trackedShows: [{ showId: 155, status: 'completed', addedAt: 'a' }],
    watchedEpisodes: { '155_movie': watched(), '155_s1_e1': watched() },
    episodeNotes: { '155_movie': note, '155_s1_e2': note }
  };
  const { data } = migrateLibrary(lib, 1);
  assert.deepEqual(Object.keys(data.watchedEpisodes), ['155_movie']);
  assert.deepEqual(Object.keys(data.episodeNotes), ['155_movie']);
  assert.deepEqual(data.trackedShows.map(t => t.showId), [155], 'com prova do Batman, a obra 155 na lista fica');
});

test('migração: showId 155 sem nenhuma prova da série antiga é mantido (padrão conservador)', () => {
  const lib = { trackedShows: [{ showId: 155, status: 'watching', addedAt: 'a' }], watchedEpisodes: {}, episodeNotes: {} };
  assert.equal(migrateLibrary(lib, 1).data.trackedShows.length, 1);
  assert.equal(migrateLibrary(lib, 1).changed, false);
});

test('migração é idempotente, ignora versões atuais e não apaga bibliotecas inteiras', () => {
  const once = migrateLibrary(oldLibrary(), 1).data;
  const twice = migrateLibrary(once, 1);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.data, once);

  const untouched = migrateLibrary(oldLibrary(), STATE_VERSION);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.data.trackedShows.length, 5);

  const onlyOld = { trackedShows: [{ showId: 555, status: 'watching', addedAt: 'a' }], watchedEpisodes: {}, episodeNotes: {} };
  const out = migrateLibrary(onlyOld, undefined).data;
  assert.deepEqual(out, { trackedShows: [], watchedEpisodes: {}, episodeNotes: {} });
});

test('LibraryModel.get migra uma biblioteca antiga e grava a versão nova', () => {
  const lib = new LibraryModel(newDir());
  fs.mkdirSync(lib.dir, { recursive: true });
  fs.writeFileSync(path.join(lib.dir, 'usr_a1.json'), JSON.stringify({ ...oldLibrary(), updatedAt: '2026-10-01T00:00:00Z' }));

  const got = lib.get('usr_a1');
  assert.deepEqual(got.trackedShows.map(t => t.showId), [1396]);
  assert.equal(got.schemaVersion, STATE_VERSION);
  assert.equal(got.updatedAt, '2026-10-01T00:00:00Z');
  const onDisk = JSON.parse(fs.readFileSync(path.join(lib.dir, 'usr_a1.json'), 'utf-8'));
  assert.equal(onDisk.schemaVersion, STATE_VERSION);
  assert.equal(onDisk.trackedShows.length, 1);
});

test('LibraryModel.save: cliente antigo (sem versão) é migrado; cliente v2 não perde dados', () => {
  const lib = new LibraryModel(newDir());
  lib.save('usr_b1', oldLibrary());
  assert.deepEqual(lib.get('usr_b1').trackedShows.map(t => t.showId), [1396]);

  const v2 = { trackedShows: [{ showId: 555, status: 'watching', addedAt: 'a' }], watchedEpisodes: {}, episodeNotes: {} };
  lib.save('usr_b2', v2, { stateVersion: STATE_VERSION });
  assert.deepEqual(lib.get('usr_b2').trackedShows.map(t => t.showId), [555], 'versão atual não é filtrada');
});

test('LibraryModel.migrateAll migra os arquivos antigos, pula os corrompidos sem tocá-los', () => {
  const lib = new LibraryModel(newDir());
  fs.mkdirSync(lib.dir, { recursive: true });
  fs.writeFileSync(path.join(lib.dir, 'usr_old.json'), JSON.stringify(oldLibrary()));
  fs.writeFileSync(path.join(lib.dir, 'usr_bad.json'), '{corrompido');
  lib.save('usr_new', { trackedShows: [], watchedEpisodes: {}, episodeNotes: {} }, { stateVersion: STATE_VERSION });

  const summary = lib.migrateAll();
  assert.deepEqual(summary, { migrated: 1, skipped: 1, failed: 1 });
  assert.equal(fs.readFileSync(path.join(lib.dir, 'usr_bad.json'), 'utf-8'), '{corrompido');
  assert.equal(lib.get('usr_old').trackedShows.length, 1);
});

// --- Leitura corrompida -------------------------------------------------------------------------------------------------

test('LibraryModel: biblioteca corrompida não vira vazia; salvar preserva uma cópia do arquivo quebrado', () => {
  const lib = new LibraryModel(newDir());
  fs.mkdirSync(lib.dir, { recursive: true });
  const file = path.join(lib.dir, 'usr_c1.json');
  fs.writeFileSync(file, '{"trackedShows": [');

  assert.throws(() => lib.get('usr_c1'), err => err instanceof DataCorruptionError);
  assert.equal(fs.readFileSync(file, 'utf-8'), '{"trackedShows": [', 'leitura não altera o arquivo');

  lib.save('usr_c1', { trackedShows: [{ showId: 1, status: 'watching', addedAt: 'a' }], watchedEpisodes: {}, episodeNotes: {} }, { stateVersion: STATE_VERSION });
  const copies = fs.readdirSync(lib.dir).filter(f => f.startsWith('usr_c1.json.corrupt-'));
  assert.equal(copies.length, 1);
  assert.equal(fs.readFileSync(path.join(lib.dir, copies[0]), 'utf-8'), '{"trackedShows": [');
});

test('LibraryModel: biblioteca corrompida com .bak válido é recuperada', () => {
  const lib = new LibraryModel(newDir());
  lib.save('usr_d1', { trackedShows: [{ showId: 7, status: 'watching', addedAt: 'a' }], watchedEpisodes: {}, episodeNotes: {} }, { stateVersion: STATE_VERSION });
  lib.save('usr_d1', { trackedShows: [{ showId: 8, status: 'watching', addedAt: 'a' }], watchedEpisodes: {}, episodeNotes: {} }, { stateVersion: STATE_VERSION });
  fs.writeFileSync(path.join(lib.dir, 'usr_d1.json'), 'lixo');
  assert.deepEqual(lib.get('usr_d1').trackedShows.map(t => t.showId), [7]);
});

test('UserModel: users.json corrompido NÃO vira lista vazia nem é sobrescrito pelo próximo cadastro', async () => {
  const dir = newDir();
  const users = new UserModel(dir);
  await users.create({ name: 'A', email: 'a@exemplo.test', password: 'senha-de-teste-1' });
  await users.create({ name: 'B', email: 'b@exemplo.test', password: 'senha-de-teste-2' });
  const file = path.join(dir, 'users.json');
  fs.writeFileSync(file, '[{"id": "usr_x", ');
  const broken = fs.readFileSync(file, 'utf-8');

  // há .bak (versão com 1 usuário, a anterior ao 2º create): recupera
  assert.equal(users.getAll().length, 1);

  fs.rmSync(`${file}.bak`);
  assert.throws(() => users.getAll(), err => err instanceof DataCorruptionError);
  await assert.rejects(() => users.create({ name: 'C', email: 'c@exemplo.test', password: 'senha-de-teste-3' }), err => err.code === 'DATA_CORRUPT');
  assert.throws(() => users.findByEmail('a@exemplo.test'), err => err.code === 'DATA_CORRUPT');
  assert.equal(fs.readFileSync(file, 'utf-8'), broken, 'arquivo corrompido continua intacto');
  assert.equal(fs.readdirSync(dir).some(f => f.startsWith('users.json.corrupt-')), true);
});

test('UserModel: grava de forma atômica (sem .tmp) e cria users.json vazio quando não existe', async () => {
  const dir = newDir();
  const users = new UserModel(dir);
  assert.deepEqual(users.getAll(), []);
  await users.create({ name: 'A', email: 'a@exemplo.test', password: 'senha-de-teste-1' });
  assert.equal(fs.readdirSync(dir).some(f => f.endsWith('.tmp')), false);
  assert.equal(users.findByEmail('A@EXEMPLO.test').name, 'A');
});

test('RateLimiter: bloqueia depois do máximo e libera depois da janela', () => {
  const rl = new RateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(rl.hit('u', 0).ok, true);
  assert.equal(rl.hit('u', 10).ok, true);
  const blocked = rl.hit('u', 20);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(rl.hit('outro', 20).ok, true);
  assert.equal(rl.hit('u', 1100).ok, true);
});

// --- Rotas da API ---------------------------------------------------------------------------------------------------------

test('API: ingestão exige login, leitura é pública, entradas inválidas dão 400', async (t) => {
  const app = require('../server/app');
  const mediaService = require('../server/services/mediaService');
  const { ingestLimiter } = require('../server/controllers/mediaController');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const fetchCalls = [];
  mediaService.fetchJson = async (url) => {
    fetchCalls.push(url);
    const id = Number(/shows\/(\d+)/.exec(url)[1]);
    return { id, name: `Série ${id}`, type: 'Scripted', summary: '<p>ok</p>', genres: ['Drama'], _embedded: { episodes: [{ season: 1, number: 1, name: 'E1', runtime: 30 }] } };
  };
  const token = issueToken({ id: 'usr_teste_api' });
  const auth = { Authorization: `Bearer ${token}` };
  const json = async (res) => ({ status: res.status, body: await res.json() });
  const post = (body, headers = {}) => fetch(`${base}/media/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  // leitura pública de obra existente
  assert.equal((await fetch(`${base}/media/trending`)).status, 200);
  const batman = await json(await fetch(`${base}/media/155`));
  assert.equal(batman.status, 200);
  assert.equal(batman.body.data.type, 'movie');

  // ingestão sem login
  assert.equal((await post({ id: 1000300 })).status, 401);
  const anonGet = await json(await fetch(`${base}/media/1000300`));
  assert.equal(anonGet.status, 401);
  assert.equal(anonGet.body.code, 'LOGIN_REQUIRED');
  assert.equal((await fetch(`${base}/media/1000300`, { headers: { Authorization: 'Bearer lixo' } })).status, 401);
  assert.equal(fetchCalls.length, 0, 'visitante nunca dispara a fonte externa');
  assert.equal(mediaService.findLocal(1000300), null);

  // ingestão com login (POST e GET)
  const posted = await json(await post({ id: 1000300 }, auth));
  assert.equal(posted.status, 200);
  assert.equal(posted.body.data.id, 1000300);
  const got = await json(await fetch(`${base}/media/1000301`, { headers: auth }));
  assert.equal(got.status, 200);
  assert.equal(fetchCalls.length, 2);

  // depois de ingerida, a leitura volta a ser pública
  assert.equal((await fetch(`${base}/media/1000300`)).status, 200);
  assert.equal(fetchCalls.length, 2);

  // ids inválidos / inexistentes
  assert.equal((await post({ id: 'abc' }, auth)).status, 400);
  assert.equal((await post({ id: -5 }, auth)).status, 400);
  assert.equal((await post({}, auth)).status, 400);
  assert.equal((await post({ id: [1, 2] }, auth)).status, 400);
  assert.equal((await fetch(`${base}/media/abc`)).status, 400);
  assert.equal((await fetch(`${base}/media/1.5`)).status, 400);
  assert.equal((await fetch(`${base}/media/999999`)).status, 404, 'faixa do seed fora do catálogo');
  assert.equal(fetchCalls.length, 2);

  // q e type
  assert.equal((await fetch(`${base}/media/search?q=a&q=b`)).status, 400);
  assert.equal((await fetch(`${base}/media/search?q=${'a'.repeat(101)}`)).status, 400);
  assert.equal((await fetch(`${base}/media/search?type=banana`)).status, 400);
  assert.equal((await fetch(`${base}/media/search?type=tv&type=anime`)).status, 400);
  assert.equal((await fetch(`${base}/media/trending?type=banana`)).status, 400);
  const ok = await json(await fetch(`${base}/media/search?q=batman&type=movie`));
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.some(m => m.id === 155));

  // limite de ingestões por usuário
  ingestLimiter.reset();
  ingestLimiter.max = 2;
  assert.equal((await post({ id: 1000401 }, auth)).status, 200);
  assert.equal((await post({ id: 1000402 }, auth)).status, 200);
  const limited = await post({ id: 1000403 }, auth);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal((await post({ id: 1000401 }, auth)).status, 200, 'obra já existente não conta no limite');
});

test('API: arquivo de usuários corrompido responde 503 e não é sobrescrito', async (t) => {
  const app = require('../server/app');
  const UserModelSingleton = require('../server/models/UserModel');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;

  fs.writeFileSync(UserModelSingleton.filePath, '[{"id":');
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'novo@exemplo.test', password: 'senha-de-teste-9' })
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'DATA_CORRUPT');
  assert.equal(fs.readFileSync(UserModelSingleton.filePath, 'utf-8'), '[{"id":');

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'novo@exemplo.test', password: 'senha-de-teste-9' })
  });
  assert.equal(login.status, 503);
});
