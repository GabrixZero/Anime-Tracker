// ================================================================
// SHOWVAULT · ACESSIBILIDADE (S07): teclado, ARIA e foco
// Script "dual": no navegador liga tudo em DOMContentLoaded; no Node exporta as funções puras (testes).
//
// Em vez de espalhar `aria-*` por todas as views, este arquivo:
//  1. registra os 4 modais no `Dialog` (utils/dialog.js);
//  2. espelha o estado visual (classe `active`) em `aria-pressed` / `aria-selected` + `tabindex` das abas;
//  3. liga as setas/Home/End nas listas de abas (principal, login e temporadas);
//  4. preserva o foco quando uma view redesenha seu HTML (marcar episódio recria os botões).
// Os templates só precisam de `data-focus-key="<grupo>:<id>:<ação>"` nos botões que mudam de lugar.
// ================================================================

(function (root) {
  // Função pura: qual aba recebe o foco depois de uma tecla? (-1 = tecla não tratada)
  function nextTabIndex(key, index, count) {
    if (count <= 0) return -1;
    if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return -1;
  }

  // "nu:12:check" -> grupo "nu:12:" (mesma obra/episódio, outra ação)
  function groupOf(key) {
    const i = key.lastIndexOf(':');
    return i >= 0 ? key.slice(0, i + 1) : key;
  }

  // "nu:12:check" -> "check"
  function actionOf(key) {
    const i = key.lastIndexOf(':');
    return i >= 0 ? key.slice(i + 1) : key;
  }

  const api = { nextTabIndex, groupOf, actionOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || !window.document) return;

  const doc = window.document;
  const keySel = (k) => '[data-focus-key="' + String(k).replace(/"/g, '') + '"]';

  // ---------- 2. classe `active` -> atributos ARIA ----------
  function updateFromClass(el, mode) {
    const on = el.classList.contains('active');
    if (mode === 'tab') {
      el.setAttribute('aria-selected', String(on));
      el.setAttribute('tabindex', on ? '0' : '-1');
    } else {
      el.setAttribute('aria-pressed', String(on));
    }
  }

  function mirrorActive(selector, mode) {
    const apply = () => doc.querySelectorAll(selector).forEach(el => updateFromClass(el, mode));
    apply();
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.target.matches && r.target.matches(selector)) updateFromClass(r.target, mode);
      }
    }).observe(doc.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    return apply;
  }

  // ---------- 3. setas nas abas ----------
  // auto = ativa a aba ao mover (barato: temporadas, login); senão só move o foco e Enter/Espaço ativam (abas principais).
  function enableTablist(container, { auto = false } = {}) {
    if (!container) return;
    container.addEventListener('keydown', (e) => {
      const tab = e.target.closest && e.target.closest('[role="tab"]');
      if (!tab || e.altKey || e.ctrlKey || e.metaKey) return;
      const tabs = Array.from(container.querySelectorAll('[role="tab"]')).filter(t => t.getClientRects().length > 0);
      const next = nextTabIndex(e.key, tabs.indexOf(tab), tabs.length);
      if (next < 0) return;
      e.preventDefault();
      tabs[next].focus();
      if (auto) tabs[next].click();
    });
  }

  // ---------- 4. foco que sobrevive ao redesenho ----------
  // Guarda a chave do elemento com foco e a posição dele entre os de mesma ação (ex.: o 3º botão "check").
  function activeKeyWithin(container) {
    const a = doc.activeElement;
    const key = a && container.contains(a) ? a.getAttribute('data-focus-key') : null;
    if (!key) return null;
    const action = actionOf(key);
    const same = Array.from(container.querySelectorAll('[data-focus-key]')).filter(el => actionOf(el.getAttribute('data-focus-key')) === action);
    return { key, action, index: same.indexOf(a) };
  }

  function restoreFocus(container, saved, section) {
    const exact = container.querySelector(keySel(saved.key));
    if (exact) { exact.focus(); return; }
    const sibling = container.querySelector('[data-focus-key^="' + groupOf(saved.key).replace(/"/g, '') + '"]');
    if (sibling) { sibling.focus(); return; }
    // O item saiu da lista: vai para o próximo da mesma ação (ou o último), como um leitor esperaria.
    const same = Array.from(container.querySelectorAll('[data-focus-key]')).filter(el => actionOf(el.getAttribute('data-focus-key')) === saved.action);
    if (same.length) { same[Math.min(Math.max(saved.index, 0), same.length - 1)].focus(); return; }
    // O item sumiu (ex.: episódio concluído saiu da fila): foco no título da tela, para não cair no <body>.
    const heading = section ? section.querySelector('h2') : null;
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
  }

  function wrapRender(obj, method, containerSelector, sectionSelector) {
    if (!obj || typeof obj[method] !== 'function') return;
    const original = obj[method];
    obj[method] = function (...args) {
      const container = doc.querySelector(containerSelector);
      const saved = container ? activeKeyWithin(container) : null;
      const result = original.apply(this, args);
      if (saved && container) restoreFocus(container, saved, sectionSelector ? doc.querySelector(sectionSelector) : null);
      return result;
    };
  }

  // ---------- 1. + tudo junto ----------
  function init() {
    const D = window.Dialog;
    if (D) {
      D.register(doc.getElementById('tvtime-auth-modal'), { dialog: '.tvtime-auth-card', initialFocus: '#input-tvtime-email' });
      D.register(doc.getElementById('modal-show-detail'), { dialog: '.modal-container', initialFocus: 'dialog' });
      D.register(doc.getElementById('modal-episode-note'), { dialog: '.modal-container', initialFocus: '#note-textarea' });
      D.register(doc.getElementById('modal-backup'), { dialog: '.modal-container', initialFocus: 'dialog' });
    }

    mirrorActive('.nav-tab', 'tab');
    mirrorActive('.tvtime-tab-btn', 'tab');
    mirrorActive('.type-pill-btn, .pill-btn, .emotion-btn', 'pressed');

    enableTablist(doc.getElementById('main-nav'), { auto: false });
    enableTablist(doc.getElementById('tvtime-auth-tabs'), { auto: true });
    enableTablist(doc.getElementById('show-seasons-tabs'), { auto: true });

    wrapRender(window.nextUpView, 'render', '#next-up-container', '#view-next-up');
    wrapRender(window.watchlistView, 'render', '#watchlist-container', '#view-watchlist');
    wrapRender(window.diaryView, 'render', '#diary-container', '#view-diary');
    // S09: troca de um só cartão/linha ao marcar episódio (o foco volta ao mesmo botão do cartão novo)
    wrapRender(window.nextUpView, 'updateShow', '#next-up-container', '#view-next-up');
    wrapRender(window.watchlistView, 'updateShow', '#watchlist-container', '#view-watchlist');
    const dv = window.detailModalView;
    wrapRender(dv, 'renderEpisodes', '#show-episodes-container');
    wrapRender(dv, 'renderSeasonTabs', '#show-seasons-tabs');
    wrapRender(dv, 'open', '#modal-show-detail');
  }

  // Registrado antes do appController (ordem dos <script>), então roda primeiro.
  doc.addEventListener('DOMContentLoaded', init);
  root.A11y = Object.assign({ init, mirrorActive, enableTablist, wrapRender }, api);
})(typeof window !== 'undefined' ? window : globalThis);
