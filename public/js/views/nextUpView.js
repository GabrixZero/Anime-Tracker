// ================================================================
// SHOWVAULT · VIEW "A SEGUIR" (NEXT UP) (MVC)
// ================================================================

class NextUpView {
  constructor() {
    this.container = document.getElementById('next-up-container');
    this.emptyState = document.getElementById('next-up-empty');
    this.counterPill = document.getElementById('next-up-counter-pill');
    this.badge = document.getElementById('badge-next-up');
    this.typeFilter = 'all';
    this.bindEvents();
  }


  bindEvents() {
    document.querySelectorAll('#view-next-up .type-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#view-next-up .type-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.typeFilter = btn.getAttribute('data-type');
        this.render();
      });
    });
  }

  // Item da fila de UMA obra da lista (ou null se ela não tem nada pendente / não entra na fila).
  // S09: o próximo episódio vem do cache de progresso do estado (uma varredura por obra, não por render).
  queueItemFor(tracked) {
    const state = window.appState;
    // Finalizado, Pausado e Desisti não entram na fila (regra única em utils/watchStatus.js)
    if (!window.WatchStatus.isQueueStatus(state.getStatus(tracked))) return null;

    const media = state.getMedia(tracked.showId);
    if (!media) return null;

    if (this.typeFilter !== 'all' && media.type !== this.typeFilter) return null;

    // Filme
    if (media.type === 'movie') {
      if (state.isWatched(media.id)) return null;
      return {
        isMovie: true,
        showId: media.id,
        showName: media.name,
        type: media.type,
        title: "Filme Completo",
        runtime: media.runtime,
        overview: media.overview,
        still_path: media.backdrop_path || media.poster_path
      };
    }

    // Série ou Anime: primeiro episódio ainda não assistido (obra sem detalhe carregado ainda não tem episódios)
    const next = state.getNextEpisode(media.id);
    const ep = next ? state.getEpisode(media.id, next.seasonNumber, next.episodeNumber) : null;
    if (!ep) return null;
    return {
      isMovie: false,
      showId: media.id,
      showName: media.name,
      type: media.type,
      seasonNumber: next.seasonNumber,
      episodeNumber: next.episodeNumber,
      title: ep.name,
      runtime: ep.runtime,
      overview: ep.overview,
      still_path: ep.still_path || media.backdrop_path || media.poster_path
    };
  }

  calculateQueue() {
    const queue = [];
    const state = window.appState;
    if (!state || !state.data || !state.data.trackedShows) return queue;
    state.data.trackedShows.forEach((tracked) => {
      const item = this.queueItemFor(tracked);
      if (item) queue.push(item);
    });
    return queue;
  }

  // Só o número da aba (barato): usado quando a aba está oculta e não será redesenhada.
  refreshBadge() {
    if (!window.appState || window.appState.detailsStatus === 'loading') return null;
    const count = this.calculateQueue().length;
    if (this.badge) this.badge.textContent = count;
    return count;
  }

  // Marcou/desmarcou um episódio da obra: troca só o cartão dela (ou o tira da fila); o resto da lista não é tocado.
  // Mudanças que alteram a estrutura (obra entrou na fila, fila ficou vazia, mensagem de carregamento) caem no render completo.
  updateShow(showId) {
    const state = window.appState;
    const id = Number(showId);
    const card = this.container ? this.container.querySelector(`[data-show-id="${id}"]`) : null;
    const tracked = state ? state.getTracked(id) : null;
    const item = tracked ? this.queueItemFor(tracked) : null;
    if (!card || (!item && this.container.querySelectorAll('[data-show-id]').length <= 1)) return this.render();
    if (item) card.outerHTML = this.renderCard(item);
    else card.remove();
    const count = this.refreshBadge();
    if (this.counterPill && count !== null) this.counterPill.textContent = `${count} título${count === 1 ? '' : 's'} na fila`;
  }

  render() {
    const state = window.appState;
    const trackedCount = (state && state.data && state.data.trackedShows) ? state.data.trackedShows.length : 0;

    // Obras da lista ainda sem episódios (o detalhe chega em lote do servidor, S09): mostra o carregamento em vez de uma fila errada.
    if (state && trackedCount > 0 && state.detailsStatus !== 'idle' && state.data.trackedShows.some(t => !state.hasDetail(t.showId))) {
      const failed = state.detailsStatus === 'error';
      if (this.counterPill) this.counterPill.textContent = failed ? 'Não carregou' : 'Carregando fila...';
      if (this.badge) this.badge.textContent = '0';
      if (this.container) {
        this.container.innerHTML = failed
          ? `<div class="grid-message grid-message--error" role="alert">Não foi possível carregar os episódios das suas obras. Verifique a conexão.
              <div><button type="button" class="btn btn-sm btn-secondary" data-focus-key="nuload:retry" onclick="window.appController.retryDetails()">Tentar de novo</button></div></div>`
          : '<div class="grid-message grid-message--info" role="status">Carregando próximos episódios...</div>';
      }
      if (this.emptyState) this.emptyState.classList.add('hidden');
      return;
    }

    const queue = this.calculateQueue();
    if (this.badge) this.badge.textContent = queue.length;
    if (this.counterPill) this.counterPill.textContent = `${queue.length} título${queue.length === 1 ? '' : 's'} na fila`;

    if (queue.length > 0) {
      this.emptyState.classList.add('hidden');
      this.container.innerHTML = queue.map(item => this.renderCard(item)).join('');
      return;
    }

    // Fila vazia
    this.container.innerHTML = '';
    this.emptyState.classList.remove('hidden');

    // Caso 1: Usuário não possui nenhuma obra na lista
    if (trackedCount === 0) {
      this.emptyState.innerHTML = `
        <div class="empty-icon empty-icon--muted">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>
        </div>
        <h3 class="empty-title">Sua lista está vazia</h3>
        <p class="empty-text empty-text--narrow">Você ainda não adicionou nenhuma série, anime ou filme. Explore o catálogo para começar, ou carregue alguns títulos de exemplo para ver o app funcionando (você remove quando quiser).</p>
        <div class="empty-actions">
          <button type="button" class="btn btn-primary" data-focus-key="empty:explore" onclick="window.appController.switchTab('explore')">Explorar</button>
          <button type="button" class="btn btn-outline" data-focus-key="empty:example" onclick="window.appController.loadExample()">Carregar exemplo</button>
        </div>
      `;
      return;
    }

    // Caso 2: Filtro específico ativo sem resultados
    if (this.typeFilter !== 'all') {
      const typeLabel = this.typeFilter === 'tv' ? 'séries' : this.typeFilter === 'anime' ? 'animes' : 'filmes';
      this.emptyState.innerHTML = `
        <div class="empty-icon empty-icon--muted">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        </div>
        <h3 class="empty-title">Nenhum título pendente em ${typeLabel}</h3>
        <p class="empty-text">Todos os seus lançamentos desta categoria estão concluídos.</p>
        <button class="btn btn-outline" onclick="document.querySelector('#view-next-up .type-pill-btn[data-type=all]').click()">Ver Todos os Títulos</button>
      `;
      return;
    }

    // Caso 3: O usuário REALMENTE está com tudo em dia
    this.emptyState.innerHTML = `
      <div class="empty-icon empty-icon--success">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <h3 class="empty-title">Você está em dia com tudo!</h3>
      <p class="empty-text empty-text--narrow">Nenhum episódio ou filme pendente. Explore novas obras para adicionar à sua maratona.</p>
      <button type="button" class="btn btn-primary" data-focus-key="empty:explore" onclick="window.appController.switchTab('explore')">Explorar</button>
    `;
  }

  renderCard(item) {
    const typeBadge = item.type === 'movie' 
      ? `<span class="badge-type-tag badge-type-movie">Filme</span>` 
      : item.type === 'anime' 
      ? `<span class="badge-type-tag badge-type-anime">Anime</span>`
      : `<span class="badge-type-tag badge-type-tv">Série</span>`;

    const codeBadge = item.isMovie ? `FILME` : `T${item.seasonNumber}:E${item.episodeNumber}`;
    const fallbackThumb = window.MediaDisplay.STILL_PLACEHOLDER;

    return `
      <div class="next-up-card" data-show-id="${toInt(item.showId)}">
        <div class="next-up-thumb-wrap" aria-hidden="true" onclick="window.detailModalView.open(${toInt(item.showId)})">
          <img class="next-up-thumb"
               src="${safeSrc(item.still_path) || fallbackThumb}"
               alt=""
               loading="lazy" decoding="async"
               onerror="this.onerror=null; this.src='${fallbackThumb}';">
          <span class="next-up-badge">${escapeHtml(codeBadge)}</span>
          ${window.MediaDisplay.runtimeText(item.runtime) ? `<span class="next-up-runtime">${escapeHtml(window.MediaDisplay.runtimeText(item.runtime))}</span>` : ''}
        </div>
        
        <div class="next-up-info">
          <div class="next-up-info-top">
            <span class="next-up-show-name" onclick="window.detailModalView.open(${toInt(item.showId)})">${escapeHtml(item.showName)}</span>
            ${typeBadge}
          </div>

          <h3 class="next-up-ep-title"><button type="button" class="link-btn" data-focus-key="nu:${toInt(item.showId)}:open" onclick="window.detailModalView.open(${toInt(item.showId)})">${escapeHtml(item.title)}</button></h3>
          <p class="next-up-overview">${escapeHtml(item.overview || 'Sem descrição cadastrada.')}</p>
          
          <div class="next-up-footer">
            <button type="button" class="btn-check-episode" data-focus-key="nu:${toInt(item.showId)}:check" aria-label="Marcar como assistido: ${escapeHtml(item.showName)}, ${escapeHtml(codeBadge)}" onclick="window.appController.quickCheck(${toInt(item.showId)}, ${toInt(item.seasonNumber) || null}, ${toInt(item.episodeNumber) || null})">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Assistido</span>
            </button>
            
            <button type="button" class="btn-quick-note" data-focus-key="nu:${toInt(item.showId)}:note" aria-label="Anotar no diário: ${escapeHtml(item.showName)}, ${escapeHtml(codeBadge)}" onclick="window.detailModalView.openNote(${toInt(item.showId)}, ${toInt(item.seasonNumber) || null}, ${toInt(item.episodeNumber) || null})" title="Anotar no Diário">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

window.nextUpView = new NextUpView();
