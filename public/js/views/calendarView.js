// ================================================================
// SHOWVAULT · VIEW "AGENDA" (S15) (MVC)
// Episódios e estreias das obras da lista por dia (semana, 7 dias, 30 dias ou Todos = últimos 90 dias + tudo que vem pela frente). 100% no cliente: usa o detalhe que o app já tem e,
// ao abrir a aba, pede ao servidor (POST /media/:id/refresh) a atualização das obras em exibição. Cálculo em utils/calendar.js.
// ================================================================

class CalendarView {
  constructor() {
    this.container = document.getElementById('calendar-container');
    this.emptyState = document.getElementById('calendar-empty');
    this.counterPill = document.getElementById('calendar-counter-pill');
    this.notice = document.getElementById('calendar-notice');
    this.range = 'week';
    this.scrollToToday = false; // 'Todos' abre posicionado em Hoje (só ao abrir a aba ou trocar o filtro)
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
        document.querySelectorAll('#view-calendar .type-pill-btn').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        this.range = btn.getAttribute('data-range');
        this.scrollToToday = true;
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
    this.scrollToToday = true;
    const sync = window.syncService;
    if (this.refreshing || !sync || !sync.isLoggedIn()) return;
    if (this.lastRefreshAt && Date.now() - this.lastRefreshAt < CalendarView.REFRESH_EVERY_MS) return;
    const state = window.appState;
    const ids = (state.data.trackedShows || [])
      .filter(t => this.includeTracked(t))
      .map(t => ({ id: t.showId, media: state.getMedia(t.showId) }))
      .filter(x => x.media && this.needsRefresh(x.media))
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

  // Série/anime em exibição ou "Em breve"; filme ainda sem estreia ou com estreia de hoje em diante.
  needsRefresh(media) {
    if (media.type === 'movie') {
      const day = String(media.first_air_date || '').slice(0, 10);
      return !day || day >= this.today();
    }
    return CalendarView.AIRING_STATUSES.includes(media.status);
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
    if (this.counterPill) {
      this.counterPill.textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`;
    }

    if (items.length > 0) {
      this.emptyState.classList.add('hidden');
      this.container.innerHTML = this.renderPhases(window.Calendar.groupByDay(items));
      if (this.scrollToToday) {
        this.scrollToToday = false;
        const today = this.range === 'all' ? this.container.querySelector('#calendar-today') : null;
        if (today && typeof today.scrollIntoView === 'function') today.scrollIntoView({ block: 'start' });
      }
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
        text: 'Adicione séries, animes e filmes para ver aqui as datas de lançamento.',
        narrow: true,
        actionsHtml:
          '<button type="button" class="btn btn-primary" data-focus-key="cal:empty:explore" data-action="goto-tab" data-goto="explore">Explorar</button>'
      });
      return;
    }

    this.emptyState.innerHTML = window.ViewKit.emptyStateHtml({
      iconSvg: calendarIcon,
      title: 'Nada nesse período',
      text: 'Tente outro período.',
      narrow: true
    });
  }

  // "Hoje", "Amanhã", "Ontem" ou o dia da semana; depois a data dd/mm.
  dayHeading(group) {
    const names = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const rel = { '-1': 'Ontem', 0: 'Hoje', 1: 'Amanhã' }[String(group.daysFromToday)];
    const year = Number(this.today().slice(0, 4));
    const date = `${String(group.d).padStart(2, '0')}/${String(group.m).padStart(2, '0')}${group.y === year ? '' : '/' + group.y}`;
    return `${rel || names[group.weekday]} · ${date}`;
  }

  // Três blocos em ordem cronológica: já lançados (passado), hoje e próximos. Hoje sempre aparece como marco (mesmo sem itens).
  renderPhases(groups) {
    const past = groups.filter(g => g.phase === 'past');
    const today = groups.find(g => g.phase === 'today') || { phase: 'today', daysFromToday: 0, items: [], ...this.todayParts() };
    const future = groups.filter(g => g.phase === 'future');
    const block = (cls, label, inner) =>
      inner ? `<div class="calendar-phase calendar-phase--${cls}" role="group" aria-label="${label}">${inner}</div>` : '';
    return (
      block('past', 'Já lançados', past.map(g => this.renderDay(g)).join('')) +
      block('today', 'Hoje', this.renderDay(today)) +
      block('future', 'Próximos lançamentos', future.map(g => this.renderDay(g)).join(''))
    );
  }

  todayParts() {
    const day = window.Calendar.parseDay(this.today());
    return { key: this.today(), y: day.y, m: day.m, d: day.d, weekday: window.Calendar.weekday(this.today()) };
  }

  renderDay(group) {
    const isToday = group.phase === 'today';
    const mark = isToday ? '<span class="calendar-today-mark" aria-hidden="true"></span>' : '';
    const idAttr = isToday ? ' id="calendar-today"' : '';
    return `
      <div class="calendar-day calendar-day--${group.phase}"${idAttr}>
        <h3 class="calendar-day-title${isToday ? ' calendar-day-title--today' : ''}">${mark}${escapeHtml(this.dayHeading(group))}</h3>
        ${group.items.length > 0 ? `<ul class="calendar-list">${group.items.map(item => this.renderItem(item)).join('')}</ul>` : ''}
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

    const past = item.daysFromToday < 0;
    const released = past ? '<span class="calendar-item-released">Lançado</span>' : '';
    return `
      <li class="calendar-item${item.watched ? ' calendar-item--watched' : ''}${past ? ' calendar-item--past' : ''}" data-show-id="${id}">
        <div class="calendar-item-info">
          <div class="calendar-item-top">
            <span class="calendar-item-show">${escapeHtml(item.showName)}</span>
            ${window.ViewKit.typeBadge(item.type)}
            <span class="calendar-item-code">${escapeHtml(code)}</span>
            ${released}
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
