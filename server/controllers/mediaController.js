const mediaService = require('../services/mediaService');
const RateLimiter = require('../utils/rateLimiter');
const { parseId } = require('../utils/ids');
const { mediaErrors } = require('../utils/errors');
const { sendError } = require('../utils/httpErrors');

const VALID_TYPES = ['all', 'tv', 'anime', 'movie'];
const MAX_QUERY_LENGTH = 100;

// Limite de ingestões por usuário (cada uma baixa uma obra inteira da fonte externa).
const ingestLimiter = new RateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });

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
      const items = await mediaService.getTrending(readType(req));
      return res.json({ count: items.length, data: items });
    } catch (err) {
      return sendError(res, err, 'Erro ao buscar catálogo de destaques.', 'media/trending');
    }
  }

  async search(req, res) {
    try {
      const query = readQuery(req);
      const items = await mediaService.search(query, readType(req));
      return res.json({ query, count: items.length, data: items });
    } catch (err) {
      return sendError(res, err, 'Erro na pesquisa de mídia.', 'media/search');
    }
  }

  async getById(req, res) {
    try {
      const item = await resolveMedia(req, parseId(req.params.id));
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
