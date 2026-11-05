// ================================================================
// SHOWVAULT · NOTA PESSOAL DE 0 A 10 (S17)
// Regra única da nota (uma casa decimal, ex. 2.3, 6.6, 9.2; 0 e 10 valem), estatísticas puras e HTML do controle de nota.
// Usada pelo navegador (state.js, telas), pelo servidor (LibraryModel.validate) e pelo backupValidator: mesmo código nos três.
// Script "dual": navegador (window.Rating) e Node (module.exports).
// ================================================================

(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dom = () => (isNode ? require('./dom') : root);

  const MIN = 0;
  const MAX = 10;
  const TOP_LIMIT = 5;
  // Faixas da distribuição: [início, fim). A última também inclui o 10.
  const BANDS = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]];

  // Sem nota informada (ausente, null ou texto vazio): é o jeito de pedir "remover a nota".
  const isEmptyRating = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

  // Número com 1 casa decimal (0..10) ou null se for inválido. Aceita número ou texto ("6.6"); nunca arredonda: 2.35 é inválido.
  function normalizeRating(value) {
    let n;
    if (typeof value === 'number') n = value;
    else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) n = Number(value.trim());
    else return null;
    if (!Number.isFinite(n) || n < MIN || n > MAX) return null;
    const tenths = Math.round(n * 10);
    if (Math.abs(n * 10 - tenths) > 1e-9) return null;
    return tenths / 10;
  }

  // "6.6" (sempre com uma casa)
  const formatUserRating = v => normalizeRating(v) === null ? '' : normalizeRating(v).toFixed(1);

  // items: [{ showId, title, rating }] (só os com nota válida entram).
  // Devolve { count, average (1 casa ou null), distribution: [{ label, count }], top: [{ showId, title, rating }] (até 5) }.
  function computeRatingStats(items) {
    const rated = [];
    for (const it of Array.isArray(items) ? items : []) {
      const rating = it ? normalizeRating(it.rating) : null;
      if (rating === null) continue;
      rated.push({ showId: it.showId, title: String(it.title === undefined || it.title === null ? '' : it.title), rating });
    }
    const sumTenths = rated.reduce((s, r) => s + Math.round(r.rating * 10), 0); // em décimos: sem erro de ponto flutuante
    const average = rated.length ? Math.round(sumTenths / rated.length) / 10 : null;
    const distribution = BANDS.map(([from, to], i) => ({
      label: `${from}–${to}`,
      count: rated.filter(r => r.rating >= from && (r.rating < to || (i === BANDS.length - 1 && r.rating <= to))).length
    }));
    const top = rated.slice().sort((a, b) =>
      b.rating - a.rating || a.title.localeCompare(b.title, 'pt-BR') || (Number(a.showId) - Number(b.showId))
    ).slice(0, TOP_LIMIT);
    return { count: rated.length, average, distribution, top };
  }

  // Controle de nota do modal/cartão. Tudo escapado; sem style/onclick. `idPrefix` torna o id do campo único por tela.
  // Confirma ao mudar o valor (Enter ou sair do campo) via data-change-action; "Remover nota" via data-action.
  function ratingControlHtml({ showId, name, rating, idPrefix = 'rating' }) {
    const { escapeHtml, toInt } = dom();
    const id = toInt(showId);
    const value = formatUserRating(rating);
    return `<div class="rating-control">
      <label class="rating-label" for="${escapeHtml(idPrefix)}-${id}">Minha nota (0 a 10)</label>
      <input type="number" class="rating-input" id="${escapeHtml(idPrefix)}-${id}" min="0" max="10" step="0.1" inputmode="decimal" value="${escapeHtml(value)}" aria-label="Minha nota (0 a 10) de ${escapeHtml(name)}" data-focus-key="${escapeHtml(idPrefix)}:${id}:input" data-change-action="set-rating" data-show="${id}">
      <button type="button" class="btn btn-sm btn-secondary rating-clear" data-focus-key="${escapeHtml(idPrefix)}:${id}:clear" data-action="clear-rating" data-show="${id}"${value === '' ? ' disabled' : ''}>Remover nota</button>
    </div>`;
  }

  // Linha "Nota do catálogo: ★ 8.5" (a nota pública vem da fonte; sem nota = "Sem nota"). `badge` = MediaDisplay.ratingBadge(valor).
  function catalogRatingHtml(badge) {
    const { escapeHtml } = dom();
    return `<span class="rating-catalog"><span class="rating-catalog-label">Nota do catálogo:</span> ${escapeHtml(badge)}</span>`;
  }

  // Selo "★ 6.6" da sua nota no cartão ('' sem nota)
  function userRatingBadgeHtml(rating) {
    const { escapeHtml } = dom();
    const text = formatUserRating(rating);
    return text ? `<span class="rating-user-badge" title="Minha nota">★ ${escapeHtml(text)}</span>` : '';
  }

  const api = {
    MIN, MAX, TOP_LIMIT, BANDS, isEmptyRating, normalizeRating, formatUserRating, computeRatingStats,
    ratingControlHtml, catalogRatingHtml, userRatingBadgeHtml
  };
  root.Rating = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
