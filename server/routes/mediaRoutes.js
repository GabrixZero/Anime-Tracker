const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');
const { requireAuth, optionalAuth } = require('../middleware/auth');

router.get('/trending', mediaController.getTrending);
router.get('/search', mediaController.search);
router.post('/ingest', requireAuth, mediaController.ingest);
// Leitura de obra existente é pública; se a obra ainda não está no catálogo, a ingestão exige login (resolvido no controller).
router.get('/:id', optionalAuth, mediaController.getById);

module.exports = router;
