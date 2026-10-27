const mediaService = require('../services/mediaService');
const RateLimiter = require('../utils/rateLimiter');
const { parseId } = require('../utils/ids');
const { mediaErrors } = require('../utils/errors');
const { sendError } = require('../utils/httpErrors');
const { toListItem, toSearchItem } = require('../utils/mediaLight');

const VALID_TYPES = ['all', 'tv', 'anime', 'movie'];
const MAX_QUERY_LENGTH = 100;
// Lista paginada (S09): 60 por página por padrão, no máximo 200.
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const MAX_BATCH_IDS = 50;

// Dados públicos que só mudam quando uma obra é ingerida: o navegador guarda, mas confere (ETag) antes de reutilizar.
const revalidate = res => res.set('Cache-Control', 'no-cache');

// Inteiro opcional na query (?limit=, ?offset=): ausente => padrão; repetido, não numérico ou fora da faixa => 400.
function readInt(req, name, fallback, min, max) {
  const raw = req.query[name];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) throw mediaErrors.invalidQuery(`Parâmetro "${name}" inválido: use um número inteiro.`);
  const n = Number(raw);
  if (n < min || n > max) throw mediaErrors.invalidQuery(`Parâmetro "${name}" fora da faixa permitida (${min} a ${max}).`);
  return n;
}

// Limite de ingestões por usuário (cada uma baixa uma obra inteira da fonte externa).
const ingestLimiter = new RateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
// Limite de buscas por IP (o frontend espera ~400 ms entre teclas; 60/min é folgado para uso humano).
const searchLimiter = new RateLimiter({ windowMs: 60 * 1000, max: 60 });

// type opcional: ausente => 'all'; repetido (?type=a&type=b) ou desconhecido => 400.
function readType(req) {
  const type = req.query.type === undefined ? 'all' : req.query.type;
  if (typeof type !== 'string' || !VALID_TYPES.includes(type)) {
    throw mediaErrors.invalidQuery('Tipo inválido: use all, tv, anime ou movie.');
  }
  return type;
}

// q opcional: tem de ser texto (não lista) e ter no máximo 100 caracteres.
function readQuery(req) {
  const q = req.query.q === undefined ? '' : req.query.q;
  if (typeof q !== 'string') throw mediaErrors.invalidQuery('Busca inválida: envie um único texto em q.');
  if (q.length > MAX_QUERY_LENGTH) throw mediaErrors.invalidQuery(`Busca muito longa (máximo ${MAX_QUERY_LENGTH} caracteres).`);
  return q;
}

// Decide se pode servir/ingerir a obra: leitura de obra existente é pública; ingestão exige login e respeita o limite.
async function resolveMedia(req, id) {
  if (!mediaService.needsIngest(id)) return mediaService.findLocal(id);
  if (!mediaService.canIngest(id)) {
    return mediaService.ingest(id); // rejeita com 404 (fonte não suportada / fora das faixas)
  }
  if (!req.userId) throw mediaErrors.loginRequired();
  const limit = ingestLimiter.hit(req.userId);
  if (!limit.ok) throw mediaErrors.tooManyRequests(limit.retryAfterSec);
  return mediaService.ingest(id);
}

class MediaController {
  async getTrending(req, res) {
    try {
      const type = readType(req);
      const limit = readInt(req, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
      const offset = readInt(req, 'offset', 0, 0, 1e9);
      const all = await mediaService.getTrending(type);
      // Lista LEVE e paginada: temporadas/episódios só no detalhe (GET /:id ou /batch).
      const data = all.slice(offset, offset + limit).map(toListItem);
      revalidate(res);
      return res.json({ count: data.length, total: all.length, offset, limit, hasMore: offset + data.length < all.length, data });
    } catch (err) {
      return sendError(res, err, 'Erro ao buscar catálogo de destaques.', 'media/trending');
    }
  }

  async search(req, res) {
    try {
      const query = readQuery(req);
      const type = readType(req);
      if (query.trim()) {
        // A busca é pública mas dispara consultas a fontes externas (Jikan, TVMaze, TMDB): limite por IP.
        const limit = searchLimiter.hit(req.ip || 'anon');
        if (!limit.ok) throw mediaErrors.tooManySearches(limit.retryAfterSec);
      }
      const { items, warnings } = await mediaService.searchDetailed(query, type);
      // warnings = fontes que falharam/não estão configuradas (a lista vem mesmo assim, com o que as outras fontes devolveram)
      revalidate(res);
      return res.json({ query, count: items.length, data: items.map(toSearchItem), warnings });
    } catch (err) {
      return sendError(res, err, 'Erro na pesquisa de mídia.', 'media/search');
    }
  }

  // GET /api/media/batch?ids=1,2,3 — detalhe completo (temporadas/episódios) de várias obras do catálogo de uma vez.
  // Público e sem ingestão: ids que não estão completos no catálogo voltam em `missing`.
  async getBatch(req, res) {
    try {
      const raw = req.query.ids;
      if (typeof raw !== 'string' || !raw.trim()) throw mediaErrors.invalidQuery('Informe os ids separados por vírgula em ids.');
      const parts = raw.split(',');
      if (parts.length > MAX_BATCH_IDS) throw mediaErrors.invalidQuery(`Muitos ids de uma vez (máximo ${MAX_BATCH_IDS}).`);
      const ids = [...new Set(parts.map(part => parseId(part.trim())))];
      const { data, missing } = mediaService.getMany(ids);
      revalidate(res);
      return res.json({ count: data.length, data, missing });
    } catch (err) {
      return sendError(res, err, 'Erro ao buscar detalhes das obras.', 'media/batch');
    }
  }

  async getById(req, res) {
    try {
      const item = await resolveMedia(req, parseId(req.params.id));
      revalidate(res);
      return res.json({ data: item });
    } catch (err) {
      return sendError(res, err, 'Erro ao buscar detalhes da obra.', 'media/getById');
    }
  }

  // POST /api/media/ingest (a rota já exige login)
  async ingest(req, res) {
    try {
      const raw = req.body && req.body.id;
      if (raw === undefined || raw === null || raw === '') {
        return res.status(400).json({ error: 'ID é obrigatório para ingestão.' });
      }
      const item = await resolveMedia(req, parseId(raw));
      return res.json({ success: true, data: item });
    } catch (err) {
      return sendError(res, err, 'Falha ao ingerir obra no catálogo.', 'media/ingest');
    }
  }
}

module.exports = new MediaController();
module.exports.ingestLimiter = ingestLimiter;
module.exports.searchLimiter = searchLimiter;
