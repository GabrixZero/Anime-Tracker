// S11: migrar os JSON de OUTRA pasta (server/data do projeto) para o SQLite em %LOCALAPPDATA%\ShowVault\data, com simulação (--dry-run).
// Fixtures sintéticas em pastas temporárias; nenhuma pasta de dados real é tocada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { migrateJsonToSqlite } = require('../server/storage/migrate');
const { SqliteStore } = require('../server/storage/sqliteStore');

const REPO = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s11-from-'));
const opened = [];
const open = file => {
  const s = new SqliteStore(file);
  opened.push(s);
  return s;
};
const rm = (...dirs) => {
  opened.splice(0).forEach(s => s.close());
  dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
};
const quiet = { log() {}, warn() {} };
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};

// "Projeto antigo": JSON do modo de arquivos.
function legacyProject(dir) {
  write(path.join(dir, 'users.json'), [{ id: 'usr_1', email: 'a@exemplo.test' }]);
  write(path.join(dir, 'mediaCatalog.runtime.json'), [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' }
  ]);
  write(path.join(dir, 'libraries', 'usr_1.json'), { trackedShows: [{ showId: 1 }], schemaVersion: 2 });
  write(path.join(dir, 'libraries', 'usr_1.json.bak'), { trackedShows: [] });
  write(path.join(dir, 'mediaCatalog.seed.json'), [{ id: 99 }]); // não é dado do usuário: não entra
}

// Foto do conteúdo de uma pasta (nomes + tamanhos + datas) para provar que nada mudou.
function snapshot(dir) {
  const out = [];
  const walk = d => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const stat = fs.statSync(full);
      out.push(`${path.relative(dir, full)}|${stat.isDirectory() ? 'dir' : `${stat.size}|${stat.mtimeMs}`}`);
      if (stat.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out;
}

test('--from: importa os JSON de outra pasta, faz backup NO destino e deixa a origem intacta', t => {
  const src = tmp();
  const dest = path.join(tmp(), 'LocalAppData', 'ShowVault', 'data'); // pasta que ainda nem existe
  t.after(() => rm(src, path.join(dest, '..', '..', '..')));
  legacyProject(src);
  const before = snapshot(src);

  const r = migrateJsonToSqlite(dest, { ...quiet, fromDir: src });
  assert.equal(r.skipped, false);
  assert.equal(r.users, 1);
  assert.equal(r.libraries, 1);
  assert.equal(r.catalog, 2);
  assert.deepEqual(r.existingKeys, []);
  assert.equal(r.sourceDir, src);

  assert.ok(r.backupDir.startsWith(path.join(dest, 'backup-pre-sqlite-')), 'o backup fica ao lado do banco, não na origem');
  assert.ok(fs.existsSync(path.join(r.backupDir, 'users.json')));
  assert.ok(fs.existsSync(path.join(r.backupDir, 'libraries', 'usr_1.json.bak')));
  assert.deepEqual(snapshot(src), before, 'a pasta de origem não foi alterada (nem apagada)');

  const store = open(path.join(dest, 'showvault.sqlite'));
  assert.deepEqual(store.list('').sort(), ['libraries/usr_1.json', 'mediaCatalog.runtime.json', 'users.json']);
  assert.equal(store.read('users.json').data[0].id, 'usr_1');
});

test('--from vale mesmo que o banco já tenha a marca "migrado", mas NUNCA sobrescreve; avisa o que já existia', t => {
  const src = tmp();
  const dest = tmp();
  t.after(() => rm(src, dest));
  legacyProject(src);

  // O servidor chegou a rodar antes da migração: banco com users.json vazio e a marca "nada para migrar".
  assert.equal(migrateJsonToSqlite(dest, quiet).skipped, false);
  const premature = open(path.join(dest, 'showvault.sqlite'));
  premature.write('users.json', [{ id: 'usr_novo' }]);
  premature.close();
  opened.length = 0;
  assert.equal(migrateJsonToSqlite(dest, quiet).skipped, true, 'sem --from continua pulando');

  const warnings = [];
  const r = migrateJsonToSqlite(dest, { log() {}, warn: m => warnings.push(m), fromDir: src });
  assert.equal(r.skipped, false);
  assert.equal(r.libraries, 1, 'a biblioteca que faltava entrou');
  assert.deepEqual(r.existingKeys, ['users.json']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /NÃO foram sobrescritos: users\.json/);

  const store = open(path.join(dest, 'showvault.sqlite'));
  assert.deepEqual(store.read('users.json').data, [{ id: 'usr_novo' }], 'o documento do banco continua intacto');
});

test('--from numa pasta sem JSON: não faz nada e não cria banco vazio nem marca "migrado"', t => {
  const empty = tmp();
  const dest = path.join(tmp(), 'dados');
  t.after(() => rm(empty, path.dirname(dest)));
  const r = migrateJsonToSqlite(dest, { ...quiet, fromDir: empty });
  assert.equal(r.nothingFound, true);
  assert.equal(fs.existsSync(dest), false, 'o destino nem chegou a ser criado');
});

test('--dry-run: conta o que seria importado e não grava NADA (nem pasta, nem banco, nem backup)', t => {
  const src = tmp();
  const destRoot = tmp();
  const dest = path.join(destRoot, 'dados');
  t.after(() => rm(src, destRoot));
  legacyProject(src);
  write(path.join(src, 'libraries', 'usr_2.json'), '{quebrado'); // ilegível, sem .bak

  const before = snapshot(src);
  const p = migrateJsonToSqlite(dest, { fromDir: src, dryRun: true });
  assert.equal(p.dryRun, true);
  assert.equal(p.skipped, false);
  assert.equal(p.users, 1);
  assert.equal(p.libraries, 1);
  assert.equal(p.catalog, 2);
  assert.deepEqual(
    p.failed.map(f => f.key),
    ['libraries/usr_2.json']
  );
  assert.equal(p.dbExists, false);
  assert.equal(fs.existsSync(dest), false, 'a simulação não cria a pasta do banco');
  assert.deepEqual(snapshot(src), before, 'nem uma cópia .corrupt-* aparece na origem');
});

test('--dry-run com banco existente: mostra o que já existe e deixa o banco e a pasta exatamente como estavam', t => {
  const src = tmp();
  const dest = tmp();
  t.after(() => rm(src, dest));
  legacyProject(src);
  migrateJsonToSqlite(dest, quiet); // sem fromDir: pasta de dados vazia -> banco criado e marcado
  const store = open(path.join(dest, 'showvault.sqlite'));
  store.write('users.json', [{ id: 'usr_novo' }]);
  store.close();
  opened.length = 0;

  const destBefore = snapshot(dest);
  const p = migrateJsonToSqlite(dest, { fromDir: src, dryRun: true });
  assert.equal(p.dbExists, true);
  assert.deepEqual(p.existingKeys, ['users.json']);
  assert.equal(p.users, 0);
  assert.equal(p.libraries, 1);
  assert.deepEqual(snapshot(dest), destBefore, 'nenhum arquivo do destino mudou (nem -wal/-shm novos)');

  // sem --from nem --force a simulação diz que o banco já foi migrado, como a execução real diria
  const again = migrateJsonToSqlite(dest, { dryRun: true });
  assert.equal(again.skipped, true);
  assert.match(again.previous, /nada para migrar/);
});

// ---- o comando npm run storage:migrate ----

function cli(args, dataDir) {
  // Ambiente explícito: um .env real na pasta do projeto nunca decide nada aqui.
  const env = { ...process.env, NODE_ENV: 'test', STORAGE: 'sqlite', SHOWVAULT_DATA_DIR: dataDir };
  delete env.JWT_SECRET;
  return spawnSync(process.execPath, ['scripts/storage.js', 'migrate', ...args], { cwd: REPO, env, encoding: 'utf8' });
}

test('npm run storage:migrate -- --from <pasta> --dry-run / real / pasta vazia', t => {
  const src = tmp();
  const destRoot = tmp();
  const dest = path.join(destRoot, 'dados');
  const empty = tmp();
  t.after(() => rm(src, destRoot, empty));
  legacyProject(src);

  const dry = cli(['--from', src, '--dry-run'], dest);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Simulação: nada será gravado/);
  assert.match(dry.stdout, /Seriam importados: 1 conta\(s\), 1 biblioteca\(s\), catálogo com 2 obra\(s\)/);
  assert.equal(dry.stdout.includes('a@exemplo.test'), false, 'a saída não mostra e-mails');
  assert.equal(fs.existsSync(dest), false);

  const real = cli(['--from', src], dest);
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /Migração JSON -> SQLite: 1 usuário\(s\), 1 biblioteca\(s\), catálogo com 2 obra\(s\)/);
  assert.ok(fs.existsSync(path.join(dest, 'showvault.sqlite')));
  assert.ok(fs.readdirSync(dest).some(n => n.startsWith('backup-pre-sqlite-')));
  assert.ok(fs.existsSync(path.join(src, 'users.json')), 'os JSON originais continuam lá');

  const none = cli(['--from', empty], path.join(destRoot, 'outro'));
  assert.equal(none.status, 1);
  assert.match(none.stdout, /Nenhum JSON de dados encontrado/);

  const hint = cli([], path.join(destRoot, 'vazio'));
  assert.equal(hint.status, 0, hint.stderr);
  assert.match(hint.stdout, /use --from <pasta>/);
});
