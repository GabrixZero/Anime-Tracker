// ================================================================
// SHOWVAULT · MODO OFFLINE / APP INSTALÁVEL (S18)
// Registra o service worker (public/sw.js) e avisa quando a internet cai ou volta. Script externo (CSP estrita).
// ================================================================
(function () {
  function toast(message, type) {
    if (window.appController && typeof window.appController.showToast === 'function') window.appController.showToast(message, type);
  }

  function onNetworkChange() {
    const offline = navigator.onLine === false;
    document.body.classList.toggle('is-offline', offline);
    if (offline) toast('Sem conexão: você pode consultar sua lista. O que mudar fica salvo neste aparelho e sincroniza quando a internet voltar.', 'info');
    else if (window.__wasOffline) toast('Conexão de volta.', 'success');
    window.__wasOffline = offline;
  }
  window.addEventListener('offline', onNetworkChange);
  window.addEventListener('online', onNetworkChange);
  if (navigator.onLine === false) window.addEventListener('DOMContentLoaded', onNetworkChange);

  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Modo offline indisponível:', err.message));
    // Nova versão do app assumiu o controle: avisa para recarregar quando for conveniente (nunca recarrega sozinho).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Há uma versão nova do ShowVault. Recarregue a página para usá-la.', 'info');
    });
  });
})();
