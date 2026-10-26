// ================================================================
// SHOWVAULT · VALIDAÇÃO DE BACKUP IMPORTADO
// Mesmas regras de server/models/LibraryModel.js (validate). Também roda em Node.
// ================================================================

(function (root) {
  const EPISODE_KEY_RE = /^\d+_(movie|s\d+_e\d+)$/;
  const MAX_SHOWS = 5000;
  const MAX_KEYS = 50000;
  const MAX_TEXT = 20000;
  const MAX_SNAPSHOTS = 5;

  const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

  // libraryMerge.js (carregado antes de qualquer uso): navegador = window.LibraryMerge; Node = require.
  const merge = () => (typeof module !== 'undefined' && module.exports ? require('./libraryMerge') : root.LibraryMerge);

  // Retorna uma cópia saneada {trackedShows, watchedEpisodes, episodeNotes, tombstones, resetAt} ou lança Error com mensagem em português.
  function validateBackup(payload) {
    if (!isPlainObject(payload)) throw new Error('Backup inválido.');
    const { trackedShows, watchedEpisodes, episodeNotes } = payload;

    if (!Array.isArray(trackedShows) || !isPlainObject(watchedEpisodes) || !isPlainObject(episodeNotes)) {
      throw new Error('Backup inválido: faltam trackedShows, watchedEpisodes ou episodeNotes.');
    }
    if (trackedShows.length > MAX_SHOWS
      || Object.keys(watchedEpisodes).length > MAX_KEYS
      || Object.keys(episodeNotes).length > MAX_KEYS) {
      throw new Error('Backup grande demais.');
    }

    const seen = new Set();
    const cleanShows = [];
    for (const t of trackedShows) {
      if (!isPlainObject(t) || !Number.isInteger(t.showId) || seen.has(t.showId)) {
        throw new Error('Backup inválido: item incorreto em trackedShows.');
      }
      seen.add(t.showId);
      const show = { showId: t.showId, status: str(t.status, 30), addedAt: str(t.addedAt, 40) };
      const updatedAt = merge().cleanStamp(t.updatedAt);
      if (updatedAt) show.updatedAt = updatedAt;
      cleanShows.push(show);
    }

    const cleanWatched = {};
    for (const [key, v] of Object.entries(watchedEpisodes)) {
      if (!EPISODE_KEY_RE.test(key) || !isPlainObject(v)) throw new Error('Backup inválido: item incorreto em watchedEpisodes.');
      cleanWatched[key] = {
        watched: v.watched === true,
        watchedAt: str(v.watchedAt, 40),
        rewatchCount: Number.isInteger(v.rewatchCount) && v.rewatchCount > 0 ? Math.min(v.rewatchCount, 1000) : 1
      };
      const updatedAt = merge().cleanStamp(v.updatedAt);
      if (updatedAt) cleanWatched[key].updatedAt = updatedAt;
    }

    const cleanNotes = {};
    for (const [key, n] of Object.entries(episodeNotes)) {
      if (!EPISODE_KEY_RE.test(key) || !isPlainObject(n)) throw new Error('Backup inválido: item incorreto em episodeNotes.');
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

    const fail = () => { throw new Error('Backup inválido: item incorreto em tombstones.'); };
    const tombstones = merge().cleanTombstones(payload.tombstones, fail);
    const resetAt = merge().cleanStamp(payload.resetAt);

    return { trackedShows: cleanShows, watchedEpisodes: cleanWatched, episodeNotes: cleanNotes, tombstones, resetAt };
  }

  const api = { validateBackup };
  Object.assign(root, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
