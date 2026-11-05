const { truncateText } = require('./sanitize');

// Sinopse curta do resumo (D-FX-1): o cartão do "A Seguir" mostra descrição sem baixar o detalhe completo.
const SUMMARY_OVERVIEW_MAX = 240;

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

// Resumo por obra (S18): o que o app precisa para a lista, o "A Seguir", as estatísticas e a Agenda sem baixar o detalhe completo.
// Vem o item leve + temporadas com episódios ENXUTOS (número, nome, data, duração, miniatura) + sinopse CURTA da obra
// (truncada em ~240 caracteres; só aparece quando a fonte tem texto, nunca inventada). Ficam de fora a sinopse completa, as sinopses
// dos episódios (pesam ~8x mais que a da obra), os títulos alternativos e a franquia (o modal pede o detalhe completo quando a obra é aberta).
// `summary: true` avisa o app de que ainda não é o detalhe completo.
function toSummaryItem(item) {
  const out = toListItem(item);
  delete out.light;
  out.summary = true;
  const overview = truncateText(item.overview, SUMMARY_OVERVIEW_MAX);
  if (overview) out.overview = overview;
  if (item.backdrop_path) out.backdrop_path = item.backdrop_path;
  if (Array.isArray(item.seasons)) {
    out.seasons = item.seasons.map(season => {
      const light = {
        season_number: season.season_number,
        name: season.name,
        episodes: (Array.isArray(season.episodes) ? season.episodes : []).map(ep => ({
          episode_number: ep.episode_number,
          name: ep.name,
          air_date: ep.air_date,
          runtime: ep.runtime,
          still_path: ep.still_path
        }))
      };
      if (season.category) light.category = season.category; // 'season' | 'movie' | 'special' (animes)
      return light;
    });
  }
  return out;
}

// Resultado de busca: obra do catálogo vira item leve; resultado externo (ainda sem episódios) segue como veio.
function toSearchItem(item) {
  return item && item.isExternal ? item : toListItem(item);
}

module.exports = { toListItem, toSearchItem, toSummaryItem, SUMMARY_OVERVIEW_MAX };
