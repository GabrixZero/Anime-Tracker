const jwt = require('jsonwebtoken');
const config = require('../config/config');

function issueToken(user) {
  return jwt.sign({ sub: user.id }, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JWT_EXPIRES_IN
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  try {
    const payload = jwt.verify(match[1], config.JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

// Define req.userId se houver um token válido; caso contrário segue como visitante (sem erro).
function optionalAuth(req, res, next) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (match) {
    try {
      req.userId = jwt.verify(match[1], config.JWT_SECRET, { algorithms: ['HS256'] }).sub;
    } catch { /* token inválido/expirado: trata como visitante */ }
  }
  return next();
}

module.exports = { issueToken, requireAuth, optionalAuth };
