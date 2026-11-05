// ================================================================
// SHOWVAULT · VIEW "AGENDA" (S15) (MVC)
// Episódios das obras da lista por dia (semana, próximos 7 ou 30 dias). 100% no cliente: usa o detalhe que o app já tem e,
// ao abrir a aba, pede ao servidor (POST /media/:id/refresh) a atualização das obras em exibição. Cálculo em utils/calendar.js.
// ================================================================

class CalendarView {
  constructor() {
    this.container = document.getElementById('calendar-container');
    this.emptyState = document.getElementById('calendar-empty');
    this.counterPill = document.getElementById('calendar-counter-pill');
    this.notice = document.getElementById('calendar-notice');
    this.range = 'week';
    this.refreshing = false;
    this.lastRefreshAt = 0; // início da última rodada de atualização das fontes (uma a cada 30 min por sessão)
    this.refreshFailures = 0; // obras que não atualizaram na última rodada
    this.bindEvents();
  }

  bindEvents() {
    document.querySelectorAll('#view-calendar .type-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#view-calendar .type-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.range = btn.getAttribute('data-range');
        this.render();
      });
    });
  }

  today() {
    return window.Calendar.dayKey(new Date());
  }

  // Todas as obras da lista, menos as que o usuário desistiu (status "Desisti").
  includeTracked(tracked) {
    return window.appState.getStatus(tracked) !== 'dropped';
  }

  // Obras sem nenhuma data futura conhecida (seção "Sem data prevista"), independente do período.
  buildUndated() {
    const state = window.appState;
    if (!state || !state.data || !state.data.trackedShows) return [];
    return window.Calendar.buildUndated(state.data.trackedShows, id => state.getMedia(id), this.today(), {
      includeTracked: t => this.includeTracked(t)
    });
  }

  buildItems() {
    const state = window.appState;
    if (!state || !state.data || !state.data.trackedShows) return [];
    return window.Calendar.buildAgenda(
      state.data.trackedShows,
      id => state.getMedia(id),
      (id, s, e) => state.isWatched(id, s, e),
      this.today(),
      { range: this.range, includeTracked: t => this.includeTracked(t) }
    );
  }

  // ---------- atualização das fontes ao abrir a aba ----------
  // Chamado pelo AppController.switchTab('calendar'). Só com login, no máximo 1 rodada a cada 30 min, até 8 obras, uma por vez.
  async onOpen() {
    const sync = window.syncService;
    if (this.refreshing || !sync || !sync.isLoggedIn()) return;
    if (this.lastRefreshAt && Date.now() - this.lastRefreshAt < CalendarView.REFRESH_EVERY_MS) return;
    const state = window.appState;
    const ids = (state.data.trackedShows || [])
      .filter(t => this.includeTracked(t))
      .map(t => ({ id: t.showId, media: state.getMedia(t.showId) }))
      .filter(x => x.media && CalendarView.AIRING_STATUSES.includes(x.media.status))
      .slice(0, CalendarView.REFRESH_LIMIT)
      .map(x => x.id);
    this.lastRefreshAt = Date.now();
    if (ids.length === 0) return;

    this.refreshing = true;
    this.refreshFailures = 0;
    this.renderNotice();
    for (const id of ids) {
      try {
        const res = await window.apiClient.refreshMedia(id);
        if (res && res.data && Number(res.data.id) === Number(id)) state.cacheMediaDetail(res.data);
      } catch (err) {
        this.refreshFailures++;
        console.warn('Não foi possível atualizar a obra para a agenda:', err.message);
      }
    }
    this.refreshing = false;
    const app = window.appController;
    app.dirty.add('calendar');
    if (app.activeTab === 'calendar') app.renderTab('calendar');
  }

  renderNotice() {
    if (!this.notice) return;
    let text = '';
    if (this.refreshing) text = 'Atualizando as obras em exibição...';
    else if (this.refreshFailures > 0) text = 'Algumas obras não foram atualizadas agora; mostrando os dados salvos.';
    this.notice.textContent = text;
    this.notice.classList.toggle('hidden', !text);
  }

  // ---------- desenho ----------
  render() {
    const state = window.appState;
    const trackedCount = state && state.data && state.data.trackedShows ? state.data.trackedShows.length : 0;
    this.renderNotice();

    // Obras da lista ainda sem episódios (o detalhe chega em lote): carregamento ou erro, nunca uma agenda errada.
    if (state && trackedCount > 0 && state.detailsStatus !== 'idle' && state.data.trackedShows.some(t => !state.hasEpisodes(t.showId))) {
      const failed = state.detailsStatus === 'error';
      if (this.counterPill) this.counterPill.textContent = failed ? 'Não carregou' : 'Carregando agenda...';
      if (this.container) {
        this.container.innerHTML = failed
          ? `<div class="grid-message grid-message--error" role="alert">Não foi possível carregar os episódios das suas obras. Verifique a conexão.
              <div><button type="button" class="btn btn-sm btn-secondary" data-focus-key="cal:retry:retry" data-action="retry-details">Tentar de novo</button></div></div>`
          : '<div class="grid-message grid-message--info" role="status">Carregando a agenda...</div>';
      }
      if (this.emptyState) this.emptyState.classList.add('hidden');
      return;
    }

    const items = this.buildItems();
    const undated = this.buildUndated();
    if (this.counterPill) {
      const eps = `${items.length} episódio${items.length === 1 ? '' : 's'}`;
      this.counterPill.textContent = undated.length > 0 ? `${eps} · ${undated.length} sem data` : eps;
    }

    if (items.length > 0 || undated.length > 0) {
      this.emptyState.classList.add('hidden');
      const noEpisodes =
        items.length === 0
          ? '<div class="grid-message grid-message--info" role="status">Nenhum episódio com data nesse período. Tente outro período.</div>'
          : '';
      this.container.innerHTML =
        noEpisodes +
        window.Calendar.groupByDay(items)
          .map(g => this.renderDay(g))
          .join('') +
        this.renderUndated(undated);
      return;
    }

    this.container.innerHTML = '';
    this.emptyState.classList.remove('hidden');
    const calendarIcon =
      '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

    if (trackedCount === 0) {
      this.emptyState.innerHTML = window.ViewKit.emptyStateHtml({
        iconSvg: calendarIcon,
        title: 'Sua lista está vazia',
        text: 'Adicione séries e animes em exibição para ver aqui os dias em que saem os próximos episódios.',
        narrow: true,
        actionsHtml:
          '<button type="button" class="btn btn-primary" data-focus-key="cal:empty:explore" data-action="goto-tab" data-goto="explore">Explorar</button>'
      });
      return;
    }

    this.emptyState.innerHTML = window.ViewKit.emptyStateHtml({
      iconSvg: calendarIcon,
      title: 'Nenhum episódio nesse período',
      text: 'Tente outro período. A agenda só mostra episódios com data de exibição conhecida, de todas as obras exceto as que você desistiu.',
      narrow: true
    });
  }

  // "Hoje", "Amanhã", "Ontem" ou o dia da semana; depois a data dd/mm.
  dayHeading(group) {
    const names = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const rel = { '-1': 'Ontem', 0: 'Hoje', 1: 'Amanhã' }[String(group.daysFromToday)];
    const date = `${String(group.d).padStart(2, '0')}/${String(group.m).padStart(2, '0')}`;
    return `${rel || names[group.weekday]} · ${date}`;
  }

  renderDay(group) {
    return `
      <div class="calendar-day">
        <h3 class="calendar-day-title${group.daysFromToday === 0 ? ' calendar-day-title--today' : ''}">${escapeHtml(this.dayHeading(group))}</h3>
        <ul class="calendar-list">
          ${group.items.map(item => this.renderItem(item)).join('')}
        </ul>
      </div>
    `;
  }

  // Seção no fim: obras sem data prevista (sem botão de marcar episódio, só abre o detalhe).
  renderUndated(list) {
    if (list.length === 0) return '';
    return `
      <div class="calendar-day calendar-undated">
        <h3 class="calendar-day-title">Sem data prevista</h3>
        <ul class="calendar-list">
          ${list
            .map(o => {
              const id = toInt(o.showId);
              return `
          <li class="calendar-item" data-show-id="${id}">
            <div class="calendar-item-info">
              <div class="calendar-item-top">
                <span class="calendar-item-show">${escapeHtml(o.showName)}</span>
                ${window.ViewKit.typeBadge(o.type)}
              </div>
              <p class="calendar-item-title"><button type="button" class="link-btn" data-focus-key="cal:undated-${id}:open" aria-label="Ver detalhes: ${escapeHtml(o.showName)}" data-action="open-detail" data-show="${id}">Ver detalhes</button></p>
            </div>
          </li>`;
            })
            .join('')}
        </ul>
      </div>
    `;
  }

  renderItem(item) {
    const id = toInt(item.showId);
    const isMovie = item.type === 'movie';
    const code = isMovie ? 'FILME' : `T${toInt(item.seasonNumber)}:E${toInt(item.episodeNumber)}`;
    const epAttrs = isMovie ? '' : ` data-season="${toInt(item.seasonNumber)}" data-episode="${toInt(item.episodeNumber)}"`;
    const key = isMovie ? `${id}-m` : `${id}-${toInt(item.seasonNumber)}-${toInt(item.episodeNumber)}`;
    const title = item.title || (isMovie ? 'Filme' : `Episódio ${toInt(item.episodeNumber)}`);
    const label = `${escapeHtml(item.showName)}, ${escapeHtml(code)}`;
    const button = item.watched
      ? `<button type="button" class="calendar-check calendar-check--done" data-focus-key="cal:${key}:check" aria-label="Desmarcar como assistido: ${label}" data-action="quick-check" data-show="${id}"${epAttrs}>
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"/></svg>
           <span>Assistido · Desfazer</span>
         </button>`
      : `<button type="button" class="calendar-check" data-focus-key="cal:${key}:check" aria-label="Marcar como assistido: ${label}" data-action="quick-check" data-show="${id}"${epAttrs}>
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"/></svg>
           <span>Assistido</span>
         </button>`;

    return `
      <li class="calendar-item${item.watched ? ' calendar-item--watched' : ''}" data-show-id="${id}">
        <div class="calendar-item-info">
          <div class="calendar-item-top">
            <span class="calendar-item-show">${escapeHtml(item.showName)}</span>
            ${window.ViewKit.typeBadge(item.type)}
            <span class="calendar-item-code">${escapeHtml(code)}</span>
          </div>
          <p class="calendar-item-title"><button type="button" class="link-btn" data-focus-key="cal:${key}:open" data-action="open-detail" data-show="${id}">${escapeHtml(title)}</button></p>
        </div>
        ${button}
      </li>
    `;
  }
}

CalendarView.REFRESH_EVERY_MS = 30 * 60 * 1000;
CalendarView.REFRESH_LIMIT = 8;
CalendarView.AIRING_STATUSES = ['Em Exibição', 'Em breve'];

window.calendarView = new CalendarView();
