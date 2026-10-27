// Cliente do TMDB (themoviedb.org) para séries e filmes em pt-BR (D-17). OPCIONAL: sem TMDB_API_KEY o cliente fica desligado
// (`enabled === false`) e o app segue com o catálogo local + TVMaze. A chave pode ser a "API Key (v3)" ou o "Token de leitura (v4)".
const TtlCache = require('../utils/ttlCache');
const { stripHtml, safeHttpUrl } = require('../utils/sanitize');
const { toInternalId } = require('../utils/ids');
const { mediaErrors } = require('../utils/errors');

const IMG = 'https://image.tmdb.org/t/p';
const MAX_SEASONS = 40;

// Nomes dos gêneros em pt-BR (a busca só devolve os números; evita uma requisição extra por consulta).
const GENRES_PT = {
  28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário', 18: 'Drama', 10751: 'Família',
  14: 'Fantasia', 36: 'História', 27: 'Terror', 10402: 'Música', 9648: 'Mistério', 10749: 'Romance', 878: 'Ficção científica',
  10770: 'Cinema TV', 53: 'Suspense', 10752: 'Guerra', 37: 'Faroeste', 10759: 'Ação e aventura', 10762: 'Infantil', 10763: 'Notícias',
  10764: 'Reality', 10765: 'Ficção científica e fantasia', 10766: 'Novela', 10767: 'Talk show', 10768: 'Guerra e política'
};
const TV_STATUS_PT = {
  'Returning Series': 'Em Exibição', 'In Production': 'Em produção', Planned: 'Planejada', Pilot: 'Piloto',
  Ended: 'Finalizada', Canceled: 'Cancelada'
};
const MOVIE_STATUS_PT = {
  Released: 'Lançado', 'Post Production': 'Em pós-produção', 'In Production': 'Em produção', Planned: 'Planejado',
  Rumored: 'Rumor', Canceled: 'Cancelado'
};

const img = (path, size) => (typeof path === 'string' && path.startsWith('/') ? `${IMG}/${size}${path}` : null);
const dateOnly = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };
const rating = (avg, count) => (Number(avg) > 0 && Number(count) > 0 ? Number(avg) : null);

function genreNames(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(g => (g && typeof g === 'object' ? stripHtml(g.name, 60) : GENRES_PT[g])).filter(Boolean).slice(0, 6);
}

// Animação japonesa é do domínio da Jikan (anime): o TMDB não decide sozinho o que é anime.
function isTmdbAnime(entry) {
  const ids = Array.isArray(entry.genre_ids) ? entry.genre_ids : (Array.isArray(entry.genres) ? entry.genres.map(g => g && g.id) : []);
  return ids.includes(16) && entry.original_language === 'ja';
}

class TmdbClient {
  constructor({ apiKey, fetchJson, baseUrl = 'https://api.themoviedb.org/3', language = 'pt-BR', now, searchTtlMs = 10 * 60 * 1000 } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.fetchJson = fetchJson;
    this.baseUrl = baseUrl;
    this.language = language;
    this.searchTtlMs = searchTtlMs;
    this.cache = new TtlCache({ max: 200, now });
  }

  get enabled() { return Boolean(this.apiKey); }

  // Token v4 (JWT, começa com "eyJ") vai no cabeçalho; chave v3 vai na URL. A chave nunca aparece em mensagens de erro.
  async get(path, params = {}, { ttlMs = this.searchTtlMs } = {}) {
    if (!this.enabled) throw mediaErrors.upstream('A busca de séries e filmes (TMDB) não está configurada neste servidor.');
    const query = new URLSearchParams({ language: this.language, ...params });
    const bearer = this.apiKey.startsWith('eyJ');
    if (!bearer) query.set('api_key', this.apiKey);
    const url = `${this.baseUrl}${path}?${query}`;
    const key = `${path}?${[...query].filter(([k]) => k !== 'api_key').join('&')}`;
    const cached = this.cache.get(key, ttlMs);
    if (cached !== undefined) return cached;
    const data = await this.fetchJson(url, bearer ? { headers: { Authorization: `Bearer ${this.apiKey}` } } : {});
    this.cache.set(key, data);
    return data;
  }

  // --- Busca -----------------------------------------------------------------------------------

  async searchTv(q) {
    const json = await this.get('/search/tv', { query: q, include_adult: 'false', page: '1' });
    if (!json || !Array.isArray(json.results)) throw mediaErrors.upstream('Resposta inesperada do TMDB.');
    return json.results.filter(r => r && Number.isSafeInteger(r.id) && r.id > 0 && typeof r.name === 'string' && r.name && !isTmdbAnime(r)).map(TmdbClient.mapTv);
  }

  async searchMovie(q) {
    const json = await this.get('/search/movie', { query: q, include_adult: 'false', page: '1' });
    if (!json || !Array.isArray(json.results)) throw mediaErrors.upstream('Resposta inesperada do TMDB.');
    return json.results.filter(r => r && Number.isSafeInteger(r.id) && r.id > 0 && typeof r.title === 'string' && r.title && !isTmdbAnime(r)).map(TmdbClient.mapMovie);
  }

  // --- Detalhes (ingestão) ---------------------------------------------------------------------

  async getMovie(tmdbId) {
    const m = await this.get(`/movie/${tmdbId}`, {}, { ttlMs: 60 * 60 * 1000 });
    if (!m || m.id !== tmdbId || !m.title) throw mediaErrors.notFound();
    return { ...TmdbClient.mapMovie(m), ...(Number(m.runtime) > 0 ? { runtime: Number(m.runtime) } : { runtime: null }) };
  }

  // Série + uma requisição por temporada (o TMDB só entrega os episódios por temporada). Temporada 0 (extras) fica de fora.
  async getTv(tmdbId) {
    const tv = await this.get(`/tv/${tmdbId}`, {}, { ttlMs: 60 * 60 * 1000 });
    if (!tv || tv.id !== tmdbId || !tv.name) throw mediaErrors.notFound();
    const numbers = (Array.isArray(tv.seasons) ? tv.seasons : [])
      .map(s => s && s.season_number).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_SEASONS);
    const seasons = [];
    for (const n of numbers) {
      const s = await this.get(`/tv/${tmdbId}/season/${n}`, {}, { ttlMs: 60 * 60 * 1000 });
      const episodes = (Array.isArray(s && s.episodes) ? s.episodes : [])
        .filter(e => e && Number.isInteger(e.episode_number) && e.episode_number > 0)
        .map(e => ({
          episode_number: e.episode_number,
          name: stripHtml(e.name, 300) || `Episódio ${e.episode_number}`,
          runtime: Number(e.runtime) > 0 ? Number(e.runtime) : (Number(tv.episode_run_time && tv.episode_run_time[0]) || null),
          air_date: dateOnly(e.air_date),
          overview: stripHtml(e.overview),
          still_path: safeHttpUrl(img(e.still_path, 'w300'), null)
        }));
      if (episodes.length) seasons.push({ season_number: n, name: stripHtml(s.name, 80) || `Temporada ${n}`, episodes });
    }
    return { ...TmdbClient.mapTv(tv), seasons };
  }

  // --- Mapeamento ------------------------------------------------------------------------------

  static mapTv(r) {
    return {
      id: toInternalId('tmdb_tv', r.id),
      type: 'tv',
      name: stripHtml(r.name, 300),
      original_name: r.original_name && r.original_name !== r.name ? stripHtml(r.original_name, 300) : '',
      overview: stripHtml(r.overview),
      poster_path: safeHttpUrl(img(r.poster_path, 'w500'), null),
      backdrop_path: safeHttpUrl(img(r.backdrop_path, 'w1280'), null),
      vote_average: rating(r.vote_average, r.vote_count),
      first_air_date: dateOnly(r.first_air_date),
      genres: genreNames(r.genres || r.genre_ids),
      status: TV_STATUS_PT[r.status] || ''
    };
  }

  static mapMovie(r) {
    const out = {
      id: toInternalId('tmdb_movie', r.id),
      type: 'movie',
      name: stripHtml(r.title, 300),
      original_name: r.original_title && r.original_title !== r.title ? stripHtml(r.original_title, 300) : '',
      overview: stripHtml(r.overview),
      poster_path: safeHttpUrl(img(r.poster_path, 'w500'), null),
      backdrop_path: safeHttpUrl(img(r.backdrop_path, 'w1280'), null),
      vote_average: rating(r.vote_average, r.vote_count),
      first_air_date: dateOnly(r.release_date),
      genres: genreNames(r.genres || r.genre_ids),
      status: MOVIE_STATUS_PT[r.status] || ''
    };
    if (Number(r.runtime) > 0) out.runtime = Number(r.runtime);
    return out;
  }
}

module.exports = TmdbClient;
module.exports.isTmdbAnime = isTmdbAnime;
