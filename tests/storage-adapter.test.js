// Testes do adaptador de armazenamento (S10): SqliteStore, roteamento de documentos e paridade com o jsonStore.
// Sempre em diretórios temporários; nunca toca em server/data real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { SqliteStore } = require('../server/storage/sqliteStore');
const { createStorage, locate } = require('../server/storage');
const { DataCorruptionError } = require('../server/utils/errors');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-storage-'));
const cleanup = (...dirs) => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));

test('SqliteStore: grava, lê, versiona o carimbo e guarda a versão anterior', (t) => {
  const dir = tmp();
  const store = new SqliteStore(path.join(dir, 'x.sqlite'));
  t.after(() => { store.close(); cleanup(dir); });

  assert.equal(store.read('users.json'), null);
  assert.equal(store.stamp('users.json'), 'missing');

  store.write('users.json', [{ id: 'usr_1' }]);
  const s1 = store.stamp('users.json');
  assert.deepEqual(store.read('users.json'), { data: [{ id: 'usr_1' }], recovered: false });

  store.write('users.json', [{ id: 'usr_1' }, { id: 'usr_2' }]);
  assert.notEqual(store.stamp('users.json'), s1, 'o carimbo muda a cada gravação');
  assert.equal(store.read('users.json').data.length, 2);

  assert.throws(() => store.write('k', undefined), /serializ/);
  assert.equal(store.read('k'), null, 'gravação inválida não cria documento');
});

test('SqliteStore: documento ilegível volta da versão anterior; sem ela lança DataCorruptionError (nunca "vazio")', (t) => {
  const dir = tmp();
  const store = new SqliteStore(path.join(dir, 'x.sqlite'));
  t.after(() => { store.close(); cleanup(dir); });

  store.write('libraries/usr_a.json', { v: 1 });
  store.write('libraries/usr_a.json', { v: 2 });
  store.db.prepare('UPDATE documents SET data = ? WHERE key = ?').run('{quebrado', 'libraries/usr_a.json');
  const recovered = store.read('libraries/usr_a.json');
  assert.deepEqual(recovered, { data: { v: 1 }, recovered: true });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM corrupt').get().n, 1, 'guarda cópia do documento quebrado');
  store.read('libraries/usr_a.json');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM corrupt').get().n, 1, 'não duplica a cópia a cada leitura');

  // uma nova gravação não promove o documento quebrado a "versão anterior"
  store.write('libraries/usr_a.json', { v: 3 });
  assert.deepEqual(store.read('libraries/usr_a.json').data, { v: 3 });
  assert.equal(store.db.prepare('SELECT prev FROM documents WHERE key = ?').get('libraries/usr_a.json').prev, '{"v":1}');

  // sem versão anterior válida: erro, não lista vazia
  store.write('users.json', []);
  store.db.prepare('UPDATE documents SET data = ? WHERE key = ?').run('nao-e-json', 'users.json');
  assert.throws(() => store.read('users.json'), DataCorruptionError);
});

test('SqliteStore: list por prefixo, remove apaga também as cópias, insertIfAbsent não sobrescreve e transaction reverte', (t) => {
  const dir = tmp();
  const store = new SqliteStore(path.join(dir, 'x.sqlite'));
  t.after(() => { store.close(); cleanup(dir); });

  store.write('libraries/usr_b.json', {});
  store.write('libraries/usr_a.json', {});
  store.write('users.json', []);
  assert.deepEqual(store.list('libraries/'), ['libraries/usr_a.json', 'libraries/usr_b.json']);
  assert.deepEqual(store.list(''), ['libraries/usr_a.json', 'libraries/usr_b.json', 'users.json']);

  store.db.prepare('INSERT INTO corrupt (key, data, at) VALUES (?, ?, ?)').run('libraries/usr_a.json', 'x', 'now');
  assert.equal(store.remove('libraries/usr_a.json'), true);
  assert.equal(store.remove('libraries/usr_a.json'), false);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM corrupt').get().n, 0);

  assert.equal(store.insertIfAbsent('users.json', '[1]'), false);
  assert.deepEqual(store.read('users.json').data, []);
  assert.throws(() => store.insertIfAbsent('novo', '{ruim'), /JSON inválido/);

  assert.throws(() => store.transaction(() => { store.write('t', { a: 1 }); throw new Error('falha'); }), /falha/);
  assert.equal(store.read('t'), null, 'transação com erro não grava nada');
});

test('SqliteStore: dados persistem ao reabrir o arquivo', (t) => {
  const dir = tmp();
  t.after(() => cleanup(dir));
  const file = path.join(dir, 'x.sqlite');
  const a = new SqliteStore(file);
  a.write('users.json', [{ id: 'usr_1', nome: 'Ação ✓' }]);
  a.close();
  const b = new SqliteStore(file);
  assert.deepEqual(b.read('users.json').data, [{ id: 'usr_1', nome: 'Ação ✓' }]);
  b.close();
});

test('locate: só users.json, libraries/usr_*.json e o catálogo de runtime vão para o banco', () => {
  const d = path.resolve('/dados');
  assert.deepEqual(locate(path.join(d, 'users.json')), { dataDir: d, key: 'users.json' });
  assert.deepEqual(locate(path.join(d, 'mediaCatalog.runtime.json')), { dataDir: d, key: 'mediaCatalog.runtime.json' });
  assert.deepEqual(locate(path.join(d, 'libraries', 'usr_1_ab.json')), { dataDir: d, key: 'libraries/usr_1_ab.json' });
  assert.equal(locate(path.join(d, 'mediaCatalog.seed.json')), null);
  assert.equal(locate(path.join(d, 'users.example.json')), null);
  assert.equal(locate(path.join(d, 'jwt.secret')), null);
  assert.equal(locate(path.join(d, 'libraries', 'usr_1.json.bak')), null);
  assert.equal(locate(path.join(d, 'libraries', '..', 'x.json')), null);
});

test('adaptador SQLite: documentos de dados vão para o banco, o resto continua em arquivo', (t) => {
  const dir = tmp();
  const storage = createStorage('sqlite');
  t.after(() => { storage.close(); cleanup(dir); });

  const users = path.join(dir, 'users.json');
  const lib = path.join(dir, 'libraries', 'usr_x.json');
  const seed = path.join(dir, 'mediaCatalog.seed.json');

  assert.equal(storage.readJson(users), null);
  storage.writeJsonAtomic(users, [{ id: 'usr_x' }], { pretty: true });
  storage.writeJsonAtomic(lib, { trackedShows: [] }, { pretty: false });
  storage.writeJsonAtomic(seed, [{ id: 1 }]);

  assert.equal(fs.existsSync(users), false, 'users.json não é criado como arquivo');
  assert.equal(fs.existsSync(path.dirname(lib)), false, 'a pasta libraries não é criada');
  assert.equal(fs.existsSync(seed), true, 'seed continua sendo arquivo');
  assert.ok(fs.existsSync(path.join(dir, 'showvault.sqlite')));

  assert.deepEqual(storage.readJson(users).data, [{ id: 'usr_x' }]);
  assert.deepEqual(storage.listNames(path.join(dir, 'libraries'), /^usr_[A-Za-z0-9_]+\.json$/), ['usr_x.json']);
  assert.equal(storage.stamp(users) === storage.stamp(users), true);
  const before = storage.stamp(users);
  storage.writeJsonAtomic(users, []);
  assert.notEqual(storage.stamp(users), before);

  assert.equal(storage.removeAll(lib), 1);
  assert.equal(storage.removeAll(lib), 0);
  assert.deepEqual(storage.listNames(path.join(dir, 'libraries'), /./), []);
});

test('adaptador JSON (padrão): mesmos métodos, em arquivos', (t) => {
  const dir = tmp();
  const storage = createStorage('json');
  t.after(() => cleanup(dir));

  const lib = path.join(dir, 'libraries', 'usr_y.json');
  assert.equal(storage.readJson(lib), null);
  storage.writeJsonAtomic(lib, { a: 1 });
  storage.writeJsonAtomic(lib, { a: 2 }); // cria .bak
  assert.deepEqual(storage.readJson(lib).data, { a: 2 });
  assert.deepEqual(storage.listNames(path.dirname(lib), /^usr_/).sort(), ['usr_y.json', 'usr_y.json.bak']);
  assert.notEqual(storage.stamp(lib), 'missing');
  assert.equal(storage.removeAll(lib), 2);
  assert.equal(storage.stamp(lib), 'missing');
  assert.deepEqual(storage.listNames(path.join(dir, 'nao-existe'), /./), []);
});

test('createStorage recusa modo desconhecido; STORAGE inválido derruba a config com mensagem clara', () => {
  assert.throws(() => createStorage('postgres'), /STORAGE inválido/);
  const run = (value) => {
    try {
      return { ok: true, out: execFileSync(process.execPath, ['-e', "console.log(require('./server/config/config').STORAGE)"], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, STORAGE: value, SHOWVAULT_DATA_DIR: os.tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() };
    } catch (err) {
      return { ok: false, err: String(err.stderr) };
    }
  };
  assert.deepEqual(run('sqlite'), { ok: true, out: 'sqlite' });
  assert.deepEqual(run('SQLite'), { ok: true, out: 'sqlite' });
  const bad = run('mongo');
  assert.equal(bad.ok, false);
  assert.match(bad.err, /STORAGE inválido/);
});
