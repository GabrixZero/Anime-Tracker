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
      this.container.innerHTML = `<div class="grid-message">Carregando catálogo da API...</div>`;

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
        this.container.innerHTML = `<div class="grid-message">Nenhuma obra encontrada.</div>`;
        return;
      }

      this.render(items);
    } catch (err) {
      this.container.innerHTML = `<div class="grid-message grid-message--error">Erro ao carregar dados da API: ${escapeHtml(err.message)}</div>`;
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
          <div class="show-poster-wrap" onclick="window.detailModalView.open(${toInt(item.id)})">
            <img class="show-poster" 
                 src="${safeSrc(item.poster_path) || fallbackPoster}" 
                 alt="${escapeHtml(item.name)}" 
                 loading="lazy"
                 onerror="this.onerror=null; this.src='${fallbackPoster}';">
            <div class="show-rating-badge">★ ${formatRating(item.vote_average, '–')}</div>
          </div>

          <div class="show-info">
            <div class="show-info-top">
              ${typeBadge}
              <span class="show-year">${escapeHtml(item.first_air_date ? String(item.first_air_date).slice(0, 4) : '')}</span>
            </div>

            <h4 class="show-title" title="${escapeHtml(item.name)}" onclick="window.detailModalView.open(${toInt(item.id)})">${escapeHtml(item.name)}</h4>
            <div class="show-meta-line">
              <span>${isMovie ? `${escapeHtml(item.runtime || 120)} min` : `${item.seasons ? item.seasons.length : 1} temp.`}</span>
              <span>${escapeHtml((item.genres || []).slice(0, 2).join(', '))}</span>
            </div>

            <div class="show-card-actions">
              ${isTracked ? `
                <button class="btn btn-sm btn-secondary" onclick="window.detailModalView.open(${toInt(item.id)})">
                  Ver no Cofre
                </button>
              ` : `
                <button class="btn btn-sm btn-primary" onclick="window.appController.addToList(${toInt(item.id)})">
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
