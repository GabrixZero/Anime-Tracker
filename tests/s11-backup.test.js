// S11: backup consistente do SQLite, rotação (7 diários + 4 semanais) e restauração com cópia de segurança.
// Bancos de teste em pastas temporárias; nada toca em server/data nem em %LOCALAPPDATA%/OneDrive reais.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync, execFile } = require('child_process');
const { promisify } = require('util');

const { SqliteStore } = require('../server/storage/sqliteStore');
const {
  BackupError,
  backupFileName,
  parseBackupName,
  inspectDatabase,
  listBackups,
  planRotation,
  rotateBackups,
  createBackup,
  restoreBackup,
  resolveBackupArgument
} = require('../server/storage/backup');

const REPO = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s11-backup-'));
const opened = [];
const rm = (...dirs) => {
  opened.splice(0).forEach(s => s.close()); // no Windows um banco aberto não pode ser apagado
  dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
};

// Banco no formato do servidor (a mesma classe que o app usa).
function makeDb(dir, { users = 2, libraries = 2, catalog = 3 } = {}) {
  const store = new SqliteStore(path.join(dir, 'showvault.sqlite'));
  opened.push(store);
  store.write(
    'users.json',
    Array.from({ length: users }, (_, i) => ({ id: `usr_${i + 1}` }))
  );
  for (let i = 1; i <= libraries; i++) store.write(`libraries/usr_${i}.json`, { trackedShows: [{ showId: i }] });
  store.write(
    'mediaCatalog.runtime.json',
    Array.from({ length: catalog }, (_, i) => ({ id: i + 1, name: `Obra ${i + 1}` }))
  );
  return store;
}

const at = (y, mo, d, h = 4, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);
const touch = (dir, name) => fs.writeFileSync(path.join(dir, name), 'x');

// ---- nomes ----

test('nome do backup: ida e volta em hora local; nomes que não são nossos são ignorados', () => {
  const date = at(2026, 10, 27, 4, 5, 9);
  assert.equal(backupFileName(date), 'showvault-2026-10-27_040509.sqlite');
  assert.deepEqual(parseBackupName('showvault-2026-10-27_040509.sqlite'), date);
  for (const bad of [
    'showvault-2026-13-01_000000.sqlite', // mês impossível
    'showvault-2026-02-30_000000.sqlite', // dia impossível
    'showvault-2026-10-27_040509.sqlite.part',
    'showvault-2026-10-27_040509.db',
    'showvault-ANTES-DA-RESTAURACAO-2026-10-27_153000.sqlite',
    'meu-showvault-2026-10-27_040509.sqlite',
    'notas.txt'
  ]) {
    assert.equal(parseBackupName(bad), null, bad);
  }
});

// ---- backup ----

test('createBackup: foto consistente com o banco ABERTO e em uso; o backup não muda quando o banco muda depois', t => {
  const data = tmp();
  const bk = tmp();
  t.after(() => rm(data, bk));
  const live = makeDb(data); // como o servidor: conexão aberta, modo WAL

  const result = createBackup({ dataDir: data, backupDir: bk, now: at(2026, 10, 27) });
  assert.equal(result.name, 'showvault-2026-10-27_040000.sqlite');
  assert.equal(result.file, path.join(bk, result.name));
  assert.equal(result.users, 2);
  assert.equal(result.libraries, 2);
  assert.equal(result.catalog, 3);
  assert.ok(result.size > 0);

  // o servidor continua escrevendo; o backup guardado é a foto do momento
  live.write('users.json', [{ id: 'usr_1' }, { id: 'usr_2' }, { id: 'usr_3' }]);
  const snapshot = inspectDatabase(result.file);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.integrity, 'ok');
  assert.equal(snapshot.users, 2, 'o backup não vê a escrita feita depois dele');
  assert.equal(inspectDatabase(path.join(data, 'showvault.sqlite')).users, 3);

  // nada sobra: nem `.part` na pasta de backups, nem `.work` na pasta de trabalho
  assert.deepEqual(fs.readdirSync(bk), [result.name]);
  assert.deepEqual(fs.readdirSync(path.join(data, 'backup-work')), []);

  // a foto é independente: abre sozinha com o mesmo conteúdo (o SqliteStore do app a põe em modo WAL, por isso isto vem por último)
  const copy = new SqliteStore(result.file);
  opened.push(copy);
  assert.deepEqual(copy.read('libraries/usr_2.json').data, { trackedShows: [{ showId: 2 }] });
});

test('createBackup: sem banco não cria banco vazio nem a pasta de backups', t => {
  const data = tmp();
  const bk = path.join(tmp(), 'backups');
  t.after(() => rm(data, path.dirname(bk)));
  assert.throws(
    () => createBackup({ dataDir: data, backupDir: bk }),
    err => err instanceof BackupError && err.code === 'NO_DATABASE'
  );
  assert.deepEqual(fs.readdirSync(data), [], 'a pasta de dados continua vazia');
  assert.equal(fs.existsSync(bk), false);
});

test('createBackup: banco corrompido não vira backup e a rotação NÃO apaga os backups bons', t => {
  const data = tmp();
  const bk = tmp();
  t.after(() => rm(data, bk));
  fs.writeFileSync(path.join(data, 'showvault.sqlite'), 'isto nao e um banco sqlite, e sim um arquivo estragado qualquer');
  const olds = [];
  for (let d = 1; d <= 12; d++) {
    const name = backupFileName(at(2026, 10, d));
    touch(bk, name);
    olds.push(name);
  }
  assert.throws(
    () => createBackup({ dataDir: data, backupDir: bk, now: at(2026, 10, 27) }),
    err => err instanceof BackupError && err.code === 'SNAPSHOT_FAILED'
  );
  assert.deepEqual(fs.readdirSync(bk).sort(), olds.sort(), 'nenhum backup antigo foi apagado');
  assert.deepEqual(fs.readdirSync(path.join(data, 'backup-work')), [], 'sem sobras');
});

test('createBackup roda a rotação depois de um backup bom', t => {
  const data = tmp();
  const bk = tmp();
  t.after(() => rm(data, bk));
  makeDb(data);
  for (let d = 1; d <= 20; d++) touch(bk, backupFileName(at(2026, 9, d)));
  const r = createBackup({ dataDir: data, backupDir: bk, now: at(2026, 10, 27), keepDaily: 3, keepWeekly: 1 });
  assert.ok(r.rotation.removed.length > 0);
  assert.ok(fs.existsSync(r.file), 'o backup novo nunca é apagado pela rotação');
  assert.equal(listBackups(bk).length, r.rotation.kept);
  const noRotation = createBackup({ dataDir: data, backupDir: bk, now: at(2026, 10, 28), rotate: false });
  assert.equal(noRotation.rotation, null);
});

// ---- rotação ----

test('rotação: 7 dias recentes + 1 por semana nas 4 últimas semanas; só mexe nos nossos nomes', t => {
  const bk = tmp();
  t.after(() => rm(bk));
  assert.equal(new Date(2026, 9, 27).getDay(), 2, 'conta de cabeça do teste: 27/10/2026 é uma terça-feira');

  // um backup por dia, de 18/09 a 27/10 (40 dias), às 04:00
  for (let i = 0; i < 40; i++) touch(bk, backupFileName(new Date(2026, 8, 18 + i, 4)));
  // sobras do mesmo dia (manual e antes de atualizar): só o mais novo do dia vale
  touch(bk, backupFileName(at(2026, 10, 27, 8, 30)));
  touch(bk, backupFileName(at(2026, 10, 27, 20, 15)));
  // arquivos que NÃO são backups automáticos: nunca podem ser apagados
  const others = [
    'notas.txt',
    'showvault-ANTES-DA-RESTAURACAO-2026-10-27_153000.sqlite',
    'showvault-2026-13-01_000000.sqlite',
    'copia manual.sqlite'
  ];
  others.forEach(name => touch(bk, name));

  const result = rotateBackups(bk, { daily: 7, weekly: 4 });
  assert.deepEqual(result.failed, []);

  const left = listBackups(bk).map(e => e.name);
  const day = (mo, d, h = 4, mi = 0) => backupFileName(at(2026, mo, d, h, mi));
  const expected = [
    day(10, 27, 20, 15), // hoje: só o mais novo do dia
    day(10, 26),
    day(10, 25),
    day(10, 24),
    day(10, 23),
    day(10, 22),
    day(10, 21), // os 7 dias mais recentes
    day(10, 18), // domingo da semana de 12/10 a 18/10
    day(10, 11) // domingo da semana de 05/10 a 11/10 (a semana de 19 a 25 e a atual já estão entre os diários)
  ];
  assert.deepEqual(left, expected);
  for (const name of others) assert.ok(fs.existsSync(path.join(bk, name)), `${name} tem que continuar lá`);
});

test('rotação: sem apagar tudo se o PC ficou desligado (conta "dias com backup", não dias do calendário)', () => {
  const entries = [
    ...Array.from({ length: 10 }, (_, i) => ({ name: backupFileName(at(2026, 8, 1 + i)), date: at(2026, 8, 1 + i) })), // agosto
    { name: backupFileName(at(2026, 10, 20)), date: at(2026, 10, 20) } // único de outubro, depois de ~7 semanas parado
  ];
  const { keep } = planRotation(entries, { daily: 7, weekly: 4 });
  assert.ok(keep.has(backupFileName(at(2026, 10, 20))));
  assert.ok(keep.has(backupFileName(at(2026, 8, 10))), 'os 6 dias de backup mais recentes antes da pausa continuam');
  assert.ok(keep.has(backupFileName(at(2026, 8, 5))));
  assert.equal(keep.has(backupFileName(at(2026, 8, 1))), false);
});

test('rotação: "protect" salva o arquivo indicado e pasta inexistente é lista vazia', t => {
  const bk = tmp();
  t.after(() => rm(bk));
  for (let d = 1; d <= 9; d++) touch(bk, backupFileName(at(2026, 5, d)));
  const keepName = backupFileName(at(2026, 5, 1));
  rotateBackups(bk, { daily: 2, weekly: 1, protect: [keepName] });
  assert.ok(fs.existsSync(path.join(bk, keepName)));
  assert.deepEqual(listBackups(path.join(bk, 'nao-existe')), []);
});

// ---- restauração ----

test('restoreBackup: volta ao estado do backup, guarda o banco atual e remove -wal/-shm velhos', t => {
  const data = tmp();
  const bk = tmp();
  t.after(() => rm(data, bk));
  const live = makeDb(data, { users: 2 });
  const backup = createBackup({ dataDir: data, backupDir: bk, now: at(2026, 10, 27) });

  // depois do backup, o banco ganha uma conta; o servidor é encerrado (conexão fechada) e sobram -wal/-shm de uma queda
  live.write('users.json', [{ id: 'usr_1' }, { id: 'usr_2' }, { id: 'usr_3' }]);
  live.close();
  opened.length = 0;
  fs.writeFileSync(path.join(data, 'showvault.sqlite-wal'), 'lixo de uma queda de energia');
  fs.writeFileSync(path.join(data, 'showvault.sqlite-shm'), 'lixo');

  const result = restoreBackup({ dataDir: data, backupFile: backup.file, safetyDir: bk, now: at(2026, 10, 28, 15, 30, 0) });
  assert.equal(result.restored.users, 2, 'voltou ao estado do backup');
  assert.equal(result.safety.method, 'copia-consistente');
  assert.equal(path.basename(result.safety.file), 'showvault-ANTES-DA-RESTAURACAO-2026-10-28_153000.sqlite');
  assert.equal(inspectDatabase(result.safety.file).users, 3, 'a cópia de segurança tem o banco que estava em uso');
  assert.equal(fs.existsSync(path.join(data, 'showvault.sqlite-wal')), false);
  assert.equal(fs.existsSync(path.join(data, 'showvault.sqlite-shm')), false);
  assert.equal(fs.existsSync(path.join(data, 'showvault.sqlite.restaurando')), false, 'sem arquivo temporário sobrando');

  // o app abre o banco restaurado normalmente
  const store = new SqliteStore(path.join(data, 'showvault.sqlite'));
  opened.push(store);
  assert.deepEqual(
    store.read('users.json').data.map(u => u.id),
    ['usr_1', 'usr_2']
  );
  // a cópia de segurança não é apagada pela rotação (o nome não é de backup automático)
  rotateBackups(bk, { daily: 1, weekly: 1 });
  assert.ok(fs.existsSync(result.safety.file));
});

test('restoreBackup: máquina nova (sem banco ainda) e banco atual ilegível (guarda os arquivos originais)', t => {
  const source = tmp();
  const bk = tmp();
  const fresh = tmp();
  const broken = tmp();
  t.after(() => rm(source, bk, fresh, broken));
  makeDb(source, { users: 4 });
  const backup = createBackup({ dataDir: source, backupDir: bk, now: at(2026, 10, 27) });

  const onFresh = restoreBackup({ dataDir: fresh, backupFile: backup.file, safetyDir: bk });
  assert.equal(onFresh.safety, null);
  assert.equal(onFresh.restored.users, 4);

  fs.writeFileSync(path.join(broken, 'showvault.sqlite'), 'banco estragado que não abre');
  const onBroken = restoreBackup({ dataDir: broken, backupFile: backup.file, safetyDir: bk, now: at(2026, 10, 29, 9, 0, 0) });
  assert.equal(onBroken.safety.method, 'arquivos-originais');
  assert.equal(fs.readFileSync(path.join(onBroken.safety.file, 'showvault.sqlite'), 'utf8'), 'banco estragado que não abre');
  assert.equal(onBroken.restored.users, 4);
});

test('restoreBackup: recusa arquivo que não é backup do ShowVault e deixa o banco atual intacto', t => {
  const data = tmp();
  const other = tmp();
  t.after(() => rm(data, other));
  makeDb(data, { users: 2 });
  fs.writeFileSync(path.join(other, 'texto.sqlite'), 'isto nao e um banco');
  // um SQLite válido, mas de outro programa (sem a tabela documents)
  const { DatabaseSync } = require('node:sqlite');
  const foreign = new DatabaseSync(path.join(other, 'outro.sqlite'));
  foreign.exec('CREATE TABLE coisas (id INTEGER)');
  foreign.close();

  for (const bad of ['texto.sqlite', 'outro.sqlite', 'nao-existe.sqlite']) {
    assert.throws(
      () => restoreBackup({ dataDir: data, backupFile: path.join(other, bad) }),
      err => err instanceof BackupError && err.code === 'INVALID_BACKUP',
      bad
    );
  }
  assert.equal(inspectDatabase(path.join(data, 'showvault.sqlite')).users, 2, 'o banco atual não foi tocado');
  assert.equal(fs.existsSync(path.join(data, 'antes-da-restauracao')), false, 'nem criou cópia de segurança à toa');
});

test(
  'restoreBackup: com o banco aberto por outro processo o Windows recusa a troca e nada muda',
  { skip: process.platform !== 'win32' && 'só vale no Windows (o Linux deixa apagar arquivo aberto)' },
  t => {
    const data = tmp();
    const bk = tmp();
    t.after(() => rm(data, bk));
    const live = makeDb(data, { users: 2 }); // o "servidor": conexão aberta, modo WAL
    const backup = createBackup({ dataDir: data, backupDir: bk, now: at(2026, 10, 27) });
    live.write('users.json', [{ id: 'usr_1' }, { id: 'usr_2' }, { id: 'usr_3' }]);

    assert.throws(
      () => restoreBackup({ dataDir: data, backupFile: backup.file, safetyDir: bk, now: at(2026, 10, 28) }),
      err => err instanceof BackupError && err.code === 'DATABASE_IN_USE' && /Nada foi trocado/.test(err.message)
    );
    assert.equal(inspectDatabase(path.join(data, 'showvault.sqlite')).users, 3, 'o banco em uso continua como estava');
    assert.equal(fs.existsSync(path.join(data, 'showvault.sqlite.restaurando')), false, 'sem arquivo temporário sobrando');
    assert.deepEqual(
      fs.readdirSync(bk).filter(n => n.includes('ANTES-DA-RESTAURACAO')),
      [],
      'a cópia de segurança de uma tentativa que não mudou nada é descartada'
    );
    // o servidor continua escrevendo normalmente depois da tentativa
    live.write('users.json', [{ id: 'usr_1' }]);
    assert.equal(inspectDatabase(path.join(data, 'showvault.sqlite')).users, 1);
  }
);

test('resolveBackupArgument: caminho, nome na pasta de backups e "ultimo"', t => {
  const bk = tmp();
  t.after(() => rm(bk));
  const older = backupFileName(at(2026, 10, 1));
  const newer = backupFileName(at(2026, 10, 2));
  touch(bk, older);
  touch(bk, newer);
  assert.equal(resolveBackupArgument('ultimo', bk), path.join(bk, newer));
  assert.equal(resolveBackupArgument('LATEST', bk), path.join(bk, newer));
  assert.equal(resolveBackupArgument(older, bk), path.join(bk, older));
  assert.equal(resolveBackupArgument(path.join(bk, older), bk), path.join(bk, older));
  assert.equal(resolveBackupArgument('nao-existe', bk), null);
  assert.equal(resolveBackupArgument('', bk), null);
  assert.equal(resolveBackupArgument('ultimo', path.join(bk, 'vazio')), null);
});

// ---- os comandos npm run backup / npm run restore (processos de verdade) ----

// O ambiente é sempre explícito (STORAGE, pastas, PORT): um .env real na pasta do projeto nunca decide nada nestes testes.
function cli(script, args, env, options = {}) {
  const base = { ...process.env, STORAGE: 'sqlite', PORT: '1', ...env };
  return spawnSync(process.execPath, [script, ...args], { cwd: REPO, env: base, encoding: 'utf8', ...options });
}

test('npm run backup: cria o backup, mostra o resumo e recusa STORAGE=json ou pasta sem banco', t => {
  const data = tmp();
  const bk = tmp();
  t.after(() => rm(data, bk));
  makeDb(data);
  const env = { SHOWVAULT_DATA_DIR: data, SHOWVAULT_BACKUP_DIR: bk };

  const ok = cli('scripts/backup.js', [], env);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Backup criado: .*showvault-\d{4}-\d{2}-\d{2}_\d{6}\.sqlite/);
  assert.match(ok.stdout, /2 conta\(s\) · 2 biblioteca\(s\) · 3 obra\(s\) no catálogo · integridade ok/);
  assert.equal(listBackups(bk).length, 1);

  const json = cli('scripts/backup.js', [], { ...env, STORAGE: 'json' });
  assert.equal(json.status, 1);
  assert.match(json.stderr, /STORAGE=json/);

  const empty = tmp();
  t.after(() => rm(empty));
  const none = cli('scripts/backup.js', [], { SHOWVAULT_DATA_DIR: empty, SHOWVAULT_BACKUP_DIR: bk });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /Banco não encontrado/);

  const badFlag = cli('scripts/backup.js', ['--keep-daily', '0'], env);
  assert.equal(badFlag.status, 1);
  assert.match(badFlag.stderr, /--keep-daily/);
  assert.equal(cli('scripts/backup.js', ['--nada'], env).status, 1);
});

test('npm run restore: lista, confere (--dry-run), pede confirmação, restaura com --yes e recusa com o servidor rodando', async t => {
  const data = tmp();
  const bk = tmp();
  t.after(() => rm(data, bk));
  const live = makeDb(data, { users: 2 });
  const backup = createBackup({ dataDir: data, backupDir: bk, now: at(2026, 10, 27) });
  live.write('users.json', [{ id: 'usr_1' }, { id: 'usr_2' }, { id: 'usr_3' }]);
  live.close();
  opened.length = 0;
  const env = { SHOWVAULT_DATA_DIR: data, SHOWVAULT_BACKUP_DIR: bk };
  const usersNow = () => inspectDatabase(path.join(data, 'showvault.sqlite')).users;

  const listing = cli('scripts/restore.js', [], env);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, new RegExp(backup.name));

  const dry = cli('scripts/restore.js', ['ultimo', '--dry-run'], env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Backup escolhido: .*showvault-2026-10-27_040000\.sqlite/);
  assert.match(dry.stdout, /2 conta\(s\)/);
  assert.match(dry.stdout, /nada foi trocado/);
  assert.equal(usersNow(), 3);

  // sem --yes e sem terminal interativo: não troca nada
  const noTty = cli('scripts/restore.js', ['ultimo'], env, { input: 'RESTAURAR\n' });
  assert.equal(noTty.status, 1);
  assert.match(noTty.stderr, /terminal interativo|--yes/);
  assert.equal(usersNow(), 3);

  // arquivo inválido
  fs.writeFileSync(path.join(bk, 'lixo.sqlite'), 'nao e banco');
  const bad = cli('scripts/restore.js', ['lixo.sqlite', '--yes'], env);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /NÃO é um backup utilizável/);
  assert.equal(usersNow(), 3);
  assert.equal(cli('scripts/restore.js', ['nao-existe', '--yes'], env).status, 1);

  // servidor "rodando": /health responde na porta do .env, então o comando recusa
  const fake = http.createServer((req, res) => res.end('{"status":"ok"}'));
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.close());
  const running = await promisify(execFile)(process.execPath, ['scripts/restore.js', 'ultimo', '--yes'], {
    cwd: REPO,
    env: { ...process.env, STORAGE: 'sqlite', ...env, PORT: String(fake.address().port) }
  }).then(
    r => ({ status: 0, ...r }),
    e => ({ status: e.code, stdout: e.stdout, stderr: e.stderr })
  );
  assert.equal(running.status, 1);
  assert.match(running.stderr, /está rodando/);
  assert.equal(usersNow(), 3, 'com o servidor ligado nada é trocado');

  // com tudo certo: restaura e guarda a cópia do banco atual
  const done = cli('scripts/restore.js', ['ultimo', '--yes'], env);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /Cópia do banco que estava em uso: .*ANTES-DA-RESTAURACAO/);
  assert.match(done.stdout, /Restaurado: 2 conta\(s\)/);
  assert.equal(usersNow(), 2);
  assert.ok(fs.readdirSync(bk).some(n => n.startsWith('showvault-ANTES-DA-RESTAURACAO-')));
});
