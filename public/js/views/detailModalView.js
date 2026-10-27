// ================================================================
// SHOWVAULT · VIEW DETALHES DE OBRA & DIÁRIO BLINDADO (MVC)
// ================================================================

class DetailModalView {
  constructor() {
    this.detailModal = document.getElementById('modal-show-detail');
    this.noteModal = document.getElementById('modal-episode-note');
    this.currentShowId = null;
    this.currentSeasonNum = 1;
    this.currentNoteEp = { showId: null, seasonNum: null, epNum: null, isMovie: false };
    this.autoSaveTimer = null;
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
      historyList.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest('[data-restore]') : null;
        if (btn) this.restoreVersion(Number(btn.getAttribute('data-restore')));
      });
    }
    // ===== fim S08 =====

    // Toggle de Assistido dentro do Diário
    document.getElementById('note-watched-toggle').addEventListener('change', () => {
      const isWatched = window.appState.toggleWatched(this.currentNoteEp.showId, this.currentNoteEp.seasonNum, this.currentNoteEp.epNum);
      document.getElementById('note-watched-toggle').checked = isWatched;
      window.appController.refreshAll();
    });

    // Batch Actions
    document.getElementById('btn-batch-check-season').addEventListener('click', () => {
      window.appState.batchSetSeason(this.currentShowId, this.currentSeasonNum, true);
      this.renderEpisodes();
      this.renderSeasonTabs();
      window.appController.refreshAll();
      window.appController.showToast('Temporada inteira marcada como assistida!', 'success');
    });

    document.getElementById('btn-batch-uncheck-season').addEventListener('click', () => {
      window.appState.batchSetSeason(this.currentShowId, this.currentSeasonNum, false);
      this.renderEpisodes();
      this.renderSeasonTabs();
      window.appController.refreshAll();
      window.appController.showToast('Temporada desmarcada.');
    });
  }

  open(showId) {
    const media = window.appState.getMedia(showId);
    if (!media) return;

    this.currentShowId = showId;
    const header = document.getElementById('show-modal-header');
    const seriesBody = document.getElementById('series-detail-body');
    const movieBody = document.getElementById('movie-detail-body');

    const typeBadge = media.type === 'movie' 
      ? `<span class="badge-type-tag badge-type-movie">Filme</span>` 
      : media.type === 'anime' 
      ? `<span class="badge-type-tag badge-type-anime">Anime</span>`
      : `<span class="badge-type-tag badge-type-tv">Série</span>`;

    const tracked = window.appState.getTracked(media.id);
    const MD = window.MediaDisplay;
    const fallbackPoster = MD.POSTER_PLACEHOLDER;
    header.style.backgroundImage = cssUrl(safeUrl(media.backdrop_path) || media.poster_path);
    // S08: nada de nota/gênero/ano inventados; o que a fonte não informa aparece como "Sem nota"/"Sem gênero" ou some
    const metaParts = [
      MD.hasRating(media.vote_average) ? `<span>★ <strong>${escapeHtml(Number(media.vote_average).toFixed(1))}</strong></span>` : '<span>Sem nota</span>',
      MD.yearText(media.first_air_date) ? `<span>${escapeHtml(MD.yearText(media.first_air_date))}</span>` : '',
      `<span>${escapeHtml(MD.genresText(media.genres))}</span>`,
      MD.runtimeText(media.runtime) ? `<span>${escapeHtml(MD.runtimeText(media.runtime))}</span>` : ''
    ].filter(Boolean).join('<span>•</span>');
    header.innerHTML = `
      <img class="modal-poster" src="${safeSrc(media.poster_path) || fallbackPoster}" alt="Pôster de ${escapeHtml(media.name)}" onerror="this.onerror=null; this.src='${fallbackPoster}';">
      <div class="modal-header-info">
        <div class="modal-type-row">${typeBadge}</div>
        <h2 class="modal-title" id="detail-modal-title">${escapeHtml(media.name)}</h2>
        <div class="modal-meta">${metaParts}</div>
        <p class="modal-synopsis">${escapeHtml(media.overview || 'Sem sinopse.')}</p>
        
        <div class="modal-actions">
          ${tracked ? `
            <button type="button" class="btn btn-sm btn-secondary" data-focus-key="detail:primary" onclick="window.appController.removeFromList(${toInt(media.id)})">Remover da Lista</button>
            <label class="status-picker">
              <span class="status-picker-label">Status</span>
              <select class="status-select" id="detail-status-select" aria-label="Status da obra" onchange="window.appController.setStatus(${toInt(media.id)}, this.value)">${window.WatchStatus.statusOptionsHtml(window.appState.getStatus(tracked))}</select>
            </label>
          ` : `
            <button type="button" class="btn btn-sm btn-primary" data-focus-key="detail:primary" onclick="window.appController.addToList(${toInt(media.id)})">+ Adicionar à Lista</button>
          `}
        </div>
      </div>
    `;

    if (media.type === 'movie') {
      seriesBody.classList.add('hidden');
      movieBody.classList.remove('hidden');

      const isWatched = window.appState.isWatched(media.id);
      const note = window.appState.getNote(media.id);
      const hasNote = note && note.text && note.text.trim();

      movieBody.innerHTML = `
        <div class="movie-actions-box">
          <div>
            <h4>${isWatched ? '✓ Filme Assistido no Seu Diário' : 'Filme Pendente para Assistir'}</h4>
            <p>${window.MediaDisplay.knownRuntime(media.runtime)
              ? `Duração: ${escapeHtml(window.MediaDisplay.knownRuntime(media.runtime))} minutos, contados nas estatísticas ao marcar.`
              : 'Duração não informada pela fonte; as estatísticas usam 120 min como estimativa.'}</p>
            ${hasNote ? `<p class="movie-quote">"${escapeHtml(this.notePreview(note.text, 75))}"</p>` : ''}
          </div>

          <div class="movie-btn-group">
            <button type="button" class="btn ${isWatched ? 'btn-secondary' : 'btn-primary'}" data-focus-key="detail:movie-check" onclick="window.appController.quickCheck(${toInt(media.id)})">
              ${isWatched ? 'Desmarcar Filme' : '✓ Marcar como Assistido'}
            </button>
            <button type="button" class="btn btn-outline" data-focus-key="detail:movie-note" onclick="window.detailModalView.openNote(${toInt(media.id)})">
              ${hasNote ? 'Editar Anotação' : 'Anotar no Diário'}
            </button>
          </div>
        </div>
      `;
    } else {
      movieBody.classList.add('hidden');
      seriesBody.classList.remove('hidden');

      const seasons = media.seasons || [];
      this.currentSeasonNum = seasons.length > 0 ? seasons[0].season_number : 1;
      this.renderSeasonTabs();
      this.renderEpisodes();
    }

    this.detailModal.classList.remove('hidden');
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

  renderSeasonTabs() {
    const media = window.appState.getMedia(this.currentShowId);
    if (!media || !media.seasons) return;

    const bar = document.getElementById('show-seasons-tabs');
    bar.innerHTML = media.seasons.map(s => {
      let watched = 0;
      (s.episodes || []).forEach(ep => {
        if (window.appState.isWatched(media.id, s.season_number, ep.episode_number)) watched++;
      });
      const total = s.episodes ? s.episodes.length : 0;

      return `
        <button type="button" class="season-tab-btn ${s.season_number === this.currentSeasonNum ? 'active' : ''}" id="season-tab-${toInt(s.season_number)}" data-focus-key="season:${toInt(s.season_number)}:tab" role="tab" aria-selected="${s.season_number === this.currentSeasonNum}" tabindex="${s.season_number === this.currentSeasonNum ? 0 : -1}" aria-controls="show-episodes-container" 
                onclick="window.detailModalView.switchSeason(${toInt(s.season_number)})">
          ${escapeHtml(s.name || `Temporada ${s.season_number}`)} (${watched}/${total})
        </button>
      `;
    }).join('');
  }

  switchSeason(num) {
    this.currentSeasonNum = num;
    this.renderSeasonTabs();
    this.renderEpisodes();
  }

  renderEpisodes() {
    const media = window.appState.getMedia(this.currentShowId);
    if (!media || !media.seasons) return;

    const season = media.seasons.find(s => s.season_number === this.currentSeasonNum);
    const container = document.getElementById('show-episodes-container');
    const summary = document.getElementById('season-stats-summary');
    container.setAttribute('aria-labelledby', `season-tab-${toInt(this.currentSeasonNum)}`);

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

    const fallbackEpisodeThumb = window.MediaDisplay.STILL_PLACEHOLDER;

    container.innerHTML = season.episodes.map(ep => {
      const isWatched = window.appState.isWatched(media.id, season.season_number, ep.episode_number);
      const note = window.appState.getNote(media.id, season.season_number, ep.episode_number);
      const hasNote = note && note.text && note.text.trim();

      return `
        <div class="episode-row ${isWatched ? 'watched' : ''}">
          <button type="button" class="episode-check" role="checkbox" aria-checked="${isWatched}" data-focus-key="ep:${toInt(ep.episode_number)}:check" aria-label="Assistido: episódio ${toInt(ep.episode_number)}, ${escapeHtml(ep.name)}" onclick="window.appController.quickCheck(${toInt(media.id)}, ${toInt(season.season_number)}, ${toInt(ep.episode_number)})">
            <span aria-hidden="true">${isWatched ? '✓' : ''}</span>
          </button>

          <img src="${safeSrc(safeUrl(ep.still_path) || safeUrl(media.backdrop_path) || media.poster_path) || fallbackEpisodeThumb}" alt="" onerror="this.onerror=null; this.src='${fallbackEpisodeThumb}';" class="episode-thumb" loading="lazy">

          <div class="episode-info">
            <span class="episode-code">E${escapeHtml(ep.episode_number)}${ep.air_date ? ` · ${escapeHtml(String(ep.air_date).slice(0, 10))}` : ''}</span>
            <div class="episode-name">${escapeHtml(ep.name)}</div>
            ${window.MediaDisplay.runtimeText(ep.runtime) ? `<span class="episode-runtime">${escapeHtml(window.MediaDisplay.runtimeText(ep.runtime))}</span>` : ''}
            ${hasNote ? `<span class="episode-note-tag">Anotação salva</span>` : ''}
          </div>

          <button type="button" class="btn btn-sm btn-outline" data-focus-key="ep:${toInt(ep.episode_number)}:note" aria-label="${hasNote ? 'Ver ou editar' : 'Anotar'} episódio ${toInt(ep.episode_number)}: ${escapeHtml(ep.name)}" onclick="window.detailModalView.openNote(${toInt(media.id)}, ${toInt(season.season_number)}, ${toInt(ep.episode_number)})">
            ${hasNote ? 'Ver/Editar' : 'Anotar'}
          </button>
        </div>
      `;
    }).join('');
  }

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
      showTitle.textContent = window.MediaDisplay.runtimeText(media.runtime) ? `Duração: ${window.MediaDisplay.runtimeText(media.runtime)}` : 'Filme';
    } else {
      const season = media.seasons ? media.seasons.find(s => s.season_number === seasonNum) : null;
      const ep = season ? season.episodes.find(e => e.episode_number === epNum) : null;
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
    const plain = window.NoteMarkdown.toPlainText(String(text || '')).replace(/\s+/g, ' ').trim();
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
    if (!versions.length) { list.innerHTML = ''; return; }

    list.innerHTML = versions.map((v, i) => {
      const when = Date.parse(v.updatedAt)
        ? new Date(v.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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
    }).join('');
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

window.detailModalView = new DetailModalView();
