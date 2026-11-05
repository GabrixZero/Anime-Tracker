// ================================================================
// SHOWVAULT · TOP GÊNEROS (contagem pura)
// Conta o gênero da OBRA INTEIRA (série, filme ou anime), uma vez por obra, e só das obras que estão em Minha Lista.
// Não depende de episódios assistidos (o progresso de obras removidas fica guardado e não pode contar).
// Obra sem gênero conta como "Sem gênero" (mesma convenção de MediaDisplay.genresText).
// Script "dual": navegador (window.GenreStats) e Node (module.exports).
// ================================================================

(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  const NO_GENRE = 'Sem gênero';

  // trackedShows: [{ showId }] (Minha Lista); getMedia(showId) -> obra com `genres` ou undefined.
  // Devolve [{ genre, count }] do maior para o menor (empate: ordem alfabética), até `limit` itens (sem limite se omitido).
  function countGenres(trackedShows, getMedia, limit) {
    const counts = new Map();
    const seen = new Set();
    for (const tracked of Array.isArray(trackedShows) ? trackedShows : []) {
      if (!tracked || seen.has(String(tracked.showId))) continue; // uma vez por obra
      seen.add(String(tracked.showId));
      const media = getMedia(tracked.showId);
      if (!media) continue; // detalhe ainda não carregado: não inventa gênero
      const own = Array.isArray(media.genres) ? media.genres.filter(g => typeof g === 'string' && g.trim()).map(g => g.trim()) : [];
      for (const genre of new Set(own.length ? own : [NO_GENRE])) counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    const sorted = [...counts]
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre, 'pt-BR'));
    return limit ? sorted.slice(0, limit) : sorted;
  }

  const api = { NO_GENRE, countGenres };
  root.GenreStats = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
