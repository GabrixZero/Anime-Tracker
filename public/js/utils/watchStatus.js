// ================================================================
// SHOWVAULT · STATUS POR OBRA (regra única, funções puras)
// Usado pelo estado (state.js), pela lista, pelas estatísticas, pelo "A Seguir" e pelo seletor do modal,
// para que todas as telas concordem. Também roda em Node (testes).
//
// Status: watching (Assistindo), plan_to_watch (Quero ver), paused (Pausado), completed (Finalizado), dropped (Desisti).
// O status guardado é a verdade; `effectiveStatus` só corrige dados antigos (série com tudo assistido que nunca virou Finalizado).
// ================================================================

(function (root) {
  const STATUS_LIST = [
    { value: 'watching', label: 'Assistindo' },
    { value: 'plan_to_watch', label: 'Quero ver' },
    { value: 'paused', label: 'Pausado' },
    { value: 'completed', label: 'Finalizado' },
    { value: 'dropped', label: 'Desisti' }
  ];
  const STATUS_VALUES = STATUS_LIST.map(s => s.value);
  const STATUS_LABELS = Object.fromEntries(STATUS_LIST.map(s => [s.value, s.label]));

  // Valor desconhecido ou vazio (dados antigos) vira "Assistindo".
  function normalizeStatus(status) {
    return STATUS_VALUES.includes(status) ? status : 'watching';
  }

  function statusLabel(status) {
    return STATUS_LABELS[normalizeStatus(status)];
  }

  // Anime: cada temporada pode ser 'season' (TV normal), 'movie' ou 'special' (OVA/especial). Sem `category` = temporada normal.
  function seasonCategory(season) {
    return (season && season.category) || 'season';
  }

  function isExtraSeason(season) {
    return seasonCategory(season) !== 'season';
  }

  // Temporadas que contam no progresso e no "Finalizado": as normais. Se a obra só tem extras (anime só de filme/OVA), eles contam.
  function mainSeasons(media) {
    const seasons = (media && media.seasons) || [];
    const normal = seasons.filter(s => !isExtraSeason(s));
    return normal.length > 0 ? normal : seasons;
  }

  // Progresso da obra. `isWatched(seasonNum, epNum)`; para filme é chamado sem argumentos.
  // Sem episódios conhecidos (catálogo incompleto) => total 0 e complete=false. Extras (filmes/OVAs) ficam de fora (ver mainSeasons).
  function computeProgress(media, isWatched) {
    if (!media) return { total: 0, watched: 0, complete: false };
    if (media.type === 'movie') {
      const w = isWatched() ? 1 : 0;
      return { total: 1, watched: w, complete: w === 1 };
    }
    let total = 0;
    let watched = 0;
    for (const season of mainSeasons(media)) {
      for (const ep of season.episodes || []) {
        total++;
        if (isWatched(season.season_number, ep.episode_number)) watched++;
      }
    }
    return { total, watched, complete: total > 0 && watched === total };
  }

  // Marcar o episódio N também marca os anteriores (Ajustes 2, D-AV2-3): as temporadas anteriores inteiras e os episódios anteriores da
  // mesma temporada (a temporada 0, de especiais, só entra se for a do próprio episódio). NÃO entram episódios com data futura (ainda não
  // lançados) nem os já assistidos; episódio sem data conta como lançado. Devolve [{ season, episode }] SEM o episódio clicado.
  // `isWatched(season, episode)`; `todayKey` = 'AAAA-MM-DD' de hoje (fuso do navegador).
  function episodesToCascade(media, seasonNum, epNum, isWatched, todayKey) {
    if (!media || (media.type !== 'tv' && media.type !== 'anime')) return [];
    const s0 = Number(seasonNum);
    const e0 = Number(epNum);
    const out = [];
    const clicked = (media.seasons || []).find(s => Number(s.season_number) === s0);
    if (clicked && isExtraSeason(clicked)) return []; // filme/OVA não puxa nada para trás
    for (const season of media.seasons || []) {
      const sn = Number(season.season_number);
      const before = sn === s0 ? true : sn > 0 && sn < s0;
      if (!before) continue;
      if (sn !== s0 && isExtraSeason(season)) continue; // extras de outras temporadas não entram na cascata
      for (const ep of season.episodes || []) {
        const en = Number(ep.episode_number);
        if (sn === s0 && !(en < e0)) continue;
        const day = String(ep.air_date || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && todayKey && day > todayKey) continue; // ainda não lançado
        if (isWatched(sn, en)) continue;
        out.push({ season: sn, episode: en });
      }
    }
    return out;
  }
  // Status que a tela deve mostrar/contar. Correção só para itens antigos (sem updatedAt = nunca tocados pelas regras da S03):
  // série/filme com tudo assistido e status "Assistindo/Quero ver" aparece como "Finalizado". Itens novos valem como estão
  // (assim o usuário ainda pode escolher "Assistindo" para rever uma série).
  // `progress` (opcional) = progresso já calculado/em cache (S09); sem ele, calcula com `isWatched`.
  function effectiveStatus(tracked, media, isWatched, progress) {
    const status = normalizeStatus(tracked && tracked.status);
    const legacy = !(tracked && tracked.updatedAt);
    if (
      legacy &&
      media &&
      (status === 'watching' || status === 'plan_to_watch') &&
      (progress || computeProgress(media, isWatched)).complete
    ) {
      return 'completed';
    }
    return status;
  }

  // Status inicial ao adicionar à lista, conforme o que já foi assistido.
  function initialStatus(progress) {
    if (progress && progress.complete) return 'completed';
    if (progress && progress.watched > 0) return 'watching';
    return 'plan_to_watch';
  }

  // Novo status depois que o progresso muda. `marked` = true ao marcar episódios, false ao desmarcar.
  // Pausado/Desisti/Quero ver voltam para Assistindo quando o usuário marca algo; Finalizado volta ao desmarcar.
  function statusAfterProgress(current, media, progress, marked) {
    const status = normalizeStatus(current);
    if (progress.complete) return 'completed';
    if (media && media.type === 'movie') {
      return marked ? 'completed' : status === 'completed' ? 'plan_to_watch' : status;
    }
    if (marked) return status === 'watching' ? status : 'watching';
    if (status === 'completed') return progress.watched > 0 ? 'watching' : 'plan_to_watch';
    return status;
  }

  // Aparece na fila "A Seguir"? Finalizado, Desisti e Pausado ficam de fora.
  function isQueueStatus(status) {
    const s = normalizeStatus(status);
    return s === 'watching' || s === 'plan_to_watch';
  }

  // <option>s do seletor (valores e rótulos fixos, sem dados externos).
  function statusOptionsHtml(selected) {
    const current = normalizeStatus(selected);
    return STATUS_LIST.map(s => `<option value="${s.value}"${s.value === current ? ' selected' : ''}>${s.label}</option>`).join('');
  }

  const api = {
    STATUS_LIST,
    STATUS_VALUES,
    STATUS_LABELS,
    seasonCategory,
    isExtraSeason,
    mainSeasons,
    normalizeStatus,
    statusLabel,
    computeProgress,
    episodesToCascade,
    effectiveStatus,
    initialStatus,
    statusAfterProgress,
    isQueueStatus,
    statusOptionsHtml
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WatchStatus = api;
})(typeof window !== 'undefined' ? window : null);
