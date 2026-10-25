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

  addToList(showId) {
    const exists = window.appState.data.trackedShows.some(t => t.showId === Number(showId));
    if (!exists) {
      window.appState.data.trackedShows.push({
        showId: Number(showId),
        status: 'watching',
        addedAt: new Date().toISOString()
      });
      window.appState.save();
      this.showToast('Adicionado à sua lista!', 'success');
      this.refreshAll();
      if (window.detailModalView.currentShowId === showId) {
        window.detailModalView.open(showId);
      }
    }
  }

  removeFromList(showId) {
    window.appState.data.trackedShows = window.appState.data.trackedShows.filter(t => t.showId !== Number(showId));
    window.appState.save();
    this.showToast('Removido da sua lista.');
    this.refreshAll();
    if (window.detailModalView.currentShowId === showId) {
      window.detailModalView.open(showId);
    }
  }

  refreshAll() {
    window.nextUpView.render();
    window.watchlistView.render();
    window.diaryView.render();
    window.statsView.render();
  }

  bindBackupModal() {
    const modal = document.getElementById('modal-backup');
    document.getElementById('btn-open-backup').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('btn-close-backup-modal').addEventListener('click', () => modal.classList.add('hidden'));

    document.getElementById('btn-download-json-backup').addEventListener('click', () => {
      const fullData = {
        exportDate: new Date().toISOString(),
        version: 4,
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
            const data = parsed.database || parsed;
            if (data.trackedShows && data.watchedEpisodes) {
              window.appState.data = data;
              window.appState.save();
              this.refreshAll();
              modal.classList.add('hidden');
              this.showToast('Backup restaurado com sucesso!', 'success');
            }
          } catch {
            this.showToast('Arquivo de backup inválido.', 'error');
          }
        };
        reader.readAsText(e.target.files[0]);
      }
    });

    document.getElementById('btn-reset-database').addEventListener('click', () => {
      if (confirm('Deseja resetar todos os dados para o padrão original?')) {
        localStorage.removeItem(window.appState.STORAGE_KEY);
        window.appState.data = window.appState.load();
        this.refreshAll();
        modal.classList.add('hidden');
        this.showToast('Banco de dados resetado.', 'info');
      }
    });
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${message}</span>`;
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
