// ================================================================
// SHOWVAULT · MODELO DE ESTADO LOCAL-FIRST (MVC)
// ================================================================

class AppState {
  constructor() {
    this.STORAGE_KEY = 'showvault_state_mvc_v1';
    // Versão do formato/conteúdo do estado (migrações em utils/migrations.js). Fica em chave própria para não
    // mudar o formato de STORAGE_KEY. Sem a chave = estado antigo (versão 1).
    this.VERSION_KEY = 'showvault_state_version';
    // Dono do estado guardado neste navegador (id da conta). Ausente = visitante. Isola os dados entre contas (S03).
    this.OWNER_KEY = 'showvault_last_user';
    // Cópia de segurança do estado de uma conta que saiu com alterações ainda não enviadas (recuperada no próximo login dela).
    this.ARCHIVE_PREFIX = 'showvault_archive_';
    this.data = this.load();
    // Catálogo em memória: preenchido pela API (appController.init / exploreView / ingestão). Fonte única = servidor.
    this.mediaMap = new Map();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) return window.LibraryMerge.normalizeData(this.migrateStored(JSON.parse(raw)));
    } catch (e) {
      console.warn('Erro ao ler estado local:', e);
    }

    this.seeded = true; // estado demo padrão, ainda não editado pelo usuário
    return window.LibraryMerge.normalizeData({
      trackedShows: [
        { showId: 1396, status: 'watching', addedAt: new Date().toISOString() },      // Breaking Bad
        { showId: 1429, status: 'watching', addedAt: new Date().toISOString() },      // Attack on Titan
        { showId: 157336, status: 'plan_to_watch', addedAt: new Date().toISOString() }, // Interestelar
        { showId: 136283, status: 'watching', addedAt: new Date().toISOString() }     // The Bear
      ],
      watchedEpisodes: {
        "1396_s1_e1": { watched: true, watchedAt: "2026-10-20T19:30:00Z", rewatchCount: 1 },
        "1396_s1_e2": { watched: true, watchedAt: "2026-10-21T21:00:00Z", rewatchCount: 1 },
        "1429_s1_e1": { watched: true, watchedAt: "2026-10-22T20:15:00Z", rewatchCount: 1 },
        "136283_s1_e1": { watched: true, watchedAt: "2026-10-23T22:15:00Z", rewatchCount: 1 }
      },
      episodeNotes: {
        "1396_s1_e1": {
          text: "O piloto é simplesmente perfeito. A cena da van no deserto e a transformação inicial de Walter White.",
          emotion: "awesome",
          character: "Walter White",
          updatedAt: "2026-10-20T20:45:00Z",
          snapshots: []
        },
        "1429_s1_e1": {
          text: "A abertura com o Titã Colossal surgindo acima da muralha Maria é inesquecível.",
          emotion: "mindblown",
          character: "Eren Yeager",
          updatedAt: "2026-10-22T20:40:00Z",
          snapshots: []
        }
      }
    });
  }

  // Aplica as migrações de versão ao estado salvo (remove só as referências às obras aposentadas, D-11).
  // Só regrava o localStorage quando algo muda; a versão nova é registrada em seguida.
  migrateStored(data) {
    let version = 1;
    try { version = Number(localStorage.getItem(this.VERSION_KEY)) || 1; } catch { /* sem localStorage */ }
    const target = window.STATE_VERSION || version;
    if (version >= target || !window.migrateLibrary) return data;

    const result = window.migrateLibrary(data, version);
    try {
      if (result.changed) localStorage.setItem(this.STORAGE_KEY, JSON.stringify(result.data));
      localStorage.setItem(this.VERSION_KEY, String(target));
    } catch (e) {
      console.warn('Não foi possível gravar a migração do estado local:', e);
    }
    if (result.changed) console.info('[migração] Referências a obras aposentadas removidas do estado local:', result.removed);
    return result.data;
  }

  // Grava só no navegador (usado também quando o dado veio do servidor: não precisa reenviar).
  persist() {
    this.seeded = false;
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
      if (window.STATE_VERSION) localStorage.setItem(this.VERSION_KEY, String(window.STATE_VERSION));
    } catch (e) {
      console.error('Falha ao gravar estado local:', e);
    }
  }

  // Alteração do usuário: grava e agenda o envio ao servidor.
  save() {
    this.persist();
    if (window.syncService) window.syncService.schedulePush();
  }

  // ----- isolamento por conta (S03) -----
  getOwner() {
    try { return localStorage.getItem(this.OWNER_KEY) || ''; } catch { return ''; }
  }

  setOwner(userId) {
    try {
      if (userId) localStorage.setItem(this.OWNER_KEY, String(userId));
      else localStorage.removeItem(this.OWNER_KEY);
    } catch { /* sem localStorage */ }
  }

  // Troca todo o conteúdo (sem agendar envio: quem chama decide).
  replaceData(data) {
    this.data = window.LibraryMerge.normalizeData(data);
    this.persist();
  }

  // Guarda o estado atual como arquivo da conta (alterações ainda não enviadas); só se houver conteúdo.
  archiveFor(userId) {
    if (!userId || !window.LibraryMerge.hasContent(this.data)) return;
    try { localStorage.setItem(this.ARCHIVE_PREFIX + userId, JSON.stringify(this.data)); } catch { /* sem espaço: segue */ }
  }

  // Devolve (e apaga) o arquivo da conta, se existir e for legível.
  takeArchive(userId) {
    if (!userId) return null;
    try {
      const raw = localStorage.getItem(this.ARCHIVE_PREFIX + userId);
      localStorage.removeItem(this.ARCHIVE_PREFIX + userId);
      return raw ? window.LibraryMerge.normalizeData(JSON.parse(raw)) : null;
    } catch { return null; }
  }

  // Logout/troca de conta: o navegador volta a ser "visitante" e vazio (sem dados da conta anterior, sem demo).
  clearForLogout() {
    this.setOwner('');
    this.replaceData(window.LibraryMerge.emptyData());
  }

  // "Resetar": zera este aparelho. Com resetAt (devolvido pelo servidor ao apagar a nuvem) os outros aparelhos também zeram.
  resetLocal({ resetAt = '' } = {}) {
    const data = window.LibraryMerge.emptyData();
    data.resetAt = resetAt;
    this.replaceData(data);
  }

  // Importar backup: o arquivo vira o estado do aparelho e o que sumiu vira "removido" nos outros aparelhos.
  importData(imported) {
    this.replaceData(window.LibraryMerge.replaceWith(this.data, imported));
    this.save();
  }

  // ----- horários e marcas de exclusão -----
  // ISO de agora, nunca anterior (nem igual) aos horários informados: a ação mais nova sempre vence um empate.
  stamp(...previous) {
    const prev = previous.reduce((m, iso) => Math.max(m, Date.parse(iso) || 0), 0);
    return new Date(Math.max(Date.now(), prev + 1)).toISOString();
  }

  markDeleted(kind, key, liveStamp) {
    this.data.tombstones[kind][String(key)] = this.stamp(liveStamp, this.data.tombstones[kind][String(key)]);
  }

  clearDeleted(kind, key) {
    delete this.data.tombstones[kind][String(key)];
  }

  // Horário para um item que acabou de ser criado/alterado, maior que uma eventual marca de exclusão anterior.
  stampFor(kind, key, ...previous) {
    return this.stamp(this.data.tombstones[kind][String(key)], ...previous);
  }

  // ----- catálogo em memória -----
  cacheMediaList(items) {
    if (!Array.isArray(items)) return;
    items.forEach(item => this.mediaMap.set(item.id, item));
  }

  getMedia(id) {
    return this.mediaMap.get(Number(id)) || null;
  }

  // ----- obras na lista e status por obra (regra única em utils/watchStatus.js) -----
  getTracked(showId) {
    return this.data.trackedShows.find(t => t.showId === Number(showId)) || null;
  }

  // Progresso da obra (filme: 1 item; série: todos os episódios do catálogo).
  getProgress(showId) {
    return window.WatchStatus.computeProgress(this.getMedia(showId), (s, e) => this.isWatched(showId, s, e));
  }

  // Status mostrado nas telas (lista, estatísticas, A Seguir): a mesma conta para todas.
  getStatus(tracked) {
    return window.WatchStatus.effectiveStatus(tracked, this.getMedia(tracked.showId), (s, e) => this.isWatched(tracked.showId, s, e));
  }

  addShow(showId) {
    const id = Number(showId);
    if (this.getTracked(id)) return null;
    const entry = {
      showId: id,
      status: window.WatchStatus.initialStatus(this.getMedia(id) ? this.getProgress(id) : null),
      addedAt: new Date().toISOString()
    };
    entry.updatedAt = this.stampFor('shows', id, entry.addedAt);
    this.clearDeleted('shows', id);
    this.data.trackedShows.push(entry);
    this.save();
    return entry;
  }

  removeShow(showId) {
    const id = Number(showId);
    const tracked = this.getTracked(id);
    if (!tracked) return;
    this.data.trackedShows = this.data.trackedShows.filter(t => t.showId !== id);
    this.markDeleted('shows', id, tracked.updatedAt || tracked.addedAt);
    this.save();
  }

  setShowStatus(showId, status) {
    const tracked = this.getTracked(showId);
    if (!tracked || !window.WatchStatus.STATUS_VALUES.includes(status)) return false;
    if (tracked.status !== status || this.getStatus(tracked) !== status) {
      tracked.status = status;
      tracked.updatedAt = this.stamp(tracked.updatedAt, tracked.addedAt);
      this.save();
    }
    return true;
  }

  // Depois de marcar/desmarcar episódios: mantém o status coerente com o progresso. Não grava (quem chama grava).
  applyProgressRules(showId, marked) {
    const tracked = this.getTracked(showId);
    if (!tracked) return;
    const media = this.getMedia(showId);
    const W = window.WatchStatus;
    let next = tracked.status;
    if (media) next = W.statusAfterProgress(tracked.status, media, this.getProgress(showId), marked);
    else if (marked && W.normalizeStatus(tracked.status) !== 'watching') next = 'watching';
    if (next !== tracked.status) {
      tracked.status = next;
      tracked.updatedAt = this.stamp(tracked.updatedAt, tracked.addedAt);
    }
  }

  // ----- episódios e notas -----
  isWatched(showId, seasonNum, epNum) {
    const show = this.getMedia(showId);
    const key = (show && show.type === 'movie') ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
    return !!(this.data.watchedEpisodes[key] && this.data.watchedEpisodes[key].watched);
  }

  toggleWatched(showId, seasonNum, epNum) {
    const show = this.getMedia(showId);
    const isMovie = show && show.type === 'movie';
    const key = isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;

    const current = this.data.watchedEpisodes[key];
    const isNowWatched = !current || !current.watched;

    if (isNowWatched) {
      const at = this.stampFor('watched', key, current && current.updatedAt);
      this.data.watchedEpisodes[key] = {
        watched: true,
        watchedAt: at,
        updatedAt: at,
        rewatchCount: (current && current.rewatchCount) ? current.rewatchCount : 1
      };
      this.clearDeleted('watched', key);
    } else {
      delete this.data.watchedEpisodes[key];
      this.markDeleted('watched', key, current.updatedAt || current.watchedAt);
    }

    this.applyProgressRules(showId, isNowWatched);
    this.save();
    return isNowWatched;
  }

  batchSetSeason(showId, seasonNum, shouldWatch) {
    const show = this.getMedia(showId);
    if (!show || !show.seasons) return;
    const season = show.seasons.find(s => s.season_number === Number(seasonNum));
    if (!season) return;

    season.episodes.forEach(ep => {
      const key = `${showId}_s${seasonNum}_e${ep.episode_number}`;
      const current = this.data.watchedEpisodes[key];
      if (shouldWatch) {
        const at = this.stampFor('watched', key, current && current.updatedAt);
        this.data.watchedEpisodes[key] = {
          watched: true,
          watchedAt: (current && current.watched && current.watchedAt) || at,
          updatedAt: at,
          rewatchCount: (current && current.rewatchCount) || 1
        };
        this.clearDeleted('watched', key);
      } else if (current) {
        delete this.data.watchedEpisodes[key];
        this.markDeleted('watched', key, current.updatedAt || current.watchedAt);
      }
    });

    this.applyProgressRules(showId, !!shouldWatch);
    this.save();
  }

  saveNote(showId, seasonNum, epNum, noteData) {
    const show = this.getMedia(showId);
    const key = (show && show.type === 'movie') ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
    const existing = this.data.episodeNotes[key] || { snapshots: [] };

    const newSnapshots = [...(existing.snapshots || [])];
    if (existing.text && existing.text.trim() !== noteData.text.trim() && existing.text.length > 10) {
      newSnapshots.unshift({ text: existing.text, updatedAt: existing.updatedAt || new Date().toISOString() });
      if (newSnapshots.length > 5) newSnapshots.pop();
    }

    this.data.episodeNotes[key] = {
      text: noteData.text,
      emotion: noteData.emotion || null,
      character: noteData.character || '',
      updatedAt: this.stampFor('notes', key, existing.updatedAt),
      snapshots: newSnapshots
    };
    this.clearDeleted('notes', key);

    this.save();
  }

  getNote(showId, seasonNum, epNum) {
    const show = this.getMedia(showId);
    const key = (show && show.type === 'movie') ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
    return this.data.episodeNotes[key] || null;
  }
}

window.appState = new AppState();
