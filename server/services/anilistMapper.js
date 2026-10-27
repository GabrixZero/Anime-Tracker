// AniList -> obra do catálogo (funções puras; tudo passa pelo sanitizador da S01). Espelha jikanMapper.js (S06/S13).
// Regra da S06: o que a fonte não traz fica NULO/vazio (nada de nota 8.0, gênero "Drama" ou foto de banco de imagens inventados).
// A AniList não tem título por episódio: sem a Jikan, os episódios chamam "Episódio N" (número e data vêm de `episodes`,
// `nextAiringEpisode` e `airingSchedule`; nunca inventados).
const { stripHtml, stripHtmlList, safeHttpUrl } = require('../utils/sanitize');
const { toInternalId } = require('../utils/ids');
const { cleanSynopsis } = require('./jikanMapper');

const STATUS_PT = {
  FINISHED: 'Finalizada',
  RELEASING: 'Em Exibição',
  NOT_YET_RELEASED: 'Em breve',
  CANCELLED: 'Cancelada',
  HIATUS: 'Em hiato'
};
const SEASON_PT = { WINTER: 'Inverno', SPRING: 'Primavera', SUMMER: 'Verão', FALL: 'Outono' };
// Formatos da AniList que viram "temporada" de uma obra (MUSIC fica de fora). Formato ausente (anúncio) conta como série.
const KEPT_FORMATS = new Set(['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL']);
const TV_LIKE = new Set(['TV', 'TV_SHORT', 'ONA']);
const KIND_PT = { MOVIE: 'Filme', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Especial', MUSIC: 'Clipe' };
const MAX_EPISODES_PER_SEASON = 3000;
const MAX_ALT_TITLES = 24;

const isPositiveInt = n => Number.isInteger(n) && n > 0;

// {year, month, day} (partes podem faltar em anúncios) -> "2023-09-29", "2027-10" ou "2027"; '' se nem o ano existe.
function fuzzyDate(d) {
  if (!d || !isPositiveInt(d.year)) return '';
  const pad = n => String(n).padStart(2, '0');
  if (!isPositiveInt(d.month)) return String(d.year);
  return isPositiveInt(d.day) ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : `${d.year}-${pad(d.month)}`;
}

// Só uma data COMPLETA serve de data de exibição de um episódio.
function fullDate(d) {
  const s = fuzzyDate(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// airingAt (segundos Unix, UTC) -> "AAAA-MM-DD"
function dateFromUnix(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function titleOf(a) {
  const t = (a && a.title) || {};
  return stripHtml(t.english || t.romaji || t.native, 300);
}

function seasonLabel(a) {
  const year = isPositiveInt(a.seasonYear) ? a.seasonYear : (a.startDate && isPositiveInt(a.startDate.year) ? a.startDate.year : null);
  const season = SEASON_PT[a.season];
  if (season && year) return `${season} ${year}`;
  return year ? String(year) : '';
}

function altTitles(a, exclude = []) {
  const t = a.title || {};
  const raw = [t.english, t.romaji, t.native, ...(Array.isArray(a.synonyms) ? a.synonyms : [])];
  const skip = new Set(exclude);
  const out = [];
  for (const title of raw) {
    const s = stripHtml(title, 300);
    if (s && !skip.has(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_ALT_TITLES) break;
  }
  return out;
}

// Id interno: com idMal usa a faixa da Jikan (a mesma obra, o mesmo id nas duas fontes); sem idMal, a faixa própria da AniList.
function internalIdOf(a) {
  return isPositiveInt(a.idMal) ? toInternalId('jikan', a.idMal) : toInternalId('anilist', a.id);
}

// Campos comuns a um resultado de busca e a uma obra.
function mapAnimeBase(a) {
  const name = titleOf(a);
  const romaji = stripHtml(a.title && a.title.romaji, 300);
  const cover = a.coverImage || {};
  // S09: pôster do cartão = imagem média (`large`, ~230 px); a grande (`extraLarge`) e o banner ficam para o fundo do modal.
  const poster = safeHttpUrl(cover.large || cover.extraLarge, null);
  const backdrop = safeHttpUrl(a.bannerImage || cover.extraLarge || cover.large, null);
  const score = Number(a.averageScore) || Number(a.meanScore);   // 0 a 100
  const base = {
    id: internalIdOf(a),
    type: 'anime',
    anilist_id: a.id,
    name,
    original_name: romaji && romaji.toLowerCase() !== name.toLowerCase() ? romaji : '',   // "NARUTO" x "Naruto" é o mesmo título
    alt_titles: altTitles(a, [name]),
    overview: cleanSynopsis(a.description),
    poster_path: poster,
    backdrop_path: backdrop,
    vote_average: Number.isFinite(score) && score > 0 ? Math.round(score) / 10 : null,
    first_air_date: fuzzyDate(a.startDate),
    genres: stripHtmlList(a.genres).slice(0, 6),
    status: STATUS_PT[a.status] || ''
  };
  if (isPositiveInt(a.idMal)) base.mal_id = a.idMal;
  return base;
}

// Resultado de busca (ainda não ingerido): uma entrada da AniList, com dicas para a lista.
function mapAnimeSearchEntry(a) {
  return {
    ...mapAnimeBase(a),
    isExternal: true,
    anime_kind: KIND_PT[a.format] || '',           // '' = série de TV normal
    season_label: seasonLabel(a),                  // "Outono 2023" (temporada/cour de exibição)
    episode_count: isPositiveInt(a.episodes) ? a.episodes : null
  };
}

// Episódios de UMA entrada da franquia: número, data (quando a AniList sabe) e duração. Sem título (a Jikan pode completar depois).
function episodesFor(a) {
  const duration = isPositiveInt(a.duration) ? a.duration : null;
  if (a.format === 'MOVIE') {
    return [{
      episode_number: 1,
      name: titleOf(a) || 'Filme',
      runtime: duration,
      air_date: fullDate(a.startDate),
      overview: '',
      still_path: null
    }];
  }

  const dates = new Map();
  const nodes = a.airingSchedule && Array.isArray(a.airingSchedule.nodes) ? a.airingSchedule.nodes : [];
  for (const node of nodes) {
    if (node && isPositiveInt(node.episode) && node.episode <= MAX_EPISODES_PER_SEASON && !dates.has(node.episode)) {
      const d = dateFromUnix(node.airingAt);
      if (d) dates.set(node.episode, d);
    }
  }
  const next = a.nextAiringEpisode && isPositiveInt(a.nextAiringEpisode.episode) ? a.nextAiringEpisode : null;
  if (next && !dates.has(next.episode)) {
    const d = dateFromUnix(next.airingAt);
    if (d) dates.set(next.episode, d);
  }
  // O 1º episódio estreia na data de início da obra (por definição), mesmo quando a grade da AniList começa depois dele.
  if (!dates.has(1) && fullDate(a.startDate)) dates.set(1, fullDate(a.startDate));

  // Quantos episódios: o total conhecido; em exibição sem total (One Piece) vale até o último já exibido (o anterior ao próximo).
  let count = 0;
  if (isPositiveInt(a.episodes)) count = a.episodes;
  else if (next && next.episode > 1) count = next.episode - 1;
  else if (dates.size > 0) count = Math.max(...dates.keys());
  count = Math.min(count, MAX_EPISODES_PER_SEASON);

  const out = [];
  for (let n = 1; n <= count; n++) {
    out.push({ episode_number: n, name: `Episódio ${n}`, runtime: duration, air_date: dates.get(n) || '', overview: '', still_path: null });
  }
  return out;
}

// Completa os episódios de uma entrada com os da Jikan (títulos reais, data e duração) quando ela respondeu.
// `list` = [{mal_id (= número do episódio), title, aired, duration (s)}]. Só preenche o que está vazio; nunca remove episódios.
function enrichEpisodes(episodes, list) {
  if (!Array.isArray(list) || list.length === 0) return episodes;
  const byNumber = new Map();
  for (const ep of list) if (ep && isPositiveInt(ep.mal_id)) byNumber.set(ep.mal_id, ep);
  return episodes.map((ep) => {
    const extra = byNumber.get(ep.episode_number);
    if (!extra) return ep;
    const title = stripHtml(extra.title, 300);
    const seconds = Number(extra.duration);
    const aired = /^(\d{4}-\d{2}-\d{2})/.exec(String(extra.aired || ''));
    return {
      ...ep,
      name: title && ep.name === `Episódio ${ep.episode_number}` ? title : ep.name,
      air_date: ep.air_date || (aired ? aired[1] : ''),
      runtime: ep.runtime || (Number.isFinite(seconds) && seconds >= 60 ? Math.round(seconds / 60) : null)
    };
  });
}

// Atualização de uma obra: a AniList só tem "Episódio N". Se a obra já tinha títulos (e datas) vindos da Jikan e a Jikan não respondeu
// agora, mantém o que havia (por entrada da franquia: id da MAL, senão da AniList; nunca pela posição da temporada).
function carryOverEpisodeData(previous, work) {
  const keyOf = e => (e && e.mal_id ? `m${e.mal_id}` : (e && e.anilist_id ? `a${e.anilist_id}` : ''));
  const oldEntries = previous && previous.franchise && Array.isArray(previous.franchise.entries) ? previous.franchise.entries : [];
  const newEntries = work && work.franchise && Array.isArray(work.franchise.entries) ? work.franchise.entries : [];
  if (!oldEntries.length || !newEntries.length || !Array.isArray(previous.seasons)) return work;

  const oldEpisodes = new Map();
  for (const e of oldEntries) {
    const season = previous.seasons.find(x => x && x.season_number === e.season_number);
    const key = keyOf(e);
    if (season && key && Array.isArray(season.episodes)) oldEpisodes.set(key, new Map(season.episodes.filter(Boolean).map(ep => [ep.episode_number, ep])));
  }
  const seasons = work.seasons.map((season) => {
    const entry = newEntries.find(e => e.season_number === season.season_number);
    const old = entry && oldEpisodes.get(keyOf(entry));
    if (!old) return season;
    return {
      ...season,
      episodes: season.episodes.map((ep) => {
        const before = old.get(ep.episode_number);
        if (!before) return ep;
        const lostName = ep.name === `Episódio ${ep.episode_number}` && before.name && before.name !== ep.name;
        const lostDate = !ep.air_date && before.air_date;
        return lostName || lostDate ? { ...ep, name: lostName ? before.name : ep.name, air_date: lostDate ? before.air_date : ep.air_date } : ep;
      })
    };
  });
  return { ...work, seasons };
}

function startKey(a) {
  return fuzzyDate(a.startDate) || '9999-12-31';
}

const isTvLike = a => !a.format || TV_LIKE.has(a.format);

// Monta UMA obra a partir da franquia (cadeia SEQUEL/PREQUEL da AniList), cada entrada vira uma "temporada" (mesmas regras da Jikan).
// numId = id interno pedido (a obra é gravada com ele); requested = {malId?, anilistId?}; franchise = {nodes: [media], visited: [id], truncated}.
// `titlesFor` (opcional) = Map(anilistId -> lista de episódios da Jikan) para completar títulos.
function buildAnimeWork(numId, requested, franchise, { titlesFor } = {}) {
  const ordered = franchise.nodes
    .filter(a => (!a.format || KEPT_FORMATS.has(a.format)) && !a.isAdult)
    .sort((x, y) => startKey(x).localeCompare(startKey(y)) || x.id - y.id);

  const seasons = [];
  const entries = [];
  const kept = [];
  let tvIndex = 0;
  for (const a of ordered) {
    let eps = episodesFor(a);
    if (eps.length === 0) continue; // anúncio/sem episódios conhecidos: fica de fora
    if (titlesFor && titlesFor.has(a.id)) eps = enrichEpisodes(eps, titlesFor.get(a.id));
    const title = titleOf(a);
    let name;
    // ONA de um episódio só (ex.: "MONSTERS", ligado a One Piece pela AniList) não é "Temporada 2": entra com o nome do tipo
    if (isTvLike(a) && !(a.format === 'ONA' && eps.length === 1)) {
      tvIndex++;
      const label = seasonLabel(a);
      name = `Temporada ${tvIndex}${label ? ` · ${label}` : ''}`;
    } else {
      name = `${KIND_PT[a.format]}: ${title.slice(0, 40)}${title.length > 40 ? '…' : ''}`;
    }
    const seasonNumber = seasons.length + 1;
    seasons.push({ season_number: seasonNumber, name, episodes: eps });
    const entry = { anilist_id: a.id, season_number: seasonNumber, kind: a.format || 'TV', title };
    if (isPositiveInt(a.idMal)) entry.mal_id = a.idMal;
    entries.push(entry);
    kept.push(a);
  }

  const wanted = franchise.nodes.find(a => (requested.anilistId && a.id === requested.anilistId) || (requested.malId && a.idMal === requested.malId));
  const root = kept.find(isTvLike) || kept[0] || wanted || franchise.nodes[0];
  const base = mapAnimeBase(root);
  const airing = kept.some(a => a.status === 'RELEASING');
  const alt = [];
  for (const a of kept) for (const t of altTitles(a, [base.name])) if (!alt.includes(t) && alt.length < 40) alt.push(t);

  const work = {
    ...base,
    id: numId,
    mal_ids: [...new Set(franchise.nodes.map(a => a.idMal).filter(isPositiveInt))],
    anilist_ids: [...new Set(franchise.visited)],
    alt_titles: alt.length ? alt : base.alt_titles,
    status: airing ? 'Em Exibição' : (kept.length && kept.every(a => a.status === 'FINISHED') ? 'Finalizada' : base.status),
    seasons,
    franchise: { entries, truncated: Boolean(franchise.truncated) }
  };
  // `mal_id` = o pedido (como na S06); sem ele, o da entrada raiz (se existir); obras só da AniList ficam sem `mal_id`.
  const malId = requested.malId || base.mal_id;
  if (malId) work.mal_id = malId;
  else delete work.mal_id;
  work.anilist_id = (wanted || root).id;
  return work;
}

module.exports = {
  mapAnimeBase, mapAnimeSearchEntry, buildAnimeWork, episodesFor, enrichEpisodes, carryOverEpisodeData, internalIdOf,
  fuzzyDate, dateFromUnix, seasonLabel, KEPT_FORMATS, STATUS_PT
};
