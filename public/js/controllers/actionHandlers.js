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
  A.on('add-to-list', el => window.appController.addToList(show(el)));
  A.on('remove-from-list', el => window.appController.removeFromList(show(el)));
  A.on('quick-check', el => window.appController.quickCheck(show(el), season(el), episode(el)));
  A.on('more-episodes', el => window.detailModalView.showMoreEpisodes(season(el)));
  A.on('retry-details', () => window.appController.retryDetails());
  A.onChange('set-status', el => window.appController.setStatus(show(el), el.value));
  // Nota pessoal (S17): confirma ao mudar o valor (Enter ou sair do campo); "Remover nota" apaga
  A.onChange('set-rating', el => window.appController.setRating(show(el), el.value));
  A.on('clear-rating', el => window.appController.setRating(show(el), ''));

  // Detalhes e anotações
  // data-detail-mode="explore" (só a aba Explorar) abre o quadro enxuto; sem o atributo, o quadro completo
  A.on('open-detail', el => window.detailModalView.open(show(el), el.getAttribute('data-detail-mode') || 'full'));
  A.on('switch-season', el => window.detailModalView.switchSeason(season(el)));
  A.on('open-note', el => window.detailModalView.openNote(show(el), season(el), episode(el)));

  // Explorar
  A.on('retry-explore', () => window.exploreView.loadMedia());
  A.on('load-more', () => window.exploreView.loadMore());

  // A Seguir: filtro vazio -> voltar para "Todos"
  A.on('show-all-types', () => {
    const pill = document.querySelector('#view-next-up .type-pill-btn[data-type="all"]');
    if (pill) pill.click();
  });

  // Login
  // "Perdi a senha": por enquanto só um aviso (a recuperação por e-mail ainda não existe)
  A.on('forgot-password', () => document.getElementById('tvtime-forgot-note').classList.remove('hidden'));

  // Importar histórico (S16)
  A.on('import-apply', () => window.importView.apply());
  A.on('import-cancel', () => window.importView.cancel());
  A.on('import-close', () => window.importView.cancel());
  A.onChange('import-choice', el => window.importView.setChoice(A.int(el, 'index'), el.value));

  // Minha conta (S14)
  A.on('open-account', () => window.accountView.open());
  A.on('logout-all', () => window.accountView.handleLogoutAll());
})();
