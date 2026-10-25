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
    const queue = this.calculateQueue();
    this.badge.textContent = queue.length;
    this.counterPill.textContent = `${queue.length} título${queue.length === 1 ? '' : 's'} na fila`;

    if (queue.length === 0) {
      this.container.innerHTML = '';
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');
    this.container.innerHTML = queue.map(item => {
      const typeBadge = item.type === 'movie' 
        ? `<span class="badge-type-tag badge-type-movie">🎬 Filme</span>` 
        : item.type === 'anime' 
        ? `<span class="badge-type-tag badge-type-anime">⛩️ Anime</span>`
        : `<span class="badge-type-tag badge-type-tv">📺 Série</span>`;

      const codeBadge = item.isMovie ? `FILME` : `T${item.seasonNumber}:E${item.episodeNumber}`;

      return `
        <div class="next-up-card">
          <div class="next-up-thumb-wrap" onclick="window.detailModalView.open(${item.showId})">
            <img class="next-up-thumb" src="${item.still_path}" alt="${item.title}" loading="lazy">
            <span class="next-up-badge">${codeBadge}</span>
            <span class="next-up-runtime">${item.runtime} min</span>
          </div>
          
          <div class="next-up-info">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
              <span class="next-up-show-name" onclick="window.detailModalView.open(${item.showId})">${item.showName}</span>
              ${typeBadge}
            </div>

            <h4 class="next-up-ep-title" onclick="window.detailModalView.open(${item.showId})">${item.title}</h4>
            <p class="next-up-overview">${item.overview || 'Sem descrição cadastrada.'}</p>
            
            <div class="next-up-footer">
              <button class="btn-check-episode" onclick="window.appController.quickCheck(${item.showId}, ${item.seasonNumber || null}, ${item.episodeNumber || null})">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Assistido</span>
              </button>
              
              <button class="btn-quick-note" onclick="window.detailModalView.openNote(${item.showId}, ${item.seasonNumber || null}, ${item.episodeNumber || null})" title="Anotar no Diário">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

window.nextUpView = new NextUpView();
