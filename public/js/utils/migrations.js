// ================================================================
// SHOWVAULT · MIGRAÇÃO DA VERSÃO DO ESTADO (biblioteca do usuário)
// Roda no navegador (state.js) e no servidor (LibraryModel). Mesmo código nos dois lados.
//
// Versão 2 (S02 · D-11): o catálogo recomeçou do zero. Saem das bibliotecas apenas as referências às 4 obras
// que tinham sido ingeridas do TVMaze com o id "puro":
//   555 (Avatar), 13615 (My Hero Academia), 495 (Naruto)  -> removidos por completo
//   155 (Beauty & the Beast, série): removem-se as chaves "155_sX_eY"; a chave "155_movie" é o Batman (TMDB) e FICA.
// Nada mais é tocado e nenhuma biblioteca é apagada.
// ================================================================

(function (root) {
  const STATE_VERSION = 2;
  const RETIRED_SHOW_IDS = [555, 13615, 495];
  const LEGACY_SERIES_ID = 155;
  const KEY_RE = /^(\d+)_(movie|s\d+_e\d+)$/;

  const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  function isRetiredKey(key) {
    const m = KEY_RE.exec(key);
    if (!m) return false;
    const id = Number(m[1]);
    if (RETIRED_SHOW_IDS.includes(id)) return true;
    return id === LEGACY_SERIES_ID && m[2] !== 'movie';
  }

  function filterKeys(obj) {
    const out = {};
    let removed = 0;
    for (const [key, value] of Object.entries(obj)) {
      if (isRetiredKey(key)) removed++;
      else out[key] = value;
    }
    return { out, removed };
  }

  // Devolve {data, changed, removed}. Não altera o objeto recebido. fromVersion >= STATE_VERSION não faz nada.
  function migrateLibrary(data, fromVersion) {
    const version = Number.isInteger(fromVersion) && fromVersion > 0 ? fromVersion : 1;
    const removed = { trackedShows: 0, watchedEpisodes: 0, episodeNotes: 0 };
    if (version >= STATE_VERSION || !isPlainObject(data)) return { data, changed: false, removed };

    const watched = isPlainObject(data.watchedEpisodes) ? filterKeys(data.watchedEpisodes) : null;
    const notes = isPlainObject(data.episodeNotes) ? filterKeys(data.episodeNotes) : null;
    if (watched) removed.watchedEpisodes = watched.removed;
    if (notes) removed.episodeNotes = notes.removed;

    let tracked = data.trackedShows;
    if (Array.isArray(tracked)) {
      const allKeys = [...Object.keys(data.watchedEpisodes || {}), ...Object.keys(data.episodeNotes || {})];
      const hasLegacySeries = allKeys.some(k => { const m = KEY_RE.exec(k); return m && Number(m[1]) === LEGACY_SERIES_ID && m[2] !== 'movie'; });
      const hasBatman = allKeys.includes(`${LEGACY_SERIES_ID}_movie`);
      // O showId 155 só sai se há prova de que era a série antiga e nenhuma de que é o Batman (padrão conservador).
      tracked = tracked.filter(t => {
        const id = t && t.showId;
        if (RETIRED_SHOW_IDS.includes(id)) return false;
        if (id === LEGACY_SERIES_ID && hasLegacySeries && !hasBatman) return false;
        return true;
      });
      removed.trackedShows = data.trackedShows.length - tracked.length;
    }

    const changed = removed.trackedShows + removed.watchedEpisodes + removed.episodeNotes > 0;
    const next = { ...data };
    if (Array.isArray(tracked)) next.trackedShows = tracked;
    if (watched) next.watchedEpisodes = watched.out;
    if (notes) next.episodeNotes = notes.out;
    return { data: next, changed, removed };
  }

  const api = { STATE_VERSION, RETIRED_SHOW_IDS, migrateLibrary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.STATE_VERSION = STATE_VERSION;
    root.migrateLibrary = migrateLibrary;
  }
})(typeof window !== 'undefined' ? window : null);
