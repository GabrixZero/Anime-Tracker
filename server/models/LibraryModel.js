const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { readJson, writeJsonAtomic } = require('../utils/jsonStore');
const { STATE_VERSION, migrateLibrary } = require('../../public/js/utils/migrations');
const LibraryMerge = require('../../public/js/utils/libraryMerge');

const USER_ID_RE = /^usr_[A-Za-z0-9_]+$/;
const EPISODE_KEY_RE = /^\d+_(movie|s\d+_e\d+)$/;
const MAX_SHOWS = 5000;
const MAX_KEYS = 50000;
const MAX_TEXT = 20000;
const MAX_SNAPSHOTS = 5;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

class LibraryModel {
  constructor(dataDir = config.DATA_DIR) {
    this.dir = path.join(dataDir, 'libraries');
  }

  emptyLibrary() {
    return { ...LibraryMerge.emptyData(), updatedAt: null };
  }

  filePathFor(userId) {
    if (typeof userId !== 'string' || !USER_ID_RE.test(userId)) {
      throw new Error('userId inválido.');
    }
    return path.join(this.dir, `${userId}.json`);
  }

  // Retorna uma cópia saneada (só campos conhecidos, tipos checados) ou lança Error.
  validate(payload) {
    if (!isPlainObject(payload)) throw new Error('Biblioteca inválida.');
    const { trackedShows, watchedEpisodes, episodeNotes } = payload;

    if (!Array.isArray(trackedShows) || !isPlainObject(watchedEpisodes) || !isPlainObject(episodeNotes)) {
      throw new Error('Biblioteca inválida: trackedShows, watchedEpisodes e episodeNotes são obrigatórios.');
    }
    if (trackedShows.length > MAX_SHOWS
      || Object.keys(watchedEpisodes).length > MAX_KEYS
      || Object.keys(episodeNotes).length > MAX_KEYS) {
      throw new Error('Biblioteca excede o limite de tamanho.');
    }

    const seen = new Set();
    const cleanShows = [];
    for (const t of trackedShows) {
      if (!isPlainObject(t) || !Number.isInteger(t.showId) || seen.has(t.showId)) {
        throw new Error('Item inválido em trackedShows.');
      }
      seen.add(t.showId);
      const show = { showId: t.showId, status: str(t.status, 30), addedAt: str(t.addedAt, 40) };
      const updatedAt = LibraryMerge.cleanStamp(t.updatedAt);
      if (updatedAt) show.updatedAt = updatedAt;
      cleanShows.push(show);
    }

    const cleanWatched = {};
    for (const [key, v] of Object.entries(watchedEpisodes)) {
      if (!EPISODE_KEY_RE.test(key) || !isPlainObject(v)) throw new Error('Item inválido em watchedEpisodes.');
      cleanWatched[key] = {
        watched: v.watched === true,
        watchedAt: str(v.watchedAt, 40),
        rewatchCount: Number.isInteger(v.rewatchCount) && v.rewatchCount > 0 ? Math.min(v.rewatchCount, 1000) : 1
      };
      const updatedAt = LibraryMerge.cleanStamp(v.updatedAt);
      if (updatedAt) cleanWatched[key].updatedAt = updatedAt;
    }

    const cleanNotes = {};
    for (const [key, n] of Object.entries(episodeNotes)) {
      if (!EPISODE_KEY_RE.test(key) || !isPlainObject(n)) throw new Error('Item inválido em episodeNotes.');
      const snapshots = Array.isArray(n.snapshots) ? n.snapshots.slice(0, MAX_SNAPSHOTS) : [];
      cleanNotes[key] = {
        text: str(n.text, MAX_TEXT),
        emotion: typeof n.emotion === 'string' ? n.emotion.slice(0, 40) : null,
        character: str(n.character, 200),
        updatedAt: str(n.updatedAt, 40),
        snapshots: snapshots
          .filter(isPlainObject)
          .map(s => ({ text: str(s.text, MAX_TEXT), updatedAt: str(s.updatedAt, 40) }))
      };
    }

    // Marcas de exclusão (D-13) e "zerar a conta" (resetAt): ver public/js/utils/libraryMerge.js
    const fail = () => { throw new Error('Item inválido em tombstones.'); };
    const tombstones = LibraryMerge.cleanTombstones(payload.tombstones, fail);
    const resetAt = LibraryMerge.cleanStamp(payload.resetAt);

    return { trackedShows: cleanShows, watchedEpisodes: cleanWatched, episodeNotes: cleanNotes, tombstones, resetAt };
  }

  // Lê a biblioteca (migrando versões antigas do estado). Arquivo ilegível lança DataCorruptionError:
  // nunca vira biblioteca vazia. Bibliotecas gravadas antes da S03 voltam com tombstones/resetAt vazios.
  get(userId) {
    const file = this.filePathFor(userId);
    const result = readJson(file);
    if (result === null) return this.emptyLibrary();

    const stored = result.data;
    const migrated = migrateLibrary(stored, stored.schemaVersion);
    if (!migrated.changed && stored.schemaVersion === STATE_VERSION && !result.recovered) {
      return { ...stored, ...LibraryMerge.normalizeData(stored) };
    }

    const library = { ...migrated.data, schemaVersion: STATE_VERSION };
    try {
      writeJsonAtomic(file, library, { pretty: false });
    } catch (err) {
      console.error(`[LibraryModel] Não foi possível gravar a migração de ${userId}:`, err.message);
    }
    return { ...library, ...LibraryMerge.normalizeData(library) };
  }

  // Grava de forma atômica, com .bak da versão anterior.
  //  - Cliente da S03 (envia `tombstones`): o servidor MESCLA o que chegou com o que já tem (LibraryMerge.merge); um aparelho
  //    desatualizado não apaga o trabalho de outro e as remoções (marcas de exclusão) se propagam. Vale `resetAt` ("zerar a conta").
  //  - Cliente antigo (sem `tombstones`): snapshot completo, last-write-wins, como antes.
  // stateVersion = versão do estado do cliente: clientes antigos (ou sem versão) passam pela migração antes de gravar,
  // para não ressuscitar referências já removidas.
  save(userId, payload, { stateVersion } = {}) {
    const file = this.filePathFor(userId);
    const incoming = migrateLibrary(this.validate(payload), stateVersion).data;

    // Se o arquivo atual estiver quebrado, a leitura preserva uma cópia ".corrupt-*" antes de ele ser substituído
    // pelo snapshot do cliente (que é a fonte primária local-first); nesse caso não há o que mesclar.
    let current = null;
    try { current = this.get(userId); } catch { /* cópia já preservada */ }

    const supportsMerge = payload.tombstones !== undefined && payload.tombstones !== null;
    const next = supportsMerge && current ? LibraryMerge.merge(incoming, current, { now: Date.now() }) : incoming;
    const library = { ...next, schemaVersion: STATE_VERSION, updatedAt: new Date().toISOString() };

    writeJsonAtomic(file, library, { pretty: false });
    return library;
  }

  // "Resetar + apagar a nuvem": biblioteca vazia com `resetAt` = agora. Os outros aparelhos, ao sincronizar, descartam tudo anterior a essa data.
  clear(userId) {
    const file = this.filePathFor(userId);
    try { readJson(file); } catch { /* cópia .corrupt-* preservada pela leitura */ }
    const now = new Date().toISOString();
    const library = { ...LibraryMerge.emptyData(), resetAt: now, schemaVersion: STATE_VERSION, updatedAt: now };
    writeJsonAtomic(file, library, { pretty: false });
    return library;
  }

  // Migra todas as bibliotecas existentes (chamado na inicialização). Arquivos ilegíveis são pulados e reportados.
  migrateAll() {
    const summary = { migrated: 0, skipped: 0, failed: 0 };
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter(f => /^usr_[A-Za-z0-9_]+\.json$/.test(f));
    } catch {
      return summary; // pasta ainda não existe
    }
    for (const f of files) {
      try {
        const id = f.replace(/\.json$/, '');
        const result = readJson(path.join(this.dir, f));
        if (result && result.data.schemaVersion !== STATE_VERSION) {
          this.get(id);
          summary.migrated++;
        } else {
          summary.skipped++;
        }
      } catch (err) {
        summary.failed++;
        console.error(`[LibraryModel] Migração ignorou ${f}: ${err.message}`);
      }
    }
    return summary;
  }
}

module.exports = new LibraryModel();
module.exports.LibraryModel = LibraryModel;
