// ================================================================
// SHOWVAULT · VIEW ESTATÍSTICAS DE TEMPO (MVC)
// ================================================================

class StatsView {
  render() {
    const state = window.appState;
    let totalMinutes = 0;
    let totalWatchedEpisodes = 0;
    const emotionsCount = window.Emotions.emptyCounts(); // tabela única de emoções (utils/emotions.js)

    Object.keys(state.data.watchedEpisodes).forEach(key => {
      const item = state.data.watchedEpisodes[key];
      if (!item || !item.watched) return;

      const parsed = window.ViewKit.parseKey(key); // { showId, seasonNum, epNum, isMovie } ou null

      // Extras de anime (filme/OVA/especial) não entram na contagem de episódios; só o tempo (duração própria, ou 90 min filme / 45 min OVA).
      if (parsed && !parsed.isMovie) {
        const season = (state.getMedia(parsed.showId)?.seasons || []).find(s => s.season_number === parsed.seasonNum);
        if (season && window.WatchStatus.isExtraSeason(season)) {
          const ep = state.getEpisode(parsed.showId, parsed.seasonNum, parsed.epNum);
          const fallback = window.WatchStatus.seasonCategory(season) === 'movie' ? 90 : 45;
          totalMinutes += (ep && ep.runtime ? ep.runtime : fallback) * (item.rewatchCount || 1);
          return;
        }
      }

      totalWatchedEpisodes++;
      if (!parsed) return;

      if (parsed.isMovie) {
        const media = state.getMedia(parsed.showId);
        if (media) {
          totalMinutes += (media.runtime || 120) * (item.rewatchCount || 1);
        }
      } else {
        const { showId, seasonNum, epNum } = parsed;

        const media = state.getMedia(showId);
        if (media) {
          // S09: episódio por índice da obra (antes: duas varreduras lineares por episódio assistido)
          const ep = state.getEpisode(showId, seasonNum, epNum);
          const seasonExists = !!ep || (Array.isArray(media.seasons) && media.seasons.some(s => s.season_number === seasonNum));
          if (seasonExists) totalMinutes += (ep && ep.runtime ? ep.runtime : 45) * (item.rewatchCount || 1);
        }
      }
    });

    let totalNotes = 0;
    Object.values(state.data.episodeNotes).forEach(note => {
      if (note && note.text && note.text.trim()) totalNotes++;
      if (note && note.emotion && emotionsCount[note.emotion] !== undefined) {
        emotionsCount[note.emotion]++;
      }
    });

    // "Obras finalizadas" = as que a lista mostra como Finalizado (mesma regra: state.getStatus)
    const showsCompleted = state.data.trackedShows.filter(tracked => state.getStatus(tracked) === 'completed').length;

    // Conversão de tempo
    const minutesInHour = 60;
    const minutesInDay = 24 * 60;
    const minutesInMonth = 30 * minutesInDay;

    const months = Math.floor(totalMinutes / minutesInMonth);
    let rem = totalMinutes % minutesInMonth;
    const days = Math.floor(rem / minutesInDay);
    rem = rem % minutesInDay;
    const hours = Math.floor(rem / minutesInHour);
    const minutes = rem % minutesInHour;

    document.getElementById('time-months').textContent = months;
    document.getElementById('time-days').textContent = days;
    document.getElementById('time-hours').textContent = hours;
    document.getElementById('time-minutes').textContent = minutes;
    document.getElementById('stat-minutes-subtext').textContent = `${totalMinutes.toLocaleString('pt-BR')} minutos assistidos`;

    document.getElementById('stat-episodes-count').textContent = totalWatchedEpisodes;
    document.getElementById('stat-shows-completed').textContent = showsCompleted;
    document.getElementById('stat-notes-count').textContent = totalNotes;

    // Emoções
    const emotionConfig = window.Emotions.LIST.map(e => ({ key: e.id, icon: e.icon, label: e.label }));

    const maxEmotion = Math.max(...Object.values(emotionsCount), 1);
    document.getElementById('stats-emotions-chart').innerHTML = emotionConfig
      .map(emo => {
        const count = emotionsCount[emo.key] || 0;
        const pct = Math.round((count / maxEmotion) * 100);
        return `
        <div class="stat-bar-row">
          <span class="stat-bar-icon" aria-hidden="true">${emo.icon}</span>
          <span class="stat-bar-label">${emo.label}</span>
          <div class="stat-bar-track">
            <div class="stat-bar-fill ${window.ViewKit.pctClass(pct)}"></div>
          </div>
          <span class="stat-bar-count">${count}</span>
        </div>
      `;
      })
      .join('');

    // Suas notas (S17): média, distribuição por faixa e as 5 obras mais bem avaliadas
    this.renderRatings(state);

    // Top Gêneros
    // Uma contagem por obra que está em Minha Lista (utils/genreStats.js), não por episódio assistido
    const sortedGenres = window.GenreStats.countGenres(state.data.trackedShows, id => state.getMedia(id), 5);
    if (sortedGenres.length === 0) {
      document.getElementById('stats-genres-list').innerHTML =
        `<p class="muted">Adicione obras com gênero à sua lista para ver o ranking.</p>`;
    } else {
      const maxGenre = sortedGenres[0].count || 1;
      document.getElementById('stats-genres-list').innerHTML = sortedGenres
        .map(({ genre, count }) => {
          const pct = Math.round((count / maxGenre) * 100);
          return `
          <div class="stat-bar-row">
            <span class="stat-bar-label stat-bar-label--wide">${escapeHtml(genre)}</span>
            <div class="stat-bar-track">
              <div class="stat-bar-fill stat-bar-fill--cyan ${window.ViewKit.pctClass(pct)}"></div>
            </div>
            <span class="stat-bar-count">${count}</span>
          </div>
        `;
        })
        .join('');
    }
  }
}

StatsView.prototype.renderRatings = function (state) {
  const R = window.Rating;
  const items = state.data.trackedShows.map(t => {
    const media = state.getMedia(t.showId);
    return { showId: t.showId, title: media ? media.name : `Obra ${t.showId}`, rating: t.rating };
  });
  const stats = R.computeRatingStats(items);
  const summary = document.getElementById('stats-rating-summary');
  const chart = document.getElementById('stats-rating-chart');
  const top = document.getElementById('stats-rating-top');
  if (!summary || !chart || !top) return;

  // Grade completa sempre (vazia = todas as faixas em 0); sem nota nenhuma, só o resumo muda
  summary.textContent =
    stats.count === 0
      ? 'Média das notas que você deu (0 a 10)'
      : `Média: ${stats.average.toFixed(1)} (${stats.count} ${stats.count === 1 ? 'obra avaliada' : 'obras avaliadas'})`;
  const maxCount = Math.max(...stats.distribution.map(b => b.count), 1);
  chart.innerHTML = stats.distribution
    .map(band => {
      const pct = Math.round((band.count / maxCount) * 100);
      return `
      <div class="stat-bar-row">
        <span class="stat-bar-label">${escapeHtml(band.label)}</span>
        <div class="stat-bar-track">
          <div class="stat-bar-fill stat-bar-fill--cyan ${window.ViewKit.pctClass(pct)}"></div>
        </div>
        <span class="stat-bar-count">${band.count}</span>
      </div>`;
    })
    .join('');
  if (stats.count === 0) {
    top.innerHTML = '<p class="muted">Nenhuma obra avaliada ainda.</p>';
    return;
  }
  top.innerHTML = `<ol class="rating-top-list">${stats.top
    .map(
      item =>
        `<li><span class="rating-top-title">${escapeHtml(item.title)}</span> <span class="rating-top-value">★ ${escapeHtml(item.rating.toFixed(1))}</span></li>`
    )
    .join('')}</ol>`;
};

window.statsView = new StatsView();
