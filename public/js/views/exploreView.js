// ================================================================
// SHOWVAULT · VIEW DE EXPLORAÇÃO & BUSCA NA API (MVC)
// ================================================================

const SEARCH_DEBOUNCE_MS = 400;   // espera o usuário parar de digitar antes de buscar (a Jikan limita ~3 req/s)
const SEARCH_MIN_CHARS = 2;       // digitando: só busca com 2+ letras (Enter e o botão buscam qualquer tamanho)

class ExploreView {
  constructor() {
    this.container = document.getElementById('explore-container');
    this.titleEl = document.getElementById('explore-results-title');
    this.typeFilter = 'all';
    this.searchQuery = '';
    this.requestSeq = 0;        // só a resposta da requisição mais recente é exibida
    this.debounceTimer = null;
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
      clearTimeout(this.debounceTimer);
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
      // Busca enquanto digita, com atraso (debounce): uma requisição só quando a pessoa para de digitar.
      searchInput.addEventListener('input', () => {
        clearTimeout(this.debounceTimer);
        const value = searchInput.value.trim();
        if (value === this.searchQuery) return;
        if (value.length > 0 && value.length < SEARCH_MIN_CHARS) return;
        this.debounceTimer = setTimeout(doSearch, SEARCH_DEBOUNCE_MS);
      });
    }
  }

  // Mensagem de erro em português para o que pode dar errado na busca (limite de requisições, fonte fora do ar, sem conexão).
  describeError(err) {
    if (err && err.status === 429) {
      return 'Muitas buscas em pouco tempo ou o serviço de catálogo pediu para aguardar. Espere alguns segundos e tente de novo.';
    }
    if (err && err.status === 502) return 'A fonte externa do catálogo está indisponível agora. Tente de novo em instantes.';
    if (err && err.status === 503) return (err.message || 'O catálogo está temporariamente indisponível.');
    if (err && !err.status) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
    return (err && err.message) || 'Não foi possível carregar o catálogo.';
  }

  async loadMedia() {
    if (!this.container) return;
    const seq = ++this.requestSeq;
    const query = this.searchQuery;
    try {
      this.container.setAttribute('aria-busy', 'true');
      this.container.innerHTML = `<div class="grid-message" role="status">${query ? `Buscando "${escapeHtml(query)}"...` : 'Carregando catálogo...'}</div>`;

      let response;
      if (query) {
        response = await window.apiClient.search(query, this.typeFilter);
        if (seq !== this.requestSeq) return; // chegou uma busca mais nova: esta resposta é descartada
        if (this.titleEl) this.titleEl.textContent = `Resultados para "${query}" (${response ? response.count : 0})`;
      } else {
        response = await window.apiClient.getTrending(this.typeFilter);
        if (seq !== this.requestSeq) return;
        if (this.titleEl) this.titleEl.textContent = `Catálogo (${response ? response.count : 0})`;
      }

      const items = (response && response.data) ? response.data : [];
      if (window.appState) window.appState.cacheMediaList(items);
      this.container.removeAttribute('aria-busy');

      const warnings = (response && Array.isArray(response.warnings)) ? response.warnings : [];
      const notice = this.renderWarnings(warnings);

      if (items.length === 0) {
        this.container.innerHTML = `${notice}<div class="grid-message">Nenhuma obra encontrada${query ? ` para "${escapeHtml(query)}"` : ''}.</div>`;
        return;
      }

      this.render(items, notice);
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.container.removeAttribute('aria-busy');
      this.container.innerHTML = `<div class="grid-message grid-message--error" role="alert">${escapeHtml(this.describeError(err))}
        <div><button type="button" class="btn btn-sm btn-secondary" onclick="window.exploreView.loadMedia()">Tentar de novo</button></div></div>`;
    }
  }

  // Fontes que falharam ou não estão configuradas: a lista mostra o que as outras entregaram e avisa o que faltou.
  renderWarnings(warnings) {
    if (!warnings.length) return '';
    const texts = [...new Set(warnings.map(w => {
      if (w.code === 'NOT_CONFIGURED') return w.message;
      if (w.code === 'RATE_LIMITED') return `Uma fonte pediu para aguardar${w.retryAfterSec ? ` (~${w.retryAfterSec} s)` : ''}; alguns resultados podem estar faltando. Tente de novo em instantes.`;
      return 'Uma fonte do catálogo está indisponível; alguns resultados podem estar faltando.';
    }))];
    return texts.map(t => `<div class="grid-message grid-message--info" role="status">${escapeHtml(t)}</div>`).join('');
  }

  // Linha de metadados do cartão: filme = duração (só se conhecida); obra já carregada = nº de temporadas;
  // anime ainda não carregado = tipo (Filme/OVA), temporada de exibição e quantas partes da franquia foram agrupadas.
  metaText(item) {
    if (item.type === 'movie') return window.MediaDisplay.runtimeText(item.runtime) || 'Filme';
    if (Array.isArray(item.seasons) && item.seasons.length > 0) {
      return `${item.seasons.length} ${item.seasons.length === 1 ? 'temporada' : 'temporadas'}`;
    }
    const parts = [];
    if (item.anime_kind) parts.push(item.anime_kind);
    if (item.related_count > 0) parts.push(`+${item.related_count} ${item.related_count === 1 ? 'parte' : 'partes'} da franquia`);
    else if (item.episode_count) parts.push(`${item.episode_count} eps`);
    return parts.join(' · ');
  }

  render(items, notice = '') {
    const MD = window.MediaDisplay; // S08: "Sem nota"/"Sem gênero"/imagem local quando a fonte não informa
    const fallbackPoster = MD.POSTER_PLACEHOLDER;

    this.container.innerHTML = notice + items.map(item => {
      const isTracked = window.appState ? window.appState.data.trackedShows.some(t => t.showId === item.id) : false;

      const typeBadge = item.type === 'movie'
        ? `<span class="badge-type-tag badge-type-movie">Filme</span>`
        : item.type === 'anime'
        ? `<span class="badge-type-tag badge-type-anime">Anime</span>`
        : `<span class="badge-type-tag badge-type-tv">Série</span>`;

      // Temporada/cour de exibição ("Outono 2023") quando a fonte informa; senão o ano.
      const when = item.season_label || MD.yearText(item.first_air_date);
      const fullTitle = item.original_name ? `${item.name} (${item.original_name})` : item.name;

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
              <span class="show-year">${escapeHtml(when)}</span>
            </div>

            <h3 class="show-title" title="${escapeHtml(fullTitle)}"><button type="button" class="show-open-btn" data-focus-key="ex:${toInt(item.id)}:open" onclick="window.detailModalView.open(${toInt(item.id)})">${escapeHtml(item.name)}</button></h3>
            <div class="show-meta-line">
              <span>${escapeHtml(this.metaText(item))}</span>
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
