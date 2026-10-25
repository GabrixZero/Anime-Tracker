// ================================================================
// SHOWVAULT · MODELO DE ESTADO LOCAL-FIRST (MVC)
// ================================================================

class AppState {
  constructor() {
    this.STORAGE_KEY = 'showvault_state_mvc_v1';
    this.data = this.load();
    this.mediaMap = new Map(); // Cache local de obras carregadas da API
  }

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('Erro ao ler estado local:', e);
    }

    return {
      trackedShows: [
        { showId: 1396, status: 'watching', addedAt: new Date().toISOString() },      // Breaking Bad
        { showId: 1429, status: 'watching', addedAt: new Date().toISOString() },      // Attack on Titan
        { showId: 157336, status: 'plan_to_watch', addedAt: new Date().toISOString() }, // Interestelar
        { showId: 136283, status: 'watching', addedAt: new Date().toISOString() }     // The Bear
      ],
      watchedEpisodes: {
        "1396_s1_e1": { watched: true, watchedAt: "2026-10-20T19:30:00Z", rewatchCount: 1 },
        "1396_s1_e2": { watched: true, watchedAt: "2026-10-21T21:00:00Z", rewatchCount: 1 },
        "1429_s1_e1": { watched: true, watchedAt: "2026-10-22T20:15:00Z", rewatchCount: 1 },
        "136283_s1_e1": { watched: true, watchedAt: "2026-10-23T22:15:00Z", rewatchCount: 1 }
      },
      episodeNotes: {
        "1396_s1_e1": {
          text: "O piloto é simplesmente perfeito. A cena da van no deserto e a transformação inicial de Walter White.",
          emotion: "awesome",
          character: "Walter White",
          updatedAt: "2026-10-20T20:45:00Z",
          snapshots: []
        },
        "1429_s1_e1": {
          text: "A abertura com o Titã Colossal surgindo acima da muralha Maria é inesquecível.",
          emotion: "mindblown",
          character: "Eren Yeager",
          updatedAt: "2026-10-22T20:40:00Z",
          snapshots: []
        }
      }
    };
  }

  save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('Falha ao gravar estado local:', e);
    }
  }

  cacheMediaList(items) {
    items.forEach(item => this.mediaMap.set(item.id, item));
  }

  getMedia(id) {
    return this.mediaMap.get(Number(id)) || null;
  }

  isWatched(showId, seasonNum, epNum) {
    const show = this.getMedia(showId);
    const key = (show && show.type === 'movie') ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
    return !!(this.data.watchedEpisodes[key] && this.data.watchedEpisodes[key].watched);
  }

  toggleWatched(showId, seasonNum, epNum) {
    const show = this.getMedia(showId);
    const isMovie = show && show.type === 'movie';
    const key = isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;

    const current = this.data.watchedEpisodes[key];
    const isNowWatched = !current || !current.watched;

    if (isNowWatched) {
      this.data.watchedEpisodes[key] = {
        watched: true,
        watchedAt: new Date().toISOString(),
        rewatchCount: (current && current.rewatchCount) ? current.rewatchCount : 1
      };
    } else {
      delete this.data.watchedEpisodes[key];
    }

    const tracked = this.data.trackedShows.find(t => t.showId === Number(showId));
    if (tracked) {
      if (isMovie) {
        tracked.status = isNowWatched ? 'completed' : 'plan_to_watch';
      } else if (tracked.status === 'plan_to_watch' && isNowWatched) {
        tracked.status = 'watching';
      }
    }

    this.save();
    return isNowWatched;
  }

  batchSetSeason(showId, seasonNum, shouldWatch) {
    const show = this.getMedia(showId);
    if (!show || !show.seasons) return;
    const season = show.seasons.find(s => s.season_number === Number(seasonNum));
    if (!season) return;

    season.episodes.forEach(ep => {
      const key = `${showId}_s${seasonNum}_e${ep.episode_number}`;
      if (shouldWatch) {
        this.data.watchedEpisodes[key] = {
          watched: true,
          watchedAt: new Date().toISOString(),
          rewatchCount: 1
        };
      } else {
        delete this.data.watchedEpisodes[key];
      }
    });

    this.save();
  }

  saveNote(showId, seasonNum, epNum, noteData) {
    const show = this.getMedia(showId);
    const key = (show && show.type === 'movie') ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
    const existing = this.data.episodeNotes[key] || { snapshots: [] };

    const newSnapshots = [...(existing.snapshots || [])];
    if (existing.text && existing.text.trim() !== noteData.text.trim() && existing.text.length > 10) {
      newSnapshots.unshift({ text: existing.text, updatedAt: existing.updatedAt || new Date().toISOString() });
      if (newSnapshots.length > 5) newSnapshots.pop();
    }

    this.data.episodeNotes[key] = {
      text: noteData.text,
      emotion: noteData.emotion || null,
      character: noteData.character || '',
      updatedAt: new Date().toISOString(),
      snapshots: newSnapshots
    };

    this.save();
  }

  getNote(showId, seasonNum, epNum) {
    const show = this.getMedia(showId);
    const key = (show && show.type === 'movie') ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
    return this.data.episodeNotes[key] || null;
  }
}

window.appState = new AppState();
