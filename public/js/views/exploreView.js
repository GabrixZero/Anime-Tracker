// ================================================================
// SHOWVAULT · VIEW DE EXPLORAÇÃO & BUSCA NA API (MVC)
// ================================================================

const SEARCH_DEBOUNCE_MS = 400;   // espera o usuário parar de digitar antes de buscar (a Jikan limita ~3 req/s)
const SEARCH_MIN_CHARS = 2;       // digitando: só busca com 2+ letras (Enter e o botão buscam qualquer tamanho)
const EXPLORE_PAGE_SIZE = 60;     // obras por página na lista do catálogo (S09); "Mostrar mais" traz as próximas

class ExploreView {
  constructor() {
    this.container = document.getElementById('explore-container');
    this.titleEl = document.getElementById('explore-results-title');
    this.typeFilter = 'all';
    this.searchQuery = '';
    this.requestSeq = 0;        // só a resposta da requisição mais recente é exibida
    this.debounceTimer = null;
    this.items = [];            // itens já exibidos (a lista paginada cresce com "Mostrar mais")
    this.notice = '';
    this.hasMore = false;
    this.loadingMore = false;
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
        // S09: lista leve e paginada (a primeira página; "Mostrar mais" busca as seguintes)
        response = await window.apiClient.getTrending(this.typeFilter, { limit: EXPLORE_PAGE_SIZE });
        if (seq !== this.requestSeq) return;
        if (this.titleEl) this.titleEl.textContent = `Catálogo (${response ? (response.total ?? response.count) : 0})`;
      }

      const items = (response && response.data) ? response.data : [];
      if (window.appState) window.appState.cacheMediaList(items);
      this.container.removeAttribute('aria-busy');

      const warnings = (response && Array.isArray(response.warnings)) ? response.warnings : [];
      const notice = this.renderWarnings(warnings);
      this.items = items;
      this.notice = notice;
      this.hasMore = !query && !!(response && response.hasMore);

      if (items.length === 0) {
        this.container.innerHTML = `${notice}<div class="grid-message">Nenhuma obra encontrada${query ? ` para "${escapeHtml(query)}"` : ''}.</div>`;
        return;
      }

      this.render(items, notice);
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.container.removeAttribute('aria-busy');
      this.container.innerHTML = `<div class="grid-message grid-message--error" role="alert">${escapeHtml(this.describeError(err))}
        <div><button type="button" class="btn btn-sm btn-secondary" data-action="retry-explore">Tentar de novo</button></div></div>`;
    }
  }

  // Depois de adicionar/remover uma obra (S10, achado da S03): redesenha os cartões que já estão na tela, sem buscar de novo,
  // para o botão virar "Ver no Cofre"/"+ Adicionar" e devolve o foco ao mesmo botão (o HTML é recriado).
  refresh() {
    if (!this.container || !Array.isArray(this.items) || this.items.length === 0) return;
    if (this.container.querySelector('.grid-message--error')) return; // mostrando erro de busca: não há cartões
    const active = document.activeElement;
    const key = active && this.container.contains(active) ? active.getAttribute('data-focus-key') : null;
    this.render(this.items, this.notice);
    if (key) {
      const again = this.container.querySelector(`[data-focus-key="${key}"]`);
      if (again && again.focus) again.focus();
    }
  }

  // "Mostrar mais": próxima página da lista leve do catálogo (só na lista sem busca).
  async loadMore() {
    if (!this.hasMore || this.loadingMore) return;
    this.loadingMore = true;
    const seq = this.requestSeq; // se uma carga/busca nova começar enquanto isso, esta resposta é descartada
    try {
      const response = await window.apiClient.getTrending(this.typeFilter, { limit: EXPLORE_PAGE_SIZE, offset: this.items.length });
      if (seq !== this.requestSeq) return;
      const more = (response && response.data) ? response.data : [];
      if (window.appState) window.appState.cacheMediaList(more);
      this.items = this.items.concat(more);
      this.hasMore = !!(response && response.hasMore) && more.length > 0;
      this.render(this.items, this.notice);
      // o botão "Mostrar mais" foi redesenhado: leva o foco ao primeiro título novo
      const first = more.length ? this.container.querySelector(`[data-focus-key="ex:${toInt(more[0].id)}:open"]`) : null;
      if (first && first.focus) first.focus();
    } catch (err) {
      if (seq === this.requestSeq && window.appController) window.appController.showToast(this.describeError(err), 'error');
    } finally {
      this.loadingMore = false;
    }
  }

  // Fontes que falharam ou não estão configuradas: a lista mostra o que as outras entregaram e avisa o que faltou.
  renderWarnings(warnings) {
    if (!warnings.length) return '';
    // aviso com `fallback` = a fonte reserva respondeu no lugar da que falhou: os resultados estão completos, nada a avisar
    const texts = [...new Set(warnings.filter(w => !w.fallback).map(w => {
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
    // obra do catálogo: a lista leve traz `season_count`; o detalhe completo traz as temporadas
    const seasonCount = Array.isArray(item.seasons) ? item.seasons.length : (Number(item.season_count) || 0);
    if (seasonCount > 0) {
      return `${seasonCount} ${seasonCount === 1 ? 'temporada' : 'temporadas'}`;
    }
    const parts = [];
    if (item.anime_kind) parts.push(item.anime_kind);
    if (item.related_count > 0) parts.push(`+${item.related_count} ${item.related_count === 1 ? 'parte' : 'partes'} da franquia`);
    else if (item.episode_count) parts.push(`${item.episode_count} eps`);
    return parts.join(' · ');
  }

  render(items, notice = '') {
    const MD = window.MediaDisplay; // S08: "Sem nota"/"Sem gênero"/imagem local quando a fonte não informa
    const trackedIds = new Set(window.appState ? window.appState.data.trackedShows.map(t => t.showId) : []);

    this.container.innerHTML = notice + items.map(item => {
      // S13: resultado externo que é a MESMA obra de uma que o catálogo já tem (amostra do seed): `catalog_id` é o id dela
      const ownId = item.catalog_id && trackedIds.has(item.catalog_id) ? item.catalog_id : item.id;
      const isTracked = trackedIds.has(ownId);

      const typeBadge = window.ViewKit.typeBadge(item.type);

      // Temporada/cour de exibição ("Outono 2023") quando a fonte informa; senão o ano.
      const when = item.season_label || MD.yearText(item.first_air_date);
      const fullTitle = item.original_name ? `${item.name} (${item.original_name})` : item.name;

      return `
        <div class="show-card">
          <div class="show-poster-wrap">
            <img class="show-poster"
                 ${window.ViewKit.imgAttrs(item.poster_path, 'poster')}
                 alt="Pôster de ${escapeHtml(item.name)}"
                 loading="lazy" decoding="async">
            <div class="show-rating-badge">${escapeHtml(MD.ratingBadge(item.vote_average))}</div>
          </div>

          <div class="show-info">
            <div class="show-info-top">
              ${typeBadge}
              <span class="show-year">${escapeHtml(when)}</span>
            </div>

            <h3 class="show-title" title="${escapeHtml(fullTitle)}"><button type="button" class="show-open-btn" data-focus-key="ex:${toInt(item.id)}:open" data-action="open-detail" data-show="${toInt(item.id)}">${escapeHtml(item.name)}</button></h3>
            <div class="show-meta-line">
              <span>${escapeHtml(this.metaText(item))}</span>
              <span>${escapeHtml(MD.genresText(item.genres, 2))}</span>
            </div>

            <div class="show-card-actions">
              ${isTracked ? `
                <button type="button" class="btn btn-sm btn-secondary" data-focus-key="ex:${toInt(item.id)}:action" data-action="open-detail" data-show="${toInt(ownId)}">
                  Ver no Cofre
                </button>
              ` : `
                <button type="button" class="btn btn-sm btn-primary" data-focus-key="ex:${toInt(item.id)}:action" data-action="add-to-list" data-show="${toInt(item.id)}">
                  + Adicionar à Lista
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('') + (this.hasMore ? `<div class="grid-message"><button type="button" class="btn btn-secondary" data-focus-key="ex:more:load" data-action="load-more">Mostrar mais</button></div>` : '');
  }
}

window.exploreView = new ExploreView();
