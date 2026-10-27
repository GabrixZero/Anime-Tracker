const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');
const { requireAuth, optionalAuth } = require('../middleware/auth');

router.get('/trending', mediaController.getTrending);
router.get('/search', mediaController.search);
// Detalhe completo de várias obras do catálogo (declarada antes de /:id). Sem ingestão: público.
router.get('/batch', mediaController.getBatch);
router.post('/ingest', requireAuth, mediaController.ingest);
// Atualiza (episódios novos) uma obra que já está no catálogo; exige login (S13).
router.post('/:id/refresh', requireAuth, mediaController.refresh);
// Leitura de obra existente é pública; se a obra ainda não está no catálogo, a ingestão exige login (resolvido no controller).
router.get('/:id', optionalAuth, mediaController.getById);

module.exports = router;
