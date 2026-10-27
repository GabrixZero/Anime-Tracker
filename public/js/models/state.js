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
    // S09: as listas trazem itens LEVES (`light: true`, sem temporadas/episódios); o detalhe completo das obras da lista do usuário
    // chega em lote (`cacheMediaDetail`). Um item leve nunca substitui um detalhe já carregado.
    this.mediaMap = new Map();
    // 'idle' | 'loading' | 'error': situação do carregamento do detalhe das obras da lista (preenchido pelo appController).
    this.detailsStatus = 'idle';
    // Contador que sobe a cada gravação do estado e a cada detalhe carregado (telas ocultas só redesenham se ficaram para trás).
    this.rev = 0;
    this.prevRev = 0; // revisão imediatamente anterior à última gravação
    // Cache em memória por obra (progresso e próximo episódio) e índice de episódios por obra. Veja `getProgress`.
    this._progress = new Map();
    this._episodeIndex = new WeakMap();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) return window.LibraryMerge.normalizeData(this.migrateStored(JSON.parse(raw)));
    } catch (e) {
      console.warn('Erro ao ler estado local:', e);
    }

    // Primeira visita: lista vazia (D-22). Nada de obras, datas ou anotações de enfeite; o usuário explora ou usa "Carregar exemplo".
    // `seeded` = estado inicial ainda não editado (nem gravado): ao entrar numa conta, o servidor vence sem mesclar (decideLogin).
    this.seeded = true;
    return window.LibraryMerge.normalizeData(window.LibraryMerge.emptyData());
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
    this.prevRev = this.rev;
    this.rev++; // "revisão" do estado: o controlador sabe quais telas ocultas ficaram desatualizadas
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
    this.invalidateProgress();
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
  // Itens vindos de uma LISTA (explorar/busca): leves (`light`) ou resultados externos. Nunca rebaixam um detalhe já carregado.
  cacheMediaList(items) {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
      if (!item || !Number.isSafeInteger(item.id)) return;
      const current = this.mediaMap.get(item.id);
      if (current && this.isDetailed(current) && (item.light || item.isExternal)) return;
      this.mediaMap.set(item.id, item);
      this._progress.delete(item.id);
    });
  }

  // Detalhe completo de uma obra (temporadas/episódios): `GET /api/media/:id` ou `/batch`.
  cacheMediaDetail(item) {
    if (!item || !Number.isSafeInteger(item.id)) return;
    this.mediaMap.set(item.id, item);
    this._progress.delete(item.id);
    this.prevRev = this.rev;
    this.rev++;
  }

  // Item com os dados completos? (os de teste e os do servidor antigo, sem a marca `light`, contam como completos)
  isDetailed(item) {
    return !!item && !item.light && !item.isExternal;
  }

  hasDetail(id) {
    return this.isDetailed(this.mediaMap.get(Number(id)));
  }

  getMedia(id) {
    return this.mediaMap.get(Number(id)) || null;
  }

  // Episódio (objeto do catálogo) por temporada/número, sem varrer a lista (índice por obra, montado uma vez).
  getEpisode(showId, seasonNum, epNum) {
    const media = this.getMedia(showId);
    if (!media || !Array.isArray(media.seasons)) return null;
    let index = this._episodeIndex.get(media);
    if (!index) {
      index = new Map();
      for (const season of media.seasons) {
        for (const ep of season.episodes || []) {
          const key = `${season.season_number}:${ep.episode_number}`;
          if (!index.has(key)) index.set(key, ep); // dado repetido: vale o primeiro, como na busca linear antiga
        }
      }
      this._episodeIndex.set(media, index);
    }
    return index.get(`${seasonNum}:${epNum}`) || null;
  }

  // ----- obras na lista e status por obra (regra única em utils/watchStatus.js) -----
  getTracked(showId) {
    return this.data.trackedShows.find(t => t.showId === Number(showId)) || null;
  }

  // Progresso da obra (filme: 1 item; série: todos os episódios do catálogo), com o próximo episódio a assistir.
  // Cache em memória por obra (S09): uma varredura dos episódios por obra, reaproveitada pela lista, pelo "A Seguir", pelas
  // estatísticas e pelo seletor de status. Só é recalculado quando algo dessa obra muda: `toggleWatched`/`batchSetSeason`
  // limpam a obra; `replaceData` e a troca do catálogo limpam tudo. Quem alterar `data.watchedEpisodes` diretamente (fora destes
  // métodos) precisa chamar `invalidateProgress()`. O resultado é somente leitura.
  getProgress(showId) {
    const id = Number(showId);
    const media = this.getMedia(id);
    const source = this.data.watchedEpisodes;
    const hit = this._progress.get(id);
    if (hit && hit.media === media && hit.source === source) return hit.value;

    let next = null;
    const progress = window.WatchStatus.computeProgress(media, (s, e) => {
      const watched = this.isWatched(id, s, e);
      if (!watched && !next && s !== undefined) next = { seasonNumber: s, episodeNumber: e };
      return watched;
    });
    const value = { ...progress, next };
    this._progress.set(id, { media, source, value });
    return value;
  }

  // Próximo episódio ainda não assistido da série/anime: { seasonNumber, episodeNumber } ou null.
  getNextEpisode(showId) {
    return this.getProgress(showId).next;
  }

  invalidateProgress(showId) {
    if (showId === undefined) this._progress.clear();
    else this._progress.delete(Number(showId));
  }

  // Status mostrado nas telas (lista, estatísticas, A Seguir): a mesma conta para todas.
  getStatus(tracked) {
    const media = this.getMedia(tracked.showId);
    // só itens antigos (sem updatedAt) precisam do progresso para decidir; os demais valem como estão
    const progress = (!tracked.updatedAt && media) ? this.getProgress(tracked.showId) : null;
    return window.WatchStatus.effectiveStatus(tracked, media, (s, e) => this.isWatched(tracked.showId, s, e), progress);
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

    this.invalidateProgress(showId);
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

    this.invalidateProgress(showId);
    this.applyProgressRules(showId, !!shouldWatch);
    this.save();
  }

  // Chave da anotação: "<id>_movie" para filme, "<id>_s<T>_e<E>" para episódio.
  noteKey(showId, seasonNum, epNum) {
    const show = this.getMedia(showId);
    return (show && show.type === 'movie') ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
  }

  // ----- anotações e histórico de versões (S08, D-19) -----
  // A anotação grava sozinha enquanto se digita. Para o histórico não virar uma pilha de rascunhos quase iguais,
  // uma versão antiga só é guardada quando começa uma NOVA sessão de edição: a anotação ficou parada por
  // NOTE_VERSION_GAP_MS ou mais. Guardamos até MAX_NOTE_VERSIONS (as mais novas); cada versão guarda o texto.
  saveNote(showId, seasonNum, epNum, noteData) {
    const key = this.noteKey(showId, seasonNum, epNum);
    const existing = this.data.episodeNotes[key] || { snapshots: [] };
    const newText = typeof noteData.text === 'string' ? noteData.text : '';

    const newSnapshots = [...(existing.snapshots || [])];
    const before = typeof existing.text === 'string' ? existing.text : '';
    if (before.trim() && before.trim() !== newText.trim()) {
      const lastEdit = Date.parse(existing.updatedAt) || 0;
      if (Date.now() - lastEdit >= AppState.NOTE_VERSION_GAP_MS) {
        newSnapshots.unshift({ text: before, updatedAt: existing.updatedAt || new Date().toISOString() });
        if (newSnapshots.length > AppState.MAX_NOTE_VERSIONS) newSnapshots.length = AppState.MAX_NOTE_VERSIONS;
      }
    }

    this.data.episodeNotes[key] = {
      text: newText,
      emotion: noteData.emotion || null,
      character: noteData.character || '',
      updatedAt: this.stampFor('notes', key, existing.updatedAt),
      snapshots: newSnapshots
    };
    this.clearDeleted('notes', key);

    this.save();
  }

  // Versões anteriores da anotação, da mais nova para a mais antiga: [{text, updatedAt}]
  getNoteVersions(showId, seasonNum, epNum) {
    const note = this.data.episodeNotes[this.noteKey(showId, seasonNum, epNum)];
    return note && Array.isArray(note.snapshots) ? note.snapshots.map(v => ({ text: v.text || '', updatedAt: v.updatedAt || '' })) : [];
  }

  // Restaura a versão `index` do histórico (0 = a mais nova). O texto que estava valendo vira uma versão nova
  // no topo do histórico e a versão restaurada sai da lista (virou o texto atual): nenhuma outra versão se perde
  // (só a mais antiga, se já houvesse o máximo). Emoção e personagem não mudam. Devolve o texto restaurado ou null.
  restoreNoteVersion(showId, seasonNum, epNum, index) {
    const key = this.noteKey(showId, seasonNum, epNum);
    const note = this.data.episodeNotes[key];
    const list = note && Array.isArray(note.snapshots) ? note.snapshots : [];
    const version = Number.isInteger(index) ? list[index] : null;
    if (!note || !version || typeof version.text !== 'string') return null;

    const snapshots = list.filter((_, i) => i !== index);
    const current = typeof note.text === 'string' ? note.text : '';
    if (current.trim() && current.trim() !== version.text.trim()) {
      snapshots.unshift({ text: current, updatedAt: note.updatedAt || new Date().toISOString() });
    }
    if (snapshots.length > AppState.MAX_NOTE_VERSIONS) snapshots.length = AppState.MAX_NOTE_VERSIONS;

    this.data.episodeNotes[key] = {
      ...note,
      text: version.text,
      updatedAt: this.stampFor('notes', key, note.updatedAt),
      snapshots
    };
    this.clearDeleted('notes', key);
    this.save();
    return version.text;
  }

  getNote(showId, seasonNum, epNum) {
    return this.data.episodeNotes[this.noteKey(showId, seasonNum, epNum)] || null;
  }

  // ----- exemplo opcional (D-22) -----
  // "Carregar exemplo": põe algumas obras do catálogo na lista como "Quero ver", SEM episódios assistidos, datas
  // ou anotações de enfeite. São obras comuns: o usuário remove quando quiser. Só entram as que o catálogo já trouxe.
  loadExample() {
    const added = [];
    let missing = 0;
    for (const id of AppState.EXAMPLE_SHOW_IDS) {
      if (this.getTracked(id)) continue;
      if (!this.getMedia(id)) { missing++; continue; }
      if (this.addShow(id)) added.push(id);
    }
    return { added, missing };
  }
}

AppState.NOTE_VERSION_GAP_MS = 10 * 60 * 1000; // anotação parada por 10 min = nova sessão de edição
AppState.MAX_NOTE_VERSIONS = 5;                // igual ao limite do servidor e do backup (MAX_SNAPSHOTS)
AppState.EXAMPLE_SHOW_IDS = [157336, 872585, 1396, 1429]; // Interestelar, Oppenheimer, Breaking Bad, Attack on Titan (seed)

window.appState = new AppState();
