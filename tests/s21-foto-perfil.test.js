// Foto de perfil: envio, leitura só pelo dono, validação pelos bytes reais (magic bytes), remoção e exclusão da conta.
// Todas as imagens são geradas em memória; nenhuma foto real entra no repositório.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-foto-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.JWT_SECRET;
delete process.env.SEED_DEMO_USER;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.INVITE_CODES;
for (const k of ['AUTH_LOGIN_MAX', 'AUTH_LOGIN_IP_MAX', 'AUTH_REGISTER_MAX', 'AUTH_GOOGLE_MAX', 'AUTH_SENSITIVE_MAX', 'AUTH_AVATAR_MAX'])
  process.env[k] = '1000';
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const app = require('../server/app');

const PASS = 'senha-de-teste-1';
let server;
let base;

test.before(async () => {
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

// --- imagens mínimas geradas por bytes ---
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([0, 255, 0, 0]); // filtro 0 + 1 pixel vermelho
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
const makeJpeg = () =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.alloc(20),
    Buffer.from([0xff, 0xd9])
  ]);
function makeWebp() {
  const payload = Buffer.concat([Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(24)]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, payload]);
}

function call(method, route, { body, token, type = 'application/json' } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = type;
  return fetch(`${base}${route}`, { method, headers, body });
}

let counter = 0;
async function newAccount() {
  counter += 1;
  const res = await call('POST', '/auth/register', { body: JSON.stringify({ email: `foto${counter}@exemplo.test`, password: PASS }) });
  assert.equal(res.status, 201);
  const json = await res.json();
  return { token: json.token, id: json.user.id, user: json.user };
}
const put = (token, body, type) => call('PUT', '/user/avatar', { token, body, type });
const avatarFiles = () => (fs.existsSync(path.join(DATA_DIR, 'avatars')) ? fs.readdirSync(path.join(DATA_DIR, 'avatars')) : []);
const filesOf = id => avatarFiles().filter(f => f.startsWith(id));

test('PNG sobe, GET devolve os mesmos bytes só ao dono, com cabeçalhos seguros', async () => {
  const a = await newAccount();
  assert.equal(a.user.hasPhoto, false);
  const png = makePng();
  const res = await put(a.token, png, 'image/png');
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.hasPhoto, true);
  assert.ok(user.avatarUpdatedAt);
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'avatars', `${a.id}.png`)));

  const get = await call('GET', '/user/avatar', { token: a.token });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('content-type'), 'image/png');
  assert.equal(get.headers.get('cache-control'), 'private, no-store');
  assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await get.arrayBuffer()).equals(png));

  const me = await (await call('GET', '/auth/me', { token: a.token })).json();
  assert.equal(me.user.hasPhoto, true);
});

test('sem token: 401 (GET, PUT e DELETE)', async () => {
  assert.equal((await call('GET', '/user/avatar')).status, 401);
  assert.equal((await put(undefined, makePng(), 'image/png')).status, 401);
  assert.equal((await call('DELETE', '/user/avatar')).status, 401);
});

test('outra conta não vê a foto da primeira (404)', async () => {
  const a = await newAccount();
  const b = await newAccount();
  assert.equal((await put(a.token, makePng(), 'image/png')).status, 200);
  assert.equal((await call('GET', '/user/avatar', { token: b.token })).status, 404);
  assert.equal((await call('GET', '/user/avatar', { token: a.token })).status, 200);
});

test('SVG e texto são recusados, mesmo com MIME de imagem', async () => {
  const a = await newAccount();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  for (const type of ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']) {
    assert.equal((await put(a.token, svg, type)).status, 415, `svg como ${type}`);
  }
  assert.equal((await put(a.token, Buffer.from('isto é só um texto, não uma imagem'), 'image/png')).status, 415);
  assert.equal((await put(a.token, Buffer.from('texto'), 'text/plain')).status, 415);
  assert.equal((await call('GET', '/user/avatar', { token: a.token })).status, 404);
});

test('bytes falsos são recusados (cabeçalho quase certo ou tipo trocado)', async () => {
  const a = await newAccount();
  const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]); // assinatura PNG incompleta
  assert.equal((await put(a.token, fakePng, 'image/png')).status, 415);
  const wave = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(20)]);
  assert.equal((await put(a.token, wave, 'image/webp')).status, 415);
  const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(40)]);
  assert.equal((await put(a.token, fakeJpeg, 'image/jpeg')).status, 415);
  assert.deepEqual(filesOf(a.id), []);
});

test('grande demais é recusada (413) e a foto antiga continua', async () => {
  const a = await newAccount();
  assert.equal((await put(a.token, makePng(), 'image/png')).status, 200);
  const acimaDe200kb = Buffer.concat([makePng(), Buffer.alloc(210 * 1024)]); // dentro do parser (256 KB), acima do limite da foto
  assert.equal((await put(a.token, acimaDe200kb, 'image/png')).status, 413);
  const enorme = Buffer.concat([makePng(), Buffer.alloc(300 * 1024)]);
  assert.equal((await put(a.token, enorme, 'image/png')).status, 413);
  assert.equal((await call('GET', '/user/avatar', { token: a.token })).status, 200);
});

test('trocar PNG por JPEG e WEBP apaga o arquivo da outra extensão', async () => {
  const a = await newAccount();
  assert.equal((await put(a.token, makePng(), 'image/png')).status, 200);
  assert.equal((await put(a.token, makeJpeg(), 'image/jpeg')).status, 200);
  assert.deepEqual(filesOf(a.id), [`${a.id}.jpg`]);
  assert.equal((await call('GET', '/user/avatar', { token: a.token })).headers.get('content-type'), 'image/jpeg');
  assert.equal((await put(a.token, makeWebp(), 'image/webp')).status, 200);
  assert.deepEqual(filesOf(a.id), [`${a.id}.webp`]);
  assert.equal((await call('GET', '/user/avatar', { token: a.token })).headers.get('content-type'), 'image/webp');
});

test('DELETE volta ao avatar padrão', async () => {
  const a = await newAccount();
  await put(a.token, makePng(), 'image/png');
  const res = await call('DELETE', '/user/avatar', { token: a.token });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.hasPhoto, false);
  assert.equal(user.avatarUpdatedAt, null);
  assert.ok(user.avatar, 'o avatar padrão continua na conta');
  assert.equal((await call('GET', '/user/avatar', { token: a.token })).status, 404);
  assert.deepEqual(filesOf(a.id), []);
});

test('excluir a conta apaga o arquivo da foto', async () => {
  const a = await newAccount();
  await put(a.token, makePng(), 'image/png');
  assert.deepEqual(filesOf(a.id), [`${a.id}.png`]);
  const res = await call('DELETE', '/auth/account', { token: a.token, body: JSON.stringify({ password: PASS }) });
  assert.equal(res.status, 200);
  assert.deepEqual(filesOf(a.id), []);
});
