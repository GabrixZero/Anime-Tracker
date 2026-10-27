// ================================================================
// SHOWVAULT · CONTROLADOR PRINCIPAL DA APLICAÇÃO (MVC)
// ================================================================

class AppController {
  constructor() {
    this.activeTab = 'next-up';
    // S09 · render incremental: só a aba visível é redesenhada; as outras guardam "ficou desatualizada" e redesenham ao abrir.
    this.dirty = new Set();          // abas marcadas à mão (ex.: o detalhe de uma obra chegou)
    this.renderedRev = {};           // revisão do estado (appState.rev) com que cada aba foi desenhada pela última vez
    this.detailChain = Promise.resolve(); // carregamentos de detalhe em fila (um lote por vez)
    this.init();
  }

  async init() {
    this.bindNavigation();
    this.bindBackupModal();

    // Biblioteca mesclada com o servidor após login/sessão válida: as obras novas da lista precisam do detalhe (episódios)
    window.addEventListener('showvault:synced', () => this.onLibraryChanged());

    // S09: a lista do usuário não depende mais do catálogo inteiro. Só o detalhe das obras da lista (temporadas/episódios) é
    // carregado, em lote; a lista do catálogo (leve e paginada) é buscada pela aba Explorar quando ela abre.
    await this.onLibraryChanged();
  }

  // Desenha o que já dá (mostra "carregando" nas obras sem episódios) e carrega em lote o detalhe das obras da lista.
  async onLibraryChanged() {
    this.refreshAll();
    if (await this.ensureTrackedDetails()) this.refreshAll();
  }

  trackedIds() {
    const state = window.appState;
    return ((state && state.data && state.data.trackedShows) || []).map(t => t.showId);
  }

  // Carrega o detalhe das obras da lista que ainda não o têm. Devolve true se buscou algo (a tela deve ser redesenhada).
  async ensureTrackedDetails() {
    const state = window.appState;
    const need = this.trackedIds().filter(id => !state.hasDetail(id));
    if (need.length === 0) return false;
    await this.ensureDetails(need);
    return true;
  }

  retryDetails() {
    return this.onLibraryChanged();
  }

  // Carrega em lote (até 50 por requisição) o detalhe completo dessas obras. Nunca lança: em falha deixa
  // `appState.detailsStatus = 'error'` e as telas mostram o aviso. Chamadas simultâneas entram numa fila (um lote por vez).
  ensureDetails(ids) {
    const run = this.detailChain.then(() => this.loadDetails(ids));
    this.detailChain = run.catch(() => {});
    return run;
  }

  async loadDetails(ids) {
    const state = window.appState;
    const need = [...new Set(ids.map(Number))].filter(id => Number.isSafeInteger(id) && id > 0 && !state.hasDetail(id));
    if (need.length === 0) return;
    state.detailsStatus = 'loading';
    let failed = false;
    for (let i = 0; i < need.length; i += AppController.DETAIL_BATCH) {
      try {
        const res = await window.apiClient.getBatch(need.slice(i, i + AppController.DETAIL_BATCH));
        ((res && res.data) || []).forEach(item => state.cacheMediaDetail(item));
      } catch (err) {
        failed = true;
        console.warn('Não foi possível carregar o detalhe das obras:', err.message);
      }
    }
    state.detailsStatus = failed ? 'error' : 'idle';
  }

  bindNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const btn = document.getElementById(`tab-btn-${tabId}`);
    const view = document.getElementById(`view-${tabId}`);
    if (btn) btn.classList.add('active');
    if (view) view.classList.add('active');

    if (tabId === 'explore') window.exploreView.loadMedia();
    else this.renderTab(tabId);
  }

  // As views das 4 abas que dependem da lista do usuário (a aba Explorar tem o próprio ciclo de carga).
  viewFor(tabId) {
    return { 'next-up': window.nextUpView, watchlist: window.watchlistView, diary: window.diaryView, stats: window.statsView }[tabId] || null;
  }

  // Redesenha a aba se ela ficou para trás (estado mudou ou foi marcada); senão não faz nada.
  renderTab(tabId) {
    const view = this.viewFor(tabId);
    if (!view) return;
    const rev = window.appState.rev;
    if (!this.dirty.has(tabId) && this.renderedRev[tabId] === rev) return;
    this.dirty.delete(tabId);
    this.renderedRev[tabId] = rev;
    view.render();
  }

  // Números das abas (A Seguir, Lista, Diário) sempre em dia, mesmo com a aba oculta e sem redesenhar nada.
  updateBadges(except = null) {
    ['next-up', 'watchlist', 'diary'].forEach((tab) => {
      const view = this.viewFor(tab);
      if (tab !== except && view && view.refreshBadge) view.refreshBadge();
    });
  }

  quickCheck(showId, seasonNum = null, epNum = null) {
    const isWatched = window.appState.toggleWatched(showId, seasonNum, epNum);
    this.showToast(isWatched ? 'Marcado como assistido!' : 'Desmarcado.', 'success');
    this.onEpisodeToggled(showId, seasonNum, epNum);
  }

  // Depois de marcar/desmarcar um episódio ou filme (S09): atualiza só o que mudou, não a tela inteira.
  onEpisodeToggled(showId, seasonNum = null, epNum = null) {
    this.refreshShow(showId);
    // Se o modal de detalhes estiver aberto nesta obra, atualiza a linha do episódio (filme: o modal pequeno é redesenhado)
    const modal = window.detailModalView;
    if (modal.isOpenFor(showId)) {
      const media = window.appState.getMedia(showId);
      if (media && media.type === 'movie') modal.open(showId);
      else modal.updateEpisode(seasonNum, epNum);
    }
  }

  async addToList(showId) {
    const numId = Number(showId);
    const exists = window.appState.data.trackedShows.some(t => t.showId === numId);
    if (exists) {
      this.showToast('Esta obra já está na sua lista!', 'info');
      return;
    }

    // Obra já completa no cache (filme ou com temporadas): não precisa buscar de novo. Senão pede o detalhe ao servidor:
    // obra que já está no catálogo é pública; obra nova é ingerida e isso exige login (S02).
    const known = window.appState.getMedia(numId);
    // (resultado de busca externa — isExternal — e item leve da lista — light — nunca contam como completos: sem episódios no cache)
    const complete = known && !known.isExternal && !known.light && (known.type === 'movie' || (Array.isArray(known.seasons) && known.seasons.length > 0));
    if (!complete) {
      try {
        this.showToast('Buscando os episódios da obra...', 'info');
        const res = await window.apiClient.getById(numId);
        if (res && res.data) {
          window.appState.cacheMediaDetail(res.data);
        }
      } catch (e) {
        console.warn('Não foi possível ingerir a obra:', e.message);
        this.showToast(e.message || 'Não foi possível adicionar esta obra agora.', 'error');
        return;
      }
    }

    // Status inicial coerente com o progresso (Quero ver, ou Assistindo/Finalizado se já houver episódios marcados)
    window.appState.addShow(numId);
    this.showToast('Adicionado à sua lista!', 'success');
    this.refreshAll();
    if (window.detailModalView.currentShowId === numId) {
      window.detailModalView.open(numId);
    }
  }

  // S08 (D-22): "Carregar exemplo" no estado vazio. Só põe obras do catálogo na lista (Quero ver), sem progresso nem notas.
  async loadExample() {
    // as obras de exemplo precisam do catálogo em memória: busca o detalhe delas em lote (a lista não traz mais o catálogo inteiro)
    await this.ensureDetails(window.appState.constructor.EXAMPLE_SHOW_IDS || []);
    const { added, missing } = window.appState.loadExample();
    if (added.length > 0) {
      this.showToast(`Exemplo carregado: ${added.length} título${added.length === 1 ? '' : 's'} na sua lista (sem progresso nem anotações). Remova quando quiser.`, 'success');
    } else if (missing > 0) {
      this.showToast('O catálogo ainda não carregou. Tente de novo em instantes.', 'error');
    } else {
      this.showToast('Os títulos de exemplo já estão na sua lista.', 'info');
    }
    this.refreshAll();
  }

  removeFromList(showId) {
    window.appState.removeShow(showId); // grava também a marca de exclusão, para a remoção chegar aos outros aparelhos
    this.showToast('Removido da sua lista.');
    this.refreshAll();
    if (window.detailModalView.currentShowId === showId) {
      window.detailModalView.open(showId);
    }
  }

  // Seletor de status (modal e lista). O valor vem de um <select>, mas é validado de novo em AppState.
  setStatus(showId, status) {
    const ok = window.appState.setShowStatus(showId, status);
    if (!ok) {
      this.showToast('Não foi possível mudar o status desta obra.', 'error');
    } else {
      this.showToast(`Status: ${window.WatchStatus.statusLabel(status)}.`, 'success');
    }
    this.refreshShow(showId);
  }

  // Tudo pode ter mudado (login, sync, importar/resetar, adicionar/remover obra): marca as 4 telas como desatualizadas e
  // redesenha só a que está visível; as outras redesenham quando forem abertas (S09). Os números das abas ficam em dia.
  refreshAll() {
    ['next-up', 'watchlist', 'diary', 'stats'].forEach(tab => this.dirty.add(tab));
    this.renderTab(this.activeTab);
    this.updateBadges(this.activeTab);
    window.detailModalView.refreshStatusPicker();
  }

  // Mudou algo de UMA obra (episódio marcado, status): atualiza só o cartão/linha dela na aba visível.
  // Só vale se a aba estava em dia antes desta mudança (`appState.prevRev`); senão cai no redesenho completo da aba.
  refreshShow(showId) {
    const state = window.appState;
    const tab = this.activeTab;
    const view = this.viewFor(tab);
    if (view) {
      const clean = !this.dirty.has(tab) && this.renderedRev[tab] === state.prevRev;
      if (clean && view.updateShow) {
        view.updateShow(showId);
        this.renderedRev[tab] = state.rev;
      } else if (clean && tab === 'diary') {
        this.renderedRev[tab] = state.rev; // episódios não aparecem no diário: nada a redesenhar
      } else {
        this.dirty.add(tab);
        this.renderTab(tab);
      }
    }
    this.updateBadges(tab);
    window.detailModalView.refreshStatusPicker();
  }

  bindBackupModal() {
    const modal = document.getElementById('modal-backup');
    document.getElementById('btn-open-backup').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('btn-close-backup-modal').addEventListener('click', () => modal.classList.add('hidden'));

    document.getElementById('btn-download-json-backup').addEventListener('click', () => {
      const fullData = {
        exportDate: new Date().toISOString(),
        version: 4,
        stateVersion: window.STATE_VERSION,
        database: window.appState.data
      };
      const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `showvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showToast('Backup JSON exportado!', 'success');
    });

    document.getElementById('input-import-backup').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(ev.target.result);
            // Backups antigos podem conter obras aposentadas (D-11): migra antes de aplicar. Sem versão = versão 1.
            const data = window.migrateLibrary(window.validateBackup(parsed.database || parsed), parsed.stateVersion).data;
            // O arquivo vira o estado deste aparelho; o que não está nele vira "removido" nos outros aparelhos (marcas de exclusão)
            window.appState.importData(data);
            this.refreshAll();
            modal.classList.add('hidden');
            this.showToast('Backup restaurado com sucesso!', 'success');
          } catch (err) {
            const isFormat = err instanceof SyntaxError;
            this.showToast(isFormat ? 'Arquivo de backup inválido.' : (err.message || 'Arquivo de backup inválido.'), 'error');
          }
        };
        reader.readAsText(e.target.files[0]);
        e.target.value = ''; // permite escolher o mesmo arquivo de novo
      }
    });

    document.getElementById('btn-reset-database').addEventListener('click', () => {
      modal.classList.add('hidden');
      this.resetData();
    });
  }

  // "Resetar": apaga os dados deste aparelho. Conectado, pergunta se a cópia na nuvem também deve ser apagada
  // (confirmação explícita: confirm + digitar APAGAR). Sem apagar a nuvem, os dados voltam no próximo login.
  async resetData() {
    const state = window.appState;
    const sync = window.syncService;

    if (!confirm('Apagar todos os dados DESTE aparelho (séries, episódios e notas)? Se quiser guardá-los, exporte um backup antes.')) return;

    if (!sync.isLoggedIn()) {
      localStorage.removeItem(state.STORAGE_KEY); // visitante: volta ao estado inicial do app (lista vazia)
      state.data = state.load();
      this.refreshAll();
      this.showToast('Dados deste aparelho apagados.', 'info');
      return;
    }

    const alsoCloud = confirm(
      'Você está conectado. Apagar TAMBÉM a cópia guardada na nuvem desta conta?\n\n' +
      'OK = apagar aqui e na nuvem (seus outros aparelhos também ficam zerados).\n' +
      'Cancelar = apagar só neste aparelho (a cópia da nuvem volta no próximo login).'
    );

    if (alsoCloud) {
      const typed = prompt('Esta ação não pode ser desfeita. Para confirmar, digite APAGAR:');
      if (!typed || typed.trim().toUpperCase() !== 'APAGAR') {
        this.showToast('Nada foi apagado.', 'info');
        return;
      }
      try {
        await sync.wipeCloud();
      } catch (err) {
        this.showToast(`Não foi possível apagar a nuvem (${err.message}). Nada foi apagado.`, 'error');
        return;
      }
      this.refreshAll();
      this.showToast('Dados apagados neste aparelho e na nuvem.', 'success');
    } else {
      state.resetLocal();
      this.refreshAll();
      this.showToast('Dados deste aparelho apagados. A cópia da nuvem volta no próximo login.', 'info');
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    // textContent: a mensagem pode trazer nome de usuário ou erro do servidor (nunca interpretar como HTML)
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    const text = document.createElement('span');
    text.textContent = String(message);
    toast.append(icon, text);
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, type === 'error' ? 7000 : 4500); // um pouco mais de tempo para ler (acessibilidade)
  }
}

AppController.DETAIL_BATCH = 50; // ids por requisição de /api/media/batch (o servidor aceita no máximo 50)

document.addEventListener('DOMContentLoaded', () => {
  window.appController = new AppController();
});
