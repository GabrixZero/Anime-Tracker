// Lista leve × detalhe (S09).
// As listas (`/trending`, `/search`) devolvem só o que um cartão precisa: nome, pôster, nota, ano, gêneros e contagens.
// Temporadas/episódios (o grosso do peso) e sinopse só vêm no detalhe (`GET /api/media/:id` ou `GET /api/media/batch`).
// Itens de busca externa (`isExternal`) ainda não estão no catálogo: já são leves e continuam como a fonte devolveu.

// Contagens por obra, guardadas pela identidade do objeto do catálogo: uma ingestão troca o objeto, então o cache se renova sozinho.
const counts = new WeakMap();

function countsOf(item) {
  let c = counts.get(item);
  if (!c) {
    const seasons = Array.isArray(item.seasons) ? item.seasons : [];
    c = {
      season_count: seasons.length,
      episode_count: seasons.reduce((n, s) => n + (Array.isArray(s && s.episodes) ? s.episodes.length : 0), 0)
    };
    counts.set(item, c);
  }
  return c;
}

// Campos do cartão. Tudo o mais (sinopse, temporadas, títulos alternativos, franquia) fica para o detalhe.
function toListItem(item) {
  const { season_count, episode_count } = countsOf(item);
  const light = {
    id: item.id,
    type: item.type,
    name: item.name,
    poster_path: item.poster_path ?? null,
    vote_average: item.vote_average ?? null,
    first_air_date: item.first_air_date || '',
    genres: Array.isArray(item.genres) ? item.genres : [],
    status: item.status || '',
    runtime: item.runtime ?? null,
    season_count,
    episode_count,
    light: true
  };
  if (item.original_name) light.original_name = item.original_name;
  if (item.mal_id !== undefined) light.mal_id = item.mal_id;
  return light;
}

// Resultado de busca: obra do catálogo vira item leve; resultado externo (ainda sem episódios) segue como veio.
function toSearchItem(item) {
  return item && item.isExternal ? item : toListItem(item);
}

module.exports = { toListItem, toSearchItem };
