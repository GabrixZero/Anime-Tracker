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

  // Contagens dos filtros e número da aba (mesma regra de status das estatísticas e do "A Seguir": state.getStatus).
  updateCounts() {
    const state = window.appState;
    const trackedList = state.data.trackedShows || [];
    if (this.badge) this.badge.textContent = trackedList.length;
    const counts = { all: trackedList.length, watching: 0, completed: 0, plan_to_watch: 0, paused: 0, dropped: 0 };
    trackedList.forEach(t => { counts[state.getStatus(t)]++; });

    const countIds = { all: 'count-all', watching: 'count-watching', completed: 'count-completed', plan_to_watch: 'count-plan', paused: 'count-paused', dropped: 'count-dropped' };
    Object.entries(countIds).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = counts[key];
    });
  }

  // Só o número da aba (barato): usado quando a aba está oculta e não será redesenhada.
  refreshBadge() {
    const state = window.appState;
    if (this.badge && state && state.data) this.badge.textContent = (state.data.trackedShows || []).length;
  }

  // A obra aparece com os filtros atuais? (precisa ter dados: lista leve ou detalhe)
  matchesFilters(t) {
    const state = window.appState;
    const media = state.getMedia(t.showId);
    if (!media) return false;
    if (this.catFilter !== 'all' && media.type !== this.catFilter) return false;
    if (this.statusFilter !== 'all' && state.getStatus(t) !== this.statusFilter) return false;
    return true;
  }

  render() {
    const state = window.appState;
    if (!state || !state.data) return;
    const trackedList = state.data.trackedShows || [];
    this.updateCounts();

    const filtered = trackedList.filter(t => this.matchesFilters(t));

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
    if (this.container) {
      this.container.innerHTML = filtered.map(t => this.renderCard(t)).join('');
    }
  }

  // Marcou/desmarcou um episódio da obra: troca só o cartão dela. Se a obra mudou de status e saiu do filtro atual
  // (ou ainda não está na tela), redesenha a lista.
  updateShow(showId) {
    const state = window.appState;
    const id = Number(showId);
    const tracked = state ? state.getTracked(id) : null;
    const card = this.container ? this.container.querySelector(`[data-show-id="${id}"]`) : null;
    if (!tracked || !card || !this.matchesFilters(tracked)) return this.render();
    this.updateCounts();
    card.outerHTML = this.renderCard(tracked);
  }

  renderCard(t) {
    const state = window.appState;
    const MD = window.MediaDisplay;
    const media = state.getMedia(t.showId);
    if (!media) return '';

    const isMovie = media.type === 'movie';
    const detailed = state.hasDetail(media.id);
    let percent = 0;
    let progressText;

    if (isMovie) {
      const watched = state.isWatched(media.id);
      percent = watched ? 100 : 0;
      progressText = watched ? 'Filme Assistido (100%)' : 'Não assistido';
    } else if (!detailed) {
      progressText = 'Carregando episódios...'; // o detalhe da obra ainda está a caminho (S09)
    } else {
      const progress = state.getProgress(media.id); // cache por obra: sem varrer os episódios a cada desenho
      percent = progress.total > 0 ? Math.round((progress.watched / progress.total) * 100) : 0;
      progressText = `${progress.watched}/${progress.total} eps (${percent}%)`;
    }

    const typeBadge = window.ViewKit.typeBadge(media.type);

    const seasonCount = Array.isArray(media.seasons) ? media.seasons.length : (Number(media.season_count) || 1);

    return `
          <div class="show-card" data-show-id="${toInt(media.id)}">
            <div class="show-poster-wrap">
              <img class="show-poster"
                   ${window.ViewKit.imgAttrs(media.poster_path, 'poster')}
                   alt="Pôster de ${escapeHtml(media.name)}"
                   loading="lazy" decoding="async">
              <div class="show-rating-badge">${escapeHtml(MD.ratingBadge(media.vote_average))}</div>
            </div>

            <div class="show-info">
              <div class="show-info-top">
                ${typeBadge}
                <span class="show-year">${escapeHtml(MD.yearText(media.first_air_date))}</span>
              </div>

              <h3 class="show-title" title="${escapeHtml(media.name)}"><button type="button" class="show-open-btn" data-focus-key="wl:${toInt(media.id)}:open" data-action="open-detail" data-show="${toInt(media.id)}">${escapeHtml(media.name)}</button></h3>
              <div class="show-meta-line">
                <span>${isMovie ? escapeHtml(MD.runtimeText(media.runtime) || 'Filme') : `${seasonCount} temp.`}</span>
                <span>${escapeHtml(MD.statusText(media.status))}</span>
              </div>

              <select class="status-select status-select--card" data-focus-key="wl:${toInt(media.id)}:status" aria-label="Status de ${escapeHtml(media.name)}" data-change-action="set-status" data-show="${toInt(media.id)}">${window.WatchStatus.statusOptionsHtml(state.getStatus(t))}</select>

              <div class="show-progress-wrap">
                <div class="show-progress-info">
                  <span>Progresso</span>
                  <span>${progressText}</span>
                </div>
                <div class="show-progress-bar" aria-hidden="true">
                  <div class="show-progress-fill ${percent === 100 ? 'complete' : ''} ${window.ViewKit.pctClass(percent)}"></div>
                </div>
              </div>
            </div>
          </div>
        `;
  }
}

window.watchlistView = new WatchlistView();
