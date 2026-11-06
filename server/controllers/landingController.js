const config = require('../config/config');
const mediaService = require('../services/mediaService');
const RateLimiter = require('../utils/rateLimiter');
const { LandingFeatured } = require('../services/landingFeatured');

// Endpoint público: limite por IP (a resposta vem do cache; o TMDB só é consultado a cada 7 dias).
const featuredLimiter = new RateLimiter({ windowMs: 10 * 60 * 1000, max: 300 });
const featured = new LandingFeatured({ tmdb: mediaService.tmdb, dataDir: config.DATA_DIR });

const FALLBACK = () => featured.items.map(i => ({ type: i.type, title: i.title }));

async function getFeatured(req, res) {
  if (!featuredLimiter.hit(req.ip || 'anon').ok) {
    // Passou do limite: responde sem erro, só com os títulos locais.
    res.set('Cache-Control', 'no-store');
    return res.json({ data: FALLBACK() });
  }
  let data;
  try {
    data = await featured.get();
  } catch {
    data = FALLBACK();
  }
  res.set('Cache-Control', 'public, max-age=600');
  return res.json({ data });
}

module.exports = { getFeatured, featuredLimiter, featured };
