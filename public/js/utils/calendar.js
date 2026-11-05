// ================================================================
// SHOWVAULT · CALENDÁRIO / AGENDA (S15): funções puras de datas e da lista de episódios por dia
// Script "dual": navegador (window.Calendar) e Node (module.exports, testes).
//
// Tudo aqui trabalha com DIA CIVIL ("2026-11-04"), sem hora. Os episódios chegam como data (TVMaze/TMDB) ou como data tirada do
// horário UTC (AniList); "hoje" vem do fuso do navegador (`dayKey(new Date())`). Limitação: um episódio que estreia à noite no
// Brasil pode aparecer um dia depois, porque a fonte só informa o dia.
// ================================================================

(function (root) {
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  const keyOf = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

  // 'YYYY-MM-DD' -> { y, m, d } se for um dia que existe de verdade (2026-02-30 não existe); senão null.
  function parseDay(text) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof text === 'string' ? text : '');
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return { y, m, d };
  }

  // Dia civil de um Date no fuso LOCAL do navegador (null se o Date for inválido).
  function dayKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return keyOf(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  const utcMs = key => {
    const day = parseDay(key);
    return day ? Date.UTC(day.y, day.m - 1, day.d) : null;
  };

  function fromUtcMs(ms) {
    const date = new Date(ms);
    return keyOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  // Soma n dias (pode ser negativo) a um dia; chave inválida = null.
  function addDays(key, n) {
    const ms = utcMs(key);
    if (ms === null || !Number.isInteger(n)) return null;
    return fromUtcMs(ms + n * 86400000);
  }

  // Quantos dias de `a` até `b` (positivo se `b` é depois); chave inválida = null.
  function diffDays(a, b) {
    const x = utcMs(a);
    const y = utcMs(b);
    if (x === null || y === null) return null;
    return Math.round((y - x) / 86400000);
  }

  // 0 = domingo ... 6 = sábado
  function weekday(key) {
    const ms = utcMs(key);
    return ms === null ? null : new Date(ms).getUTCDay();
  }

  // Segunda-feira da semana do dia (a semana vai de segunda a domingo).
  function startOfWeek(key) {
    const dow = weekday(key);
    return dow === null ? null : addDays(key, -((dow + 6) % 7));
  }

  function weekRange(key) {
    const start = startOfWeek(key);
    return start ? { from: start, to: addDays(start, 6) } : null;
  }

  // Intervalo (inclusive) de cada período do filtro.
  function rangeBounds(todayKey, range) {
    if (!parseDay(todayKey)) return null;
    if (range === 'week') return weekRange(todayKey);
    if (range === 'next30') return { from: todayKey, to: addDays(todayKey, 29) };
    return { from: todayKey, to: addDays(todayKey, 6) }; // 'next7' (padrão)
  }

  // Lista de episódios (e estreias de filmes) das obras da lista dentro do período, ordenada por data, nome, temporada, episódio.
  //  - trackedList: itens da lista ({ showId }); getMedia(showId) -> obra; isWatched(showId, season, episode) (filme: sem season/episode);
  //  - includeTracked(tracked) -> bool (ex.: status que entra na fila); sem ele, todas entram;
  //  - episódio sem data válida não entra (nunca se inventa data).
  function buildAgenda(trackedList, getMedia, isWatched, todayKey, { range = 'next7', includeTracked } = {}) {
    const bounds = rangeBounds(todayKey, range);
    if (!bounds || !Array.isArray(trackedList)) return [];
    const inRange = key => key >= bounds.from && key <= bounds.to; // chaves YYYY-MM-DD comparam bem como texto
    const items = [];
    const seen = new Set();

    for (const tracked of trackedList) {
      if (!tracked || seen.has(tracked.showId)) continue;
      seen.add(tracked.showId);
      if (typeof includeTracked === 'function' && !includeTracked(tracked)) continue;
      const media = getMedia(tracked.showId);
      if (!media) continue;

      const base = { showId: media.id, showName: media.name, type: media.type };
      if (media.type === 'movie') {
        const day = parseDay(String(media.first_air_date || '').slice(0, 10));
        const airDate = day ? keyOf(day.y, day.m, day.d) : null;
        if (airDate && airDate >= todayKey && inRange(airDate)) {
          items.push({
            ...base,
            seasonNumber: null,
            episodeNumber: null,
            title: 'Filme',
            airDate,
            watched: !!isWatched(media.id),
            daysFromToday: diffDays(todayKey, airDate)
          });
        }
        continue;
      }
      if (media.type !== 'tv' && media.type !== 'anime') continue;

      for (const season of media.seasons || []) {
        for (const ep of season.episodes || []) {
          const day = parseDay(String(ep.air_date || '').slice(0, 10));
          if (!day) continue;
          const airDate = keyOf(day.y, day.m, day.d);
          if (!inRange(airDate)) continue;
          items.push({
            ...base,
            seasonNumber: season.season_number,
            episodeNumber: ep.episode_number,
            title: ep.name || '',
            airDate,
            watched: !!isWatched(media.id, season.season_number, ep.episode_number),
            daysFromToday: diffDays(todayKey, airDate)
          });
        }
      }
    }

    items.sort(
      (a, b) =>
        a.airDate.localeCompare(b.airDate) ||
        String(a.showName).localeCompare(String(b.showName), 'pt-BR') ||
        (a.seasonNumber || 0) - (b.seasonNumber || 0) ||
        (a.episodeNumber || 0) - (b.episodeNumber || 0)
    );
    return items;
  }

  // Agrupa itens já ordenados por dia: [{ key, y, m, d, weekday, daysFromToday, items }]. Os rótulos ("Hoje"...) ficam na view.
  function groupByDay(items) {
    const groups = [];
    for (const item of items) {
      let group = groups[groups.length - 1];
      if (!group || group.key !== item.airDate) {
        const day = parseDay(item.airDate);
        group = {
          key: item.airDate,
          y: day.y,
          m: day.m,
          d: day.d,
          weekday: weekday(item.airDate),
          daysFromToday: item.daysFromToday,
          items: []
        };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }

  const api = { parseDay, dayKey, addDays, diffDays, weekday, startOfWeek, weekRange, rangeBounds, buildAgenda, groupByDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Calendar = api;
})(typeof window !== 'undefined' ? window : null);
