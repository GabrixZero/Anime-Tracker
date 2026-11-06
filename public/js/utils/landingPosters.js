// Landing: pôsteres dos 3 títulos de exemplo (D-CL-3). Busca GET /api/landing/featured (público, só leitura) e põe um <img> sobre o cartão
// ilustrado em CSS. Qualquer falha (offline, sem chave do TMDB, resposta estranha, imagem que não carrega) deixa o cartão como está:
// o espaço do pôster já tem tamanho fixo, então a página nunca pula. Só roda quando a landing está na tela.
(function () {
  'use strict';
  const IMAGE_HOST = /^https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;

  function attach(slot, item) {
    if (!slot || !item || typeof item.title !== 'string' || typeof item.posterUrl !== 'string' || !IMAGE_HOST.test(item.posterUrl)) return;
    const img = document.createElement('img');
    img.width = 48;
    img.height = 72;
    img.alt = item.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.className = 'lp-mock-img';
    img.addEventListener('error', function () {
      if (img.parentNode) img.parentNode.removeChild(img);
    });
    img.src = item.posterUrl;
    slot.appendChild(img);
  }

  function run() {
    if (document.documentElement.getAttribute('data-view') !== 'landing' || typeof fetch !== 'function') return;
    fetch('/api/landing/featured', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (body) {
        const list = body && Array.isArray(body.data) ? body.data.slice(0, 3) : [];
        list.forEach(function (item) {
          if (!item || typeof item.type !== 'string') return;
          attach(document.querySelector('.lp-mock-poster[data-featured="' + item.type.replace(/[^a-z]/g, '') + '"]'), item);
        });
      })
      .catch(function () {
        /* sem pôsteres: o cartão ilustrado continua */
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
