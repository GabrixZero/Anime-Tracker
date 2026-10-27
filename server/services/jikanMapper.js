// Jikan/MyAnimeList -> obra do catálogo (funções puras; tudo passa pelo sanitizador da S01).
// Regra da S06: o que a fonte não traz fica NULO/vazio (nada de nota 8.0, gênero "Drama" ou foto de banco de imagens inventados).
const { stripHtml, stripHtmlList, safeHttpUrl } = require('../utils/sanitize');
const { toInternalId } = require('../utils/ids');

const STATUS_PT = {
  'Finished Airing': 'Finalizada',
  'Currently Airing': 'Em Exibição',
  'Not yet aired': 'Em breve'
};
const SEASON_PT = { winter: 'Inverno', spring: 'Primavera', summer: 'Verão', fall: 'Outono' };
// Tipos da MAL que viram "temporada" de uma obra (Music/CM/PV ficam de fora).
const KEPT_TYPES = new Set(['TV', 'Movie', 'OVA', 'ONA', 'Special', 'TV Special']);
const KIND_PT = { Movie: 'Filme', OVA: 'OVA', ONA: 'ONA', Special: 'Especial', 'TV Special': 'Especial de TV', Music: 'Clipe' };
const MAX_EPISODES_PER_SEASON = 3000;

function isoDate(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return m ? m[1] : '';
}

// "24 min per ep" => 24 · "1 hr 55 min" => 115 · "Unknown" => null
function parseDurationMin(text) {
  if (typeof text !== 'string') return null;
  const hr = /(\d+)\s*hr/.exec(text);
  const min = /(\d+)\s*min/.exec(text);
  const total = (hr ? Number(hr[1]) * 60 : 0) + (min ? Number(min[1]) : 0);
  return total > 0 ? total : null;
}

function cleanSynopsis(text) {
  if (typeof text !== 'string') return '';
  return stripHtml(text.replace(/\[Written by[^\]]*\]/gi, ' ').replace(/\((Source|Sources):[^)]*\)/gi, ' '));
}

function seasonLabel(a) {
  const year = Number.isInteger(a.year) ? a.year : Number((isoDate(a.aired && a.aired.from) || '').slice(0, 4)) || null;
  const season = SEASON_PT[a.season];
  if (season && year) return `${season} ${year}`;
  return year ? String(year) : '';
}

function altTitles(a, exclude = []) {
  const raw = [
    a.title, a.title_english, a.title_japanese,
    ...(Array.isArray(a.titles) ? a.titles.map(t => t && t.title) : []),
    ...(Array.isArray(a.title_synonyms) ? a.title_synonyms : [])
  ];
  const skip = new Set(exclude);
  const out = [];
  for (const t of raw) {
    const s = stripHtml(t, 300);
    if (s && !skip.has(s) && !out.includes(s)) out.push(s);
    if (out.length >= 24) break;
  }
  return out;
}

// Campos comuns a um resultado de busca e a uma temporada de obra.
function mapAnimeBase(a) {
  const name = stripHtml(a.title_english || a.title, 300);
  const romaji = stripHtml(a.title, 300);
  const img = a.images && a.images.jpg;
  // S09: pôster do cartão = imagem média (image_url); a grande (large_image_url) fica para o fundo do modal.
  const poster = safeHttpUrl(img && (img.image_url || img.large_image_url), null);
  const backdrop = safeHttpUrl(img && (img.large_image_url || img.image_url), null);
  const genres = stripHtmlList([...(a.genres || []), ...(a.themes || [])].map(g => g && g.name)).slice(0, 6);
  const score = Number(a.score);
  return {
    id: toInternalId('jikan', a.mal_id),
    type: 'anime',
    mal_id: a.mal_id,
    name,
    original_name: romaji && romaji !== name ? romaji : '',
    alt_titles: altTitles(a, [name]),
    overview: cleanSynopsis(a.synopsis),
    poster_path: poster,
    backdrop_path: backdrop,
    vote_average: Number.isFinite(score) && score > 0 ? score : null,
    first_air_date: isoDate(a.aired && a.aired.from),
    genres,
    status: STATUS_PT[a.status] || ''
  };
}

// Resultado de busca (ainda não ingerido): uma entrada da MAL, com dicas para a lista.
function mapAnimeSearchEntry(a) {
  return {
    ...mapAnimeBase(a),
    isExternal: true,
    anime_kind: KIND_PT[a.type] || '',           // '' = série de TV normal
    season_label: seasonLabel(a),                // "Outono 2023" (temporada/cour de exibição)
    episode_count: Number.isInteger(a.episodes) && a.episodes > 0 ? a.episodes : null
  };
}

function episodesFor(full, list) {
  const defaultRuntime = parseDurationMin(full.duration);
  if (full.type === 'Movie') {
    return [{
      episode_number: 1,
      name: stripHtml(full.title_english || full.title, 300) || 'Filme',
      runtime: defaultRuntime,
      air_date: isoDate(full.aired && full.aired.from),
      overview: '',
      still_path: null
    }];
  }
  const byNumber = new Map();
  for (const ep of Array.isArray(list) ? list : []) {
    const n = ep && ep.mal_id;
    if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_EPISODES_PER_SEASON) continue;
    const seconds = Number(ep.duration);
    byNumber.set(n, {
      episode_number: n,
      name: stripHtml(ep.title, 300) || `Episódio ${n}`,
      runtime: Number.isFinite(seconds) && seconds >= 60 ? Math.round(seconds / 60) : defaultRuntime,
      air_date: isoDate(ep.aired),
      overview: '',
      still_path: null
    });
  }
  // Sem lista de episódios mas com a contagem conhecida (OVAs, séries antigas): números reais, sem títulos inventados.
  if (byNumber.size === 0 && Number.isSafeInteger(full.episodes) && full.episodes > 0) {
    for (let n = 1; n <= Math.min(full.episodes, MAX_EPISODES_PER_SEASON); n++) {
      byNumber.set(n, { episode_number: n, name: `Episódio ${n}`, runtime: defaultRuntime, air_date: '', overview: '', still_path: null });
    }
  }
  return [...byNumber.values()].sort((x, y) => x.episode_number - y.episode_number);
}

function startKey(full) {
  return isoDate(full.aired && full.aired.from) || '9999-12-31';
}

// Monta UMA obra a partir da franquia (cadeia Sequel/Prequel da MAL), cada entrada vira uma "temporada".
// numId = id interno pedido (a obra é gravada com ele); franchise = {nodes: [full], episodes: Map(malId -> [ep]), visited: [malId], truncated}.
function buildAnimeWork(numId, requestedMalId, franchise) {
  const ordered = franchise.nodes
    .filter(full => KEPT_TYPES.has(full.type))
    .sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.mal_id - b.mal_id);

  const seasons = [];
  const entries = [];
  let tvIndex = 0;
  for (const full of ordered) {
    const eps = episodesFor(full, franchise.episodes.get(full.mal_id));
    if (eps.length === 0) continue; // ainda sem episódios (anunciada/sem dados): fica de fora
    const isTv = full.type === 'TV' || full.type === 'ONA';
    const title = stripHtml(full.title_english || full.title, 300);
    let name;
    if (isTv) {
      tvIndex++;
      const label = seasonLabel(full);
      name = `Temporada ${tvIndex}${label ? ` · ${label}` : ''}`;
    } else {
      name = `${KIND_PT[full.type]}: ${title.slice(0, 40)}${title.length > 40 ? '…' : ''}`;
    }
    const seasonNumber = seasons.length + 1;
    seasons.push({ season_number: seasonNumber, name, episodes: eps });
    entries.push({ mal_id: full.mal_id, season_number: seasonNumber, kind: full.type, title });
  }

  const kept = ordered.filter(full => entries.some(e => e.mal_id === full.mal_id));
  const root = kept.find(f => f.type === 'TV' || f.type === 'ONA') || kept[0] || franchise.nodes.find(f => f.mal_id === requestedMalId);
  const base = mapAnimeBase(root);
  const airing = kept.some(f => f.status === 'Currently Airing');
  const alt = [];
  for (const full of kept) for (const t of altTitles(full, [base.name])) if (!alt.includes(t) && alt.length < 40) alt.push(t);

  return {
    ...base,
    id: numId,
    mal_id: requestedMalId,
    mal_ids: [...new Set(franchise.visited)],
    alt_titles: alt.length ? alt : base.alt_titles,
    status: airing ? 'Em Exibição' : (kept.length && kept.every(f => f.status === 'Finished Airing') ? 'Finalizada' : base.status),
    seasons,
    franchise: { entries, truncated: Boolean(franchise.truncated) }
  };
}

module.exports = { mapAnimeBase, mapAnimeSearchEntry, buildAnimeWork, parseDurationMin, cleanSynopsis, seasonLabel, KEPT_TYPES, STATUS_PT };
