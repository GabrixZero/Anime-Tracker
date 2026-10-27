// Testes HTTP das rotas de contas (S04): cadastro, login, /me, troca de senha, exclusão, Google, cabeçalhos e CORS.
// Tudo roda num diretório temporário (SHOWVAULT_DATA_DIR): nunca toca em server/data real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-authhttp-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
process.env.GOOGLE_CLIENT_ID = 'cliente-de-teste.apps.googleusercontent.com';
process.env.CORS_ORIGINS = 'https://app.exemplo.test';
// Limites folgados aqui (o teste de limite fica em auth-ratelimit.test.js, com valores baixos).
for (const k of ['AUTH_LOGIN_MAX', 'AUTH_LOGIN_IP_MAX', 'AUTH_REGISTER_MAX', 'AUTH_GOOGLE_MAX', 'AUTH_SENSITIVE_MAX']) process.env[k] = '1000';
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const config = require('../server/config/config');
const app = require('../server/app');
const UserModel = require('../server/models/UserModel');
const { UserModel: UserModelClass } = require('../server/models/UserModel');
const googleAuth = require('../server/services/googleAuth');
const { issueToken } = require('../server/middleware/auth');
const { STATE_VERSION } = require('../public/js/utils/migrations');

const PASS = 'senha-de-teste-1';
let server;
let base;

test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function call(method, route, { body, token, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    h['Content-Type'] = h['Content-Type'] || 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${base}${route}`, { method, headers: h, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json, headers: res.headers };
}

const register = (over = {}) => call('POST', '/auth/register', { body: { email: 'usuario@exemplo.test', password: PASS, ...over } });
const login = (email, password) => call('POST', '/auth/login', { body: { email, password } });
const userCount = () => UserModel.getAll().length;

// --- Cadastro --------------------------------------------------------------------------------------------------------------

test('cadastro válido devolve usuário sem senha, token JWT e grava só o hash scrypt', async () => {
  const res = await register({ email: 'Maria.Silva@Exemplo.TEST', name: '  Maria   Silva ' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'maria.silva@exemplo.test');
  assert.equal(res.body.user.name, 'Maria Silva');
  assert.equal(res.body.user.provider, 'email');
  assert.match(res.body.user.avatar, /^https:\/\//);
  assert.equal('password' in res.body.user, false);
  assert.equal(jwt.verify(res.body.token, config.JWT_SECRET).sub, res.body.user.id);

  const stored = UserModel.findByEmail('maria.silva@exemplo.test');
  assert.match(stored.password, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.notEqual(stored.password, PASS);
});

test('cadastro sem nome usa o início do e-mail; avatar http(s) válido é aceito', async () => {
  const res = await register({ email: 'sem.nome@exemplo.test', avatar: 'https://imagens.exemplo.test/a.png' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.name, 'sem.nome');
  assert.equal(res.body.user.avatar, 'https://imagens.exemplo.test/a.png');
});

test('cadastro: entradas inválidas dão 400 claro (nunca 500) e não criam conta', async () => {
  const before = userCount();
  const long = 'x'.repeat(61);
  const cases = [
    [{ email: 123 }, 'email'],
    [{ email: ['a@b.co'] }, 'email'],
    [{ email: { $ne: null } }, 'email'],
    [{ email: '' }, 'email'],
    [{ email: 'sem-arroba' }, 'email'],
    [{ email: 'a@b' }, 'email'],
    [{ email: 'a b@exemplo.test' }, 'email'],
    [{ email: '<script>@exemplo.test' }, 'email'],
    [{ email: `${'a'.repeat(250)}@exemplo.test` }, 'email'],
    [{ password: undefined }, 'password'],
    [{ password: 12345678 }, 'password'],
    [{ password: ['abcdefgh'] }, 'password'],
    [{ password: '1234567' }, 'password'],
    [{ password: 'x'.repeat(129) }, 'password'],
    [{ password: '        ' }, 'password'],
    [{ name: 42 }, 'name'],
    [{ name: long }, 'name'],
    [{ name: '<img src=x onerror=alert(1)>' }, 'name'],
    [{ avatar: 'javascript:alert(1)' }, 'avatar'],
    [{ avatar: 'data:text/html,<script>alert(1)</script>' }, 'avatar'],
    [{ avatar: 'ftp://exemplo.test/a.png' }, 'avatar'],
    [{ avatar: 'não é url' }, 'avatar'],
    [{ avatar: 123 }, 'avatar'],
    [{ avatar: `https://exemplo.test/${'a'.repeat(500)}` }, 'avatar']
  ];
  for (const [over, field] of cases) {
    const res = await register({ email: 'valido@exemplo.test', ...over });
    assert.equal(res.status, 400, `esperava 400 para ${JSON.stringify(over).slice(0, 80)}`);
    assert.equal(res.body.code, 'INVALID_INPUT');
    assert.ok(res.body.fields[field], `campo ${field} deveria ter mensagem`);
    assert.equal(typeof res.body.error, 'string');
  }
  assert.equal(userCount(), before);
});

test('cadastro: corpo ausente, array, texto ou JSON quebrado dão 400', async () => {
  const before = userCount();
  assert.equal((await call('POST', '/auth/register')).status, 400);
  assert.equal((await call('POST', '/auth/register', { body: [] })).status, 400);
  assert.equal((await call('POST', '/auth/register', { raw: '{"email":' })).status, 400);
  assert.equal((await call('POST', '/auth/register', { raw: '"texto"' })).status, 400);
  assert.equal((await call('POST', '/auth/register', { raw: 'null' })).status, 400);
  assert.equal(userCount(), before);
});

test('cadastro: corpo acima de 16 KB é recusado (413) nas rotas de auth', async () => {
  const res = await register({ name: 'x'.repeat(20 * 1024) });
  assert.equal(res.status, 413);
});

test('cadastro: e-mail repetido responde de forma neutra (409) e o limite de maiúsculas não engana', async () => {
  assert.equal((await register({ email: 'repetido@exemplo.test' })).status, 201);
  const again = await register({ email: 'REPETIDO@exemplo.test' });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'REGISTER_FAILED');
  assert.doesNotMatch(again.body.error, /já está cadastrado|já existe/i, 'não deve confirmar que o e-mail existe');
  assert.equal(UserModel.getAll().filter(u => u.email === 'repetido@exemplo.test').length, 1);
});

test('cadastro: dois pedidos simultâneos com o mesmo e-mail criam só uma conta', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => register({ email: 'corrida@exemplo.test' })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 4);
  assert.equal(UserModel.getAll().filter(u => u.email === 'corrida@exemplo.test').length, 1);
});

// --- Login -----------------------------------------------------------------------------------------------------------------

test('login: sucesso, e mesma resposta para senha errada e e-mail inexistente (sem enumerar contas)', async () => {
  await register({ email: 'login@exemplo.test' });
  const ok = await login('LOGIN@exemplo.test', PASS);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal('password' in ok.body.user, false);

  const wrongPass = await login('login@exemplo.test', 'senha-errada-99');
  const noUser = await login('nao.existe@exemplo.test', 'senha-errada-99');
  assert.equal(wrongPass.status, 401);
  assert.equal(noUser.status, 401);
  assert.deepEqual(wrongPass.body, noUser.body);
});

test('login: entradas inválidas dão 400 (nunca 500)', async () => {
  const bad = [
    {}, { email: 123, password: PASS }, { email: 'login@exemplo.test' }, { email: 'login@exemplo.test', password: 123 },
    { email: 'login@exemplo.test', password: ['a'] }, { email: { $gt: '' }, password: { $gt: '' } },
    { email: 'sem-arroba', password: PASS }, { email: 'login@exemplo.test', password: 'x'.repeat(129) }
  ];
  for (const body of bad) {
    const res = await call('POST', '/auth/login', { body });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await call('POST', '/auth/login')).status, 400);
});

test('login: senha legada em texto puro entra e é convertida para hash (sem aceitar senha curta em cadastros novos)', async () => {
  UserModel.saveAll([...UserModel.getAll(), {
    id: 'usr_legado_01', createdAt: '2026-01-01T00:00:00.000Z', name: 'Legado', email: 'legado@exemplo.test',
    password: 'curta', avatar: 'https://exemplo.test/a.png', provider: 'email'
  }]);
  const res = await login('legado@exemplo.test', 'curta');
  assert.equal(res.status, 200);
  assert.match(UserModel.findByEmail('legado@exemplo.test').password, /^[0-9a-f]{32}:/);
  assert.equal((await login('legado@exemplo.test', 'curta')).status, 200);
});

test('conta Google (sem senha) não entra por senha e recebe a mesma resposta neutra', async () => {
  UserModel.saveAll([...UserModel.getAll(), {
    id: 'usr_semsenha_01', createdAt: '2026-01-01T00:00:00.000Z', name: 'G', email: 'semsenha@exemplo.test',
    avatar: 'https://exemplo.test/a.png', provider: 'google', googleId: 'g-semsenha'
  }]);
  const res = await login('semsenha@exemplo.test', PASS);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, (await login('nao.existe@exemplo.test', PASS)).body);
});

// --- /me e tokens ----------------------------------------------------------------------------------------------------------

test('/me: token válido devolve o usuário; sem token, forjado, expirado, alg none e legado dão 401', async () => {
  const { body: reg } = await register({ email: 'eu@exemplo.test' });
  const me = await call('GET', '/auth/me', { token: reg.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'eu@exemplo.test');
  assert.equal('password' in me.body.user, false);
  assert.equal('googleId' in me.body.user, false);

  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: 'lixo' })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: `token_${reg.user.id}` })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: jwt.sign({ sub: reg.user.id }, 'outro-segredo-qualquer') })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: jwt.sign({ sub: reg.user.id }, config.JWT_SECRET, { expiresIn: -10 }) })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: jwt.sign({ sub: reg.user.id }, '', { algorithm: 'none' }) })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: jwt.sign({ nome: 'sem sub' }, config.JWT_SECRET) })).status, 401);
  // assinatura certa, mas conta que não existe (mais): sessão inválida
  assert.equal((await call('GET', '/auth/me', { token: issueToken({ id: 'usr_fantasma_01' }) })).status, 401);
});

// --- Trocar senha ----------------------------------------------------------------------------------------------------------

test('trocar senha: valida, exige a senha atual, e derruba tokens antigos', async () => {
  const { body: reg } = await register({ email: 'troca@exemplo.test' });
  const post = (body, token = reg.token) => call('POST', '/auth/change-password', { body, token });

  assert.equal((await call('POST', '/auth/change-password', { body: { currentPassword: PASS, newPassword: 'nova-senha-123' } })).status, 401);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ currentPassword: PASS, newPassword: 'curta' })).status, 400);
  assert.equal((await post({ currentPassword: PASS, newPassword: 12345678 })).status, 400);
  assert.equal((await post({ currentPassword: PASS, newPassword: PASS })).status, 400);
  const wrong = await post({ currentPassword: 'senha-errada-99', newPassword: 'nova-senha-123' });
  assert.equal(wrong.status, 403, 'senha atual errada não pode ser 401 (o app deslogaria o usuário)');
  assert.equal(wrong.body.code, 'WRONG_PASSWORD');

  // um token emitido "100 segundos atrás" representa outro aparelho logado antes da troca
  const oldToken = jwt.sign({ sub: reg.user.id, iat: Math.floor(Date.now() / 1000) - 100 }, config.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await call('GET', '/auth/me', { token: oldToken })).status, 200);

  const changed = await post({ currentPassword: PASS, newPassword: 'nova-senha-123' });
  assert.equal(changed.status, 200);
  assert.ok(changed.body.token);

  assert.equal((await call('GET', '/auth/me', { token: oldToken })).status, 401, 'token antigo foi revogado');
  assert.equal((await call('GET', '/auth/me', { token: changed.body.token })).status, 200, 'o token novo vale');
  assert.equal((await login('troca@exemplo.test', PASS)).status, 401);
  assert.equal((await login('troca@exemplo.test', 'nova-senha-123')).status, 200);
});

// --- Excluir conta ---------------------------------------------------------------------------------------------------------

test('excluir conta: exige a senha, apaga usuário e biblioteca e invalida o token', async () => {
  const { body: reg } = await register({ email: 'apagar@exemplo.test' });
  const { body: outro } = await register({ email: 'fica@exemplo.test' });
  const lib = { trackedShows: [{ showId: 1396, status: 'watching', addedAt: '2026-10-20T00:00:00Z' }], watchedEpisodes: {}, episodeNotes: {} };
  assert.equal((await call('PUT', '/user/library', { token: reg.token, body: { data: lib, stateVersion: STATE_VERSION } })).status, 200);
  assert.equal((await call('PUT', '/user/library', { token: outro.token, body: { data: lib, stateVersion: STATE_VERSION } })).status, 200);
  const libDir = path.join(DATA_DIR, 'libraries');
  assert.ok(fs.existsSync(path.join(libDir, `${reg.user.id}.json`)));

  const del = (body, token = reg.token) => call('DELETE', '/auth/account', { body, token });
  assert.equal((await call('DELETE', '/auth/account', { body: { password: PASS } })).status, 401);
  assert.equal((await del({})).status, 400);
  assert.equal((await del({ password: 123 })).status, 400);
  assert.equal((await del({ password: 'senha-errada-99' })).status, 403);
  assert.ok(UserModel.findById(reg.user.id), 'senha errada não apaga nada');

  assert.equal((await del({ password: PASS })).status, 200);
  assert.equal(UserModel.findById(reg.user.id), null);
  assert.equal(fs.readdirSync(libDir).some(f => f.startsWith(reg.user.id)), false, 'biblioteca (e cópias) apagadas');

  // sessão antiga não ressuscita a conta nem recria a biblioteca
  assert.equal((await call('GET', '/auth/me', { token: reg.token })).status, 401);
  assert.equal((await call('PUT', '/user/library', { token: reg.token, body: { data: lib, stateVersion: STATE_VERSION } })).status, 401);
  assert.equal(fs.existsSync(path.join(libDir, `${reg.user.id}.json`)), false);
  assert.equal((await login('apagar@exemplo.test', PASS)).status, 401);

  // a outra conta continua intacta
  assert.ok(UserModel.findById(outro.user.id));
  assert.ok(fs.existsSync(path.join(libDir, `${outro.user.id}.json`)));
  assert.equal((await call('GET', '/user/library', { token: outro.token })).status, 200);
});

// --- Google ----------------------------------------------------------------------------------------------------------------

test('Google: sem GOOGLE_CLIENT_ID a rota fica desligada e a configuração pública não expõe nada', async () => {
  const saved = config.GOOGLE_CLIENT_ID;
  config.GOOGLE_CLIENT_ID = '';
  try {
    const cfg = await call('GET', '/auth/config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.body.googleClientId, null);
    const res = await call('POST', '/auth/google', { body: { credential: 'qualquer' } });
    assert.equal(res.status, 501);
    // o perfil fixo/simulado antigo não funciona mais
    const old = await call('POST', '/auth/google', { body: { email: 'perfil.antigo@gmail.test', name: 'x' } });
    assert.equal(old.status, 501);
  } finally {
    config.GOOGLE_CLIENT_ID = saved;
  }
});

test('Google: ID token é validado no servidor; cria conta, reconhece o mesmo usuário e não funde com conta de senha', async () => {
  const cfg = await call('GET', '/auth/config');
  assert.equal(cfg.body.googleClientId, process.env.GOOGLE_CLIENT_ID);

  const profiles = {
    'tok-ok': { sub: 'g-111', email: 'Pessoa@Gmail.test', email_verified: true, name: 'Pessoa Google', picture: 'https://fotos.exemplo.test/p.jpg' },
    'tok-naoverificado': { sub: 'g-222', email: 'nv@gmail.test', email_verified: false, name: 'NV' },
    'tok-conflito': { sub: 'g-333', email: 'eu@exemplo.test', email_verified: true, name: 'Outro' },
    'tok-foto-ruim': { sub: 'g-444', email: 'foto@gmail.test', email_verified: true, name: '<b>Nome</b>', picture: 'javascript:alert(1)' }
  };
  googleAuth.__setVerifierForTests(async (credential) => {
    if (!profiles[credential]) throw new Error('token inválido');
    return profiles[credential];
  });
  try {
    assert.equal((await call('POST', '/auth/google', { body: {} })).status, 400);
    assert.equal((await call('POST', '/auth/google', { body: { credential: 123 } })).status, 400);
    assert.equal((await call('POST', '/auth/google', { body: { credential: 'forjado' } })).status, 401);
    assert.equal((await call('POST', '/auth/google', { body: { credential: 'tok-naoverificado' } })).status, 403);
    // enviar e-mail/nome no corpo não adianta: só vale o que o Google assinou
    assert.equal((await call('POST', '/auth/google', { body: { email: 'eu@exemplo.test', name: 'x', credential: 'forjado' } })).status, 401);

    const first = await call('POST', '/auth/google', { body: { credential: 'tok-ok' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.user.provider, 'google');
    assert.equal(first.body.user.email, 'pessoa@gmail.test');
    assert.equal(first.body.user.avatar, 'https://fotos.exemplo.test/p.jpg');
    assert.equal('googleId' in first.body.user, false);
    assert.equal(jwt.verify(first.body.token, config.JWT_SECRET).sub, first.body.user.id);
    assert.equal(UserModel.findById(first.body.user.id).password, undefined);

    const second = await call('POST', '/auth/google', { body: { credential: 'tok-ok' } });
    assert.equal(second.body.user.id, first.body.user.id, 'mesmo Google = mesma conta');
    assert.equal(UserModel.getAll().filter(u => u.googleId === 'g-111').length, 1);

    // já existe cadastro por senha com esse e-mail: não funde automaticamente
    const conflict = await call('POST', '/auth/google', { body: { credential: 'tok-conflito' } });
    assert.equal(conflict.status, 409);
    assert.equal(UserModel.findByEmail('eu@exemplo.test').provider, 'email');

    const sanitized = await call('POST', '/auth/google', { body: { credential: 'tok-foto-ruim' } });
    assert.equal(sanitized.status, 200);
    assert.match(sanitized.body.user.avatar, /^https:\/\/api\.dicebear\.com\//, 'foto não http(s) é trocada pelo avatar padrão');
    assert.doesNotMatch(sanitized.body.user.name, /[<>]/);

    // conta Google: não tem senha para trocar; excluir exige nova credencial do mesmo Google
    assert.equal((await call('POST', '/auth/change-password', { token: first.body.token, body: { currentPassword: PASS, newPassword: 'nova-senha-123' } })).status, 409);
    assert.equal((await call('DELETE', '/auth/account', { token: first.body.token, body: { password: PASS } })).status, 400);
    assert.equal((await call('DELETE', '/auth/account', { token: first.body.token, body: { credential: 'forjado' } })).status, 403);
    assert.equal((await call('DELETE', '/auth/account', { token: first.body.token, body: { credential: 'tok-foto-ruim' } })).status, 403, 'credencial de outra pessoa');
    assert.ok(UserModel.findById(first.body.user.id));
    assert.equal((await call('DELETE', '/auth/account', { token: first.body.token, body: { credential: 'tok-ok' } })).status, 200);
    assert.equal(UserModel.findById(first.body.user.id), null);
  } finally {
    googleAuth.__setVerifierForTests(null);
  }
});

// --- Cabeçalhos, CORS, conta demo ------------------------------------------------------------------------------------------

test('cabeçalhos de segurança (helmet), sem x-powered-by, e CORS só para origens listadas', async () => {
  const res = await fetch(`${base}/auth/config`, { headers: { Origin: 'https://app.exemplo.test' } });
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('x-frame-options') || res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.exemplo.test');

  const other = await fetch(`${base}/auth/config`, { headers: { Origin: 'https://site-malicioso.test' } });
  assert.equal(other.status, 200);
  assert.equal(other.headers.get('access-control-allow-origin'), null);

  const same = await fetch(`${base}/auth/config`);
  assert.equal(same.headers.get('access-control-allow-origin'), null);
});

test('conta demo não existe por padrão; só com seedDemo explícito (SEED_DEMO_USER=1)', () => {
  assert.equal(UserModel.findByEmail('demo@showvault.local'), null);

  const examplePath = path.join(__dirname, '..', 'server', 'data', 'users.example.json');
  const withDemoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-demo-'));
  const noDemoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-nodemo-'));
  try {
    for (const dir of [withDemoDir, noDemoDir]) fs.copyFileSync(examplePath, path.join(dir, 'users.example.json'));
    assert.deepEqual(new UserModelClass(noDemoDir).getAll(), []);
    assert.deepEqual(new UserModelClass(noDemoDir, { seedDemo: false }).getAll(), []);
    assert.equal(new UserModelClass(withDemoDir, { seedDemo: true }).findByEmail('demo@showvault.local').id, 'usr_demo_01');
  } finally {
    fs.rmSync(withDemoDir, { recursive: true, force: true });
    fs.rmSync(noDemoDir, { recursive: true, force: true });
  }
});

test('o repositório não traz users.json, libraries/ nem o segredo JWT', () => {
  const root = path.join(__dirname, '..');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['server/data/users.json', 'server/data/libraries/', 'server/data/jwt.secret', '.env']) {
    assert.ok(ignore.includes(entry), `.gitignore deve conter ${entry}`);
  }
});

test('o segredo local foi criado no diretório temporário e é longo', () => {
  const file = path.join(DATA_DIR, 'jwt.secret');
  assert.ok(fs.existsSync(file));
  assert.ok(fs.readFileSync(file, 'utf8').trim().length >= 64);
  assert.equal(config.JWT_SECRET_SOURCE, 'file');
});
