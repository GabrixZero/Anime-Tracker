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
    this.addStatusFilters();
    this.bindEvents();
  }

  // Filtros "Pausados" e "Desisti": criados a partir do botão "Quero Ver" (mesmo visual), para não duplicar HTML.
  addStatusFilters() {
    const base = document.querySelector('#watchlist-filters [data-filter="plan_to_watch"]');
    if (!base) return;
    [['paused', 'Pausados', 'count-paused'], ['dropped', 'Desisti', 'count-dropped']].forEach(([filter, label, countId]) => {
      if (document.getElementById(countId)) return;
      const btn = base.cloneNode(false);
      btn.classList.remove('active');
      btn.setAttribute('data-filter', filter);
      btn.append(`${label} (`);
      const count = document.createElement('span');
      count.id = countId;
      count.textContent = '0';
      btn.append(count, ')');
      base.parentNode.appendChild(btn);
    });
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
    if (!state || !state.data) return;
    const trackedList = state.data.trackedShows || [];
    if (this.badge) this.badge.textContent = trackedList.length;

    // Mesma regra de status das estatísticas e do "A Seguir": state.getStatus (utils/watchStatus.js)
    const counts = { all: trackedList.length, watching: 0, completed: 0, plan_to_watch: 0, paused: 0, dropped: 0 };
    trackedList.forEach(t => { counts[state.getStatus(t)]++; });

    const countIds = { all: 'count-all', watching: 'count-watching', completed: 'count-completed', plan_to_watch: 'count-plan', paused: 'count-paused', dropped: 'count-dropped' };
    Object.entries(countIds).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = counts[key];
    });

    const filtered = trackedList.filter(t => {
      const media = state.getMedia(t.showId);
      if (!media) return false;

      if (this.catFilter !== 'all' && media.type !== this.catFilter) return false;
      if (this.statusFilter !== 'all' && state.getStatus(t) !== this.statusFilter) return false;
      return true;
    });

    if (filtered.length === 0) {
      if (this.container) this.container.innerHTML = '';
      if (this.emptyState) this.emptyState.classList.remove('hidden');
      return;
    }

    if (this.emptyState) this.emptyState.classList.add('hidden');
    const fallbackPoster = 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500&auto=format&fit=crop&q=80';

    if (this.container) {
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
          ? `<span class="badge-type-tag badge-type-movie">Filme</span>` 
          : media.type === 'anime' 
          ? `<span class="badge-type-tag badge-type-anime">Anime</span>`
          : `<span class="badge-type-tag badge-type-tv">Série</span>`;

        return `
          <div class="show-card" onclick="window.detailModalView.open(${toInt(media.id)})">
            <div class="show-poster-wrap">
              <img class="show-poster" 
                   src="${safeSrc(media.poster_path) || fallbackPoster}" 
                   alt="${escapeHtml(media.name)}" 
                   loading="lazy"
                   onerror="this.onerror=null; this.src='${fallbackPoster}';">
              <div class="show-rating-badge">★ ${formatRating(media.vote_average, '–')}</div>
            </div>
            
            <div class="show-info">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                ${typeBadge}
                <span style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(media.first_air_date ? String(media.first_air_date).slice(0, 4) : '')}</span>
              </div>

              <h4 class="show-title" title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</h4>
              <div class="show-meta-line">
                <span>${isMovie ? `${escapeHtml(media.runtime)} min` : `${media.seasons ? media.seasons.length : 1} temp.`}</span>
                <span>${escapeHtml(media.status || '')}</span>
              </div>

              <select class="status-select status-select--card" aria-label="Status de ${escapeHtml(media.name)}" onclick="event.stopPropagation()" onchange="window.appController.setStatus(${toInt(media.id)}, this.value)">${window.WatchStatus.statusOptionsHtml(state.getStatus(t))}</select>

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
}

window.watchlistView = new WatchlistView();
