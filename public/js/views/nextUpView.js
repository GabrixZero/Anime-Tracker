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

  calculateQueue() {
    const queue = [];
    const state = window.appState;
    if (!state || !state.data || !state.data.trackedShows) return queue;

    state.data.trackedShows.forEach(tracked => {
      if (tracked.status === 'completed' || tracked.status === 'dropped') return;

      const media = state.getMedia(tracked.showId);
      if (!media) return;

      if (this.typeFilter !== 'all' && media.type !== this.typeFilter) return;

      // Filme
      if (media.type === 'movie') {
        const isWatched = state.isWatched(media.id);
        if (!isWatched) {
          queue.push({
            isMovie: true,
            showId: media.id,
            showName: media.name,
            type: media.type,
            title: "Filme Completo",
            runtime: media.runtime || 120,
            overview: media.overview,
            still_path: media.backdrop_path || media.poster_path
          });
        }
        return;
      }

      // Série ou Anime
      if (media.seasons) {
        for (const season of media.seasons) {
          if (!season.episodes) continue;
          let found = false;
          for (const ep of season.episodes) {
            if (!state.isWatched(media.id, season.season_number, ep.episode_number)) {
              queue.push({
                isMovie: false,
                showId: media.id,
                showName: media.name,
                type: media.type,
                seasonNumber: season.season_number,
                episodeNumber: ep.episode_number,
                title: ep.name,
                runtime: ep.runtime || 45,
                overview: ep.overview,
                still_path: ep.still_path || media.backdrop_path || media.poster_path
              });
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
    });

    return queue;
  }

  render() {
    const state = window.appState;
    const trackedCount = (state && state.data && state.data.trackedShows) ? state.data.trackedShows.length : 0;

    // Aguarda catálogo inicial estar carregado se ainda estiver vazio
    if (!state || state.mediaMap.size === 0) {
      if (this.counterPill) this.counterPill.textContent = 'Carregando fila...';
      if (this.badge) this.badge.textContent = '0';
      if (this.container) {
        this.container.innerHTML = '<div class="grid-message grid-message--info">Carregando próximos episódios...</div>';
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
        <p class="empty-text empty-text--narrow">Você ainda não adicionou nenhuma série, anime ou filme. Explore o catálogo para começar sua maratona.</p>
        <button class="btn btn-primary" onclick="window.appController.switchTab('explore')">Explorar Catálogo</button>
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
      <button class="btn btn-primary" onclick="window.appController.switchTab('explore')">Explorar Catálogo</button>
    `;
  }

  renderCard(item) {
    const typeBadge = item.type === 'movie' 
      ? `<span class="badge-type-tag badge-type-movie">Filme</span>` 
      : item.type === 'anime' 
      ? `<span class="badge-type-tag badge-type-anime">Anime</span>`
      : `<span class="badge-type-tag badge-type-tv">Série</span>`;

    const codeBadge = item.isMovie ? `FILME` : `T${item.seasonNumber}:E${item.episodeNumber}`;
    const fallbackThumb = 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?w=600&auto=format&fit=crop&q=80';

    return `
      <div class="next-up-card">
        <div class="next-up-thumb-wrap" onclick="window.detailModalView.open(${toInt(item.showId)})">
          <img class="next-up-thumb" 
               src="${safeSrc(item.still_path) || fallbackThumb}" 
               alt="${escapeHtml(item.title)}" 
               loading="lazy"
               onerror="this.onerror=null; this.src='${fallbackThumb}';">
          <span class="next-up-badge">${escapeHtml(codeBadge)}</span>
          <span class="next-up-runtime">${escapeHtml(item.runtime)} min</span>
        </div>
        
        <div class="next-up-info">
          <div class="next-up-info-top">
            <span class="next-up-show-name" onclick="window.detailModalView.open(${toInt(item.showId)})">${escapeHtml(item.showName)}</span>
            ${typeBadge}
          </div>

          <h4 class="next-up-ep-title" onclick="window.detailModalView.open(${toInt(item.showId)})">${escapeHtml(item.title)}</h4>
          <p class="next-up-overview">${escapeHtml(item.overview || 'Sem descrição cadastrada.')}</p>
          
          <div class="next-up-footer">
            <button class="btn-check-episode" onclick="window.appController.quickCheck(${toInt(item.showId)}, ${toInt(item.seasonNumber) || null}, ${toInt(item.episodeNumber) || null})">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Assistido</span>
            </button>
            
            <button class="btn-quick-note" onclick="window.detailModalView.openNote(${toInt(item.showId)}, ${toInt(item.seasonNumber) || null}, ${toInt(item.episodeNumber) || null})" title="Anotar no Diário">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

window.nextUpView = new NextUpView();
