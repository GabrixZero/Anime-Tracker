// ================================================================
// SHOWVAULT · IMPORTAR E EXPORTAR HISTÓRICO (S16) — funções puras
// Lê arquivos que o usuário fornece (MyAnimeList XML, TV Time CSV): entrada NÃO confiável.
//  - limites de tamanho e de quantidade;
//  - XML lido por um leitor próprio (sem DOMParser): DOCTYPE/ENTITY são recusados (sem XXE nem "bomba de entidades");
//  - nada vira HTML aqui (a tela escapa tudo); exportações escapam XML e neutralizam fórmulas de planilha no CSV.
// Script "dual": navegador (window.ImportExport) e Node (module.exports).
// ================================================================

(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const rating = () => (isNode ? require('./rating') : root.Rating);

  const MAX_FILE_CHARS = 20 * 1024 * 1024; // 20 MB de texto
  const MAX_ITEMS = 5000;                  // obras por arquivo
  const MAX_ROWS = 200000;                 // linhas do CSV
  const MAX_EPISODES_PER_ITEM = 5000;
  const MAX_TITLE = 300;

  const MAL_STATUS = {
    watching: 'watching', completed: 'completed', 'on-hold': 'paused', onhold: 'paused',
    dropped: 'dropped', 'plan to watch': 'plan_to_watch', plantowatch: 'plan_to_watch',
    // a MAL também exporta o código numérico
    1: 'watching', 2: 'completed', 3: 'paused', 4: 'dropped', 6: 'plan_to_watch'
  };
  const STATUS_TO_MAL = {
    watching: 'Watching', completed: 'Completed', paused: 'On-Hold', dropped: 'Dropped', plan_to_watch: 'Plan to Watch'
  };

  // ---------------------------------------------------------------- utilidades
  const cleanText = (v, max = MAX_TITLE) => {
    if (typeof v !== 'string') return '';
    // remove caracteres de controle e corta; tags não são interpretadas em lugar nenhum (a tela escapa)
    // eslint-disable-next-line no-control-regex
    return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  };

  const toPositiveInt = v => {
    const n = typeof v === 'number' ? v : Number(String(v === undefined || v === null ? '' : v).trim());
    return Number.isInteger(n) && n > 0 && n < 1e9 ? n : 0;
  };

  function checkSize(text) {
    if (typeof text !== 'string') throw new Error('Arquivo ilegível.');
    if (text.length > MAX_FILE_CHARS) throw new Error('Arquivo grande demais (máximo 20 MB).');
  }

  // Data válida (YYYY-MM-DD ou ISO) -> ISO; inválida, vazia, "0000-00-00" ou futura -> ''.
  function cleanDate(v, nowMs = Date.now()) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || s.startsWith('0000')) return '';
    const ms = Date.parse(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
    if (!Number.isFinite(ms) || ms > nowMs + 24 * 3600 * 1000 || ms < Date.UTC(1950, 0, 1)) return '';
    return new Date(ms).toISOString();
  }

  // "Sousou no Frieren (2023)" / "Café: A Série!" -> "sousou no frieren 2023" (sem acento, pontuação e caixa)
  function normalizeTitle(s) {
    return String(s === undefined || s === null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- XML (MyAnimeList)
  const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeXmlText(s) {
    return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]+);/g, (m, name) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 31 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
      }
      return Object.prototype.hasOwnProperty.call(XML_ENTITIES, name) ? XML_ENTITIES[name] : ''; // entidade desconhecida: descartada, nunca expandida
    });
  }

  // Lê só o necessário: <anime> ... </anime> com campos simples (texto ou CDATA). Recusa DOCTYPE/ENTITY.
  function parseMalXml(text) {
    checkSize(text);
    if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) throw new Error('Arquivo XML recusado: contém declarações não permitidas (DOCTYPE/ENTITY).');
    if (!/<myanimelist[\s>]/i.test(text)) throw new Error('Isto não parece uma exportação da MyAnimeList (falta <myanimelist>).');

    const items = [];
    const skipped = [];
    const blockRe = /<anime>([\s\S]*?)<\/anime>/g;
    let m;
    let count = 0;
    while ((m = blockRe.exec(text)) !== null) {
      if (++count > MAX_ITEMS) throw new Error(`Arquivo com obras demais (máximo ${MAX_ITEMS}).`);
      const field = tag => {
        const f = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(m[1]);
        if (!f) return '';
        const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(f[1]);
        return cdata ? cdata[1] : decodeXmlText(f[1]);
      };
      const malId = toPositiveInt(field('series_animedb_id'));
      const title = cleanText(field('series_title'));
      if (!malId || malId > 9999999) { skipped.push({ title: title || '(sem título)', reason: 'sem id válido da MyAnimeList' }); continue; }
      const statusRaw = cleanText(field('my_status'), 30).toLowerCase();
      const score = Number(field('my_score'));
      items.push({
        malId,
        title: title || `MAL #${malId}`,
        type: cleanText(field('series_type'), 30),
        watched: Math.min(toPositiveInt(field('my_watched_episodes')), MAX_EPISODES_PER_ITEM),
        totalEpisodes: toPositiveInt(field('series_episodes')),
        status: MAL_STATUS[statusRaw] || 'watching',
        score: Number.isInteger(score) && score >= 1 && score <= 10 ? score : 0, // 0 = sem nota; entra como está (0 a 10)
        startDate: cleanDate(field('my_start_date')),
        finishDate: cleanDate(field('my_finish_date'))
      });
    }
    // duplicados no mesmo arquivo: vale o último
    const byId = new Map();
    for (const it of items) byId.set(it.malId, it);
    return { source: 'mal', items: [...byId.values()], skipped };
  }

  // ---------------------------------------------------------------- CSV (TV Time e leitura geral)
  // RFC 4180: aspas, vírgula dentro de aspas, aspas duplas, quebras de linha. Detecta ; ou , pelo cabeçalho.
  function parseCsv(text) {
    checkSize(text);
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const firstLine = src.split(/\r?\n/, 1)[0] || '';
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') inQuotes = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        if (rows.length > MAX_ROWS) throw new Error('CSV com linhas demais.');
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
    return rows;
  }

  const HEADER_ALIASES = {
    series: ['series_name', 'show_name', 'tv_show_name', 'tvshow_name', 'show', 'series', 'tv_show', 'show_title', 'series_title'],
    movie: ['movie_name', 'movie_title', 'movie'],
    title: ['title', 'name', 'entity_name'],
    season: ['season_number', 'episode_season_number', 'season', 'seasonnumber', 'season_no'],
    episode: ['episode_number', 'episode', 'episodenumber', 'episode_no'],
    date: ['created_at', 'watched_at', 'updated_at', 'date', 'watched_date', 'seen_at'],
    year: ['year', 'release_year', 'first_air_year'],
    kind: ['type', 'entity_type', 'kind'],
    seriesId: ['series_id', 'show_id', 'tv_show_id']
  };

  function headerIndex(headers) {
    const norm = headers.map(h => cleanText(h, 80).toLowerCase().replace(/[\s-]+/g, '_'));
    const idx = {};
    for (const [key, names] of Object.entries(HEADER_ALIASES)) {
      const i = norm.findIndex(h => names.includes(h));
      if (i >= 0) idx[key] = i;
    }
    return idx;
  }

  // Aceita os arquivos do pedido de dados do TV Time (colunas variam entre versões; procuramos por nome).
  // Resultado: obras agrupadas por título (+ ano, se houver). Série: lista de episódios {season, episode, at}; filme: movie=true.
  function parseTvTimeCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('CSV vazio ou sem linhas de dados.');
    const idx = headerIndex(rows[0]);
    const hasSeries = idx.series !== undefined || (idx.title !== undefined && idx.episode !== undefined);
    const hasMovie = idx.movie !== undefined || (idx.title !== undefined && idx.kind !== undefined);
    if (!hasSeries && !hasMovie) throw new Error('Não reconheci as colunas do TV Time (esperava algo como series_name, season_number, episode_number).');

    const groups = new Map();
    const skipped = [];
    const cell = (r, key) => (idx[key] === undefined ? '' : (r[idx[key]] === undefined ? '' : r[idx[key]]));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const kindRaw = cleanText(cell(r, 'kind'), 30).toLowerCase();
      const movieName = cleanText(cell(r, 'movie'));
      const seriesName = cleanText(cell(r, 'series'));
      const title = cleanText(cell(r, 'title'));
      const isMovie = !!movieName || kindRaw === 'movie' || kindRaw === 'filme';
      const name = isMovie ? (movieName || title) : (seriesName || title);
      if (!name) continue;
      const year = toPositiveInt(cell(r, 'year')) || toPositiveInt((/\b(19|20)\d{2}\b/.exec(cleanText(cell(r, 'year'))) || [])[0]);
      const at = cleanDate(cleanText(cell(r, 'date'), 40));
      const key = `${isMovie ? 'm' : 't'}|${normalizeTitle(name)}|${year || ''}`;
      let g = groups.get(key);
      if (!g) {
        if (groups.size >= MAX_ITEMS) throw new Error(`Arquivo com obras demais (máximo ${MAX_ITEMS}).`);
        g = { name, year: year || null, movie: isMovie, episodes: [], watchedAt: '' };
        groups.set(key, g);
      }
      if (isMovie) { if (at && (!g.watchedAt || at < g.watchedAt)) g.watchedAt = at; continue; }
      const season = Number(cell(r, 'season'));
      const episode = toPositiveInt(cell(r, 'episode'));
      if (!Number.isInteger(season) || season < 0 || season > 1000 || !episode) {
        skipped.push({ title: name, reason: 'linha sem temporada/episódio válidos' });
        continue;
      }
      if (g.episodes.length < MAX_EPISODES_PER_ITEM) g.episodes.push({ season, episode, at });
    }
    return { source: 'tvtime', items: [...groups.values()], skipped: skipped.slice(0, 200), skippedCount: skipped.length };
  }

  // ---------------------------------------------------------------- correspondência por título
  // Devolve 'sure' | 'maybe' | 'no'. Título igual (sem acento/pontuação) = sure se o ano bater ou um dos lados não tiver ano.
  function matchLevel(wanted, candidate) {
    const a = normalizeTitle(wanted.name);
    const names = [candidate.name, candidate.original_name, ...(Array.isArray(candidate.alt_titles) ? candidate.alt_titles : [])]
      .filter(x => typeof x === 'string' && x).map(normalizeTitle);
    const cYear = Number(String(candidate.first_air_date || candidate.release_date || candidate.year || '').slice(0, 4)) || null;
    const yearOk = !wanted.year || !cYear || Math.abs(wanted.year - cYear) <= 1;
    if (names.includes(a)) return yearOk ? 'sure' : 'maybe';
    if (a && names.some(n => n && (n.includes(a) || a.includes(n)) && Math.min(n.length, a.length) >= 4)) return 'maybe';
    return 'no';
  }

  // ---------------------------------------------------------------- aplicar na biblioteca (puro)
  const STATUS_RANK_ORDER = ['watching', 'paused', 'dropped', 'completed', 'plan_to_watch'];

  // Várias entradas da MAL podem cair na MESMA obra do catálogo (temporadas da franquia): junta os status.
  function combineStatuses(list) {
    const set = new Set(list);
    if (set.has('watching')) return 'watching';
    if (set.size === 1) return [...set][0];
    if (set.has('completed')) return 'watching';
    return STATUS_RANK_ORDER.find(s => set.has(s)) || 'watching';
  }

  /**
   * Soma o que veio do arquivo à biblioteca (nunca remove nada; o que já existe fica como está).
   * data: biblioteca atual ({trackedShows, watchedEpisodes, episodeNotes, tombstones, resetAt}).
   * entries: [{ showId, isMovie, status, rating (0..10 ou null), episodes: [{season, episode, at}] , movieAt }]
   *   (já resolvidas para obras do catálogo; um showId só aparece uma vez).
   * Devolve { data: cópia nova, report: { shows, showsNew, episodesAdded, episodesExisting, conflicts: [...] } }.
   */
  function applyEntries(data, entries, { now = new Date().toISOString() } = {}) {
    const R = rating();
    const out = JSON.parse(JSON.stringify(data));
    out.tombstones = out.tombstones || { shows: {}, watched: {}, notes: {} };
    const report = { shows: 0, showsNew: 0, episodesAdded: 0, episodesExisting: 0, conflicts: [] };

    for (const e of entries) {
      report.shows++;
      let tracked = out.trackedShows.find(t => t.showId === e.showId);
      if (!tracked) {
        tracked = { showId: e.showId, status: e.status, addedAt: now, updatedAt: now };
        const value = R.isEmptyRating(e.rating) ? null : R.normalizeRating(e.rating);
        if (value !== null) tracked.rating = value;
        out.trackedShows.push(tracked);
        delete out.tombstones.shows[String(e.showId)];
        report.showsNew++;
      } else {
        const diffs = [];
        if (tracked.status !== e.status) diffs.push(`situação (${tracked.status} × ${e.status})`);
        const value = R.isEmptyRating(e.rating) ? null : R.normalizeRating(e.rating);
        if (value !== null) {
          if (tracked.rating === undefined) { tracked.rating = value; tracked.updatedAt = now; } else if (tracked.rating !== value) diffs.push(`nota (${tracked.rating} × ${value})`);
        }
        if (diffs.length) report.conflicts.push({ showId: e.showId, what: diffs.join(', '), kept: 'a sua' });
      }
      const list = e.isMovie ? [{ season: null, episode: null, at: e.movieAt || '' }] : e.episodes;
      for (const ep of list) {
        const key = e.isMovie ? `${e.showId}_movie` : `${e.showId}_s${ep.season}_e${ep.episode}`;
        if (out.watchedEpisodes[key] && out.watchedEpisodes[key].watched) { report.episodesExisting++; continue; }
        const watchedAt = ep.at || now;
        out.watchedEpisodes[key] = { watched: true, watchedAt, updatedAt: now, rewatchCount: 1 };
        delete out.tombstones.watched[key];
        report.episodesAdded++;
      }
    }
    return { data: out, report };
  }

  // ---------------------------------------------------------------- exportar
  const csvCell = v => {
    let s = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutraliza fórmula de planilha
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const xmlText = v => String(v === undefined || v === null ? '' : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  /**
   * rows: [{ showId, title, type ('anime'|'tv'|'movie'), status, rating, watched, total, addedAt }]
   * CSV simples (UTF-8, vírgula), pronto para planilhas.
   */
  function exportCsv(rows) {
    const head = ['id', 'tipo', 'titulo', 'situacao', 'nota_0_a_10', 'episodios_assistidos', 'episodios_total', 'adicionado_em'];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([r.showId, r.type, r.title, r.status, r.rating === undefined || r.rating === null ? '' : r.rating, r.watched, r.total, r.addedAt]
        .map(csvCell).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /**
   * entries: [{ malId, title, type ('TV'|'Movie'|...), episodes, watched, status, score (inteiro 0..10), startDate, finishDate }]
   * XML no formato da exportação da MyAnimeList (só animes).
   */
  function exportMalXml(entries) {
    const out = ['<?xml version="1.0" encoding="UTF-8" ?>', '<myanimelist>', '\t<myinfo>', '\t\t<user_export_type>1</user_export_type>', '\t</myinfo>'];
    for (const e of entries) {
      out.push('\t<anime>',
        `\t\t<series_animedb_id>${toPositiveInt(e.malId)}</series_animedb_id>`,
        `\t\t<series_title>${xmlText(e.title)}</series_title>`,
        `\t\t<series_type>${xmlText(e.type || 'TV')}</series_type>`,
        `\t\t<series_episodes>${toPositiveInt(e.episodes)}</series_episodes>`,
        '\t\t<my_id>0</my_id>',
        `\t\t<my_watched_episodes>${Math.max(0, Number(e.watched) || 0)}</my_watched_episodes>`,
        `\t\t<my_start_date>${xmlText(e.startDate || '0000-00-00')}</my_start_date>`,
        `\t\t<my_finish_date>${xmlText(e.finishDate || '0000-00-00')}</my_finish_date>`,
        `\t\t<my_score>${Math.min(10, Math.max(0, Math.round(Number(e.score) || 0)))}</my_score>`,
        `\t\t<my_status>${xmlText(STATUS_TO_MAL[e.status] || 'Plan to Watch')}</my_status>`,
        '\t\t<update_on_import>1</update_on_import>',
        '\t</anime>');
    }
    out.push('</myanimelist>');
    return out.join('\n') + '\n';
  }

  const api = {
    MAX_FILE_CHARS, MAX_ITEMS, STATUS_TO_MAL,
    cleanDate, normalizeTitle, parseMalXml, parseCsv, parseTvTimeCsv, matchLevel,
    combineStatuses, applyEntries, exportCsv, exportMalXml
  };
  root.ImportExport = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
