const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');

router.get('/trending', mediaController.getTrending);
router.get('/search', mediaController.search);
router.post('/ingest', mediaController.ingest);
router.get('/:id', mediaController.getById);

module.exports = router;
