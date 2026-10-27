// ================================================================
// SHOWVAULT · SINCRONIZAÇÃO DA BIBLIOTECA COM O SERVIDOR (MVC)
// O localStorage continua sendo a fonte primária; o servidor guarda a biblioteca da conta.
//
// S03:
//  - isolamento por conta: o estado local tem um dono (appState.getOwner()); outra conta nunca herda dados (beginSession);
//  - o merge mora em utils/libraryMerge.js (funções puras, testadas) e respeita marcas de exclusão (tombstones);
//  - o servidor também mescla no PUT e devolve o resultado, então um aparelho desatualizado não apaga o trabalho do outro;
//  - falhas ficam visíveis (rótulo + selo) e há "tentar de novo".
// ================================================================

class SyncService {
  constructor() {
    this.PUSH_DELAY_MS = 1500;
    this.FLUSH_TIMEOUT_MS = 4000;
    this.timer = null;
    this.pushing = false;
    this.pushAgain = false;
    this.pulling = false;
    this.inflight = null;
    this.epoch = 0;          // muda a cada troca de sessão: respostas de uma sessão antiga são ignoradas
    this.userId = '';        // conta da sessão atual
    this.ready = false;      // primeiro pull concluído (só então é seguro enviar)
    this.dirty = false;      // há alterações locais ainda não confirmadas pelo servidor
    this.dirtyVersion = 0;
    this.status = 'idle';    // 'idle' | 'syncing' | 'offline' | 'error' | 'auth'
    this.baseLabel = 'Só neste aparelho'; // visitante: os dados ficam apenas no navegador
    this.bindStatusClick();
  }

  hasToken() {
    try {
      return !!localStorage.getItem('showvault_auth_token');
    } catch {
      return false;
    }
  }

  isLoggedIn() {
    return this.hasToken() && !!this.userId;
  }

  // Só envia se há sessão, o primeiro pull terminou e o estado local é DESTA conta.
  canSync() {
    return this.hasToken() && !!this.userId && this.ready && window.appState.getOwner() === this.userId;
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
    const state = this.hasToken() || this.status === 'auth' ? this.status : 'idle';
    const labels = {
      idle: this.baseLabel,
      syncing: 'Sincronizando...',
      offline: 'Offline · tentar de novo',
      error: 'Erro ao sincronizar · tentar de novo',
      auth: 'Sessão expirada'
    };
    const badges = { idle: 'Sincronizado', syncing: 'Sincronizando...', offline: 'Offline', error: 'Erro ao sincronizar', auth: 'Sessão expirada' };

    const box = document.getElementById('sync-status');
    if (box) {
      box.dataset.syncState = state;
      box.classList.toggle('sync-indicator--retry', state === 'offline' || state === 'error');
      // classes de estado no ponto (sugestão da S05): .is-syncing e .is-offline (offline, erro e sessão expirada)
      const dot = box.querySelector ? box.querySelector('.status-dot') : null;
      if (dot) {
        dot.classList.toggle('is-syncing', state === 'syncing');
        dot.classList.toggle('is-offline', state === 'offline' || state === 'error' || state === 'auth');
      }
    }
    const el = document.getElementById('sync-label');
    if (el) el.textContent = labels[state];
    const badge = document.getElementById('user-cloud-badge');
    if (badge) {
      badge.textContent = badges[state];
      badge.dataset.syncState = state;
    }
  }

  // Clique no selo do cabeçalho com falha = tentar de novo.
  bindStatusClick() {
    const box = typeof document !== 'undefined' ? document.getElementById('sync-status') : null;
    if (!box) return;
    box.addEventListener('click', () => {
      if (this.status === 'offline' || this.status === 'error') this.retry();
    });
  }

  snapshot() {
    const { trackedShows, watchedEpisodes, episodeNotes, tombstones, resetAt } = window.appState.data;
    return { trackedShows, watchedEpisodes, episodeNotes, tombstones, resetAt };
  }

  // Encerra a sessão de sincronização (logout, token expirado). Mantém `dirty` (alterações não enviadas continuam existindo).
  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pushAgain = false;
    this.pushing = false;
    this.pulling = false;
    this.inflight = null;
    this.ready = false;
    this.userId = '';
    this.epoch++;
    this.status = 'idle';
    this.renderLabel();
  }

  // Chamado a cada login/sessão retomada, ANTES de qualquer envio. Garante que o estado local é desta conta:
  // se pertencia a outra conta, ele é arquivado e o navegador começa vazio (nunca mescla dados de duas contas).
  // resumed = sessão retomada ao abrir a página (estado sem dono é assumido como desta conta, pois é anterior ao isolamento).
  beginSession(user, { resumed = false } = {}) {
    this.stop();
    this.userId = String(user.id);
    this.dirty = false;
    const state = window.appState;
    const owner = state.getOwner();
    if (owner && owner !== this.userId) {
      state.archiveFor(owner);
      state.clearForLogout();
      window.dispatchEvent(new CustomEvent('showvault:synced'));
    } else if (!owner && resumed) {
      state.setOwner(this.userId);
    }
  }

  // Chamado por AppState.save(): agenda o envio com debounce.
  schedulePush() {
    if (!this.hasToken()) return;
    this.dirty = true;
    this.dirtyVersion++;
    if (!this.canSync() || this.pulling) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), this.PUSH_DELAY_MS);
  }

  async push() {
    if (!this.canSync()) return false;
    if (this.pushing) {
      this.pushAgain = true;
      return true;
    }

    const epoch = this.epoch;
    const version = this.dirtyVersion;
    this.pushing = true;
    this.setStatus('syncing');
    let ok = false;
    this.inflight = (async () => {
      try {
        const res = await window.apiClient.putLibrary(this.snapshot());
        if (epoch !== this.epoch) return;
        if (version === this.dirtyVersion) this.dirty = false;
        this.applyServerData(res && res.data);
        this.setStatus('idle');
        ok = true;
      } catch (err) {
        if (epoch === this.epoch) this.handleError(err); // dados seguem salvos localmente; reenvia na próxima alteração
      } finally {
        if (epoch === this.epoch) {
          this.pushing = false;
          this.inflight = null;
          if (this.pushAgain) {
            this.pushAgain = false;
            this.schedulePush();
          }
        }
      }
    })();
    await this.inflight;
    return ok;
  }

  // O servidor devolve a biblioteca já mesclada: junta com o que mudou aqui durante o envio.
  applyServerData(remote) {
    if (!remote || !window.LibraryMerge) return;
    const state = window.appState;
    const merged = window.LibraryMerge.merge(this.snapshot(), remote);
    if (this.fingerprint(merged) === this.fingerprint(this.snapshot())) return;
    state.replaceData(merged);
    window.dispatchEvent(new CustomEvent('showvault:synced'));
  }

  // Compara bibliotecas ignorando a ordem de chaves/obras.
  fingerprint(data) {
    const d = window.LibraryMerge.normalizeData(data);
    const sorted = (value) => {
      if (Array.isArray(value)) return value.map(sorted);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])]));
      }
      return value;
    };
    return JSON.stringify(sorted({ ...d, trackedShows: [...d.trackedShows].sort((a, b) => a.showId - b.showId) }));
  }

  handleError(err) {
    this.lastError = err;
    if (err && err.status === 401) this.setStatus('auth');
    else if (err && !err.status && err instanceof TypeError) this.setStatus('offline'); // fetch sem rede
    else this.setStatus('error');
  }

  // Após login/sessão válida: traz a biblioteca do servidor e a une à local (regras em LibraryMerge.decideLogin).
  // Com `user`, inicia a sessão (isolamento por conta) antes do pull.
  async pullAndMerge(user, options) {
    if (!this.hasToken()) return;
    if (user && user.id) this.beginSession(user, options);
    if (!this.userId || this.pulling) return;

    const epoch = this.epoch;
    const userId = this.userId;
    const state = window.appState;
    const versionAtStart = this.dirtyVersion;
    this.pulling = true;
    this.setStatus('syncing');
    try {
      const res = await window.apiClient.getLibrary();
      if (epoch !== this.epoch) return; // outra sessão assumiu enquanto esperávamos

      const remote = window.LibraryMerge.normalizeData(res.data);
      const decision = window.LibraryMerge.decideLogin({
        ownerId: state.getOwner(), userId, seeded: !!state.seeded, local: state.data, remote
      });
      if (decision.archiveLocal) state.archiveFor(state.getOwner());

      let next = decision.data;
      // Alterações não enviadas que esta conta deixou ao sair (ex.: logout sem rede) voltam agora.
      const archived = state.takeArchive(userId);
      if (archived) next = window.LibraryMerge.merge(next, archived);

      state.replaceData(next);
      state.setOwner(userId);
      this.ready = true;
      this.pulling = false;

      const needsPush = decision.action === 'merge' || !!archived || this.dirtyVersion !== versionAtStart;
      if (needsPush) await this.push();
      else this.dirty = false;
      if (epoch !== this.epoch) return;
      this.setStatus('idle');
      window.dispatchEvent(new CustomEvent('showvault:synced'));
    } catch (err) {
      if (epoch === this.epoch) this.handleError(err);
    } finally {
      if (epoch === this.epoch) this.pulling = false;
    }
  }

  // "Tentar de novo" depois de uma falha.
  retry() {
    if (!this.hasToken() || !this.userId) return Promise.resolve(false);
    return this.ready ? this.push() : this.pullAndMerge();
  }

  // Espera o que estiver em andamento e tenta enviar o que falta, por até FLUSH_TIMEOUT_MS. true = nada ficou pendente.
  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), this.FLUSH_TIMEOUT_MS); });
    try {
      for (let i = 0; i < 2 && this.dirty && this.canSync(); i++) {
        await Promise.race([this.pushing && this.inflight ? this.inflight : this.push(), timeout]);
      }
    } finally {
      clearTimeout(timer);
    }
    return !this.dirty && this.ready;
  }

  // Logout: envia o que falta; se não der, guarda uma cópia (arquivo) para a conta recuperar no próximo login; limpa o navegador.
  async logout() {
    const state = window.appState;
    const ownerId = state.getOwner() || this.userId;
    const synced = await this.flush();
    if (!synced) state.archiveFor(ownerId);
    this.stop();
    this.dirty = false;
    state.clearForLogout();
    return { synced };
  }

  // "Resetar + apagar a nuvem": zera a conta no servidor (resetAt) e depois este aparelho. Lança erro se o servidor falhar (nada é apagado aqui).
  async wipeCloud() {
    const res = await window.apiClient.deleteLibrary();
    window.appState.resetLocal({ resetAt: res && res.resetAt });
    this.dirty = false;
    return res;
  }
}

window.syncService = new SyncService();
