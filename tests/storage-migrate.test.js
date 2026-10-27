// Migração dos JSON existentes para o SQLite (S10). Fixtures sintéticas em pasta temporária.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { migrateJsonToSqlite, exportSqliteToJson } = require('../server/storage/migrate');
const { SqliteStore } = require('../server/storage/sqliteStore');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-migrate-'));
// Bancos abertos pelo teste: fechados antes de apagar a pasta (no Windows o arquivo aberto não pode ser removido).
const opened = [];
const open = file => {
  const s = new SqliteStore(file);
  opened.push(s);
  return s;
};
const rm = (...dirs) => {
  opened.splice(0).forEach(s => s.close());
  dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
};
const quiet = { log() {}, warn() {} };
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};

function fixture(dir) {
  write(path.join(dir, 'users.json'), [
    { id: 'usr_1', email: 'a@exemplo.test' },
    { id: 'usr_2', email: 'b@exemplo.test' }
  ]);
  write(path.join(dir, 'users.json.bak'), [{ id: 'usr_1', email: 'a@exemplo.test' }]);
  write(path.join(dir, 'mediaCatalog.runtime.json'), [{ id: 1, name: 'A', type: 'tv' }]);
  write(path.join(dir, 'libraries', 'usr_1.json'), { trackedShows: [{ showId: 1 }], schemaVersion: 2 });
  write(path.join(dir, 'libraries', 'usr_2.json'), { trackedShows: [], schemaVersion: 2 });
  write(path.join(dir, 'libraries', 'usr_1.json.bak'), { trackedShows: [] });
  write(path.join(dir, 'users.example.json'), []); // não é dado do usuário: não entra
}

test('migra usuários, bibliotecas e catálogo; faz backup; mantém os originais', t => {
  const dir = tmp();
  t.after(() => rm(dir));
  fixture(dir);

  const r = migrateJsonToSqlite(dir, quiet);
  assert.equal(r.skipped, false);
  assert.equal(r.users, 2);
  assert.equal(r.libraries, 2);
  assert.equal(r.catalog, 1);
  assert.deepEqual(r.failed, []);

  // backup completo (principal + .bak), e os originais continuam onde estavam
  assert.ok(r.backupDir.startsWith(path.join(dir, 'backup-pre-sqlite-')));
  for (const rel of [
    'users.json',
    'users.json.bak',
    'mediaCatalog.runtime.json',
    'libraries/usr_1.json',
    'libraries/usr_1.json.bak',
    'libraries/usr_2.json'
  ]) {
    assert.ok(fs.existsSync(path.join(r.backupDir, ...rel.split('/'))), `backup de ${rel}`);
    assert.ok(fs.existsSync(path.join(dir, ...rel.split('/'))), `original ${rel} preservado`);
  }
  assert.equal(fs.existsSync(path.join(r.backupDir, 'users.example.json')), false);

  const store = open(path.join(dir, 'showvault.sqlite'));
  assert.deepEqual(store.list('').sort(), ['libraries/usr_1.json', 'libraries/usr_2.json', 'mediaCatalog.runtime.json', 'users.json']);
  assert.equal(store.read('users.json').data[1].id, 'usr_2');
  assert.equal(store.read('libraries/usr_1.json').data.trackedShows[0].showId, 1);
});

test('só roda uma vez; --force acrescenta sem sobrescrever o que o banco já tem', t => {
  const dir = tmp();
  t.after(() => rm(dir));
  fixture(dir);
  migrateJsonToSqlite(dir, quiet);

  const store = open(path.join(dir, 'showvault.sqlite'));
  store.write('users.json', [{ id: 'usr_novo' }]); // trabalho feito depois da migração
  store.close();

  const again = migrateJsonToSqlite(dir, quiet);
  assert.equal(again.skipped, true);

  const forced = migrateJsonToSqlite(dir, { ...quiet, force: true });
  assert.equal(forced.skipped, false);
  assert.ok(forced.existing >= 1);
  const check = open(path.join(dir, 'showvault.sqlite'));
  assert.deepEqual(check.read('users.json').data, [{ id: 'usr_novo' }], 'dados do banco nunca são sobrescritos pelos JSON antigos');
});

test('arquivo ilegível é pulado e relatado (a cópia fica no backup); usa o .bak quando existe', t => {
  const dir = tmp();
  t.after(() => rm(dir));
  write(path.join(dir, 'users.json'), '{isto nao e json');
  write(path.join(dir, 'users.json.bak'), [{ id: 'usr_9' }]);
  write(path.join(dir, 'libraries', 'usr_3.json'), '###');
  write(path.join(dir, 'libraries', 'usr_4.json'), { trackedShows: [] });

  const warnings = [];
  const r = migrateJsonToSqlite(dir, { log() {}, warn: m => warnings.push(m) });
  assert.deepEqual(
    r.failed.map(f => f.key),
    ['libraries/usr_3.json']
  );
  assert.equal(warnings.length, 1);
  assert.equal(r.users, 1, 'users.json ilegível voltou do .bak');
  assert.equal(fs.readFileSync(path.join(r.backupDir, 'libraries', 'usr_3.json'), 'utf8'), '###');

  const store = open(path.join(dir, 'showvault.sqlite'));
  assert.deepEqual(store.list('libraries/'), ['libraries/usr_4.json']);
});

test('pasta sem dados: marca como migrada, não cria backup nem falha', t => {
  const dir = tmp();
  t.after(() => rm(dir));
  const r = migrateJsonToSqlite(dir, quiet);
  assert.equal(r.backupDir, null);
  assert.equal(r.users, 0);
  assert.equal(
    fs.readdirSync(dir).some(n => n.startsWith('backup-pre-sqlite-')),
    false
  );
  assert.equal(migrateJsonToSqlite(dir, quiet).skipped, true);
});

test('exportar devolve o banco como JSON numa pasta separada (caminho de volta)', t => {
  const dir = tmp();
  const out = path.join(tmp(), 'saida');
  t.after(() => rm(dir, path.dirname(out)));
  fixture(dir);
  migrateJsonToSqlite(dir, quiet);

  const { count } = exportSqliteToJson(dir, out);
  assert.equal(count, 4);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(out, 'users.json'), 'utf8')).map(u => u.id),
    ['usr_1', 'usr_2']
  );
  assert.ok(fs.existsSync(path.join(out, 'libraries', 'usr_2.json')));
  assert.throws(() => exportSqliteToJson(dir, dir), /diferente/);
  assert.throws(() => exportSqliteToJson(path.join(dir, 'nada'), out), /não encontrado/);
});
