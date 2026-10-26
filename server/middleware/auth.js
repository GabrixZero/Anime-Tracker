const jwt = require('jsonwebtoken');
const config = require('../config/config');
const UserModel = require('../models/UserModel');
const { sendError } = require('../utils/httpErrors');

function issueToken(user) {
  return jwt.sign({ sub: user.id }, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JWT_EXPIRES_IN
  });
}

function verifyBearer(header) {
  const match = /^Bearer (.+)$/.exec(header || '');
  if (!match) return null;
  try {
    const payload = jwt.verify(match[1], config.JWT_SECRET, { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' && payload.sub ? payload : null;
  } catch {
    return null;
  }
}

// Só confere a assinatura e a validade do token (não consulta o cadastro).
function requireAuth(req, res, next) {
  if (!/^Bearer (.+)$/.test(req.headers.authorization || '')) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  const payload = verifyBearer(req.headers.authorization);
  if (!payload) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
  req.userId = payload.sub;
  req.tokenIssuedAt = payload.iat;
  return next();
}

// Como requireAuth, mas também exige que a conta ainda exista e que o token seja posterior à última troca de senha.
// Assim "excluir conta" e "trocar senha" encerram as sessões antigas de verdade.
function requireActiveUser(req, res, next) {
  requireAuth(req, res, () => {
    try {
      const info = UserModel.authInfo(req.userId);
      if (!info || (info.passwordChangedAtSec && (req.tokenIssuedAt || 0) < info.passwordChangedAtSec)) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      }
      return next();
    } catch (err) {
      return sendError(res, err, 'Erro ao validar a sessão.', 'auth/session');
    }
  });
}

// Define req.userId se houver um token válido; caso contrário segue como visitante (sem erro).
function optionalAuth(req, res, next) {
  const payload = verifyBearer(req.headers.authorization);
  if (payload) req.userId = payload.sub;
  return next();
}

module.exports = { issueToken, requireAuth, requireActiveUser, optionalAuth };
