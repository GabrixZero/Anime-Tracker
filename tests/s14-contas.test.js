// Testes HTTP da S14: cadastro por convite, "sair de todos os aparelhos", excluir conta (apaga a biblioteca) e trocar senha.
// Roda numa pasta temporária (SHOWVAULT_DATA_DIR). Os códigos de convite são inventados a cada execução: nenhum código real aparece aqui.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s14-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.INVITE_CODES;
for (const k of ['AUTH_LOGIN_MAX', 'AUTH_LOGIN_IP_MAX', 'AUTH_REGISTER_MAX', 'AUTH_GOOGLE_MAX', 'AUTH_SENSITIVE_MAX']) process.env[k] = '1000';
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const config = require('../server/config/config');
const app = require('../server/app');
const UserModel = require('../server/models/UserModel');
const { STATE_VERSION } = require('../public/js/utils/migrations');

const PASS = 'senha-de-teste-1';
const fakeCode = () => `convite-${crypto.randomBytes(9).toString('hex')}`;
let server;
let base;

test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function call(method, route, { body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json };
}

const register = (email, extra = {}) => call('POST', '/auth/register', { body: { email, password: PASS, ...extra } });

// --- Convite ---------------------------------------------------------------------------------------------------------------

test('convite desligado (INVITE_CODES vazio): cadastro livre e /config diz que não exige convite', async () => {
  delete process.env.INVITE_CODES;
  assert.equal((await call('GET', '/auth/config')).body.inviteRequired, false);
  assert.equal((await register('livre@exemplo.test')).status, 201);
  process.env.INVITE_CODES = ' , ,'; // só vírgulas e espaços = também desligado
  assert.equal((await call('GET', '/auth/config')).body.inviteRequired, false);
  assert.equal((await register('livre2@exemplo.test')).status, 201);
});

test('convite ligado: código válido cadastra UMA vez; inválido, ausente e reutilizado dão a mesma mensagem neutra', async () => {
  const [a, b] = [fakeCode(), fakeCode()];
  process.env.INVITE_CODES = `${a}, ${b}`;
  const cfg = await call('GET', '/auth/config');
  assert.equal(cfg.body.inviteRequired, true);
  assert.equal(JSON.stringify(cfg.body).includes(a), false, '/config nunca revela os códigos');

  const before = UserModel.getAll().length;
  const wrong = await register('sem-convite@exemplo.test', { inviteCode: fakeCode() });
  const missing = await register('sem-convite@exemplo.test');
  const notText = await register('sem-convite@exemplo.test', { inviteCode: { $ne: null } });
  const huge = await register('sem-convite@exemplo.test', { inviteCode: 'x'.repeat(5000) });
  for (const res of [wrong, missing, notText, huge]) {
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'INVITE_INVALID');
    assert.equal(res.body.error, wrong.body.error, 'mesma mensagem em todos os casos');
  }
  assert.match(wrong.body.error, /convite/i);
  assert.equal(UserModel.getAll().length, before, 'recusado não cria conta');

  const ok = await register('convidado1@exemplo.test', { inviteCode: a });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.token);

  const reused = await register('convidado2@exemplo.test', { inviteCode: a });
  assert.equal(reused.status, 403, 'cada código vale uma vez');
  assert.equal(reused.body.error, wrong.body.error);
  assert.equal((await register('convidado2@exemplo.test', { inviteCode: `  ${b}  ` })).status, 201, 'outro código segue valendo (espaços nas pontas são ignorados)');

  // O arquivo de códigos usados guarda só hashes, nunca o código em texto.
  const stored = fs.readFileSync(path.join(DATA_DIR, 'invites.json'), 'utf8');
  assert.equal(stored.includes(a) || stored.includes(b), false);
  delete process.env.INVITE_CODES;
});

test('convite: dois cadastros ao mesmo tempo com o mesmo código, só um passa', async () => {
  const code = fakeCode();
  process.env.INVITE_CODES = code;
  const results = await Promise.all([
    register('corrida1@exemplo.test', { inviteCode: code }),
    register('corrida2@exemplo.test', { inviteCode: code })
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 403]);
  delete process.env.INVITE_CODES;
});

test('convite: cadastro que falha por e-mail repetido não gasta o código', async () => {
  const code = fakeCode();
  await register('repetido@exemplo.test');
  process.env.INVITE_CODES = code;
  assert.equal((await register('repetido@exemplo.test', { inviteCode: code })).status, 409);
  assert.equal((await register('novo-com-codigo@exemplo.test', { inviteCode: code })).status, 201, 'o código continuou valendo');
  assert.equal((await register('invalido@exemplo.test', { inviteCode: code, password: 'curta' })).status, 400, 'validação vem antes e não gasta nada');
  delete process.env.INVITE_CODES;
});

// --- Sair de todos os aparelhos ---------------------------------------------------------------------------------------------

test('logout-all: exige sessão, derruba todos os tokens (inclusive um emitido neste mesmo segundo) e o login novo funciona', async () => {
  assert.equal((await call('POST', '/auth/logout-all')).status, 401);

  const { body: reg } = await register('todos@exemplo.test');
  const login1 = await call('POST', '/auth/login', { body: { email: 'todos@exemplo.test', password: PASS } });
  const tokens = [reg.token, login1.body.token];
  for (const t of tokens) assert.equal((await call('GET', '/auth/me', { token: t })).status, 200);

  const out = await call('POST', '/auth/logout-all', { token: reg.token });
  assert.equal(out.status, 200);
  for (const t of tokens) assert.equal((await call('GET', '/auth/me', { token: t })).status, 401, 'token antigo foi revogado');
  assert.equal((await call('POST', '/auth/logout-all', { token: reg.token })).status, 401);

  const again = await call('POST', '/auth/login', { body: { email: 'todos@exemplo.test', password: PASS } });
  assert.equal(again.status, 200);
  assert.equal((await call('GET', '/auth/me', { token: again.body.token })).status, 200, 'o login novo (mesmo segundo) vale');
  assert.equal(jwt.verify(again.body.token, config.JWT_SECRET).tv, 1);
});

test('logout-all de uma conta não afeta as sessões de outra', async () => {
  const { body: a } = await register('isolado-a@exemplo.test');
  const { body: b } = await register('isolado-b@exemplo.test');
  await call('POST', '/auth/logout-all', { token: a.token });
  assert.equal((await call('GET', '/auth/me', { token: b.token })).status, 200);
});

// --- Trocar senha ------------------------------------------------------------------------------------------------------------

test('trocar senha: o token novo vale, o antigo cai e a senha antiga deixa de entrar; também vale depois de logout-all', async () => {
  const { body: reg } = await register('troca-s14@exemplo.test');
  const oldToken = jwt.sign({ sub: reg.user.id, tv: 0, iat: Math.floor(Date.now() / 1000) - 100 }, config.JWT_SECRET, { expiresIn: '1h' });
  const changed = await call('POST', '/auth/change-password', { token: reg.token, body: { currentPassword: PASS, newPassword: 'outra-senha-456' } });
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/auth/me', { token: oldToken })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: changed.body.token })).status, 200);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'troca-s14@exemplo.test', password: PASS } })).status, 401);

  // trocar a senha depois de "sair de todos" mantém a versão da sessão e continua coerente
  const login = await call('POST', '/auth/login', { body: { email: 'troca-s14@exemplo.test', password: 'outra-senha-456' } });
  await call('POST', '/auth/logout-all', { token: login.body.token });
  const relogin = await call('POST', '/auth/login', { body: { email: 'troca-s14@exemplo.test', password: 'outra-senha-456' } });
  const second = await call('POST', '/auth/change-password', { token: relogin.body.token, body: { currentPassword: 'outra-senha-456', newPassword: 'terceira-senha-789' } });
  assert.equal(second.status, 200);
  assert.equal((await call('GET', '/auth/me', { token: second.body.token })).status, 200);
});

// --- Excluir conta -----------------------------------------------------------------------------------------------------------

test('excluir conta apaga também a biblioteca do usuário (e só a dele)', async () => {
  const { body: reg } = await register('exclui-s14@exemplo.test');
  const { body: other } = await register('permanece-s14@exemplo.test');
  const lib = { trackedShows: [{ showId: 1396, status: 'watching', addedAt: '2026-10-20T00:00:00Z' }], watchedEpisodes: {}, episodeNotes: {} };
  for (const t of [reg.token, other.token]) {
    assert.equal((await call('PUT', '/user/library', { token: t, body: { data: lib, stateVersion: STATE_VERSION } })).status, 200);
  }
  const libDir = path.join(DATA_DIR, 'libraries');
  const mine = path.join(libDir, `${reg.user.id}.json`);
  assert.ok(fs.existsSync(mine));

  assert.equal((await call('DELETE', '/auth/account', { token: reg.token, body: { password: 'senha-errada-99' } })).status, 403);
  assert.ok(fs.existsSync(mine), 'senha errada não apaga nada');

  assert.equal((await call('DELETE', '/auth/account', { token: reg.token, body: { password: PASS } })).status, 200);
  assert.equal(UserModel.findById(reg.user.id), null);
  assert.equal(fs.readdirSync(libDir).some(f => f.startsWith(reg.user.id)), false, 'biblioteca e cópias apagadas');
  assert.ok(fs.existsSync(path.join(libDir, `${other.user.id}.json`)), 'a biblioteca de outra conta continua');
  assert.equal((await call('GET', '/user/library', { token: reg.token })).status, 401);
});
