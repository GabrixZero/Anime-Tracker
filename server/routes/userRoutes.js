const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');

router.use(requireAuth);

// Foto de perfil: o corpo do PUT é a imagem em si (binário); só estes tipos entram no parser, o resto fica sem corpo e dá 415.
const rawImage = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '256kb' });
router.get('/avatar', userController.getAvatar);
router.put('/avatar', limits.avatar, rawImage, userController.putAvatar);
router.delete('/avatar', limits.avatar, userController.deleteAvatar);

router.get('/library', userController.getLibrary);
router.put('/library', userController.putLibrary);
router.delete('/library', userController.deleteLibrary);

module.exports = router;
