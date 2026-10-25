// ================================================================
// SHOWVAULT · VIEW "MINHA LISTA" (WATCHLIST) (MVC)
// ================================================================

class WatchlistView {
  constructor() {
    this.container = document.getElementById('watchlist-container');
    this.emptyState = document.getElementById('watchlist-empty');
    this.badge = document.getElementById('badge-watchlist');
    this.statusFilter = 'all';
    this.catFilter = 'all';
    this.bindEvents();
  }

  bindEvents() {
    document.querySelectorAll('#watchlist-filters .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#watchlist-filters .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.statusFilter = btn.getAttribute('data-filter');
        this.render();
      });
    });

    document.querySelectorAll('#view-watchlist .type-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#view-watchlist .type-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.catFilter = btn.getAttribute('data-cat');
        this.render();
      });
    });
  }

  render() {
    const state = window.appState;
    const trackedList = state.data.trackedShows;
    this.badge.textContent = trackedList.length;

    let countAll = 0, countWatching = 0, countCompleted = 0, countPlan = 0;
    trackedList.forEach(t => {
      countAll++;
      if (t.status === 'watching') countWatching++;
      if (t.status === 'completed') countCompleted++;
      if (t.status === 'plan_to_watch') countPlan++;
    });

    document.getElementById('count-all').textContent = countAll;
    document.getElementById('count-watching').textContent = countWatching;
    document.getElementById('count-completed').textContent = countCompleted;
    document.getElementById('count-plan').textContent = countPlan;

    const filtered = trackedList.filter(t => {
      const media = state.getMedia(t.showId);
      if (!media) return false;

      if (this.catFilter !== 'all' && media.type !== this.catFilter) return false;
      if (this.statusFilter !== 'all' && t.status !== this.statusFilter) return false;
      return true;
    });

    if (filtered.length === 0) {
      this.container.innerHTML = '';
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');
    this.container.innerHTML = filtered.map(t => {
      const media = state.getMedia(t.showId);
      if (!media) return '';

      const isMovie = media.type === 'movie';
      let percent = 0;
      let progressText = '';

      if (isMovie) {
        const watched = state.isWatched(media.id);
        percent = watched ? 100 : 0;
        progressText = watched ? 'Filme Assistido (100%)' : 'Não assistido';
      } else {
        let totalEps = 0;
        let watchedEps = 0;
        (media.seasons || []).forEach(s => {
          (s.episodes || []).forEach(ep => {
            totalEps++;
            if (state.isWatched(media.id, s.season_number, ep.episode_number)) watchedEps++;
          });
        });
        percent = totalEps > 0 ? Math.round((watchedEps / totalEps) * 100) : 0;
        progressText = `${watchedEps}/${totalEps} eps (${percent}%)`;
      }

      const typeBadge = media.type === 'movie' 
        ? `<span class="badge-type-tag badge-type-movie">🎬 Filme</span>` 
        : media.type === 'anime' 
        ? `<span class="badge-type-tag badge-type-anime">⛩️ Anime</span>`
        : `<span class="badge-type-tag badge-type-tv">📺 Série</span>`;

      return `
        <div class="show-card" onclick="window.detailModalView.open(${media.id})">
          <div class="show-poster-wrap">
            <img class="show-poster" src="${media.poster_path}" alt="${media.name}" loading="lazy">
            <div class="show-rating-badge">★ ${media.vote_average.toFixed(1)}</div>
          </div>
          
          <div class="show-info">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              ${typeBadge}
              <span style="font-size: 0.72rem; color: var(--text-muted);">${media.first_air_date ? media.first_air_date.slice(0, 4) : ''}</span>
            </div>

            <h4 class="show-title" title="${media.name}">${media.name}</h4>
            <div class="show-meta-line">
              <span>${isMovie ? `${media.runtime} min` : `${media.seasons ? media.seasons.length : 1} temp.`}</span>
              <span>${media.status}</span>
            </div>

            <div class="show-progress-wrap">
              <div class="show-progress-info">
                <span>Progresso</span>
                <span>${progressText}</span>
              </div>
              <div class="show-progress-bar">
                <div class="show-progress-fill ${percent === 100 ? 'complete' : ''}" style="width: ${percent}%;"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

window.watchlistView = new WatchlistView();
