// Limite de tentativas em login e cadastro (S04). Arquivo separado porque os contadores ficam em memória no processo:
// aqui os limites são baixos, no auth-http.test.js ficam folgados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-ratelimit-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
process.env.AUTH_LOGIN_MAX = '3'; // falhas por IP+e-mail
process.env.AUTH_LOGIN_IP_MAX = '6'; // falhas por IP
process.env.AUTH_REGISTER_MAX = '4';
process.env.AUTH_SENSITIVE_MAX = '3';
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const app = require('../server/app');

const PASS = 'senha-de-teste-1';
let server;
let base;
test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function post(route, body, token, method = 'POST') {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json, headers: res.headers };
}

test('cadastro: depois de 4 tentativas no mesmo IP responde 429 com Retry-After', async () => {
  // as tentativas inválidas também contam (impede usar o cadastro para testar e-mails sem limite)
  for (let i = 0; i < 3; i++) {
    assert.equal((await post('/auth/register', { email: `pessoa${i}@exemplo.test`, password: PASS })).status, 201);
  }
  assert.equal((await post('/auth/register', { email: 'pessoa0@exemplo.test', password: PASS })).status, 409);
  const blocked = await post('/auth/register', { email: 'pessoa9@exemplo.test', password: PASS });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
});

test('login: só falhas contam; a 4ª falha para o mesmo e-mail é bloqueada, mesmo com a senha certa', async () => {
  // logins corretos não consomem o limite
  for (let i = 0; i < 5; i++) {
    assert.equal((await post('/auth/login', { email: 'pessoa0@exemplo.test', password: PASS })).status, 200);
  }

  for (let i = 0; i < 3; i++) {
    assert.equal((await post('/auth/login', { email: 'pessoa1@exemplo.test', password: 'senha-errada-99' })).status, 401);
  }
  const blocked = await post('/auth/login', { email: 'pessoa1@exemplo.test', password: 'senha-errada-99' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  // e-mail diferente do mesmo IP ainda tem direito às suas tentativas
  assert.equal((await post('/auth/login', { email: 'pessoa2@exemplo.test', password: 'senha-errada-99' })).status, 401);
  // maiúsculas/espaços no e-mail não burlam o limite
  assert.equal((await post('/auth/login', { email: '  PESSOA1@exemplo.test ', password: PASS })).status, 429);
});

test('login: o IP também tem teto próprio contra quem testa muitas contas diferentes', async () => {
  // O teste anterior gastou as 6 tentativas falhas permitidas a este IP (3 + 1 bloqueada + 1 de outro e-mail + 1 bloqueada).
  // Um e-mail que nunca foi usado só pode ser barrado pelo teto do IP.
  const blocked = await post('/auth/login', { email: 'nunca.usado@exemplo.test', password: 'senha-errada-99' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
});

test('trocar senha / excluir conta: tentativas erradas são limitadas por usuário', async () => {
  // o cadastro está no limite por IP; reaproveita a conta já criada fazendo login por token emitido diretamente
  const { issueToken } = require('../server/middleware/auth');
  const UserModel = require('../server/models/UserModel');
  const user = UserModel.findByEmail('pessoa0@exemplo.test');
  const token = issueToken(user);

  for (let i = 0; i < 3; i++) {
    assert.equal((await post('/auth/change-password', { currentPassword: 'senha-errada-99', newPassword: 'nova-senha-123' }, token)).status, 403);
  }
  const blocked = await post('/auth/change-password', { currentPassword: 'senha-errada-99', newPassword: 'nova-senha-123' }, token);
  assert.equal(blocked.status, 429);
  const blockedDelete = await post('/auth/account', { password: PASS }, token, 'DELETE');
  assert.equal(blockedDelete.status, 429, 'o contador é do usuário e vale para as duas ações sensíveis');
});
