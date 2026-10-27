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
const { readJson, writeJsonAtomic } = require('../utils/jsonStore');
const { SqliteStore } = require('./sqliteStore');
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
  try { names = fs.readdirSync(libDir); } catch { /* sem pasta de bibliotecas */ }
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

// Migra dataDir/*.json para dataDir/showvault.sqlite. Seguro para chamar sempre que o servidor sobe (só age uma vez).
function migrateJsonToSqlite(dataDir, { log = console.log, warn = console.warn, force = false, now = new Date() } = {}) {
  const dir = path.resolve(dataDir);
  const store = new SqliteStore(path.join(dir, DB_FILE_NAME));
  try {
    const previous = store.getMeta(META_KEY);
    if (previous && !force) return { skipped: true, reason: 'already-migrated', previous };

    const files = candidateFiles(dir);
    const summary = { skipped: false, users: 0, libraries: 0, catalog: 0, existing: 0, failed: [], backupDir: null };
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
        if (!store.insertIfAbsent(item.key, item.json)) { summary.existing++; continue; }
        inserted.push(item);
        if (item.key === 'users.json') summary.users = JSON.parse(item.json).length;
        else if (item.key === 'mediaCatalog.runtime.json') summary.catalog = JSON.parse(item.json).length;
        else summary.libraries++;
      }
    });

    // Confere o que foi gravado: a releitura do banco precisa ser igual ao que foi lido do arquivo.
    for (const { key, json } of inserted) {
      const back = store.read(key);
      if (!back || JSON.stringify(back.data) !== json) throw new Error(`Verificação da migração falhou em ${key}; a marca de migração NÃO foi gravada.`);
    }

    store.setMeta(META_KEY, `${now.toISOString()} users=${summary.users} libraries=${summary.libraries} catalog=${summary.catalog}`);
    log(`[storage] Migração JSON -> SQLite: ${summary.users} usuário(s), ${summary.libraries} biblioteca(s), catálogo com ${summary.catalog} obra(s)` +
      `${summary.failed.length ? `, ${summary.failed.length} arquivo(s) com erro` : ''}. Os JSON originais foram mantidos.`);
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
