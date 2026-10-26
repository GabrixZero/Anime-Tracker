// Limites de tentativas nas rotas de autenticação (força bruta / cadastro em massa).
// Contadores ficam em memória (uma instância); atrás de proxy defina TRUST_PROXY para o IP real ser o do visitante.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/config');

const MESSAGE = { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', code: 'RATE_LIMITED' };

function build({ windowMs, max }, extra = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit-* e Retry-After
    legacyHeaders: false,
    message: MESSAGE,
    ...extra
  });
}

const emailOf = req => (req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '');

// Login: só tentativas que FALHAM contam. Uma trava por IP+e-mail (impede adivinhar a senha de uma conta)
// e outra só por IP (impede testar muitas contas de um mesmo lugar).
const loginPerEmail = build(config.RATE_LIMITS.loginPerEmail, {
  skipSuccessfulRequests: true,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}|${emailOf(req)}`
});
const loginPerIp = build(config.RATE_LIMITS.loginPerIp, { skipSuccessfulRequests: true });

// Cadastro: conta todas as tentativas por IP (inclusive "e-mail já usado", para não virar um teste de contas sem limite).
const register = build(config.RATE_LIMITS.register);

const google = build(config.RATE_LIMITS.google);

// Troca de senha / exclusão de conta: por usuário (rota já autenticada), só falhas contam.
const sensitive = build(config.RATE_LIMITS.sensitive, {
  skipSuccessfulRequests: true,
  keyGenerator: req => `${req.userId || ipKeyGenerator(req.ip)}`
});

module.exports = { loginPerEmail, loginPerIp, register, google, sensitive };
