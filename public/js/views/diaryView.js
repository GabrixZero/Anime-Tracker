// ================================================================
// SHOWVAULT · VIEW DIÁRIO DE ANOTAÇÕES (MVC)
// ================================================================

class DiaryView {
  constructor() {
    this.container = document.getElementById('diary-container');
    this.emptyState = document.getElementById('diary-empty');
    this.badge = document.getElementById('badge-diary');
    this.emotionFilter = 'all';
    this.searchQuery = '';
    this.bindEvents();
  }

  bindEvents() {
    document.querySelectorAll('#emotion-filters .emotion-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#emotion-filters .emotion-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.emotionFilter = btn.getAttribute('data-emotion');
        this.render();
      });
    });

    const searchInput = document.getElementById('diary-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.render();
      });
    }

    document.getElementById('btn-export-notes-md').addEventListener('click', () => this.exportMarkdown());
  }

  render() {
    const state = window.appState;
    const entries = [];

    Object.keys(state.data.episodeNotes).forEach(key => {
      const note = state.data.episodeNotes[key];
      if (!note || !note.text || !note.text.trim()) return;

      if (key.includes('_movie')) {
        const showId = Number(key.replace('_movie', ''));
        const media = state.getMedia(showId);
        if (media) {
          entries.push({
            isMovie: true,
            showId,
            name: media.name,
            epTitle: "Filme",
            stillPath: media.backdrop_path || media.poster_path,
            text: note.text,
            emotion: note.emotion,
            character: note.character,
            updatedAt: note.updatedAt
          });
        }
      } else {
        const parts = key.split('_');
        const showId = Number(parts[0]);
        const seasonNum = Number(parts[1].replace('s', ''));
        const epNum = Number(parts[2].replace('e', ''));

        const media = state.getMedia(showId);
        if (media) {
          const season = media.seasons ? media.seasons.find(s => s.season_number === seasonNum) : null;
          const ep = season ? season.episodes.find(e => e.episode_number === epNum) : null;

          entries.push({
            isMovie: false,
            showId,
            seasonNum,
            epNum,
            name: media.name,
            epTitle: ep ? ep.name : `Episódio ${epNum}`,
            stillPath: (ep && ep.still_path) ? ep.still_path : media.backdrop_path,
            text: note.text,
            emotion: note.emotion,
            character: note.character,
            updatedAt: note.updatedAt
          });
        }
      }
    });

    entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    this.badge.textContent = entries.length;

    const filtered = entries.filter(e => {
      if (this.emotionFilter !== 'all' && e.emotion !== this.emotionFilter) return false;
      if (this.searchQuery) {
        return e.text.toLowerCase().includes(this.searchQuery) ||
               e.name.toLowerCase().includes(this.searchQuery) ||
               (e.character || '').toLowerCase().includes(this.searchQuery);
      }
      return true;
    });

    if (filtered.length === 0) {
      this.container.innerHTML = '';
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');
    const emotionLabels = {
      awesome: '😍 Adorei',
      fun: '😂 Engraçado',
      mindblown: '😱 Chocado',
      sad: '😢 Triste',
      disappointed: '😡 Decepcionado'
    };

    this.container.innerHTML = filtered.map(e => {
      const formattedDate = new Date(e.updatedAt).toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const headerText = e.isMovie ? `${e.name} · 🎬 Filme` : `${e.name} · T${e.seasonNum}:E${e.epNum}`;

      return `
        <div class="diary-entry-card" style="background: var(--bg-card); border: 1px solid var(--bg-card-border); border-radius: var(--radius-md); padding: 1.5rem; display: flex; gap: 1.5rem; margin-bottom: 1.25rem;">
          <img src="${e.stillPath}" alt="${e.epTitle}" style="width: 140px; height: 90px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0;" loading="lazy">
          
          <div style="flex: 1; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--tvtime-yellow); text-transform: uppercase;">${headerText}</span>
              ${e.emotion ? `<span style="font-size: 0.78rem; background: rgba(255,255,255,0.06); padding: 0.2rem 0.55rem; border-radius: var(--radius-full);">${emotionLabels[e.emotion] || e.emotion}</span>` : ''}
            </div>

            <h4 style="font-family: var(--font-display); font-size: 1.15rem; color: #ffffff; margin-bottom: 0.4rem;">${e.epTitle}</h4>

            ${e.character ? `<div style="font-size: 0.75rem; background: rgba(56, 189, 248, 0.12); color: var(--accent-cyan); padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin-bottom: 0.5rem; width: fit-content;">Destaque: ${this.escapeHtml(e.character)}</div>` : ''}

            <div style="font-size: 0.92rem; color: #e2e8f0; line-height: 1.55; background: rgba(0,0,0,0.25); padding: 0.85rem 1rem; border-radius: var(--radius-sm); border-left: 3px solid var(--tvtime-yellow); margin-bottom: 0.65rem; white-space: pre-wrap;">${this.escapeHtml(e.text)}</div>

            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted); margin-top: auto;">
              <span>Gravado em: ${formattedDate}</span>
              <button class="btn btn-sm btn-ghost" onclick="window.detailModalView.openNote(${e.showId}, ${e.seasonNum || null}, ${e.epNum || null})">Editar</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  exportMarkdown() {
    let md = `# Meu Diário de Obras · ShowVault\n*Exportado em: ${new Date().toLocaleString('pt-BR')}*\n\n---\n\n`;
    const state = window.appState;

    Object.keys(state.data.episodeNotes).forEach(key => {
      const note = state.data.episodeNotes[key];
      if (!note || !note.text || !note.text.trim()) return;

      if (key.includes('_movie')) {
        const id = Number(key.replace('_movie', ''));
        const media = state.getMedia(id);
        md += `## 🎬 Filme: ${media ? media.name : 'Filme'}\n`;
      } else {
        const parts = key.split('_');
        const media = state.getMedia(Number(parts[0]));
        md += `## ${media ? media.name : 'Série'} — ${parts[1]}:${parts[2]}\n`;
      }

      md += `**Data:** ${new Date(note.updatedAt).toLocaleDateString('pt-BR')}\n`;
      if (note.emotion) md += `**Reação:** ${note.emotion}\n`;
      if (note.character) md += `**Destaque:** ${note.character}\n`;
      md += `\n${note.text}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diario-showvault-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    window.appController.showToast('Diário exportado em Markdown!', 'success');
  }
}

window.diaryView = new DiaryView();
