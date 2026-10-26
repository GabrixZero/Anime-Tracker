const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const USER_ID_RE = /^usr_[A-Za-z0-9_]+$/;
const EPISODE_KEY_RE = /^\d+_(movie|s\d+_e\d+)$/;
const MAX_SHOWS = 5000;
const MAX_KEYS = 50000;
const MAX_TEXT = 20000;
const MAX_SNAPSHOTS = 5;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

class LibraryModel {
  constructor() {
    this.dir = path.join(config.DATA_DIR, 'libraries');
  }

  emptyLibrary() {
    return { trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, updatedAt: null };
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
      cleanShows.push({ showId: t.showId, status: str(t.status, 30), addedAt: str(t.addedAt, 40) });
    }

    const cleanWatched = {};
    for (const [key, v] of Object.entries(watchedEpisodes)) {
      if (!EPISODE_KEY_RE.test(key) || !isPlainObject(v)) throw new Error('Item inválido em watchedEpisodes.');
      cleanWatched[key] = {
        watched: v.watched === true,
        watchedAt: str(v.watchedAt, 40),
        rewatchCount: Number.isInteger(v.rewatchCount) && v.rewatchCount > 0 ? Math.min(v.rewatchCount, 1000) : 1
      };
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

    return { trackedShows: cleanShows, watchedEpisodes: cleanWatched, episodeNotes: cleanNotes };
  }

  get(userId) {
    const file = this.filePathFor(userId);
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      if (err.code === 'ENOENT') return this.emptyLibrary();
      console.error(`[LibraryModel] Biblioteca ilegível para ${userId}:`, err.message);
      return this.emptyLibrary();
    }
  }

  // Grava o snapshot completo (last-write-wins) de forma atômica.
  save(userId, payload) {
    const file = this.filePathFor(userId);
    const library = { ...this.validate(payload), updatedAt: new Date().toISOString() };

    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(library), 'utf-8');
    fs.renameSync(tmp, file);
    return library;
  }
}

module.exports = new LibraryModel();
