// Cliente da AniList (GraphQL, sem chave): https://graphql.anilist.co — fonte PRINCIPAL de anime desde a S13 (D-26); a Jikan é a reserva.
// Limite oficial ~90 requisições/min por IP (pode cair para ~30/min em degradação): fila com espaçamento + teto por minuto, cache com
// validade, retentativa em 429/5xx respeitando Retry-After (um 429 pausa a fila inteira) e disjuntor: tudo vem de sourceClient.js.
// A AniList NÃO traz título por episódio: só `episodes`, `nextAiringEpisode` e o `airingSchedule` (número + data). Nada é inventado.
const SourceClient = require('./sourceClient');
const { mediaErrors } = require('../utils/errors');

const DEFAULTS = {
  baseUrl: 'https://graphql.anilist.co',
  minIntervalMs: 350,        // uma franquia de 9 entradas sai em ~3 s; o teto por minuto (abaixo) é que respeita o limite oficial de 90/min
  perMinute: 80,
  maxQueue: 40,
  maxWaitMs: 25000,
  retries: 2,
  backoffMs: 1000,
  timeoutMs: 6000,           // a AniList responde em ~0,2-1,5 s; sem resposta em 6 s a busca já cai para a reserva
  breakerCooldownMs: 30000,  // AniList fora do ar: 30 s de falha imediata (a busca cai para a Jikan) antes de tentar de novo
  pauseOnRateLimit: true,
  searchTtlMs: 10 * 60 * 1000,
  detailTtlMs: 60 * 60 * 1000,
  maxFranchiseNodes: 12
};

// Campos comuns a um resultado de busca e a uma obra. `description(asHtml: false)` ainda traz <br>/<i>: o mapper limpa.
const MEDIA_FIELDS = `
    id idMal type format status episodes duration season seasonYear isAdult
    title { romaji english native }
    synonyms
    startDate { year month day }
    averageScore meanScore
    genres
    description(asHtml: false)
    coverImage { large extraLarge }
    bannerImage
    nextAiringEpisode { episode airingAt }`;

const SEARCH_QUERY = `query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {${MEDIA_FIELDS}
    }
  }
}`;

// Uma obra (por id da AniList ou por idMal) com as relações e a 1ª página (50) da grade de exibição: tudo numa requisição só.
const MEDIA_QUERY = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {${MEDIA_FIELDS}
    relations { edges { relationType(version: 2) node { id idMal type format isAdult } } }
    airingSchedule(perPage: 50) { nodes { episode airingAt } }
  }
}`;

const FRANCHISE_RELATIONS = new Set(['SEQUEL', 'PREQUEL']);

const isMedia = m => !!m && Number.isSafeInteger(m.id) && m.id > 0 && !!m.title && !!(m.title.english || m.title.romaji || m.title.native);

// ids (da AniList) das entradas ligadas por SEQUEL/PREQUEL (anime, não adulto, não clipe musical)
function franchiseNeighbours(media) {
  const edges = (media.relations && Array.isArray(media.relations.edges)) ? media.relations.edges : [];
  const ids = [];
  for (const edge of edges) {
    const node = edge && edge.node;
    if (!edge || !FRANCHISE_RELATIONS.has(edge.relationType)) continue;
    if (!node || node.type !== 'ANIME' || node.isAdult || node.format === 'MUSIC') continue;
    if (Number.isSafeInteger(node.id) && node.id > 0 && !ids.includes(node.id)) ids.push(node.id);
  }
  return ids;
}

class AniListClient extends SourceClient {
  // fetchJson(url, {method, body, headers, retries429}) => Promise<json>: injetado (o MediaService usa o dele, com timeout e erros tipados).
  constructor(opts = {}) {
    super({ name: 'anilist', label: 'A AniList', defaults: DEFAULTS, ...opts });
  }

  // POST GraphQL com fila, nova tentativa, disjuntor e cache. Devolve o objeto `data` ou lança um erro tipado.
  async query(query, variables, { ttlMs = this.searchTtlMs, fresh = false } = {}) {
    const body = JSON.stringify({ query, variables });
    const json = await this.cached(body, ttlMs, async () => {
      // retries429: 0 => a espera/retentativa é decidida pela fila (o fetchJson não repete por conta própria)
      const res = await this.fetchJson(this.baseUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, retries429: 0, timeoutMs: this.timeoutMs });
      return AniListClient.unwrap(res);
    }, { fresh });
    return json;
  }

  // GraphQL devolve {data} ou {errors:[{message,status}]}. Erro sem dados = erro tipado (nunca "vazio").
  static unwrap(res) {
    if (!res || typeof res !== 'object') throw mediaErrors.upstream('Resposta inesperada da AniList.');
    if (Array.isArray(res.errors) && res.errors.length > 0 && (res.data === null || res.data === undefined || !Object.values(res.data).some(Boolean))) {
      const status = Number(res.errors[0] && res.errors[0].status);
      if (status === 404) throw mediaErrors.notFound();
      if (status === 429) throw mediaErrors.rateLimited();
      throw mediaErrors.upstream('A AniList recusou o pedido.');
    }
    if (!res.data || typeof res.data !== 'object') throw mediaErrors.upstream('Resposta inesperada da AniList.');
    return res.data;
  }

  // --- Endpoints ------------------------------------------------------------------------------

  async searchAnime(query, { limit = 25 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const data = await this.query(SEARCH_QUERY, { search: q, perPage: limit }, { ttlMs: this.searchTtlMs });
    const list = data.Page && data.Page.media;
    if (!Array.isArray(list)) throw mediaErrors.upstream('Resposta inesperada da AniList.');
    return list.filter(m => isMedia(m) && !m.isAdult && m.type !== 'MANGA' && m.format !== 'MUSIC');
  }

  // Uma obra por id da AniList ({id}) ou do MyAnimeList ({idMal}), com relações e grade de exibição.
  async getMedia({ id, idMal }, { fresh = false } = {}) {
    const variables = id ? { id } : { idMal };
    const data = await this.query(MEDIA_QUERY, variables, { ttlMs: this.detailTtlMs, fresh });
    const m = data.Media;
    // só vale uma obra do tipo pedido, com o id pedido e um título; adulta não entra (como a busca)
    if (!isMedia(m) || (id && m.id !== id) || (idMal && m.idMal !== idMal) || m.isAdult) throw mediaErrors.notFound();
    return m;
  }

  // Franquia = componente ligado por relações SEQUEL/PREQUEL (Spin-off, Side story, Summary etc. ficam de fora de propósito: o grafo
  // é grande e misturaria obras diferentes). Busca em largura a partir da obra pedida, no máximo `maxNodes` entradas; cada nível sai
  // em paralelo (a fila espaça os pedidos). Devolve {nodes:[media], visited:[idAniList], truncated}.
  // Erro em qualquer entrada (exceto 404 de uma entrada relacionada) aborta: melhor falhar do que gravar uma franquia pela metade.
  async getFranchise(root, { maxNodes = this.maxFranchiseNodes, fresh = false } = {}) {
    const first = await this.getMedia(root, { fresh });
    const nodes = new Map([[first.id, first]]);
    const seen = new Set([first.id]);
    let frontier = franchiseNeighbours(first).filter(id => !seen.has(id));
    frontier.forEach(id => seen.add(id));
    let truncated = false;

    while (frontier.length > 0) {
      const room = maxNodes - nodes.size;
      if (room <= 0) { truncated = true; break; }
      if (frontier.length > room) truncated = true;
      const batch = frontier.slice(0, room);
      const settled = await Promise.allSettled(batch.map(id => this.getMedia({ id }, { fresh })));
      const next = [];
      settled.forEach((res, i) => {
        if (res.status === 'rejected') {
          if (res.reason && res.reason.code === 'NOT_FOUND') return; // entrada relacionada que não existe (ou é adulta): fica de fora
          throw res.reason;
        }
        nodes.set(res.value.id, res.value);
        for (const id of franchiseNeighbours(res.value)) {
          if (!seen.has(id)) { seen.add(id); next.push(id); }
        }
      });
      frontier = next;
    }
    return { nodes: [...nodes.values()], visited: [...nodes.keys()], truncated };
  }
}

module.exports = AniListClient;
module.exports.DEFAULTS = DEFAULTS;
module.exports.SEARCH_QUERY = SEARCH_QUERY;
module.exports.MEDIA_QUERY = MEDIA_QUERY;
module.exports.franchiseNeighbours = franchiseNeighbours;
