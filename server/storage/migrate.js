// Migração dos arquivos JSON de dados para o SQLite (e o caminho inverso, para exportar/voltar atrás).
//
// Regras de segurança:
//  - ANTES de importar, copia tudo (users.json, libraries/, mediaCatalog.runtime.json e seus .bak/.corrupt-*) para
//    <pasta de dados>/backup-pre-sqlite-<data>/ (ignorada pelo git);
//  - os arquivos originais NÃO são apagados nem alterados;
//  - nunca sobrescreve um documento que já existe no banco; arquivo ilegível é pulado e relatado (a cópia fica no backup);
//  - é feita uma única vez por banco (marca `json_migration` na tabela `meta`); depois disso o SQLite é a fonte da verdade.
// Precisa rodar ANTES de o servidor carregar os modelos (o UserModel cria um users.json vazio ao ser carregado): ver server.js.

const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic, stripBom } = require('../utils/jsonStore');
const { SqliteStore } = require('./sqliteStore');
const { openReadOnly } = require('./readOnly');
const { DB_FILE_NAME, LIBRARY_FILE_RE } = require('./index');

const META_KEY = 'json_migration';

function candidateFiles(dataDir) {
  const found = [];
  for (const name of ['users.json', 'mediaCatalog.runtime.json']) {
    if (fs.existsSync(path.join(dataDir, name)) || fs.existsSync(path.join(dataDir, `${name}.bak`))) {
      found.push({ key: name, file: path.join(dataDir, name) });
    }
  }
  const libDir = path.join(dataDir, 'libraries');
  let names = [];
  try {
    names = fs.readdirSync(libDir);
  } catch {
    /* sem pasta de bibliotecas */
  }
  for (const name of names.filter(n => LIBRARY_FILE_RE.test(n)).sort()) {
    found.push({ key: `libraries/${name}`, file: path.join(libDir, name) });
  }
  return found;
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

// Copia os arquivos de dados (principal + .bak + .corrupt-*) para a pasta de backup. Devolve a pasta (ou null se não havia nada).
function backupJsonFiles(dataDir, files, now = new Date()) {
  if (files.length === 0) return null;
  const dest = path.join(dataDir, `backup-pre-sqlite-${stamp(now)}`);
  fs.mkdirSync(dest, { recursive: true });
  const copySiblings = (file, destDir) => {
    const dir = path.dirname(file);
    const base = path.basename(file);
    for (const name of fs.readdirSync(dir)) {
      if (name === base || name.startsWith(`${base}.`)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(path.join(dir, name), path.join(destDir, name));
      }
    }
  };
  for (const { key, file } of files) {
    copySiblings(file, path.join(dest, path.dirname(key) === '.' ? '' : path.dirname(key)));
  }
  return dest;
}

// Lê um JSON sem NENHUM efeito colateral (o readJson cria uma cópia .corrupt-* ao achar arquivo quebrado). Usa o .bak se o principal falhar.
// null = nem o arquivo nem o .bak existem; lança o erro do arquivo principal se nenhum dos dois for legível.
function peekJson(file) {
  const attempt = f => {
    try {
      return { data: JSON.parse(stripBom(fs.readFileSync(f, 'utf-8'))) };
    } catch (error) {
      return { error };
    }
  };
  const main = attempt(file);
  if (!main.error) return main;
  const bak = attempt(`${file}.bak`);
  if (!bak.error) return bak;
  if (main.error.code === 'ENOENT' && bak.error.code === 'ENOENT') return null;
  throw main.error.code === 'ENOENT' ? bak.error : main.error;
}

// Lê (somente leitura, sem criar nada) o que o banco já tem: a marca de migração e as chaves dos documentos.
function peekDatabase(dbFile) {
  const info = { exists: fs.existsSync(dbFile), previous: null, keys: new Set() };
  if (!info.exists) return info;
  try {
    const db = openReadOnly(dbFile); // sem criar -wal/-shm
    try {
      info.keys = new Set(
        db
          .prepare('SELECT key FROM documents')
          .all()
          .map(row => row.key)
      );
      const row = db.prepare('SELECT value FROM meta WHERE name = ?').get(META_KEY);
      info.previous = row ? row.value : null;
    } finally {
      db.close();
    }
  } catch {
    /* banco ilegível ou sem as tabelas: para a simulação conta como vazio */
  }
  return info;
}

// Modo simulação (--dry-run): conta o que seria importado e o que o banco já tem. Não cria pasta, banco, backup nem marca nada.
function previewMigration(dir, sourceDir, { force }) {
  const dbFile = path.join(dir, DB_FILE_NAME);
  const known = peekDatabase(dbFile);
  const preview = {
    dryRun: true,
    skipped: false,
    sourceDir,
    dbFile,
    dbExists: known.exists,
    files: 0,
    users: 0,
    libraries: 0,
    catalog: 0,
    existingKeys: [],
    failed: []
  };
  if (known.previous && !force) return { ...preview, skipped: true, reason: 'already-migrated', previous: known.previous };

  const files = candidateFiles(sourceDir);
  preview.files = files.length;
  for (const { key, file } of files) {
    let result;
    try {
      result = peekJson(file);
    } catch (err) {
      preview.failed.push({ key, error: err.message });
      continue;
    }
    if (result === null) continue;
    if (known.keys.has(key)) {
      preview.existingKeys.push(key);
      continue;
    }
    if (key === 'users.json') preview.users = result.data.length;
    else if (key === 'mediaCatalog.runtime.json') preview.catalog = result.data.length;
    else preview.libraries++;
  }
  return preview;
}

// Migra os JSON para dataDir/showvault.sqlite. Seguro para chamar sempre que o servidor sobe (só age uma vez).
//  - fromDir: lê os JSON de OUTRA pasta (ex.: server/data do projeto, quando o banco vai para %LOCALAPPDATA%\ShowVault\data).
//    Pedir a pasta de propósito vale como --force: ignora a marca "já migrado", mas continua sem sobrescrever nada do banco.
//  - dryRun: só simula (ver previewMigration).
function migrateJsonToSqlite(
  dataDir,
  { log = console.log, warn = console.warn, force = false, now = new Date(), fromDir = null, dryRun = false } = {}
) {
  const dir = path.resolve(dataDir);
  const sourceDir = fromDir ? path.resolve(fromDir) : dir;
  if (dryRun) return previewMigration(dir, sourceDir, { force: force || !!fromDir });

  const summary = {
    skipped: false,
    users: 0,
    libraries: 0,
    catalog: 0,
    existing: 0,
    existingKeys: [],
    failed: [],
    backupDir: null,
    sourceDir
  };
  // Pasta indicada à mão e sem JSON: nada a fazer, e o destino nem chega a ser tocado (não cria banco vazio nem marca "migrado").
  if (fromDir && candidateFiles(sourceDir).length === 0) return { ...summary, nothingFound: true };

  const store = new SqliteStore(path.join(dir, DB_FILE_NAME));
  try {
    const previous = store.getMeta(META_KEY);
    if (previous && !force && !fromDir) return { skipped: true, reason: 'already-migrated', previous };

    const files = candidateFiles(sourceDir);
    if (files.length === 0) {
      store.setMeta(META_KEY, `${now.toISOString()} (nada para migrar)`);
      return summary;
    }

    summary.backupDir = backupJsonFiles(dir, files, now);
    log(`[storage] Backup dos arquivos JSON em ${summary.backupDir}`);

    // Lê tudo primeiro (arquivo ilegível é pulado, não derruba a migração), grava tudo numa transação só.
    const ready = [];
    for (const { key, file } of files) {
      try {
        const result = readJson(file); // usa o .bak se o principal estiver quebrado
        if (result === null) continue;
        ready.push({ key, json: JSON.stringify(result.data) });
      } catch (err) {
        summary.failed.push({ key, error: err.message });
        warn(`[storage] ${key} ilegível; NÃO migrado (a cópia está no backup): ${err.message}`);
      }
    }

    const inserted = [];
    store.transaction(() => {
      for (const item of ready) {
        if (!store.insertIfAbsent(item.key, item.json)) {
          summary.existing++;
          summary.existingKeys.push(item.key);
          continue;
        }
        inserted.push(item);
        if (item.key === 'users.json') summary.users = JSON.parse(item.json).length;
        else if (item.key === 'mediaCatalog.runtime.json') summary.catalog = JSON.parse(item.json).length;
        else summary.libraries++;
      }
    });

    // Confere o que foi gravado: a releitura do banco precisa ser igual ao que foi lido do arquivo.
    for (const { key, json } of inserted) {
      const back = store.read(key);
      if (!back || JSON.stringify(back.data) !== json)
        throw new Error(`Verificação da migração falhou em ${key}; a marca de migração NÃO foi gravada.`);
    }

    store.setMeta(
      META_KEY,
      `${now.toISOString()} users=${summary.users} libraries=${summary.libraries} catalog=${summary.catalog}${fromDir ? ' (de outra pasta)' : ''}`
    );
    if (summary.existingKeys.length) {
      warn(
        `[storage] Já existiam no banco e NÃO foram sobrescritos: ${summary.existingKeys.join(', ')}. ` +
          'Se o ShowVault chegou a rodar neste banco antes da migração, pare o app, mova o showvault.sqlite* para outro lugar e migre de novo.'
      );
    }
    log(
      `[storage] Migração JSON -> SQLite: ${summary.users} usuário(s), ${summary.libraries} biblioteca(s), catálogo com ${summary.catalog} obra(s)` +
        `${summary.failed.length ? `, ${summary.failed.length} arquivo(s) com erro` : ''}. Os JSON originais foram mantidos.`
    );
    return summary;
  } finally {
    store.close();
  }
}

// Exporta o banco para arquivos JSON em outra pasta (saída segura: nunca escreve por cima de dados reais sem querer).
function exportSqliteToJson(dataDir, outDir) {
  const dbFile = path.join(path.resolve(dataDir), DB_FILE_NAME);
  if (!fs.existsSync(dbFile)) throw new Error(`Banco não encontrado: ${dbFile}`);
  const out = path.resolve(outDir);
  if (out === path.resolve(dataDir)) throw new Error('A pasta de saída precisa ser diferente da pasta de dados.');
  const store = new SqliteStore(dbFile);
  try {
    let count = 0;
    for (const key of store.list('')) {
      const result = store.read(key);
      writeJsonAtomic(path.join(out, ...key.split('/')), result.data, { pretty: false });
      count++;
    }
    return { count, outDir: out };
  } finally {
    store.close();
  }
}

module.exports = { migrateJsonToSqlite, exportSqliteToJson, candidateFiles, backupJsonFiles, META_KEY };
