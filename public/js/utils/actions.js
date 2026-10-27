// ================================================================
// SHOWVAULT · DELEGAÇÃO DE EVENTOS (S10)
// Substitui TODOS os onclick/onchange/onerror inline por atributos de dados, o que permite uma CSP sem 'unsafe-inline'.
//
//   <button data-action="open-detail" data-show="12">          clique  -> Actions.on('open-detail', (el, event) => ...)
//   <select data-change-action="set-status" data-show="12">    change  -> Actions.onChange('set-status', ...)
//   <img data-fallback="poster">                               erro de imagem -> troca pela imagem local (Actions.fallbacks)
//
// Parâmetros vão em data-* (data-show, data-season, data-episode, ...) e são lidos com Actions.int(el, 'show').
// Os ouvintes ficam no `document` (um só para a página toda), então HTML recriado por innerHTML continua funcionando.
// Script "dual": navegador (window.Actions) e Node (fábrica createActionRouter, testada com DOM simulado).
// ================================================================

(function (root) {
  function createActionRouter(doc) {
    const clicks = new Map();
    const changes = new Map();
    const fallbacks = {}; // tipo de imagem -> caminho da imagem reserva local

    // Lê um inteiro de data-<name>; ausente ou inválido = null (0 é válido: temporada 0 = especiais).
    function int(el, name) {
      const raw = el && el.getAttribute ? el.getAttribute(`data-${name}`) : null;
      if (raw === null || raw === '') return null;
      const n = Number(raw);
      return Number.isInteger(n) ? n : null;
    }

    function dispatch(map, attr, event) {
      const start = event.target;
      const el = start && typeof start.closest === 'function' ? start.closest(`[${attr}]`) : null;
      if (!el) return;
      const handler = map.get(el.getAttribute(attr));
      if (!handler) return;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      try {
        handler(el, event);
      } catch (err) {
        console.error(`[Actions] ${el.getAttribute(attr)}:`, err);
      }
    }

    // Imagem que falhou: troca (uma vez) pela reserva do tipo; sem laço se a própria reserva falhar.
    function onImageError(event) {
      const img = event.target;
      if (!img || img.tagName !== 'IMG' || typeof img.getAttribute !== 'function') return;
      const kind = img.getAttribute('data-fallback');
      const url = kind && fallbacks[kind];
      if (!url || img.getAttribute('src') === url) return;
      img.setAttribute('src', url);
    }

    doc.addEventListener('click', event => dispatch(clicks, 'data-action', event));
    doc.addEventListener('change', event => dispatch(changes, 'data-change-action', event));
    doc.addEventListener('error', onImageError, true); // "error" não borbulha: captura

    return {
      on(name, handler) {
        clicks.set(name, handler);
      },
      onChange(name, handler) {
        changes.set(name, handler);
      },
      fallbacks,
      int,
      has: name => clicks.has(name) || changes.has(name),
      names: () => ({ click: [...clicks.keys()], change: [...changes.keys()] })
    };
  }

  const api = { createActionRouter };
  if (typeof document !== 'undefined') {
    root.Actions = createActionRouter(document);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
