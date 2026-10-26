const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/library', userController.getLibrary);
router.put('/library', userController.putLibrary);

module.exports = router;
