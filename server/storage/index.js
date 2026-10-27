// Adaptador de armazenamento dos dados de runtime (usuários, bibliotecas e catálogo vivo).
//
// Os modelos continuam pedindo "leia/grave este arquivo" (mesma interface do jsonStore); o adaptador decide onde isso vive:
//   STORAGE=json    (padrão)  arquivos JSON em server/data, como sempre (jsonStore).
//   STORAGE=sqlite            um único arquivo `showvault.sqlite` dentro da pasta de dados (SHOWVAULT_DATA_DIR), pronto para volume persistente.
// Só três tipos de documento vão para o SQLite: users.json, libraries/usr_*.json e mediaCatalog.runtime.json.
// Qualquer outro caminho (seed do catálogo, users.example.json, jwt.secret...) continua sendo arquivo normal.
// Chaves no SQLite = caminho relativo à pasta de dados ("users.json", "libraries/usr_x.json", "mediaCatalog.runtime.json").

const path = require('path');
const fileStore = require('./fileStore');
const { SqliteStore } = require('./sqliteStore');

const DB_FILE_NAME = 'showvault.sqlite';
const LIBRARY_FILE_RE = /^usr_[A-Za-z0-9_]+\.json$/;
const TOP_LEVEL_DOCS = new Set(['users.json', 'mediaCatalog.runtime.json']);

// Que documento é este arquivo? { dataDir, key } se vai para o banco, null se continua sendo arquivo comum.
function locate(file) {
  const abs = path.resolve(file);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  if (TOP_LEVEL_DOCS.has(base)) return { dataDir: dir, key: base };
  if (path.basename(dir) === 'libraries' && LIBRARY_FILE_RE.test(base)) return { dataDir: path.dirname(dir), key: `libraries/${base}` };
  return null;
}

function createStorage(mode = 'json') {
  if (mode === 'json') return fileStore;
  if (mode !== 'sqlite') throw new Error(`STORAGE inválido: "${mode}" (use "json" ou "sqlite").`);

  const stores = new Map(); // pasta de dados -> SqliteStore
  const storeFor = (dataDir) => {
    const dir = path.resolve(dataDir);
    if (!stores.has(dir)) stores.set(dir, new SqliteStore(path.join(dir, DB_FILE_NAME)));
    return stores.get(dir);
  };

  return {
    name: 'sqlite',
    storeFor,
    dbFileFor: (dataDir) => path.join(path.resolve(dataDir), DB_FILE_NAME),

    readJson(file) {
      const loc = locate(file);
      return loc ? storeFor(loc.dataDir).read(loc.key) : fileStore.readJson(file);
    },
    // `opts` (ex.: pretty) só importa para arquivos; o banco guarda JSON compacto.
    writeJsonAtomic(file, data, opts) {
      const loc = locate(file);
      if (!loc) return fileStore.writeJsonAtomic(file, data, opts);
      storeFor(loc.dataDir).write(loc.key, data);
    },
    stamp(file) {
      const loc = locate(file);
      return loc ? storeFor(loc.dataDir).stamp(loc.key) : fileStore.stamp(file);
    },
    // Nomes (como se fossem arquivos) dentro de uma pasta; hoje só a pasta "libraries" mora no banco.
    listNames(dir, regex) {
      const abs = path.resolve(dir);
      if (path.basename(abs) !== 'libraries') return fileStore.listNames(dir, regex);
      const prefix = 'libraries/';
      return storeFor(path.dirname(abs)).list(prefix).map(k => k.slice(prefix.length)).filter(name => regex.test(name));
    },
    removeAll(file) {
      const loc = locate(file);
      if (!loc) return fileStore.removeAll(file);
      return storeFor(loc.dataDir).remove(loc.key) ? 1 : 0;
    },
    close() {
      for (const s of stores.values()) s.close();
      stores.clear();
    }
  };
}

// Backend padrão do processo (escolhido por STORAGE, lido da config só no primeiro uso).
let current = null;
const backend = () => {
  if (!current) current = createStorage(require('../config/config').STORAGE);
  return current;
};

module.exports = {
  createStorage,
  locate,
  DB_FILE_NAME,
  LIBRARY_FILE_RE,
  get name() { return backend().name; },
  // Só no modo sqlite: o SqliteStore de uma pasta de dados (usado por testes e ferramentas).
  storeFor: (dataDir) => {
    const b = backend();
    if (!b.storeFor) throw new Error('storeFor só existe com STORAGE=sqlite.');
    return b.storeFor(dataDir);
  },
  readJson: (...a) => backend().readJson(...a),
  writeJsonAtomic: (...a) => backend().writeJsonAtomic(...a),
  stamp: (...a) => backend().stamp(...a),
  listNames: (...a) => backend().listNames(...a),
  removeAll: (...a) => backend().removeAll(...a),
  close: () => { if (current) { current.close(); current = null; } }
};
