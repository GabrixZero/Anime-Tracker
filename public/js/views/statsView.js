// ================================================================
// SHOWVAULT · VIEW ESTATÍSTICAS DE TEMPO (MVC)
// ================================================================

class StatsView {
  render() {
    const state = window.appState;
    let totalMinutes = 0;
    let totalWatchedEpisodes = 0;
    const emotionsCount = { awesome: 0, fun: 0, mindblown: 0, sad: 0, disappointed: 0 };
    const genresCount = {};

    Object.keys(state.data.watchedEpisodes).forEach(key => {
      const item = state.data.watchedEpisodes[key];
      if (!item || !item.watched) return;

      totalWatchedEpisodes++;

      if (key.includes('_movie')) {
        const id = Number(key.replace('_movie', ''));
        const media = state.getMedia(id);
        if (media) {
          totalMinutes += (media.runtime || 120) * (item.rewatchCount || 1);
          (media.genres || []).forEach(g => { genresCount[g] = (genresCount[g] || 0) + 1; });
        }
      } else {
        const parts = key.split('_');
        const showId = Number(parts[0]);
        const seasonNum = Number(parts[1].replace('s', ''));
        const epNum = Number(parts[2].replace('e', ''));

        const media = state.getMedia(showId);
        if (media) {
          (media.genres || []).forEach(g => { genresCount[g] = (genresCount[g] || 0) + 1; });
          const season = media.seasons ? media.seasons.find(s => s.season_number === seasonNum) : null;
          if (season) {
            const ep = season.episodes.find(e => e.episode_number === epNum);
            totalMinutes += ((ep && ep.runtime) ? ep.runtime : 45) * (item.rewatchCount || 1);
          }
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
    const emotionConfig = [
      { key: 'awesome', icon: '😍', label: 'Adorei' },
      { key: 'fun', icon: '😂', label: 'Divertido' },
      { key: 'mindblown', icon: '😱', label: 'Chocado' },
      { key: 'sad', icon: '😢', label: 'Triste' },
      { key: 'disappointed', icon: '😡', label: 'Ruim' }
    ];

    const maxEmotion = Math.max(...Object.values(emotionsCount), 1);
    document.getElementById('stats-emotions-chart').innerHTML = emotionConfig.map(emo => {
      const count = emotionsCount[emo.key] || 0;
      const pct = Math.round((count / maxEmotion) * 100);
      return `
        <div style="display: flex; align-items: center; gap: 0.85rem; margin-bottom: 0.85rem;">
          <span style="font-size: 1.2rem; width: 28px;">${emo.icon}</span>
          <span style="font-size: 0.84rem; font-weight: 600; width: 100px; color: var(--text-secondary);">${emo.label}</span>
          <div style="flex: 1; height: 8px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">
            <div style="height: 100%; border-radius: 99px; background: var(--tvtime-yellow); width: ${pct}%;"></div>
          </div>
          <span style="font-size: 0.8rem; font-weight: 700; color: #ffffff; width: 30px; text-align: right;">${count}</span>
        </div>
      `;
    }).join('');

    // Top Gêneros
    const sortedGenres = Object.entries(genresCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (sortedGenres.length === 0) {
      document.getElementById('stats-genres-list').innerHTML = `<p class="muted">Nenhuma obra assistida ainda.</p>`;
    } else {
      const maxGenre = sortedGenres[0][1] || 1;
      document.getElementById('stats-genres-list').innerHTML = sortedGenres.map(([genre, count]) => {
        const pct = Math.round((count / maxGenre) * 100);
        return `
          <div style="display: flex; align-items: center; gap: 0.85rem; margin-bottom: 0.85rem;">
            <span style="font-size: 0.84rem; font-weight: 600; width: 120px; color: var(--text-secondary);">${escapeHtml(genre)}</span>
            <div style="flex: 1; height: 8px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">
              <div style="height: 100%; border-radius: 99px; background: var(--accent-cyan); width: ${pct}%;"></div>
            </div>
            <span style="font-size: 0.8rem; font-weight: 700; color: #ffffff; width: 30px; text-align: right;">${count}</span>
          </div>
        `;
      }).join('');
    }
  }
}

window.statsView = new StatsView();
