// Categoria de cada "temporada" de um anime (funções puras, sem disco nem rede). Uma obra de anime junta TV, filmes, OVAs e ONAs na mesma
// franquia; só as de TV (e ONA com 2+ episódios) são temporadas de verdade, o resto é "extra" (filme ou especial).
// Regras iguais para AniList (`format`) e Jikan (`type`). Nunca mexe em `season_number`, `episodes` nem `franchise.entries`:
// as marcações do usuário (chaves id_sN_eM) continuam valendo. Idempotente.
const SEASON_KINDS = new Set(['TV', 'TV_SHORT', 'TV Short']);
const MOVIE_KINDS = new Set(['MOVIE', 'Movie']);
// Prefixo do nome dos extras (mesmo formato dos mappers: "Filme: Título").
const KIND_PT = {
  MOVIE: 'Filme',
  Movie: 'Filme',
  OVA: 'OVA',
  ONA: 'ONA',
  SPECIAL: 'Especial',
  Special: 'Especial',
  'TV Special': 'Especial'
};
const SEASON_NAME = /^Temporada \d+( · .*)?$/;

// kind ausente/TV => 'season'; ONA => 'season' só com 2+ episódios; Movie => 'movie'; o resto (OVA, Special...) => 'special'.
function categoryOf(kind, episodeCount) {
  if (!kind || SEASON_KINDS.has(kind)) return 'season';
  if (kind === 'ONA') return Number(episodeCount) >= 2 ? 'season' : 'special';
  if (MOVIE_KINDS.has(kind)) return 'movie';
  return 'special';
}

// Nome de um extra: "Filme: Título (até 40 letras)…"
function extraName(kind, title) {
  const t = typeof title === 'string' ? title : '';
  return `${KIND_PT[kind] || 'Especial'}: ${t.slice(0, 40)}${t.length > 40 ? '…' : ''}`;
}

// Devolve o MESMO objeto se nada muda; senão uma cópia com `category` em cada temporada e os nomes regravados.
function reclassifyWork(work) {
  if (!work || work.type !== 'anime' || !Array.isArray(work.seasons)) return work;
  const entries = work.franchise && Array.isArray(work.franchise.entries) ? work.franchise.entries : null;
  if (!entries || entries.length === 0) return work;

  // 1ª passada: categoria de cada temporada, na ordem de season_number.
  const ordered = work.seasons
    .filter(s => s && entries.some(e => e && e.season_number === s.season_number))
    .sort((a, b) => a.season_number - b.season_number);
  const info = new Map();
  let k = 0;
  for (const season of ordered) {
    const entry = entries.find(e => e && e.season_number === season.season_number);
    const count = Array.isArray(season.episodes) ? season.episodes.length : 0;
    const category = categoryOf(entry.kind, count);
    let name = season.name;
    if (category === 'season') {
      k++;
      const m = typeof name === 'string' ? SEASON_NAME.exec(name) : null;
      if (m) name = `Temporada ${k}${m[1] || ''}`; // preserva o sufixo " · rótulo"
    } else if (typeof entry.title === 'string' && entry.title) {
      name = extraName(entry.kind, entry.title);
    }
    info.set(season, { category, name });
  }

  let changed = false;
  const seasons = work.seasons.map(season => {
    const next = info.get(season);
    if (!next || (season.category === next.category && season.name === next.name)) return season;
    changed = true;
    return { ...season, category: next.category, name: next.name };
  });
  return changed ? { ...work, seasons } : work;
}

module.exports = { categoryOf, reclassifyWork };
