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
      this.container.innerHTML = `<div class="grid-message">Carregando catálogo...</div>`;

      let response;
      if (this.searchQuery) {
        response = await window.apiClient.search(this.searchQuery, this.typeFilter);
        if (this.titleEl) this.titleEl.textContent = `Resultados para "${this.searchQuery}" (${response ? response.count : 0})`;
      } else {
        response = await window.apiClient.getTrending(this.typeFilter);
        if (this.titleEl) this.titleEl.textContent = `Catálogo (${response ? response.count : 0})`;
      }

      const items = (response && response.data) ? response.data : [];
      if (window.appState) window.appState.cacheMediaList(items);

      if (items.length === 0) {
        this.container.innerHTML = `<div class="grid-message">Nenhuma obra encontrada.</div>`;
        return;
      }

      this.render(items);
    } catch (err) {
      this.container.innerHTML = `<div class="grid-message grid-message--error">Não foi possível carregar o catálogo: ${escapeHtml(err.message)}</div>`;
    }
  }

  render(items) {
    const MD = window.MediaDisplay; // S08: "Sem nota"/"Sem gênero"/imagem local quando a fonte não informa
    const fallbackPoster = MD.POSTER_PLACEHOLDER;

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
          <div class="show-poster-wrap">
            <img class="show-poster" 
                 src="${safeSrc(item.poster_path) || fallbackPoster}" 
                 alt="Pôster de ${escapeHtml(item.name)}" 
                 loading="lazy"
                 onerror="this.onerror=null; this.src='${fallbackPoster}';">
            <div class="show-rating-badge">${escapeHtml(MD.ratingBadge(item.vote_average))}</div>
          </div>

          <div class="show-info">
            <div class="show-info-top">
              ${typeBadge}
              <span class="show-year">${escapeHtml(MD.yearText(item.first_air_date))}</span>
            </div>

            <h3 class="show-title" title="${escapeHtml(item.name)}"><button type="button" class="show-open-btn" data-focus-key="ex:${toInt(item.id)}:open" onclick="window.detailModalView.open(${toInt(item.id)})">${escapeHtml(item.name)}</button></h3>
            <div class="show-meta-line">
              <span>${isMovie ? escapeHtml(MD.runtimeText(item.runtime) || 'Filme') : `${item.seasons ? item.seasons.length : 1} temp.`}</span>
              <span>${escapeHtml(MD.genresText(item.genres, 2))}</span>
            </div>

            <div class="show-card-actions">
              ${isTracked ? `
                <button type="button" class="btn btn-sm btn-secondary" data-focus-key="ex:${toInt(item.id)}:action" onclick="window.detailModalView.open(${toInt(item.id)})">
                  Ver no Cofre
                </button>
              ` : `
                <button type="button" class="btn btn-sm btn-primary" data-focus-key="ex:${toInt(item.id)}:action" onclick="window.appController.addToList(${toInt(item.id)})">
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
