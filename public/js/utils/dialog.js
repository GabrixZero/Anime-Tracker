// ================================================================
// SHOWVAULT · DIÁLOGOS ACESSÍVEIS (S07)
// Script "dual": no navegador cria `window.Dialog`; no Node exporta a fábrica (testes com DOM simulado).
//
// O que faz por diálogo registrado (`Dialog.register(overlay, opções)`):
//  - garante role="dialog" + aria-modal no contêiner;
//  - ao abrir (classe `hidden` removida do overlay, por qualquer código): guarda quem tinha o foco,
//    deixa o resto da página inerte (`inert` + `aria-hidden`), move o foco para dentro e prende o Tab;
//  - Esc fecha o diálogo do topo;
//  - ao fechar: devolve o foco ao gatilho (ou ao elemento de mesmo `data-focus-key` se a tela foi redesenhada).
// Ele observa a classe `hidden`, então os pontos que abrem/fecham modais (`classList.add/remove('hidden')`)
// não precisam mudar; `Dialog.open/close` existem para código novo.
// ================================================================

(function (root) {
  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    'summary'
  ].join(',');

  // Função pura (testável): para onde o Tab deve ir dentro do diálogo?
  // list = elementos focáveis em ordem; active = elemento com foco; insideDialog = o foco está dentro?
  // Retorna o índice a focar, ou -1 se o navegador pode seguir o Tab normal.
  function nextFocusIndex(count, activeIndex, shift, insideDialog) {
    if (count === 0) return -2; // nada focável: foco no próprio diálogo
    if (!insideDialog || activeIndex < 0) return shift ? count - 1 : 0;
    if (shift && activeIndex === 0) return count - 1;
    if (!shift && activeIndex === count - 1) return 0;
    return -1;
  }

  function createDialogManager(doc, win) {
    const stack = [];            // diálogos ativos (o último é o do topo)
    const registry = new Map();  // overlay -> opções
    const marked = new Map();    // elemento deixado inerte por nós -> aria-hidden anterior
    let listening = false;
    let lastClickTarget = null;

    const win_ = win || (doc && doc.defaultView) || {};

    function isVisible(el) {
      return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
    }

    function focusables(container) {
      return Array.from(container.querySelectorAll(FOCUSABLE)).filter(isVisible);
    }

    function isConnected(el) {
      return !!el && (el.isConnected !== undefined ? el.isConnected : doc.contains(el));
    }

    function top() { return stack[stack.length - 1]; }
    function isActive(overlay) { return stack.some(e => e.overlay === overlay); }
    function isHiddenOverlay(overlay) { return overlay.classList.contains('hidden'); }

    // Tudo que é irmão do diálogo do topo fica inerte (menos regiões aria-live, como os avisos/toasts).
    function applyInert() {
      const t = top();
      const desired = new Set();
      if (t && t.overlay.parentElement) {
        Array.from(t.overlay.parentElement.children).forEach((el) => {
          if (el === t.overlay) return;
          if (el.hasAttribute('aria-live') || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) return;
          desired.add(el);
        });
      }
      marked.forEach((prev, el) => {
        if (desired.has(el)) return;
        el.removeAttribute('inert');
        if (prev === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', prev);
        marked.delete(el);
      });
      desired.forEach((el) => {
        if (marked.has(el)) return;
        marked.set(el, el.hasAttribute('aria-hidden') ? el.getAttribute('aria-hidden') : null);
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
      });
    }

    function resolve(container, ref) {
      if (!ref) return null;
      if (typeof ref !== 'string') return ref;
      return container.querySelector(ref);
    }

    function focusInitial(entry) {
      const { dialog, opts } = entry;
      if (opts.initialFocus === 'dialog') { dialog.focus(); return; } // leitor de tela anuncia o nome do diálogo
      let target = resolve(dialog, opts.initialFocus);
      const coarse = typeof win_.matchMedia === 'function' && win_.matchMedia('(pointer: coarse)').matches;
      // Em tela de toque, abrir direto num campo de texto levanta o teclado: foca o diálogo e deixa a pessoa escolher.
      if (target && coarse && /^(INPUT|TEXTAREA)$/.test(target.tagName)) target = null;
      if (!target && !opts.initialFocus) {
        const list = focusables(dialog);
        target = list.length ? list[0] : null;
      }
      (target || dialog).focus();
    }

    function activate(overlay) {
      if (isActive(overlay)) return;
      const opts = registry.get(overlay);
      if (!opts) return;
      const dialog = resolve(overlay, opts.dialog) || overlay;
      let opener = doc.activeElement;
      if (!opener || opener === doc.body || opener === doc.documentElement || overlay.contains(opener)) {
        opener = isConnected(lastClickTarget) && !overlay.contains(lastClickTarget) ? lastClickTarget : null;
      }
      // Gatilho dentro de outro diálogo aberto continua válido (nota aberta a partir dos detalhes).
      const entry = {
        overlay, dialog, opts, opener,
        openerKey: opener && opener.getAttribute ? opener.getAttribute('data-focus-key') : null
      };
      stack.push(entry);
      applyInert();
      focusInitial(entry);
    }

    function fallbackTarget(entry) {
      const t = top();
      if (t) return t.dialog;
      return doc.querySelector(entry.opts.fallbackFocus || '.nav-tab.active') || null;
    }

    function deactivate(overlay) {
      const index = stack.findIndex(e => e.overlay === overlay);
      if (index < 0) return;
      const entry = stack[index];
      const wasTop = index === stack.length - 1;
      stack.splice(index, 1);
      applyInert();

      const active = doc.activeElement;
      const focusLost = !active || active === doc.body || active === doc.documentElement || overlay.contains(active);
      if (!wasTop || !focusLost) return; // a pessoa já levou o foco para outro lugar de propósito

      let target = entry.opener;
      if ((!isConnected(target) || !isVisible(target)) && entry.openerKey) {
        target = doc.querySelector('[data-focus-key="' + String(entry.openerKey).replace(/"/g, '') + '"]');
      }
      if (!target || !isConnected(target) || !isVisible(target)) target = fallbackTarget(entry);
      if (target) target.focus();
    }

    function sync(overlay) {
      if (isHiddenOverlay(overlay)) deactivate(overlay); else activate(overlay);
    }

    function onKeydown(e) {
      const t = top();
      if (!t || e.defaultPrevented) return;
      if (e.key === 'Escape' && t.opts.closeOnEscape !== false) {
        e.preventDefault();
        close(t.overlay);
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables(t.dialog);
      const active = doc.activeElement;
      const inside = !!active && t.dialog.contains(active);
      const next = nextFocusIndex(list.length, list.indexOf(active), e.shiftKey, inside);
      if (next === -2) { e.preventDefault(); t.dialog.focus(); }
      else if (next >= 0) { e.preventDefault(); list[next].focus(); }
    }

    // Rede de segurança para navegadores sem `inert`: o foco não escapa do diálogo.
    function onFocusin(e) {
      const t = top();
      if (!t || t.dialog.contains(e.target)) return;
      const list = focusables(t.dialog);
      (list[0] || t.dialog).focus();
    }

    function onClickCapture(e) {
      const el = e.target && e.target.closest ? e.target.closest('button, a, [role="button"], [tabindex]') : null;
      if (el) lastClickTarget = el;
    }

    function listen() {
      if (listening) return;
      listening = true;
      doc.addEventListener('keydown', onKeydown);
      doc.addEventListener('focusin', onFocusin);
      doc.addEventListener('click', onClickCapture, true);
    }

    function register(overlay, opts = {}) {
      if (!overlay || registry.has(overlay)) return;
      registry.set(overlay, opts);
      const dialog = resolve(overlay, opts.dialog) || overlay;
      if (!dialog.getAttribute('role')) dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('tabindex', '-1');
      listen();
      const MO = win_.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (MO) new MO(() => sync(overlay)).observe(overlay, { attributes: true, attributeFilter: ['class'] });
      sync(overlay);
    }

    function open(overlay) {
      overlay.classList.remove('hidden');
      sync(overlay);
    }

    function close(overlay) {
      overlay.classList.add('hidden');
      sync(overlay);
    }

    return { register, open, close, sync, isActive, activeCount: () => stack.length };
  }

  const api = { createDialogManager, nextFocusIndex, FOCUSABLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) {
    root.Dialog = createDialogManager(window.document, window);
    root.DialogUtil = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
