// ================================================================
// SHOWVAULT · VIEW DETALHES DE OBRA & DIÁRIO BLINDADO (MVC)
// ================================================================

class DetailModalView {
  constructor() {
    this.detailModal = document.getElementById('modal-show-detail');
    this.noteModal = document.getElementById('modal-episode-note');
    this.currentShowId = null;
    this.currentSeasonNum = 1; // só no modo completo
    // 'explore' = quadro enxuto (aba Explorar); 'full' = quadro completo (Minha Lista, A Seguir, Agenda...). Quem abre informa.
    this.mode = 'full';
    this.currentNoteEp = { showId: null, seasonNum: null, epNum: null, isMovie: false };
    this.autoSaveTimer = null;
    this.detailToken = 0; // invalida o carregamento de detalhe de uma obra que já não é a aberta
    this.bindEvents();
  }

  bindEvents() {
    // Fechamento de Modais
    document.getElementById('btn-close-show-modal').addEventListener('click', () => this.detailModal.classList.add('hidden'));
    document.getElementById('btn-close-note-modal').addEventListener('click', () => this.noteModal.classList.add('hidden'));
    document.getElementById('btn-save-note-modal').addEventListener('click', () => {
      this.noteModal.classList.add('hidden');
      window.appController.refreshAll();
      window.appController.showToast('Anotação registrada com sucesso no seu cofre!', 'success');
    });

    // Auto-save no Textarea
    const textarea = document.getElementById('note-textarea');
    if (textarea) {
      textarea.addEventListener('input', () => {
        this.updateWordCount(textarea.value);
        this.triggerAutoSave();
      });
    }

    const charInput = document.getElementById('note-character-input');
    if (charInput) {
      charInput.addEventListener('input', () => this.triggerAutoSave());
    }

    // Emoções no Modal
    document.querySelectorAll('#note-emotion-selector .emotion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        document.querySelectorAll('#note-emotion-selector .emotion-btn').forEach(b => b.classList.remove('active'));
        if (!wasActive) btn.classList.add('active');
        this.triggerAutoSave();
      });
    });

    // Toolbar de Markdown
    document.querySelectorAll('.tool-btn[data-insert]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ins = btn.getAttribute('data-insert');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (ins === '**' || ins === '*') {
          const selected = val.substring(start, end) || 'texto';
          textarea.value = val.substring(0, start) + `${ins}${selected}${ins}` + val.substring(end);
        } else if (ins === '> ') {
          textarea.value = val.substring(0, start) + `\n> ` + val.substring(end);
        } else if (ins.includes('spoiler')) {
          const selected = val.substring(start, end) || 'spoiler';
          textarea.value = val.substring(0, start) + `>!${selected}!<` + val.substring(end);
        }
        this.triggerAutoSave();
      });
    });

    // ===== S08: histórico de versões da anotação =====
    const historyBtn = document.getElementById('btn-note-history');
    if (historyBtn) historyBtn.addEventListener('click', () => this.toggleHistory());
    const historyList = document.getElementById('note-history-list');
    if (historyList) {
      historyList.addEventListener('click', e => {
        const btn = e.target.closest ? e.target.closest('[data-restore]') : null;
        if (btn) this.restoreVersion(Number(btn.getAttribute('data-restore')));
      });
    }
    // ===== fim S08 =====

    // Toggle de Assistido dentro do Diário
    document.getElementById('note-watched-toggle').addEventListener('change', () => {
      const { showId, seasonNum, epNum } = this.currentNoteEp;
      // mesmo caminho do botão de episódio: marcar também marca os anteriores (D-AV2-3), com um aviso "Desfazer"
      const media = window.appState.getMedia(showId);
      if (media && media.type !== 'movie') {
        window.appController.quickCheck(showId, seasonNum, epNum);
        document.getElementById('note-watched-toggle').checked = window.appState.isWatched(showId, seasonNum, epNum);
        return;
      }
      const isWatched = window.appState.toggleWatched(showId, seasonNum, epNum);
      document.getElementById('note-watched-toggle').checked = isWatched;
      window.appController.onEpisodeToggled(showId, seasonNum, epNum);
    });

    // Batch Actions do modo completo (S09: atualiza as linhas no lugar, sem reconstruir a lista de episódios)
    document.getElementById('btn-batch-check-season').addEventListener('click', () => {
      window.appState.batchSetSeason(this.currentShowId, this.currentSeasonNum, true);
      this.syncEpisodeRows();
      window.appController.refreshShow(this.currentShowId);
      window.appController.showToast('Temporada inteira marcada como assistida!', 'success');
    });

    document.getElementById('btn-batch-uncheck-season').addEventListener('click', () => {
      window.appState.batchSetSeason(this.currentShowId, this.currentSeasonNum, false);
      this.syncEpisodeRows();
      window.appController.refreshShow(this.currentShowId);
      window.appController.showToast('Temporada desmarcada.');
    });

    // Modo enxuto (Ajustes 3): lista só de leitura, cada temporada é um <details>; o conteúdo só é desenhado quando ela abre.
    // `toggle` não borbulha, então o ouvinte fica na captura do contêiner (um só para todas as temporadas).
    document.getElementById('show-episodes-container').addEventListener(
      'toggle',
      e => {
        const details = e.target;
        if (!details || !details.open || !details.getAttribute) return;
        const num = details.getAttribute('data-season');
        if (num !== null && num !== '') this.openSeason(Number(num));
      },
      true
    );
  }

  // O modal está aberto mostrando esta obra?
  isOpenFor(showId) {
    return this.currentShowId === Number(showId) && !this.detailModal.classList.contains('hidden');
  }

  // Obra da lista leve (ou resultado de busca) ainda sem episódios: carrega o detalhe e redesenha o modal (S09).
  async loadDetail(showId) {
    const token = ++this.detailToken;
    await window.appController.ensureDetails([showId]);
    if (token !== this.detailToken || !this.isOpenFor(showId)) return; // abriu outra obra / fechou enquanto carregava
    if (window.appState.hasDetail(showId)) {
      const keepSeason = this.currentSeasonNum; // veio do resumo: reabre na mesma temporada (modo completo)
      this.open(showId);
      const media = window.appState.getMedia(showId);
      if (
        this.mode === 'full' &&
        keepSeason !== this.currentSeasonNum &&
        Array.isArray(media.seasons) &&
        media.seasons.some(s => s.season_number === keepSeason)
      )
        this.switchSeason(keepSeason);
    } else if (window.appState.hasEpisodes(showId)) {
      // o detalhe completo falhou, mas o resumo já mostra os episódios: segue com ele
    } else this.renderNoEpisodes('Não foi possível carregar os episódios desta obra agora. Feche e abra de novo para tentar outra vez.');
  }

  // Sem episódios para mostrar (carregando, erro ou obra que ainda não foi adicionada): limpa abas e lista antigas.
  renderNoEpisodes(message) {
    this.stopObservers();
    document.getElementById('show-seasons-tabs').innerHTML = '';
    document.getElementById('season-stats-summary').innerHTML = '';
    document.getElementById('show-episodes-container').innerHTML = `<p class="muted" role="status">${escapeHtml(message)}</p>`;
  }

  // Ajusta o HTML fixo do quadro ao modo (abas, resumo e botões de temporada só existem no completo) e, ao trocar de modo,
  // limpa o que o outro modo desenhou para nada vazar (ids únicos: os mesmos elementos servem aos dois modos).
  applyMode(mode) {
    const changed = mode !== this.mode;
    this.mode = mode;
    const full = mode === 'full';
    this.detailModal.setAttribute('data-detail-mode', mode);
    document.getElementById('show-seasons-tabs').classList.toggle('hidden', !full);
    document.getElementById('season-summary-bar').classList.toggle('hidden', !full);
    const container = document.getElementById('show-episodes-container');
    if (full) {
      container.setAttribute('role', 'tabpanel');
    } else {
      container.removeAttribute('role');
      container.removeAttribute('aria-labelledby');
    }
    if (changed) {
      this.stopObservers();
      this.renderedBySeason = {};
      this.renderToken = (this.renderToken || 0) + 1;
      document.getElementById('show-seasons-tabs').innerHTML = '';
      document.getElementById('season-stats-summary').innerHTML = '';
      container.innerHTML = '';
      document.getElementById('movie-detail-body').innerHTML = '';
    }
  }

  // `mode` ('explore' | 'full'): quem abre informa. Sem informar, a reabertura interna (adicionar/remover/carregar detalhe)
  // mantém o modo do quadro aberto; com o quadro fechado volta ao completo.
  open(showId, mode) {
    const media = window.appState.getMedia(showId);
    if (!media) return;

    const isOpen = !this.detailModal.classList.contains('hidden');
    this.applyMode(mode === 'explore' || mode === 'full' ? mode : isOpen ? this.mode : 'full');
    const explore = this.mode === 'explore';

    this.currentShowId = Number(showId);
    const header = document.getElementById('show-modal-header');
    const seriesBody = document.getElementById('series-detail-body');
    const movieBody = document.getElementById('movie-detail-body');

    const typeBadge = window.ViewKit.typeBadge(media.type);

    const tracked = window.appState.getTracked(media.id);
    const MD = window.MediaDisplay;
    header.style.backgroundImage = cssUrl(safeUrl(media.backdrop_path) || media.poster_path);
    // S08: nada de nota/gênero/ano inventados; o que a fonte não informa aparece como "Sem nota"/"Sem gênero" ou some
    const metaParts = [
      MD.hasRating(media.vote_average)
        ? `<span>★ <strong>${escapeHtml(Number(media.vote_average).toFixed(1))}</strong></span>`
        : '<span>Sem nota</span>',
      MD.yearText(media.first_air_date) ? `<span>${escapeHtml(MD.yearText(media.first_air_date))}</span>` : '',
      `<span>${escapeHtml(MD.genresText(media.genres))}</span>`,
      (!explore || media.type !== 'movie') && MD.runtimeText(media.runtime)
        ? `<span>${escapeHtml(MD.runtimeText(media.runtime))}</span>`
        : ''
    ]
      .filter(Boolean)
      .join('<span>•</span>');
    header.innerHTML = `
      <img class="modal-poster" ${window.ViewKit.imgAttrs(media.poster_path, 'poster')} alt="Pôster de ${escapeHtml(media.name)}">
      <div class="modal-header-info">
        <div class="modal-type-row">${typeBadge}</div>
        <h2 class="modal-title" id="detail-modal-title">${escapeHtml(media.name)}</h2>
        <div class="modal-meta">${metaParts}</div>
        <p class="modal-synopsis">${escapeHtml(media.overview || 'Sem sinopse.')}</p>
        <div class="modal-actions">
          ${
            explore && tracked && media.type === 'movie'
              ? `
            <span class="in-list-chip" data-focus-key="detail:in-list">✓ Na sua lista</span>
            <button type="button" class="btn btn-sm btn-secondary" data-focus-key="detail:primary" data-action="remove-from-list" data-show="${toInt(media.id)}">Remover da Lista</button>
          `
              : tracked
                ? `
            <button type="button" class="btn btn-sm btn-secondary" data-focus-key="detail:primary" data-action="remove-from-list" data-show="${toInt(media.id)}">Remover da Lista</button>
            <label class="status-picker">
              <span class="status-picker-label">Status</span>
              <select class="status-select" id="detail-status-select" aria-label="Status da obra" data-change-action="set-status" data-show="${toInt(media.id)}">${window.WatchStatus.statusOptionsHtml(window.appState.getStatus(tracked))}</select>
            </label>
            ${window.Rating.ratingControlHtml({ showId: media.id, name: media.name, rating: tracked.rating, idPrefix: 'detail-rating' })}
          `
                : `
            <button type="button" class="btn btn-sm btn-primary" data-focus-key="detail:primary" data-action="add-to-list" data-show="${toInt(media.id)}">+ Adicionar à Lista</button>
          `
          }
        </div>
      </div>
    `;

    if (media.type === 'movie') {
      seriesBody.classList.add('hidden');

      if (explore) {
        movieBody.innerHTML = ''; // D-AV3-3: no Explorar o quadro do filme é só o cabeçalho (título, nota, ano, gênero, sinopse e botão)
        movieBody.classList.add('hidden');
      } else {
        movieBody.classList.remove('hidden');
        movieBody.innerHTML = this.movieBoxHtml(media);
      }
    } else {
      movieBody.innerHTML = '';
      movieBody.classList.add('hidden');
      seriesBody.classList.remove('hidden');

      if (!Array.isArray(media.seasons)) {
        // lista leve (episódios a caminho) ou resultado de busca externo (sem episódios até a obra ser adicionada)
        this.renderNoEpisodes(
          media.isExternal ? 'Os episódios aparecem depois que a obra é adicionada à lista.' : 'Carregando episódios...'
        );
      } else {
        if (!explore) {
          this.currentSeasonNum = media.seasons.length > 0 ? media.seasons[0].season_number : 1;
          this.renderSeasonTabs();
        }
        this.renderEpisodes();
      }
    }

    this.detailModal.classList.remove('hidden');
    if (!window.appState.hasDetail(media.id) && !media.isExternal) this.loadDetail(media.id);
  }

  // Modo completo: caixa do filme (assistido/pendente, duração, anotação e botões de marcar/anotar).
  movieBoxHtml(media) {
    const isWatched = window.appState.isWatched(media.id);
    const note = window.appState.getNote(media.id);
    const hasNote = note && note.text && note.text.trim();

    return `
        <div class="movie-actions-box">
          <div>
            <h3>${isWatched ? '✓ Filme Assistido no Seu Diário' : 'Filme Pendente para Assistir'}</h3>
            <p>${
              window.MediaDisplay.knownRuntime(media.runtime)
                ? `Duração: ${escapeHtml(window.MediaDisplay.knownRuntime(media.runtime))} minutos, contados nas estatísticas ao marcar.`
                : 'Duração não informada pela fonte; as estatísticas usam 120 min como estimativa.'
            }</p>
            ${hasNote ? `<p class="movie-quote">"${escapeHtml(this.notePreview(note.text, 75))}"</p>` : ''}
          </div>

          <div class="movie-btn-group">
            <button type="button" class="btn ${isWatched ? 'btn-secondary' : 'btn-primary'}" data-focus-key="detail:movie-check" data-action="quick-check" data-show="${toInt(media.id)}">
              ${isWatched ? 'Desmarcar Filme' : '✓ Marcar como Assistido'}
            </button>
            <button type="button" class="btn btn-outline" data-focus-key="detail:movie-note" data-action="open-note" data-show="${toInt(media.id)}">
              ${hasNote ? 'Editar Anotação' : 'Anotar no Diário'}
            </button>
          </div>
        </div>
      `;
  }

  // Mantém o campo de nota do modal igual ao estado (valor normalizado, "Remover nota" só com nota), sem redesenhar (o foco fica).
  refreshRating() {
    const input = document.getElementById(`detail-rating-${this.currentShowId}`);
    if (!input || this.currentShowId === null) return;
    const rating = window.appState.getRating(this.currentShowId);
    input.value = window.Rating.formatUserRating(rating);
    const clear = input.parentNode ? input.parentNode.querySelector('[data-action="clear-rating"]') : null;
    if (clear) clear.disabled = rating === null;
  }

  // Mantém o seletor de status do modal igual ao estado (ex.: virou "Finalizado" ao marcar o último episódio).
  refreshStatusPicker() {
    const select = document.getElementById('detail-status-select');
    if (!select || this.currentShowId === null) return;
    const tracked = window.appState.getTracked(this.currentShowId);
    if (!tracked) return;
    const status = window.appState.getStatus(tracked);
    if (select.value !== status) select.value = status;
  }

  stopObservers() {
    Object.values(this.moreObservers || {}).forEach(o => o.disconnect());
    if (this.moreObserver) this.moreObserver.disconnect();
    this.moreObserver = null;
    this.moreObservers = {};
  }

  // Modo enxuto: lista só de leitura com TODAS as temporadas, um <details> por temporada (a primeira vem aberta e já desenhada).
  renderSeasonBlocks() {
    const media = window.appState.getMedia(this.currentShowId);
    if (!media || !media.seasons) return;
    const container = document.getElementById('show-episodes-container');
    this.stopObservers();
    this.renderedBySeason = {};
    this.renderToken = (this.renderToken || 0) + 1;

    if (media.seasons.length === 0) {
      container.innerHTML = `<p class="muted">Nenhum episódio cadastrado.</p>`;
      return;
    }
    container.innerHTML = media.seasons.map((season, i) => this.seasonHtml(season, i === 0)).join('');
    this.observeMore(media.seasons[0].season_number);
  }

  seasonTitle(season) {
    const total = (season.episodes || []).length;
    return `${season.name || `Temporada ${season.season_number}`} · ${total} ${total === 1 ? 'episódio' : 'episódios'}`;
  }

  // S18: com centenas de episódios só o primeiro bloco existe; o resto é desenhado aos poucos (rolagem ou botão).
  seasonHtml(season, isOpen) {
    const num = toInt(season.season_number);
    const episodes = season.episodes || [];
    let body = '';
    if (episodes.length === 0) body = '<p class="muted">Nenhum episódio cadastrado.</p>';
    else if (isOpen) body = this.firstBlockHtml(num, episodes);
    return `<details class="season-block" data-season="${num}"${isOpen ? ' open' : ''}><summary>${escapeHtml(this.seasonTitle(season))}</summary>${body}</details>`;
  }

  // Primeiro bloco de linhas da temporada + botão "Mostrar mais" se sobrar; registra quantas linhas já existem.
  firstBlockHtml(num, episodes) {
    const slice = episodes.slice(0, DetailModalView.EP_CHUNK);
    this.renderedBySeason[num] = slice.length;
    return `<ol class="episode-list" data-season-list="${num}">${this.episodeLinesHtml(slice)}</ol>${this.moreHtml(num, episodes.length - slice.length)}`;
  }

  moreHtml(num, left) {
    if (left <= 0) return '';
    return `<div class="episodes-more"><button type="button" class="btn btn-outline" data-focus-key="ep:${num}:more" data-action="more-episodes" data-season="${num}">Mostrar mais episódios (faltam ${left})</button></div>`;
  }

  findSeason(num) {
    const media = window.appState.getMedia(this.currentShowId);
    const season = media && Array.isArray(media.seasons) && media.seasons.find(s => s.season_number === Number(num));
    return season || null;
  }

  // A temporada acabou de abrir: desenha o primeiro bloco (só na primeira vez).
  openSeason(num) {
    const key = toInt(num);
    const season = this.findSeason(key);
    if (!season || !season.episodes || season.episodes.length === 0) return;
    if (this.renderedBySeason && this.renderedBySeason[key] !== undefined) return;
    const details = document.getElementById('show-episodes-container').querySelector(`details[data-season="${key}"]`);
    if (!details) return;
    details.insertAdjacentHTML('beforeend', this.firstBlockHtml(key, season.episodes));
    this.observeMore(key);
  }

  // Um observador por temporada: aciona o "Mostrar mais" sozinho quando o botão entra na tela.
  observeMore(num) {
    if (typeof IntersectionObserver === 'undefined') return;
    const key = toInt(num);
    const container = document.getElementById('show-episodes-container');
    const btn = container.querySelector(`details[data-season="${key}"] .episodes-more button`);
    if (!btn) return;
    const token = this.renderToken;
    const observer = new IntersectionObserver(
      entries => {
        if (token === this.renderToken && entries.some(e => e.isIntersecting)) this.showMoreEpisodes(key);
      },
      { root: null, rootMargin: '400px' }
    );
    observer.observe(btn);
    this.moreObservers = this.moreObservers || {};
    this.moreObservers[key] = observer;
  }

  // Desenha mais um bloco de linhas na temporada `num`; se ainda sobrar, o botão "Mostrar mais" é refeito (acessível por teclado).
  showMoreSeasonEpisodes(num) {
    const key = toInt(num);
    const season = this.findSeason(key);
    if (!season) return;
    const details = document.getElementById('show-episodes-container').querySelector(`details[data-season="${key}"]`);
    const list = details && details.querySelector('ol');
    if (!list) return;
    if (this.moreObservers && this.moreObservers[key]) {
      this.moreObservers[key].disconnect();
      delete this.moreObservers[key];
    }
    const old = details.querySelector('.episodes-more');
    if (old) old.remove();
    const episodes = season.episodes || [];
    const from = this.renderedBySeason[key] || 0;
    const slice = episodes.slice(from, from + DetailModalView.EP_CHUNK);
    list.insertAdjacentHTML('beforeend', this.episodeLinesHtml(slice));
    this.renderedBySeason[key] = from + slice.length;
    list.insertAdjacentHTML('afterend', this.moreHtml(key, episodes.length - this.renderedBySeason[key]));
    this.observeMore(key);
  }

  // Linha só de leitura: "E12 · título · AAAA-MM-DD" (a data só quando existe).
  episodeLinesHtml(episodes) {
    return episodes
      .map(ep => {
        const date = ep.air_date ? String(ep.air_date).slice(0, 10) : '';
        return `<li class="episode-line"><span class="episode-code">E${escapeHtml(ep.episode_number)}</span> · <span class="episode-name">${escapeHtml(ep.name)}</span>${date ? ` · <span class="episode-date">${escapeHtml(date)}</span>` : ''}</li>`;
      })
      .join('');
  }

  // Quem decide a lista de episódios é o modo: enxuto = <details> só de leitura; completo = abas + linhas com caixa de assistido.
  renderEpisodes() {
    if (this.mode === 'explore') this.renderSeasonBlocks();
    else this.renderEpisodesFull();
  }

  // Mostrar mais: no enxuto cada temporada tem o seu botão (`num`); no completo há uma lista só.
  showMoreEpisodes(num) {
    if (this.mode === 'explore') this.showMoreSeasonEpisodes(num);
    else this.showMoreEpisodesFull();
  }

  // ===== Modo completo (quadro anterior à PR 36) =====
  renderSeasonTabs() {
    const media = window.appState.getMedia(this.currentShowId);
    if (!media || !media.seasons) return;

    const bar = document.getElementById('show-seasons-tabs');
    bar.innerHTML = media.seasons
      .map(s => {
        return `
        <button type="button" class="season-tab-btn ${s.season_number === this.currentSeasonNum ? 'active' : ''}" id="season-tab-${toInt(s.season_number)}" data-focus-key="season:${toInt(s.season_number)}:tab" role="tab" aria-selected="${s.season_number === this.currentSeasonNum}" tabindex="${s.season_number === this.currentSeasonNum ? 0 : -1}" aria-controls="show-episodes-container"
                data-action="switch-season" data-season="${toInt(s.season_number)}">
          ${escapeHtml(this.seasonTabLabel(media, s))}
        </button>
      `;
      })
      .join('');
  }

  // "Temporada 1 (3/12)": nome da temporada e episódios assistidos.
  seasonTabLabel(media, season) {
    let watched = 0;
    (season.episodes || []).forEach(ep => {
      if (window.appState.isWatched(media.id, season.season_number, ep.episode_number)) watched++;
    });
    const total = season.episodes ? season.episodes.length : 0;
    return `${season.name || `Temporada ${season.season_number}`} (${watched}/${total})`;
  }

  // Marcou/desmarcou UM episódio com o modal aberto (S09): muda só aquela linha, o rótulo da temporada e o resumo.
  // Sem reconstruir a lista (com 1.000+ episódios, reconstruir congelava a tela).
  updateEpisode(seasonNum, epNum) {
    if (this.mode !== 'full') return;
    const media = window.appState.getMedia(this.currentShowId);
    if (!media || !Array.isArray(media.seasons)) return;
    if (Number(seasonNum) === this.currentSeasonNum) {
      const row = document.getElementById('show-episodes-container').querySelector(`[data-ep="${toInt(epNum)}"]`);
      if (row) this.paintRow(row, window.appState.isWatched(media.id, seasonNum, epNum));
    }
    this.updateSeasonCounts(media);
  }

  // Marcou/desmarcou a temporada inteira: repinta as linhas existentes (também sem reconstruir).
  syncEpisodeRows() {
    if (this.mode !== 'full') return;
    const media = window.appState.getMedia(this.currentShowId);
    if (!media || !Array.isArray(media.seasons)) return;
    const rows = document.getElementById('show-episodes-container').querySelectorAll('[data-ep]');
    rows.forEach(row =>
      this.paintRow(row, window.appState.isWatched(media.id, this.currentSeasonNum, Number(row.getAttribute('data-ep'))))
    );
    this.updateSeasonCounts(media);
  }

  paintRow(row, isWatched) {
    row.classList.toggle('watched', isWatched);
    const check = row.querySelector('.episode-check');
    if (!check) return;
    check.setAttribute('aria-checked', String(isWatched));
    const mark = check.querySelector('span');
    if (mark) mark.textContent = isWatched ? '✓' : '';
  }

  // Rótulo da aba da temporada atual e resumo "Progresso da Temporada" (texto igual ao de renderSeasonTabs/renderEpisodesFull).
  updateSeasonCounts(media) {
    const season = media.seasons.find(s => s.season_number === this.currentSeasonNum);
    if (!season) return;
    const tab = document.getElementById(`season-tab-${toInt(season.season_number)}`);
    if (tab) tab.textContent = this.seasonTabLabel(media, season);
    const episodes = season.episodes || [];
    if (episodes.length > 0) {
      const watched = episodes.filter(ep => window.appState.isWatched(media.id, season.season_number, ep.episode_number)).length;
      document.getElementById('season-stats-summary').innerHTML =
        `Progresso da Temporada: <strong>${watched}/${episodes.length} assistidos</strong>`;
    }
  }

  switchSeason(num) {
    this.currentSeasonNum = num;
    this.renderSeasonTabs();
    this.renderEpisodes();
  }

  renderEpisodesFull() {
    const media = window.appState.getMedia(this.currentShowId);
    if (!media || !media.seasons) return;

    const season = media.seasons.find(s => s.season_number === this.currentSeasonNum);
    const container = document.getElementById('show-episodes-container');
    const summary = document.getElementById('season-stats-summary');
    container.setAttribute('aria-labelledby', `season-tab-${toInt(this.currentSeasonNum)}`);
    this.stopObservers();

    if (!season || !season.episodes || season.episodes.length === 0) {
      container.innerHTML = `<p class="muted">Nenhum episódio cadastrado.</p>`;
      summary.innerHTML = '';
      return;
    }

    let watched = 0;
    season.episodes.forEach(ep => {
      if (window.appState.isWatched(media.id, season.season_number, ep.episode_number)) watched++;
    });

    summary.innerHTML = `Progresso da Temporada: <strong>${watched}/${season.episodes.length} assistidos</strong>`;

    // S18: com centenas de episódios só as primeiras linhas existem; o resto é desenhado aos poucos (rolagem ou botão).
    this.renderedEpisodes = 0;
    this.renderToken = (this.renderToken || 0) + 1;
    container.innerHTML = '';
    this.renderMoreEpisodes(media, season, DetailModalView.EP_CHUNK);
  }

  // Desenha mais `count` linhas depois das já existentes; se ainda sobrar, põe o botão "Mostrar mais" (acessível por teclado)
  // e um observador que o aciona sozinho quando ele entra na tela.
  renderMoreEpisodes(media, season, count) {
    const container = document.getElementById('show-episodes-container');
    const old = container.querySelector('.episodes-more');
    if (old) old.remove();
    if (this.moreObserver) {
      this.moreObserver.disconnect();
      this.moreObserver = null;
    }
    const from = this.renderedEpisodes;
    const slice = season.episodes.slice(from, from + count);
    container.insertAdjacentHTML('beforeend', this.episodeRowsHtml(media, season, slice));
    this.renderedEpisodes = from + slice.length;
    const left = season.episodes.length - this.renderedEpisodes;
    if (left <= 0) return;
    container.insertAdjacentHTML(
      'beforeend',
      `<div class="episodes-more"><button type="button" class="btn btn-outline" data-focus-key="ep:more" data-action="more-episodes">Mostrar mais episódios (faltam ${left})</button></div>`
    );
    const btn = container.querySelector('.episodes-more button');
    if (btn && typeof IntersectionObserver !== 'undefined') {
      const token = this.renderToken;
      this.moreObserver = new IntersectionObserver(
        entries => {
          if (token === this.renderToken && entries.some(e => e.isIntersecting)) this.showMoreEpisodes();
        },
        { root: null, rootMargin: '400px' }
      );
      this.moreObserver.observe(btn);
    }
  }

  showMoreEpisodesFull() {
    const media = window.appState.getMedia(this.currentShowId);
    const season = media && media.seasons && media.seasons.find(s => s.season_number === this.currentSeasonNum);
    if (season) this.renderMoreEpisodes(media, season, DetailModalView.EP_CHUNK);
  }

  episodeRowsHtml(media, season, episodes) {
    return episodes
      .map(ep => {
        const isWatched = window.appState.isWatched(media.id, season.season_number, ep.episode_number);
        const note = window.appState.getNote(media.id, season.season_number, ep.episode_number);
        const hasNote = note && note.text && note.text.trim();

        return `
        <div class="episode-row ${isWatched ? 'watched' : ''}" data-ep="${toInt(ep.episode_number)}">
          <button type="button" class="episode-check" role="checkbox" aria-checked="${isWatched}" data-focus-key="ep:${toInt(ep.episode_number)}:check" aria-label="Assistido: episódio ${toInt(ep.episode_number)}, ${escapeHtml(ep.name)}" data-action="quick-check" data-show="${toInt(media.id)}" data-season="${toInt(season.season_number)}" data-episode="${toInt(ep.episode_number)}">
            <span aria-hidden="true">${isWatched ? '✓' : ''}</span>
          </button>

          <img ${window.ViewKit.imgAttrs(safeUrl(ep.still_path) || safeUrl(media.backdrop_path) || media.poster_path, 'still')} alt="" class="episode-thumb" loading="lazy" decoding="async">

          <div class="episode-info">
            <span class="episode-code">E${escapeHtml(ep.episode_number)}${ep.air_date ? ` · ${escapeHtml(String(ep.air_date).slice(0, 10))}` : ''}</span>
            <div class="episode-name">${escapeHtml(ep.name)}</div>
            ${window.MediaDisplay.runtimeText(ep.runtime) ? `<span class="episode-runtime">${escapeHtml(window.MediaDisplay.runtimeText(ep.runtime))}</span>` : ''}
            ${hasNote ? `<span class="episode-note-tag">Anotação salva</span>` : ''}
          </div>

          <button type="button" class="btn btn-sm btn-outline" data-focus-key="ep:${toInt(ep.episode_number)}:note" aria-label="${hasNote ? 'Ver ou editar' : 'Anotar'} episódio ${toInt(ep.episode_number)}: ${escapeHtml(ep.name)}" data-action="open-note" data-show="${toInt(media.id)}" data-season="${toInt(season.season_number)}" data-episode="${toInt(ep.episode_number)}">
            ${hasNote ? 'Ver/Editar' : 'Anotar'}
          </button>
        </div>
      `;
      })
      .join('');
  }
  // ===== fim do modo completo =====

  openNote(showId, seasonNum = null, epNum = null) {
    const media = window.appState.getMedia(showId);
    if (!media) return;

    const isMovie = media.type === 'movie';
    this.currentNoteEp = { showId, seasonNum, epNum, isMovie };

    const epCode = document.getElementById('note-ep-code');
    const epTitle = document.getElementById('note-ep-title');
    const showTitle = document.getElementById('note-show-title');

    if (isMovie) {
      epCode.textContent = 'FILME';
      epTitle.textContent = media.name;
      showTitle.textContent = window.MediaDisplay.runtimeText(media.runtime)
        ? `Duração: ${window.MediaDisplay.runtimeText(media.runtime)}`
        : 'Filme';
    } else {
      const ep = window.appState.getEpisode(showId, seasonNum, epNum);
      epCode.textContent = `S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`;
      epTitle.textContent = ep ? ep.name : `Episódio ${epNum}`;
      showTitle.textContent = media.name;
    }

    const note = window.appState.getNote(showId, seasonNum, epNum) || { text: '', emotion: null, character: '', snapshots: [] };
    const isWatched = window.appState.isWatched(showId, seasonNum, epNum);

    document.getElementById('note-watched-toggle').checked = isWatched;
    document.getElementById('note-character-input').value = note.character || '';
    document.getElementById('note-textarea').value = note.text || '';

    this.updateWordCount(note.text || '');
    this.updateSaveBadge('Salvo neste aparelho');
    this.renderHistory(false);

    document.querySelectorAll('#note-emotion-selector .emotion-btn').forEach(btn => {
      if (btn.getAttribute('data-emotion') === note.emotion) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    this.noteModal.classList.remove('hidden');
  }

  updateWordCount(text) {
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('note-word-count').textContent = `${words} palavras · ${chars} caracteres`;
  }

  updateSaveBadge(msg, isSaving = false) {
    const badge = document.getElementById('note-save-status');
    const textEl = badge.querySelector('.save-text');
    const dot = badge.querySelector('.save-dot');
    textEl.textContent = msg;
    dot.style.background = isSaving ? 'var(--tvtime-yellow)' : 'var(--accent-emerald)';
  }

  triggerAutoSave() {
    this.updateSaveBadge('Salvando...', true);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => this.saveNow(), 350);
  }

  saveNow() {
    this.autoSaveTimer = null;
    const text = document.getElementById('note-textarea').value;
    const character = document.getElementById('note-character-input').value;
    const activeEmo = document.querySelector('#note-emotion-selector .emotion-btn.active');
    const emotion = activeEmo ? activeEmo.getAttribute('data-emotion') : null;

    window.appState.saveNote(this.currentNoteEp.showId, this.currentNoteEp.seasonNum, this.currentNoteEp.epNum, {
      text,
      character,
      emotion
    });

    const now = new Date().toLocaleTimeString('pt-BR');
    this.updateSaveBadge(`Salvo neste aparelho às ${now}`, false);
    document.getElementById('note-last-saved').textContent = `Última edição: ${now}`;
    this.renderHistory(null);
  }

  // Grava já o que estiver pendente no timer (antes de abrir/restaurar o histórico).
  flushAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.saveNow();
    }
  }

  // ===== S08: histórico de versões da anotação (D-19) =====
  // Prévia curta em texto puro (sem marcas de Markdown e sem vazar spoiler).
  notePreview(text, max) {
    const plain = window.NoteMarkdown.toPlainText(String(text || ''))
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > max ? `${plain.slice(0, max)}…` : plain;
  }

  // open: true abre o painel, false fecha, null mantém como está. Também atualiza o botão "Histórico (n)".
  renderHistory(open = null) {
    const btn = document.getElementById('btn-note-history');
    const panel = document.getElementById('note-history-panel');
    const list = document.getElementById('note-history-list');
    if (!btn || !panel || !list) return;

    const { showId, seasonNum, epNum } = this.currentNoteEp;
    const versions = window.appState.getNoteVersions(showId, seasonNum, epNum);
    btn.classList.toggle('hidden', versions.length === 0);
    btn.textContent = `Histórico (${versions.length})`;

    const show = versions.length > 0 && (open === null ? !panel.classList.contains('hidden') : open);
    panel.classList.toggle('hidden', !show);
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (!versions.length) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = versions
      .map((v, i) => {
        const when = Date.parse(v.updatedAt)
          ? new Date(v.updatedAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'Data desconhecida';
        return `
        <li class="note-history-item">
          <div class="note-history-info">
            <span class="note-history-when">${escapeHtml(when)}</span>
            <span class="note-history-text">${escapeHtml(this.notePreview(v.text, 220) || '(texto vazio)')}</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline" data-restore="${toInt(i)}" data-focus-key="history:${toInt(i)}:restore" aria-label="Restaurar a versão de ${escapeHtml(when)}">Restaurar</button>
        </li>
      `;
      })
      .join('');
  }

  toggleHistory() {
    this.flushAutoSave();
    const panel = document.getElementById('note-history-panel');
    this.renderHistory(panel ? panel.classList.contains('hidden') : false);
  }

  restoreVersion(index) {
    this.flushAutoSave(); // o texto atual precisa estar gravado: ele vira uma versão nova do histórico
    const { showId, seasonNum, epNum } = this.currentNoteEp;
    const restored = window.appState.restoreNoteVersion(showId, seasonNum, epNum, index);
    if (restored === null) {
      window.appController.showToast('Não foi possível restaurar esta versão.', 'error');
      return;
    }
    document.getElementById('note-textarea').value = restored;
    this.updateWordCount(restored);
    const now = new Date().toLocaleTimeString('pt-BR');
    this.updateSaveBadge(`Salvo neste aparelho às ${now}`, false);
    document.getElementById('note-last-saved').textContent = `Última edição: ${now}`;
    this.renderHistory(true);
    // a lista foi redesenhada (o botão clicado não existe mais): devolve o foco para o botão "Histórico"
    const historyBtn = document.getElementById('btn-note-history');
    if (historyBtn && !historyBtn.classList.contains('hidden') && historyBtn.focus) historyBtn.focus();
    window.appController.showToast('Versão restaurada. O texto anterior ficou no histórico.', 'success');
  }
  // ===== fim S08 =====
}

DetailModalView.EP_CHUNK = 60; // linhas de episódio desenhadas por vez (S18)

window.detailModalView = new DetailModalView();
