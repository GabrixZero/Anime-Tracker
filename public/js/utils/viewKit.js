// ================================================================
// SHOWVAULT · PEÇAS COMUNS DAS TELAS (S10)
// O que as views repetiam: selo de tipo (Série/Anime/Filme), imagem com reserva local, leitura da chave de episódio
// "<id>_s<T>_e<E>" / "<id>_movie", classe da barra de progresso e a estrutura das telas vazias.
// Script "dual": navegador (window.ViewKit) e Node (module.exports). Em Node usa os utilitários por require.
// ================================================================

(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dom = () => (isNode ? require('./dom') : root);
  const media = () => root.MediaDisplay || (isNode ? require('./mediaDisplay') : null);

  const TYPE_BADGES = {
    movie: ['badge-type-movie', 'Filme'],
    anime: ['badge-type-anime', 'Anime'],
    tv: ['badge-type-tv', 'Série']
  };

  // <span class="badge-type-tag badge-type-...">Série</span> (qualquer tipo desconhecido vira Série)
  function typeBadge(type) {
    const [cls, label] = TYPE_BADGES[type] || TYPE_BADGES.tv;
    return `<span class="badge-type-tag ${cls}">${label}</span>`;
  }

  // Atributos src + data-fallback de uma imagem: se a URL for ruim ou a imagem não carregar, entra a imagem local do tipo
  // (a troca em caso de erro é feita por Actions, sem onerror inline).
  function imgAttrs(url, kind = 'poster') {
    const MD = media();
    const placeholder = kind === 'still' ? MD.STILL_PLACEHOLDER : MD.POSTER_PLACEHOLDER;
    return `src="${dom().safeSrc(url) || placeholder}" data-fallback="${kind === 'still' ? 'still' : 'poster'}"`;
  }

  // Chave de episódio -> { showId, seasonNum, epNum, isMovie }; chave fora do padrão = null.
  function parseKey(key) {
    if (typeof key !== 'string') return null;
    let m = /^(\d+)_movie$/.exec(key);
    if (m) return { showId: Number(m[1]), seasonNum: null, epNum: null, isMovie: true };
    m = /^(\d+)_s(\d+)_e(\d+)$/.exec(key);
    if (m) return { showId: Number(m[1]), seasonNum: Number(m[2]), epNum: Number(m[3]), isMovie: false };
    return null;
  }

  function makeKey(showId, seasonNum, epNum, isMovie = false) {
    return isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
  }

  // Classe CSS da largura de uma barra de progresso (0 a 100, arredondado): .pct-NN em css/views.css.
  // Existe porque `style="width: N%"` no HTML é bloqueado pela CSP.
  function pctClass(percent) {
    const n = Number(percent);
    const p = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
    return `pct-${p}`;
  }

  // Tela vazia padrão. `icon` é SVG fixo do código (nunca texto de usuário); title/text são escapados; actionsHtml vem de templates do código.
  function emptyStateHtml({ iconSvg, iconClass = 'empty-icon--muted', title, text = '', narrow = false, actionsHtml = '' }) {
    const { escapeHtml } = dom();
    return `
      <div class="empty-icon ${iconClass}">${iconSvg}</div>
      <h3 class="empty-title">${escapeHtml(title)}</h3>
      <p class="empty-text${narrow ? ' empty-text--narrow' : ''}">${escapeHtml(text)}</p>
      ${actionsHtml}
    `;
  }

  const api = { typeBadge, imgAttrs, parseKey, makeKey, pctClass, emptyStateHtml };
  root.ViewKit = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
