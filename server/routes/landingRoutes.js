const express = require('express');
const router = express.Router();
const landingController = require('../controllers/landingController');

// Público e somente leitura (sem parâmetros): 3 destaques fixos da landing, com pôster do TMDB quando disponível.
router.get('/featured', landingController.getFeatured);

module.exports = router;
