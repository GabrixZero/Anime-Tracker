// ================================================================
// SHOWVAULT · AÇÕES DA INTERFACE (S10)
// Tabela única: nome em data-action / data-change-action -> o que fazer. Carregado por último (usa os outros objetos globais
// só na hora do clique, então a ordem entre eles não importa). Parâmetros: data-show, data-season, data-episode, data-goto, data-mode.
// ================================================================

(function () {
  const A = window.Actions;
  if (!A) return;

  const show = el => A.int(el, 'show');
  const season = el => A.int(el, 'season');
  const episode = el => A.int(el, 'episode');

  A.fallbacks.poster = window.MediaDisplay.POSTER_PLACEHOLDER;
  A.fallbacks.still = window.MediaDisplay.STILL_PLACEHOLDER;

  // Navegação e listas
  A.on('goto-tab', el => window.appController.switchTab(el.getAttribute('data-goto')));
  A.on('load-example', () => window.appController.loadExample());
  A.on('add-to-list', el => window.appController.addToList(show(el)));
  A.on('remove-from-list', el => window.appController.removeFromList(show(el)));
  A.on('quick-check', el => window.appController.quickCheck(show(el), season(el), episode(el)));
  A.on('retry-details', () => window.appController.retryDetails());
  A.onChange('set-status', el => window.appController.setStatus(show(el), el.value));

  // Detalhes e anotações
  A.on('open-detail', el => window.detailModalView.open(show(el)));
  A.on('open-note', el => window.detailModalView.openNote(show(el), season(el), episode(el)));
  A.on('switch-season', el => window.detailModalView.switchSeason(season(el)));

  // Explorar
  A.on('retry-explore', () => window.exploreView.loadMedia());
  A.on('load-more', () => window.exploreView.loadMore());

  // A Seguir: filtro vazio -> voltar para "Todos"
  A.on('show-all-types', () => {
    const pill = document.querySelector('#view-next-up .type-pill-btn[data-type="all"]');
    if (pill) pill.click();
  });

  // Login
  A.on('auth-mode', el => window.authView.switchMode(el.getAttribute('data-mode')));
})();
