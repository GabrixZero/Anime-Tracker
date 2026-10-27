// Armazenamento de documentos JSON em um único arquivo SQLite (módulo embutido `node:sqlite`, sem dependência nativa).
//
// Equivalente ao jsonStore (arquivos), com as mesmas garantias:
//  - gravação atômica (transação do SQLite);
//  - a versão válida anterior fica na coluna `prev` (o papel do ".bak");
//  - documento ilegível: tenta `prev`; sem `prev` válido lança DataCorruptionError, guarda uma cópia em `corrupt` e NUNCA devolve "vazio".
// Um único arquivo (`showvault.sqlite`, em modo WAL) facilita o volume persistente. Funciona com UM processo do servidor por arquivo.

const fs = require('fs');
const path = require('path');
const { DataCorruptionError } = require('../utils/errors');

let DatabaseSync = null;
function loadDriver() {
  if (!DatabaseSync) {
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch (err) {
      throw new Error(`STORAGE=sqlite exige Node 26 ou mais novo (módulo node:sqlite indisponível em ${process.version}): ${err.message}`, {
        cause: err
      });
    }
  }
  return DatabaseSync;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS documents (
    key        TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    prev       TEXT,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS corrupt (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    key    TEXT NOT NULL,
    data   TEXT NOT NULL,
    at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    name  TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const isValidJson = text => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

class SqliteStore {
  constructor(dbFile) {
    this.dbFile = dbFile;
    if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const Driver = loadDriver();
    this.db = new Driver(dbFile);
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (dbFile !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.stmts = {
      get: this.db.prepare('SELECT data, prev FROM documents WHERE key = ?'),
      upsert: this.db.prepare(`
        INSERT INTO documents (key, data, prev, version, updated_at) VALUES (?, ?, NULL, 1, ?)
        ON CONFLICT(key) DO UPDATE SET
          prev = CASE WHEN json_valid(documents.data) THEN documents.data ELSE documents.prev END,
          data = excluded.data,
          version = documents.version + 1,
          updated_at = excluded.updated_at`),
      insertIfAbsent: this.db.prepare('INSERT OR IGNORE INTO documents (key, data, prev, version, updated_at) VALUES (?, ?, NULL, 1, ?)'),
      del: this.db.prepare('DELETE FROM documents WHERE key = ?'),
      delCorrupt: this.db.prepare('DELETE FROM corrupt WHERE key = ?'),
      stamp: this.db.prepare('SELECT version, length(data) AS size FROM documents WHERE key = ?'),
      list: this.db.prepare('SELECT key FROM documents WHERE key >= ? AND key < ? ORDER BY key'),
      all: this.db.prepare('SELECT key FROM documents ORDER BY key'),
      addCorrupt: this.db.prepare('INSERT INTO corrupt (key, data, at) VALUES (?, ?, ?)'),
      getMeta: this.db.prepare('SELECT value FROM meta WHERE name = ?'),
      setMeta: this.db.prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
    };
    this.preservedCorrupt = new Set();
  }

  // null = não existe; { data, recovered } = lido; lança DataCorruptionError se o documento e o `prev` estão ilegíveis.
  read(key) {
    const row = this.stmts.get.get(key);
    if (!row) return null;
    try {
      return { data: JSON.parse(row.data), recovered: false };
    } catch (mainError) {
      console.error(`[sqliteStore] ${key} está ilegível (${mainError.message}). Tentando a versão anterior.`);
      if (!this.preservedCorrupt.has(`${key}:${row.data.length}`)) {
        this.preservedCorrupt.add(`${key}:${row.data.length}`);
        this.stmts.addCorrupt.run(key, row.data, new Date().toISOString());
      }
      if (row.prev) {
        try {
          const data = JSON.parse(row.prev);
          console.error(`[sqliteStore] ${key} recuperado da versão anterior.`);
          return { data, recovered: true };
        } catch {
          /* cai no erro abaixo */
        }
      }
      throw new DataCorruptionError(`${this.dbFile}#${key}`, mainError);
    }
  }

  write(key, data) {
    const json = JSON.stringify(data);
    if (json === undefined) throw new Error('Dados não serializáveis.');
    this.stmts.upsert.run(key, json, new Date().toISOString());
  }

  // Só insere se a chave ainda não existe (usado pela migração, que nunca sobrescreve). Devolve true se inseriu.
  insertIfAbsent(key, json) {
    if (!isValidJson(json)) throw new Error('JSON inválido.');
    return this.stmts.insertIfAbsent.run(key, json, new Date().toISOString()).changes > 0;
  }

  // Apaga o documento, a versão anterior (`prev`, na mesma linha) e as cópias de documento quebrado dele. Devolve true se existia.
  remove(key) {
    this.stmts.delCorrupt.run(key);
    return this.stmts.del.run(key).changes > 0;
  }

  // Muda a cada gravação (equivale ao "mtime:tamanho" do arquivo).
  stamp(key) {
    const row = this.stmts.stamp.get(key);
    return row ? `${row.version}:${row.size}` : 'missing';
  }

  // Chaves com um prefixo (ex.: "libraries/").
  list(prefix = '') {
    if (!prefix) return this.stmts.all.all().map(r => r.key);
    return this.stmts.list.all(prefix, `${prefix}￿`).map(r => r.key);
  }

  getMeta(name) {
    const row = this.stmts.getMeta.get(name);
    return row ? row.value : null;
  }

  setMeta(name, value) {
    this.stmts.setMeta.run(name, String(value));
  }

  // Bloco atômico (várias gravações viram uma só ou nenhuma).
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* já revertido */
      }
      throw err;
    }
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* já fechado */
    }
  }
}

module.exports = { SqliteStore };
