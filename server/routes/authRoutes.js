const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireActiveUser } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');

router.get('/config', authController.publicConfig);

router.post('/register', limits.register, authController.register);
router.post('/login', limits.loginPerIp, limits.loginPerEmail, authController.login);
router.post('/google', limits.google, authController.googleAuth);

router.get('/me', requireActiveUser, authController.me);
router.post('/change-password', requireActiveUser, limits.sensitive, authController.changePassword);
router.delete('/account', requireActiveUser, limits.sensitive, authController.deleteAccount);

module.exports = router;
