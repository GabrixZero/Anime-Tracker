// ================================================================
// SHOWVAULT · UTILITÁRIOS DE DOM SEGUROS (anti-XSS)
// Carregado antes das views. Também funciona em Node (testes).
// ================================================================

(function (root) {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '`': '&#096;' };

  // Escapa qualquer valor (string, número, null...) para uso em texto ou atributo HTML.
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, ch => ESCAPES[ch]);
  }

  // Só deixa passar URLs http(s) ou imagens data:image/. Qualquer outra coisa vira ''.
  function safeUrl(url) {
    if (typeof url !== 'string') return '';
    const u = url.trim();
    if (/^https?:\/\//i.test(u) || /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(u)) return u;
    return '';
  }

  // URL segura já escapada para atributo HTML (src="...").
  function safeSrc(url) {
    return escapeHtml(safeUrl(url));
  }

  // Valor para `style.backgroundImage` (definido via JS, nunca via string HTML).
  // Codifica aspas, parênteses e barras que poderiam fechar o url(...).
  function cssUrl(url) {
    const u = safeUrl(url);
    if (!u) return 'none';
    const enc = u.replace(/[\s"'()\\<>]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
    return `url("${enc}")`;
  }

  // Inteiro seguro para usar dentro de onclick="..." (ids, temporadas, episódios).
  function toInt(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isInteger(n) ? n : fallback;
  }

  // Nota/avaliação numérica com 1 casa decimal; valores ausentes viram o fallback.
  function formatRating(value, fallback = '–') {
    const n = Number(value);
    return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n.toFixed(1) : fallback;
  }

  const api = { escapeHtml, safeUrl, safeSrc, cssUrl, toInt, formatRating };
  Object.assign(root, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
