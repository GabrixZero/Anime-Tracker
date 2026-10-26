// ================================================================
// SHOWVAULT · SINCRONIZAÇÃO DA BIBLIOTECA COM O SERVIDOR (MVC)
// O localStorage continua sendo a fonte primária; o servidor guarda
// um snapshot por usuário enviado com debounce a cada save().
// ================================================================

class SyncService {
  constructor() {
    this.PUSH_DELAY_MS = 1500;
    this.timer = null;
    this.pushing = false;
    this.pushAgain = false;
    this.pulling = false;
    this.status = 'idle'; // 'idle' | 'syncing' | 'offline'
    this.baseLabel = 'Local-First';
  }

  hasToken() {
    try {
      return !!localStorage.getItem('showvault_auth_token');
    } catch {
      return false;
    }
  }

  setBaseLabel(label) {
    this.baseLabel = label;
    this.renderLabel();
  }

  setStatus(status) {
    this.status = status;
    this.renderLabel();
  }

  renderLabel() {
    const el = document.getElementById('sync-label');
    if (!el) return;
    if (!this.hasToken()) {
      el.textContent = this.baseLabel;
    } else if (this.status === 'syncing') {
      el.textContent = 'Sincronizando...';
    } else if (this.status === 'offline') {
      el.textContent = 'Offline';
    } else {
      el.textContent = this.baseLabel;
    }
  }

  snapshot() {
    const { trackedShows, watchedEpisodes, episodeNotes } = window.appState.data;
    return { trackedShows, watchedEpisodes, episodeNotes };
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pushAgain = false;
    this.status = 'idle';
  }

  // Chamado por AppState.save(); sem token ou durante o pull, não faz nada.
  schedulePush() {
    if (!this.hasToken() || this.pulling) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), this.PUSH_DELAY_MS);
  }

  async push() {
    if (!this.hasToken()) return;
    if (this.pushing) {
      this.pushAgain = true;
      return;
    }

    this.pushing = true;
    this.setStatus('syncing');
    try {
      await window.apiClient.putLibrary(this.snapshot());
      this.setStatus('idle');
    } catch {
      // Dados seguem salvos localmente; reenvia na próxima alteração.
      this.setStatus('offline');
    } finally {
      this.pushing = false;
      if (this.pushAgain) {
        this.pushAgain = false;
        this.schedulePush();
      }
    }
  }

  // Após login/sessão válida: traz a biblioteca do servidor e mescla com a local.
  async pullAndMerge() {
    if (!this.hasToken() || this.pulling) return;

    this.pulling = true;
    this.setStatus('syncing');
    try {
      const res = await window.apiClient.getLibrary();
      const remote = res.data;
      const state = window.appState;
      const remoteHasData = remote.trackedShows.length > 0
        || Object.keys(remote.watchedEpisodes).length > 0;

      if (state.seeded) {
        // Estado local ainda é o demo padrão (nunca editado): o servidor manda.
        if (remoteHasData) {
          state.data = { ...state.data, ...remote };
          state.save();
        }
      } else {
        state.data = { ...state.data, ...this.merge(this.snapshot(), remote) };
        state.save();
      }

      this.pulling = false;
      if (!state.seeded || remoteHasData) await this.push();
      this.setStatus('idle');
      window.dispatchEvent(new CustomEvent('showvault:synced'));
    } catch {
      this.setStatus('offline');
    } finally {
      this.pulling = false;
    }
  }

  // União não destrutiva: nada do que existe só de um lado é perdido.
  merge(local, remote) {
    const statusRank = s => (s === 'watching' ? 1 : (s === 'plan_to_watch' || !s) ? 0 : 2);
    const time = iso => Date.parse(iso) || 0;

    const shows = new Map();
    [...remote.trackedShows, ...local.trackedShows].forEach(t => {
      const prev = shows.get(t.showId);
      if (!prev) {
        shows.set(t.showId, { ...t });
        return;
      }
      if (statusRank(t.status) >= statusRank(prev.status)) prev.status = t.status;
      if (t.addedAt && (!prev.addedAt || time(t.addedAt) < time(prev.addedAt))) prev.addedAt = t.addedAt;
    });

    const watched = { ...remote.watchedEpisodes };
    Object.entries(local.watchedEpisodes).forEach(([key, l]) => {
      const r = watched[key];
      watched[key] = r ? {
        watched: !!(l.watched || r.watched),
        watchedAt: time(l.watchedAt) >= time(r.watchedAt) ? l.watchedAt : r.watchedAt,
        rewatchCount: Math.max(l.rewatchCount || 1, r.rewatchCount || 1)
      } : l;
    });

    const notes = { ...remote.episodeNotes };
    Object.entries(local.episodeNotes).forEach(([key, l]) => {
      const r = notes[key];
      notes[key] = (!r || time(l.updatedAt) >= time(r.updatedAt)) ? l : r;
    });

    return { trackedShows: [...shows.values()], watchedEpisodes: watched, episodeNotes: notes };
  }
}

window.syncService = new SyncService();
