// ================================================================
// SHOWVAULT · CONTROLADOR PRINCIPAL DA APLICAÇÃO (MVC)
// ================================================================

class AppController {
  constructor() {
    this.activeTab = 'next-up';
    this.init();
  }

  async init() {
    this.bindNavigation();
    this.bindBackupModal();

    // Biblioteca mesclada com o servidor após login/sessão válida
    window.addEventListener('showvault:synced', () => this.refreshAll());

    // Carrega dados iniciais da API para popular o cache
    try {
      const res = await window.apiClient.getTrending('all');
      if (res && res.data) {
        window.appState.cacheMediaList(res.data);
      }
    } catch (err) {
      console.warn('API inicial em cache local:', err.message);
    }

    this.refreshAll();
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

    if (tabId === 'next-up') window.nextUpView.render();
    if (tabId === 'watchlist') window.watchlistView.render();
    if (tabId === 'diary') window.diaryView.render();
    if (tabId === 'stats') window.statsView.render();
    if (tabId === 'explore') window.exploreView.loadMedia();
  }

  quickCheck(showId, seasonNum = null, epNum = null) {
    const isWatched = window.appState.toggleWatched(showId, seasonNum, epNum);
    this.showToast(isWatched ? 'Marcado como assistido!' : 'Desmarcado.', 'success');
    this.refreshAll();

    // Se o modal de detalhes estiver aberto, atualiza ele também
    if (window.detailModalView.currentShowId === showId) {
      const media = window.appState.getMedia(showId);
      if (media && media.type === 'movie') {
        window.detailModalView.open(showId);
      } else {
        window.detailModalView.renderEpisodes();
        window.detailModalView.renderSeasonTabs();
      }
    }
  }

  async addToList(showId) {
    const numId = Number(showId);
    const exists = window.appState.data.trackedShows.some(t => t.showId === numId);
    if (exists) {
      this.showToast('Esta obra já está na sua lista!', 'info');
      return;
    }

    // Obra já completa no cache (filme ou com temporadas): não precisa ingerir. Senão a ingestão exige login (S02).
    const known = window.appState.getMedia(numId);
    // (resultado de busca externa — isExternal — nunca conta como completo, nem filme: ainda não está no catálogo do servidor)
    const complete = known && !known.isExternal && (known.type === 'movie' || (Array.isArray(known.seasons) && known.seasons.length > 0));
    if (!complete) {
      try {
        this.showToast('Salvando obra no catálogo mestre...', 'info');
        const res = await window.apiClient.ingest(numId);
        if (res && res.data) {
          window.appState.mediaMap.set(res.data.id, res.data);
        }
      } catch (e) {
        console.warn('Não foi possível ingerir a obra:', e.message);
        this.showToast(e.message || 'Não foi possível adicionar esta obra agora.', 'error');
        return;
      }
    }

    // Status inicial coerente com o progresso (Quero ver, ou Assistindo/Finalizado se já houver episódios marcados)
    window.appState.addShow(numId);
    this.showToast('Adicionado à sua lista e salvo no catálogo!', 'success');
    this.refreshAll();
    if (window.detailModalView.currentShowId === numId) {
      window.detailModalView.open(numId);
    }
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
    this.refreshAll();
  }

  refreshAll() {
    window.nextUpView.render();
    window.watchlistView.render();
    window.diaryView.render();
    window.statsView.render();
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
      localStorage.removeItem(state.STORAGE_KEY); // visitante: volta ao estado inicial do app
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
    }, 3200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.appController = new AppController();
});
