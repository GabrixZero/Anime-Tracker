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
      // S08: lista realmente vazia = chamada para explorar + "Carregar exemplo"; com obras mas sem resultado no filtro = aviso do filtro
      const noItems = trackedList.length === 0;
      const title = document.getElementById('watchlist-empty-title');
      const text = document.getElementById('watchlist-empty-text');
      const exampleBtn = document.getElementById('btn-watchlist-example');
      if (title) title.textContent = noItems ? 'Sua lista está vazia' : 'Nenhuma obra neste filtro';
      if (text) text.textContent = noItems
        ? 'Explore o catálogo e adicione títulos para registrar seu progresso e suas notas. Quer só ver como funciona? Carregue alguns títulos de exemplo.'
        : 'Troque o filtro de status ou de categoria para ver as outras obras da sua lista.';
      if (exampleBtn) exampleBtn.classList.toggle('hidden', !noItems);
      return;
    }

    if (this.emptyState) this.emptyState.classList.add('hidden');
    const MD = window.MediaDisplay;
    const fallbackPoster = MD.POSTER_PLACEHOLDER;

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
          <div class="show-card">
            <div class="show-poster-wrap">
              <img class="show-poster" 
                   src="${safeSrc(media.poster_path) || fallbackPoster}" 
                   alt="Pôster de ${escapeHtml(media.name)}" 
                   loading="lazy"
                   onerror="this.onerror=null; this.src='${fallbackPoster}';">
              <div class="show-rating-badge">${escapeHtml(MD.ratingBadge(media.vote_average))}</div>
            </div>
            
            <div class="show-info">
              <div class="show-info-top">
                ${typeBadge}
                <span class="show-year">${escapeHtml(MD.yearText(media.first_air_date))}</span>
              </div>

              <h3 class="show-title" title="${escapeHtml(media.name)}"><button type="button" class="show-open-btn" data-focus-key="wl:${toInt(media.id)}:open" onclick="window.detailModalView.open(${toInt(media.id)})">${escapeHtml(media.name)}</button></h3>
              <div class="show-meta-line">
                <span>${isMovie ? escapeHtml(MD.runtimeText(media.runtime) || 'Filme') : `${media.seasons ? media.seasons.length : 1} temp.`}</span>
                <span>${escapeHtml(MD.statusText(media.status))}</span>
              </div>

              <select class="status-select status-select--card" data-focus-key="wl:${toInt(media.id)}:status" aria-label="Status de ${escapeHtml(media.name)}" onclick="event.stopPropagation()" onchange="window.appController.setStatus(${toInt(media.id)}, this.value)">${window.WatchStatus.statusOptionsHtml(state.getStatus(t))}</select>

              <div class="show-progress-wrap">
                <div class="show-progress-info">
                  <span>Progresso</span>
                  <span>${progressText}</span>
                </div>
                <div class="show-progress-bar" aria-hidden="true">
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
