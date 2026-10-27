// ================================================================
// SHOWVAULT · TEXTOS E IMAGENS DE OBRA SEM DADOS INVENTADOS (S08)
// Quando a fonte não informa nota, gênero, imagem ou duração, as telas dizem isso
// ("Sem nota", "Sem gênero", imagem neutra local) em vez de mostrar um valor de enfeite.
// Script "dual": navegador (window.MediaDisplay) e Node (module.exports).
// ================================================================

(function (root) {
  // Arquivos locais em public/img (nada de imagem de terceiros como reserva)
  const POSTER_PLACEHOLDER = 'img/poster-placeholder.svg';
  const STILL_PLACEHOLDER = 'img/still-placeholder.svg';

  // Status que vêm em inglês das fontes externas (TVMaze/Jikan) -> português. O resto passa como veio.
  const STATUS_PT = {
    'running': 'Em exibição',
    'ended': 'Finalizada',
    'to be determined': 'A definir',
    'in development': 'Em desenvolvimento',
    'canceled': 'Cancelada',
    'cancelled': 'Cancelada',
    'currently airing': 'Em exibição',
    'finished airing': 'Finalizada',
    'not yet aired': 'Ainda não lançada',
    'released': 'Lançado',
    'upcoming': 'Em breve'
  };

  // Só vale nota numérica maior que zero (null, vazio e 0,0 = ninguém avaliou)
  function hasRating(value) {
    if (value === null || value === undefined || value === '') return false;
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  // "★ 8.5" ou "Sem nota"
  function ratingBadge(value) {
    return hasRating(value) ? `★ ${Number(value).toFixed(1)}` : 'Sem nota';
  }

  // "Drama, Crime" ou "Sem gênero"
  function genresText(genres, limit) {
    const list = (Array.isArray(genres) ? genres : []).filter(g => typeof g === 'string' && g.trim());
    if (!list.length) return 'Sem gênero';
    return (limit ? list.slice(0, limit) : list).join(', ');
  }

  function statusText(status) {
    if (typeof status !== 'string' || !status.trim()) return '';
    return STATUS_PT[status.trim().toLowerCase()] || status.trim();
  }

  // "2024" ou "" (sem data, não mostra nada)
  function yearText(date) {
    const y = date ? String(date).slice(0, 4) : '';
    return /^\d{4}$/.test(y) ? y : '';
  }

  // Duração informada pela fonte (minutos > 0) ou 0 quando não existe
  function knownRuntime(runtime) {
    const n = Number(runtime);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // "45 min" ou "" (não inventa duração)
  function runtimeText(runtime) {
    const n = knownRuntime(runtime);
    return n ? `${n} min` : '';
  }

  const api = {
    POSTER_PLACEHOLDER, STILL_PLACEHOLDER, STATUS_PT,
    hasRating, ratingBadge, genresText, statusText, yearText, knownRuntime, runtimeText
  };
  root.MediaDisplay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
