// Migração do catálogo de runtime ANTIGO (S13). Antes da S06 o mapper do TVMaze INVENTAVA o que a fonte não trazia: nota 8.0,
// gênero "Drama", status "Em Exibição", episódio de 45 min e fotos de banco de imagens (Unsplash). Obras gravadas nessa época
// continuam assim no catálogo vivo. Aqui (funções puras, sem disco):
//  - o que é CERTAMENTE inventado (foto do Unsplash) vira nulo; 8.0 e só "Drama" na mesma obra também (o padrão do mapper antigo);
//  - a obra recebe `needsRefresh: true`: o MediaService baixa os dados de verdade da fonte assim que ela responder (mesma ingestão
//    de sempre) e o selo some (a obra nova ganha `refreshedAt`);
//  - 8.0 + só "Drama" SEM foto do Unsplash pode ser verdadeiro: não se altera nada, só se marca para atualizar.
// Idempotente: obra já marcada (`needsRefresh`) ou já atualizada (`refreshedAt`) nunca é migrada de novo; uma segunda passada não muda nada.
const { describeId } = require('../utils/ids');

const UNSPLASH = /^https?:\/\/images\.unsplash\.com\//i;
const isUnsplash = url => typeof url === 'string' && UNSPLASH.test(url);
const onlyDrama = genres => Array.isArray(genres) && genres.length === 1 && genres[0] === 'Drama';

// 'certain' = traz foto do banco de imagens · 'maybe' = nota 8.0 e só "Drama" · null = não é do mapper antigo.
// Só obras do TVMaze (ids 1.000.000+): o mapper antigo só existia lá; Jikan, AniList e TMDB já nasceram sem valores inventados.
function legacyKind(item) {
  if (!item || item.needsRefresh || item.refreshedAt) return null;
  if (describeId(item.id).source !== 'tvmaze') return null;
  if (isUnsplash(item.poster_path) || isUnsplash(item.backdrop_path)) return 'certain';
  if (item.vote_average === 8 && onlyDrama(item.genres)) return 'maybe';
  return null;
}

function cleanItem(item, kind) {
  const next = { ...item, needsRefresh: true };
  if (kind !== 'certain') return next;
  if (isUnsplash(next.poster_path)) next.poster_path = null;
  if (isUnsplash(next.backdrop_path)) next.backdrop_path = null;
  if (next.vote_average === 8) next.vote_average = null;
  if (onlyDrama(next.genres)) next.genres = [];
  if (Array.isArray(next.seasons)) {
    next.seasons = next.seasons.map(season => ({
      ...season,
      episodes: Array.isArray(season.episodes) ? season.episodes.map(ep => (isUnsplash(ep && ep.still_path) ? { ...ep, still_path: null } : ep)) : season.episodes
    }));
  }
  return next;
}

// items -> { items (novos; os intactos são os MESMOS objetos), changed: [{id, name, kind}] }
function migrateLegacyCatalog(items) {
  const changed = [];
  const out = items.map((item) => {
    const kind = legacyKind(item);
    if (!kind) return item;
    changed.push({ id: item.id, name: item.name, kind });
    return cleanItem(item, kind);
  });
  return { items: changed.length ? out : items, changed };
}

module.exports = { migrateLegacyCatalog, legacyKind, isUnsplash };
