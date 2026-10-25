// ================================================================
// SHOWVAULT · VIEW DE EXPLORAÇÃO & BUSCA NA API (MVC)
// ================================================================

class ExploreView {
  constructor() {
    this.container = document.getElementById('explore-container');
    this.titleEl = document.getElementById('explore-results-title');
    this.typeFilter = 'all';
    this.searchQuery = '';
    this.bindEvents();
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  bindEvents() {
    // Filtros de Categoria (Todos, Séries, Animes, Filmes)
    document.querySelectorAll('#view-explore .type-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#view-explore .type-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.typeFilter = btn.getAttribute('data-explore-type');
        this.loadMedia();
      });
    });

    // Busca
    const searchInput = document.getElementById('explore-search-input');
    const searchBtn = document.getElementById('btn-search-shows');

    const doSearch = () => {
      if (searchInput) {
        this.searchQuery = searchInput.value.trim();
        this.loadMedia();
      }
    };

    if (searchBtn) searchBtn.addEventListener('click', doSearch);
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    }
  }

  async loadMedia() {
    if (!this.container) return;
    try {
      this.container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">Carregando catálogo da API...</div>`;

      let response;
      if (this.searchQuery) {
        response = await window.apiClient.search(this.searchQuery, this.typeFilter);
        if (this.titleEl) this.titleEl.textContent = `Resultados para "${this.searchQuery}" (${response ? response.count : 0})`;
      } else {
        response = await window.apiClient.getTrending(this.typeFilter);
        if (this.titleEl) this.titleEl.textContent = `Destaques da API (${response ? response.count : 0})`;
      }

      const items = (response && response.data) ? response.data : [];
      if (window.appState) window.appState.cacheMediaList(items);

      if (items.length === 0) {
        this.container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">Nenhuma obra encontrada.</div>`;
        return;
      }

      this.render(items);
    } catch (err) {
      this.container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--accent-rose);">Erro ao carregar dados da API: ${err.message}</div>`;
    }
  }

  render(items) {
    const fallbackPoster = 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500&auto=format&fit=crop&q=80';

    this.container.innerHTML = items.map(item => {
      const isTracked = window.appState ? window.appState.data.trackedShows.some(t => t.showId === item.id) : false;
      const isMovie = item.type === 'movie';

      const typeBadge = item.type === 'movie' 
        ? `<span class="badge-type-tag badge-type-movie">Filme</span>` 
        : item.type === 'anime' 
        ? `<span class="badge-type-tag badge-type-anime">Anime</span>`
        : `<span class="badge-type-tag badge-type-tv">Série</span>`;

      return `
        <div class="show-card">
          <div class="show-poster-wrap" onclick="window.detailModalView.open(${item.id})">
            <img class="show-poster" 
                 src="${this.escapeHtml(item.poster_path)}" 
                 alt="${this.escapeHtml(item.name)}" 
                 loading="lazy"
                 onerror="this.onerror=null; this.src='${fallbackPoster}';">
            <div class="show-rating-badge">★ ${item.vote_average ? item.vote_average.toFixed(1) : '8.0'}</div>
          </div>

          <div class="show-info">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              ${typeBadge}
              <span style="font-size: 0.72rem; color: var(--text-muted);">${item.first_air_date ? item.first_air_date.slice(0, 4) : ''}</span>
            </div>

            <h4 class="show-title" title="${this.escapeHtml(item.name)}" onclick="window.detailModalView.open(${item.id})">${this.escapeHtml(item.name)}</h4>
            <div class="show-meta-line">
              <span>${isMovie ? `${item.runtime || 120} min` : `${item.seasons ? item.seasons.length : 1} temp.`}</span>
              <span>${this.escapeHtml((item.genres || []).slice(0, 2).join(', '))}</span>
            </div>

            <div style="margin-top: auto; padding-top: 0.5rem;">
              ${isTracked ? `
                <button class="btn btn-sm btn-secondary" style="width: 100%;" onclick="window.detailModalView.open(${item.id})">
                  Ver no Cofre
                </button>
              ` : `
                <button class="btn btn-sm btn-primary" style="width: 100%;" onclick="window.appController.addToList(${item.id})">
                  + Adicionar à Lista
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

window.exploreView = new ExploreView();
