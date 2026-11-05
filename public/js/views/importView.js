// ================================================================
// SHOWVAULT · IMPORTAR E EXPORTAR HISTÓRICO (S16) — tela e orquestração
// Fluxo: escolher arquivo -> ler (utils/importExport.js) -> casar com o catálogo (fila com pausa, mostra o progresso) ->
// prévia/revisão (nada é gravado) -> confirmar -> soma à biblioteca (nunca apaga) passando pelo validateBackup.
// ================================================================

class ImportView {
  constructor() {
    this.MAL_OFFSET = 10000000;
    this.SEARCH_GAP_MS = 1100; // a busca aceita 60 por minuto
    this.RATE_WAIT_MS = 65000; // limite de ingestões do servidor (30 a cada 10 min): espera e tenta de novo
    this.MAX_RATE_RETRIES = 40;
    this.reset();
    this.bind();
  }

  reset() {
    this.step = 'idle'; // idle | working | review | applying | done
    this.source = ''; // 'mal' | 'tvtime'
    this.token = 0; // sobe a cada nova importação/cancelamento: tarefas antigas se encerram
    this.rows = []; // itens a revisar/aplicar
    this.skipped = [];
    this.progress = { done: 0, total: 0, note: '' };
    this.report = null;
  }

  $(id) {
    return document.getElementById(id);
  }

  bind() {
    const mal = this.$('input-import-mal');
    const tv = this.$('input-import-tvtime');
    if (!mal || !tv) return;
    mal.addEventListener('change', e => this.pick(e, 'mal'));
    tv.addEventListener('change', e => this.pick(e, 'tvtime'));
    this.$('btn-export-csv').addEventListener('click', () => this.exportCsv());
    this.$('btn-export-mal-xml').addEventListener('click', () => this.exportXml());
    this.$('btn-close-import-modal').addEventListener('click', () => this.cancel());
  }

  // ---------------------------------------------------------------- entrada
  pick(event, source) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const limit = window.ImportExport.MAX_FILE_CHARS;
    if (file.size > limit) {
      window.appController.showToast('Arquivo grande demais (máximo 20 MB).', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.start(source, String(reader.result || ''));
    reader.onerror = () => window.appController.showToast('Não consegui ler o arquivo.', 'error');
    reader.readAsText(file);
  }

  async start(source, text) {
    const IE = window.ImportExport;
    let parsed;
    try {
      parsed = source === 'mal' ? IE.parseMalXml(text) : IE.parseTvTimeCsv(text);
    } catch (err) {
      window.appController.showToast(err.message || 'Arquivo inválido.', 'error');
      return;
    }
    if (!parsed.items.length) {
      window.appController.showToast('Não encontrei nenhuma obra neste arquivo.', 'error');
      return;
    }
    this.reset();
    const token = ++this.token;
    this.source = source;
    this.skipped = parsed.skipped || [];
    this.step = 'working';
    this.progress = { done: 0, total: parsed.items.length, note: 'Procurando as obras no catálogo…' };
    this.$('modal-backup').classList.add('hidden');
    this.$('modal-import').classList.remove('hidden');
    this.render();
    try {
      this.rows = source === 'mal' ? await this.resolveMal(parsed.items, token) : await this.resolveTvTime(parsed.items, token);
    } catch (err) {
      if (token === this.token) {
        this.failed(err);
      }
      return;
    }
    if (token !== this.token) return;
    this.step = 'review';
    this.render();
  }

  failed(err) {
    this.step = 'idle';
    this.$('modal-import').classList.add('hidden');
    window.appController.showToast((err && err.message) || 'A importação falhou.', 'error');
  }

  cancel() {
    this.token++; // encerra qualquer tarefa em andamento
    this.step = 'idle';
    this.$('modal-import').classList.add('hidden');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Chamada à API que espera e repete quando o servidor pede calma (429).
  async withRetry(token, fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (token !== this.token) throw err;
        if (!err || err.status !== 429 || attempt >= this.MAX_RATE_RETRIES) throw err;
        this.progress.note = 'Aguardando o limite do servidor (pode levar alguns minutos)…';
        this.renderProgress();
        await this.sleep(this.RATE_WAIT_MS);
        if (token !== this.token) throw err;
      }
    }
  }

  reasonFor(err) {
    if (err && err.status === 401) return 'entre na sua conta para trazer obras novas';
    if (err && err.status === 404) return 'não encontrada no catálogo';
    if (err && err.status === 429) return 'limite do servidor, tente de novo mais tarde';
    return 'não consegui buscar a obra agora';
  }

  // ---------------------------------------------------------------- MyAnimeList
  async resolveMal(items, token) {
    const byWork = new Map(); // id da obra -> linha
    const rows = [];
    for (const item of items) {
      if (token !== this.token) return [];
      let work = null;
      let problem = '';
      try {
        const res = await this.withRetry(token, () => window.apiClient.getById(this.MAL_OFFSET + item.malId));
        work = res && res.data;
      } catch (err) {
        if (token !== this.token) return [];
        problem = this.reasonFor(err);
      }
      this.progress.done++;
      this.renderProgress();
      if (!work || !Number.isSafeInteger(work.id) || !Array.isArray(work.seasons)) {
        rows.push({ kind: 'missing', label: item.title, reason: problem || 'obra sem episódios conhecidos' });
        continue;
      }
      window.appState.cacheMediaDetail(work);
      const entry = ((work.franchise && work.franchise.entries) || []).find(e => e.mal_id === item.malId);
      const seasonNumber = entry ? entry.season_number : work.seasons[0] && work.seasons[0].season_number;
      const season = work.seasons.find(s => s.season_number === seasonNumber);
      if (!season || !Array.isArray(season.episodes)) {
        rows.push({ kind: 'missing', label: item.title, reason: 'temporada não encontrada no catálogo' });
        continue;
      }
      const numbers = season.episodes
        .map(e => e.episode_number)
        .filter(Number.isInteger)
        .sort((a, b) => a - b);
      const count = item.status === 'completed' && item.watched === 0 ? numbers.length : Math.min(item.watched, numbers.length);
      const episodes = numbers
        .slice(0, count)
        .map(n => ({ season: seasonNumber, episode: n, at: item.finishDate || item.startDate || '' }));
      let row = byWork.get(work.id);
      if (!row) {
        row = {
          kind: 'ok',
          showId: work.id,
          isMovie: false,
          label: work.name || item.title,
          statuses: [],
          rating: null,
          episodes: [],
          parts: 0
        };
        byWork.set(work.id, row);
        rows.push(row);
      }
      row.statuses.push(item.status);
      row.parts++;
      if (item.score && row.rating === null) row.rating = item.score; // nota 1–10 da MAL entra como está
      row.episodes.push(...episodes);
    }
    for (const r of rows) if (r.kind === 'ok') r.status = window.ImportExport.combineStatuses(r.statuses);
    return rows;
  }

  // ---------------------------------------------------------------- TV Time
  async resolveTvTime(items, token) {
    const IE = window.ImportExport;
    const rows = [];
    for (const item of items) {
      if (token !== this.token) return [];
      let results = [];
      let problem = '';
      try {
        const res = await this.withRetry(token, () => window.apiClient.search(item.name, item.movie ? 'movie' : 'all'));
        results = res && Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        if (token !== this.token) return [];
        problem = this.reasonFor(err);
      }
      this.progress.done++;
      this.renderProgress();
      const scored = results
        .filter(r => r && Number.isSafeInteger(r.id) && (item.movie ? r.type === 'movie' : r.type !== 'movie'))
        .map(r => ({ r, level: IE.matchLevel(item, r) }))
        .filter(x => x.level !== 'no');
      const sure = scored.filter(x => x.level === 'sure');
      const base = { label: item.name, year: item.year, isMovie: item.movie, episodes: item.episodes, movieAt: item.watchedAt };
      if (sure.length === 1 || (sure.length > 1 && !item.year)) {
        rows.push({ ...base, kind: 'ok', candidate: sure[0].r, status: item.movie ? 'completed' : 'watching' });
      } else if (scored.length) {
        const candidates = (sure.length ? sure : scored).slice(0, 5).map(x => x.r);
        rows.push({ ...base, kind: 'uncertain', candidates, choice: -1 });
      } else {
        rows.push({ kind: 'missing', label: item.name, reason: problem || 'não encontrada na busca' });
      }
      if (this.SEARCH_GAP_MS) await this.sleep(this.SEARCH_GAP_MS);
    }
    return rows;
  }

  // Baixa (ingere) a obra escolhida e transforma a linha em entrada pronta para a biblioteca.
  async finalizeTvTime(row, token) {
    const cand = row.candidate || row.candidates[row.choice];
    let work;
    try {
      const res = await this.withRetry(token, () => window.apiClient.getById(cand.id));
      work = res && res.data;
    } catch (err) {
      return { failed: this.reasonFor(err) };
    }
    if (!work || !Number.isSafeInteger(work.id)) return { failed: 'obra indisponível' };
    window.appState.cacheMediaDetail(work);
    if (row.isMovie) {
      if (work.type !== 'movie') return { failed: 'o catálogo não a trata como filme' };
      return { entry: { showId: work.id, isMovie: true, status: 'completed', rating: null, episodes: [], movieAt: row.movieAt } };
    }
    const exists = new Set();
    for (const s of work.seasons || []) for (const e of s.episodes || []) exists.add(`${s.season_number}:${e.episode_number}`);
    const seen = new Map();
    for (const ep of row.episodes) {
      const k = `${ep.season}:${ep.episode}`;
      if (exists.has(k) && !seen.has(k)) seen.set(k, ep);
    }
    const episodes = [...seen.values()];
    const status = exists.size > 0 && episodes.length >= exists.size ? 'completed' : 'watching';
    return { entry: { showId: work.id, isMovie: false, status, rating: null, episodes }, ignored: row.episodes.length - episodes.length };
  }

  // ---------------------------------------------------------------- confirmar
  setChoice(index, value) {
    const row = this.rows[index];
    if (!row || row.kind !== 'uncertain') return;
    const n = Number(value);
    row.choice = Number.isInteger(n) && n >= 0 && n < row.candidates.length ? n : -1;
    this.renderSummary();
  }

  async apply() {
    if (this.step !== 'review') return;
    const token = ++this.token;
    this.step = 'applying';
    const todo = this.rows.filter(r => r.kind === 'ok' || (r.kind === 'uncertain' && r.choice >= 0));
    this.progress = { done: 0, total: todo.length, note: 'Adicionando à sua lista…' };
    this.render();
    const entries = [];
    const failures = [];
    let ignoredEpisodes = 0;
    const merged = new Map();
    try {
      for (const row of todo) {
        if (token !== this.token) return;
        let entry;
        if (this.source === 'mal') {
          entry = { showId: row.showId, isMovie: false, status: row.status, rating: row.rating, episodes: row.episodes };
        } else {
          const res = await this.finalizeTvTime(row, token);
          if (res.failed) failures.push({ label: row.label, reason: res.failed });
          else {
            entry = res.entry;
            ignoredEpisodes += res.ignored || 0;
          }
        }
        this.progress.done++;
        this.renderProgress();
        if (!entry) continue;
        const prev = merged.get(entry.showId);
        if (prev) {
          prev.episodes.push(...entry.episodes);
        } else {
          merged.set(entry.showId, entry);
          entries.push(entry);
        }
      }
      const { data, report } = window.ImportExport.applyEntries(window.appState.data, entries);
      const clean = window.validateBackup(data); // mesma validação do backup
      window.appState.applyImported(clean);
      this.report = {
        ...report,
        failures,
        ignoredEpisodes,
        missing: this.rows.filter(r => r.kind === 'missing'),
        ignoredChoices: this.rows.filter(r => r.kind === 'uncertain' && r.choice < 0).length
      };
    } catch (err) {
      if (token === this.token) this.failed(err);
      return;
    }
    if (token !== this.token) return;
    this.step = 'done';
    window.appController.onLibraryChanged();
    this.render();
  }

  // ---------------------------------------------------------------- tela
  render() {
    const box = this.$('import-body');
    const esc = window.escapeHtml;
    const title = this.source === 'mal' ? 'Importar da MyAnimeList' : 'Importar do TV Time';
    this.$('import-title').textContent = title;
    if (this.step === 'working' || this.step === 'applying') {
      box.innerHTML = `<p class="import-note" id="import-progress-note" role="status"></p>
        <progress id="import-progress" class="import-progress" max="1" value="0"></progress>
        <p class="import-hint">Você pode cancelar fechando esta janela. Nada foi gravado na sua lista ainda.</p>`;
      this.renderProgress();
      return;
    }
    if (this.step === 'review') {
      const ok = this.rows.filter(r => r.kind === 'ok');
      const unsure = this.rows.filter(r => r.kind === 'uncertain');
      const missing = this.rows.filter(r => r.kind === 'missing');
      const items = [];
      this.rows.forEach((r, i) => {
        if (r.kind !== 'uncertain') return;
        const options = ['<option value="-1" selected>Ignorar esta obra</option>'].concat(
          r.candidates.map(
            (c, j) =>
              `<option value="${j}">${esc(c.name)}${c.first_air_date ? ` (${esc(String(c.first_air_date).slice(0, 4))})` : ''} · ${esc(c.type)}</option>`
          )
        );
        items.push(`<li class="import-item"><label for="import-choice-${i}"><strong>${esc(r.label)}</strong>${r.year ? ` (${esc(r.year)})` : ''} — qual é a certa?</label>
          <select id="import-choice-${i}" class="import-select" data-change-action="import-choice" data-index="${i}">${options.join('')}</select></li>`);
      });
      box.innerHTML = `<p class="import-summary" id="import-summary" role="status"></p>
        ${unsure.length ? `<h4 class="import-h">Revise as correspondências incertas (${unsure.length})</h4><ul class="import-list">${items.join('')}</ul>` : ''}
        ${
          missing.length
            ? `<details class="import-details"><summary>Não encontradas (${missing.length})</summary><ul class="import-list">${missing
                .slice(0, 200)
                .map(r => `<li>${esc(r.label)} — ${esc(r.reason)}</li>`)
                .join('')}</ul></details>`
            : ''
        }
        <div class="import-actions">
          <button type="button" class="btn btn-primary" data-action="import-apply"${ok.length || unsure.length ? '' : ' disabled'}>Confirmar e adicionar</button>
          <button type="button" class="btn btn-outline" data-action="import-cancel">Cancelar</button>
        </div>`;
      this.renderSummary();
      return;
    }
    if (this.step === 'done' && this.report) {
      const r = this.report;
      const lines = [
        `Obras na importação: ${r.shows} (${r.showsNew} novas na sua lista).`,
        `Episódios marcados como vistos: ${r.episodesAdded}${r.episodesExisting ? ` (outros ${r.episodesExisting} já estavam marcados)` : ''}.`
      ];
      if (r.conflicts.length)
        lines.push(`Conflitos: ${r.conflicts.length} obra(s) já estavam na lista com situação/nota diferente; mantive a sua.`);
      if (r.ignoredChoices) lines.push(`Ignoradas por sua escolha: ${r.ignoredChoices}.`);
      if (r.missing.length) lines.push(`Não encontradas: ${r.missing.length}.`);
      if (r.failures.length) lines.push(`Falharam ao baixar: ${r.failures.length}.`);
      if (r.ignoredEpisodes) lines.push(`Episódios que o catálogo não tem: ${r.ignoredEpisodes}.`);
      if (this.skipped.length) lines.push(`Linhas do arquivo ignoradas: ${this.skipped.length}.`);
      box.innerHTML = `<h4 class="import-h">Pronto!</h4><ul class="import-list">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        ${
          r.conflicts.length
            ? `<details class="import-details"><summary>Ver conflitos</summary><ul class="import-list">${r.conflicts
                .slice(0, 200)
                .map(c => `<li>${esc((window.appState.getMedia(c.showId) || {}).name || `#${c.showId}`)}: ${esc(c.what)}</li>`)
                .join('')}</ul></details>`
            : ''
        }
        <div class="import-actions"><button type="button" class="btn btn-primary" data-action="import-close">Fechar</button></div>`;
    }
  }

  renderProgress() {
    const bar = this.$('import-progress');
    const note = this.$('import-progress-note');
    if (!bar || !note) return;
    bar.max = Math.max(1, this.progress.total);
    bar.value = this.progress.done;
    note.textContent = `${this.progress.note} ${this.progress.done} de ${this.progress.total}`;
  }

  renderSummary() {
    const el = this.$('import-summary');
    if (!el) return;
    const ok = this.rows.filter(r => r.kind === 'ok');
    const chosen = this.rows.filter(r => r.kind === 'uncertain' && r.choice >= 0);
    const eps = [...ok, ...chosen].reduce((n, r) => n + (r.isMovie ? 1 : r.episodes.length), 0);
    el.textContent = `Prévia: ${ok.length + chosen.length} obra(s) e ${eps} episódio(s)/filme(s) serão adicionados. Nada muda até você confirmar.`;
  }

  // ---------------------------------------------------------------- exportar
  download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  watchedCount(showId, season, total) {
    let n = 0;
    for (const ep of season.episodes || []) {
      const w = window.appState.data.watchedEpisodes[`${showId}_s${season.season_number}_e${ep.episode_number}`];
      if (w && w.watched) n++;
    }
    return Math.min(n, total);
  }

  exportCsv() {
    const st = window.appState;
    const rows = st.data.trackedShows.map(t => {
      const m = st.getMedia(t.showId);
      let watched = 0;
      let total = 0;
      if (m && m.type === 'movie') {
        total = 1;
        watched = st.data.watchedEpisodes[`${t.showId}_movie`] && st.data.watchedEpisodes[`${t.showId}_movie`].watched ? 1 : 0;
      } else if (m) {
        for (const s of m.seasons || []) {
          total += (s.episodes || []).length;
          watched += this.watchedCount(t.showId, s, (s.episodes || []).length);
        }
      }
      return {
        showId: t.showId,
        title: m ? m.name : `#${t.showId}`,
        type: m ? m.type : '',
        status: st.getStatus(t),
        rating: window.Rating.normalizeRating(t.rating),
        watched,
        total,
        addedAt: t.addedAt
      };
    });
    this.download(
      `showvault-lista-${new Date().toISOString().slice(0, 10)}.csv`,
      window.ImportExport.exportCsv(rows),
      'text/csv;charset=utf-8'
    );
    window.appController.showToast('Lista exportada em CSV!', 'success');
  }

  exportXml() {
    const st = window.appState;
    const KIND = { TV: 'TV', TV_SHORT: 'TV', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Music' };
    const entries = [];
    for (const t of st.data.trackedShows) {
      const m = st.getMedia(t.showId);
      if (!m || m.type !== 'anime') continue;
      const list =
        m.franchise && Array.isArray(m.franchise.entries) && m.franchise.entries.length
          ? m.franchise.entries
          : [
              { mal_id: m.mal_id, season_number: (m.seasons && m.seasons[0] && m.seasons[0].season_number) || 1, kind: 'TV', title: m.name }
            ];
      const rating = window.Rating.normalizeRating(t.rating);
      for (const e of list) {
        if (!Number.isInteger(e.mal_id)) continue;
        const season = (m.seasons || []).find(s => s.season_number === e.season_number);
        const total = season ? (season.episodes || []).length : 0;
        const watched = season ? this.watchedCount(t.showId, season, total) : 0;
        let status = st.getStatus(t);
        if (total > 0 && watched >= total) status = 'completed';
        else if (watched === 0) status = status === 'dropped' || status === 'paused' ? status : 'plan_to_watch';
        else if (status === 'completed' || status === 'plan_to_watch') status = 'watching';
        entries.push({
          malId: e.mal_id,
          title: e.title || m.name,
          type: KIND[String(e.kind).toUpperCase()] || 'TV',
          episodes: total,
          watched,
          status,
          score: rating === null ? 0 : Math.round(rating)
        });
      }
    }
    this.download(
      `showvault-mal-${new Date().toISOString().slice(0, 10)}.xml`,
      window.ImportExport.exportMalXml(entries),
      'application/xml;charset=utf-8'
    );
    window.appController.showToast(
      entries.length
        ? 'XML (formato MyAnimeList) exportado! Notas com decimais foram arredondadas.'
        : 'Nenhum anime com id da MyAnimeList na sua lista.',
      entries.length ? 'success' : 'info'
    );
  }
}

window.importView = new ImportView();
