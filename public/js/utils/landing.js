// ================================================================
// SHOWVAULT · LANDING PAGE (página de apresentação)
// Decide, ANTES do primeiro desenho da página, se a pessoa vê a landing ou o app. Este script é carregado no <head>, sem defer:
// a escolha vira o atributo <html data-view="landing|app"> e o CSS (css/landing.css) mostra só um dos dois. Sem piscar a tela errada.
// Regra (D-LP-1): app se houver token de conta (checagem síncrona, sem rede) OU se a pessoa já escolheu usar sem conta neste aparelho.
// A validade do token continua sendo conferida pelo AuthView (um 401 encerra a sessão, como antes). Script externo (CSP estrita).
// Módulo "dual": navegador + Node (testes).
// ================================================================
(function (root) {
  'use strict';

  const TOKEN_KEY = 'showvault_auth_token';
  const VISITOR_KEY = 'showvault_visitor_ok';
  const APP_TITLE = 'ShowVault · Rastreador de Séries, Filmes e Animes';
  const APP_DESCRIPTION =
    'Acompanhe séries, filmes e animes: progresso episódio por episódio, diário de anotações com histórico de versões e estatísticas de tempo assistido.';

  // Pura: recebe o que está guardado e devolve 'app' ou 'landing'.
  function decideView({ token, visitor } = {}) {
    if (typeof token === 'string' && token.trim() !== '') return 'app';
    if (visitor === '1') return 'app';
    return 'landing';
  }

  function readStored(storage) {
    try {
      return { token: storage.getItem(TOKEN_KEY), visitor: storage.getItem(VISITOR_KEY) };
    } catch (_) {
      return {}; // armazenamento bloqueado: mostra a landing (dá para entrar como visitante mesmo assim)
    }
  }

  function setView(doc, view) {
    doc.documentElement.setAttribute('data-view', view);
    // O <title> e a descrição estáticos são os da landing; dentro do app voltam a ser os do app.
    if (view === 'app') {
      doc.title = APP_TITLE;
      const meta = doc.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', APP_DESCRIPTION);
    }
  }

  const api = { TOKEN_KEY, VISITOR_KEY, decideView, readStored, setView, APP_TITLE, APP_DESCRIPTION };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ---- navegador ----
  const doc = document;
  setView(doc, decideView(readStored(root.localStorage || { getItem: () => null })));

  function enterApp() {
    setView(doc, 'app');
    const main = doc.getElementById('main-content');
    if (main) main.focus({ preventScroll: true });
    root.scrollTo(0, 0);
  }

  // Quem entra sem conta (ou sai da conta) continua no app nas próximas visitas.
  api.markVisitor = function () {
    try {
      root.localStorage.setItem(VISITOR_KEY, '1');
    } catch (_) {
      /* sem armazenamento: na próxima visita volta para a landing, sem problema */
    }
  };
  api.showApp = enterApp;
  root.Landing = api;

  doc.addEventListener('DOMContentLoaded', () => {
    doc.addEventListener('click', event => {
      const el = event.target.closest && event.target.closest('[data-landing]');
      if (!el) return;
      const what = el.getAttribute('data-landing');
      if (what === 'visitor') {
        api.markVisitor();
        enterApp();
        return;
      }
      const auth = root.authView;
      if (!auth) return;
      auth.open();
      if (what === 'register') auth.switchMode('register');
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
