// Validação REAL do login com Google: o navegador envia o ID token (JWT assinado pelo Google) e o servidor confere
// assinatura, validade, emissor e "audience" (= nosso GOOGLE_CLIENT_ID). O servidor nunca confia em e-mail/nome vindos do cliente.
// Só funciona com GOOGLE_CLIENT_ID no .env (D-16).
const config = require('../config/config');

let client = null;
let verifierOverride = null;

function isConfigured() {
  return !!config.GOOGLE_CLIENT_ID;
}

// Devolve { sub, email, emailVerified, name, picture } ou lança Error (credencial inválida/expirada/de outro app).
async function verifyIdToken(credential) {
  if (verifierOverride) return normalize(await verifierOverride(credential));
  if (!isConfigured()) throw new Error('Login com Google não configurado.');
  if (!client) {
    const { OAuth2Client } = require('google-auth-library');
    client = new OAuth2Client(config.GOOGLE_CLIENT_ID);
  }
  const ticket = await client.verifyIdToken({ idToken: credential, audience: config.GOOGLE_CLIENT_ID });
  return normalize(ticket.getPayload());
}

function normalize(payload) {
  if (!payload || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Credencial do Google sem identificação.');
  }
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' ? payload.picture : ''
  };
}

// Só para testes: troca a verificação por uma função própria (nunca contata o Google).
function __setVerifierForTests(fn) {
  verifierOverride = fn;
}

module.exports = { isConfigured, verifyIdToken, __setVerifierForTests };
