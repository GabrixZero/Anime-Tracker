const path = require('path');
const { resolveJwtSecret } = require('./jwtSecret');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// SHOWVAULT_DATA_DIR permite apontar os dados para outra pasta (os testes usam um diretório temporário).
const DATA_DIR = process.env.SHOWVAULT_DATA_DIR ? path.resolve(process.env.SHOWVAULT_DATA_DIR) : path.join(__dirname, '..', 'data');

const intFromEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const listFromEnv = (name) => (process.env[name] || '')
  .split(',')
  .map(s => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

// TRUST_PROXY: atrás de proxy/hospedagem, número de proxies confiáveis (ex.: 1). Vazio = não confiar em X-Forwarded-For.
function parseTrustProxy(value) {
  if (value === undefined || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // ex.: "loopback" ou lista de sub-redes aceita pelo Express
}

// O segredo é resolvido na primeira leitura (assim, carregar a config só para ler a pasta de dados não cria arquivo nenhum).
// Em produção a verificação acontece já ao carregar: sem JWT_SECRET seguro o servidor não sobe.
let jwtSecret = null;
const getJwtSecret = () => {
  if (!jwtSecret) jwtSecret = resolveJwtSecret({ dataDir: DATA_DIR, isProduction: IS_PRODUCTION });
  return jwtSecret;
};
if (IS_PRODUCTION) getJwtSecret();

module.exports = {
  PORT: process.env.PORT || 3000,
  IS_PRODUCTION,
  DATA_DIR,
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',
  DEFAULT_LANGUAGE: 'pt-BR',
  get JWT_SECRET() { return getJwtSecret().secret; },
  get JWT_SECRET_SOURCE() { return getJwtSecret().source; },
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // Login com Google: o botão só aparece e a rota só funciona com o Client ID configurado (D-16).
  GOOGLE_CLIENT_ID: (process.env.GOOGLE_CLIENT_ID || '').trim(),

  // Origens externas autorizadas a chamar a API (CORS). Vazio = só o próprio site (mesma origem).
  CORS_ORIGINS: listFromEnv('CORS_ORIGINS'),
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),

  // Conta de demonstração: só nasce se SEED_DEMO_USER=1 e nunca em produção (D-22).
  SEED_DEMO_USER: process.env.SEED_DEMO_USER === '1' && !IS_PRODUCTION,

  // Limites de tentativas (por janela). Valores padrão pensados para uso real; testes podem alterá-los por env.
  RATE_LIMITS: {
    loginPerEmail: { windowMs: intFromEnv('AUTH_LOGIN_WINDOW_MS', 15 * 60 * 1000), max: intFromEnv('AUTH_LOGIN_MAX', 10) },
    loginPerIp: { windowMs: intFromEnv('AUTH_LOGIN_WINDOW_MS', 15 * 60 * 1000), max: intFromEnv('AUTH_LOGIN_IP_MAX', 50) },
    register: { windowMs: intFromEnv('AUTH_REGISTER_WINDOW_MS', 60 * 60 * 1000), max: intFromEnv('AUTH_REGISTER_MAX', 20) },
    google: { windowMs: intFromEnv('AUTH_GOOGLE_WINDOW_MS', 15 * 60 * 1000), max: intFromEnv('AUTH_GOOGLE_MAX', 30) },
    sensitive: { windowMs: intFromEnv('AUTH_SENSITIVE_WINDOW_MS', 15 * 60 * 1000), max: intFromEnv('AUTH_SENSITIVE_MAX', 10) }
  }
};
