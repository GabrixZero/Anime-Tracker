const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const config = require('../server/config/config');
const { issueToken, requireAuth } = require('../server/middleware/auth');
const LibraryModel = require('../server/models/LibraryModel');
const UserModel = require('../server/models/UserModel');

function runAuth(header) {
  const req = { headers: header === undefined ? {} : { authorization: header } };
  const out = { nextCalled: false, status: null };
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; }
  };
  requireAuth(req, res, () => { out.nextCalled = true; });
  return { req, out };
}

test('requireAuth aceita JWT válido e define req.userId', () => {
  const { req, out } = runAuth(`Bearer ${issueToken({ id: 'usr_abc' })}`);
  assert.equal(out.nextCalled, true);
  assert.equal(req.userId, 'usr_abc');
});

test('requireAuth rejeita ausência de token, token legado e token forjado', () => {
  assert.equal(runAuth(undefined).out.status, 401);
  assert.equal(runAuth('Bearer token_usr_demo_01').out.status, 401);

  const forged = jwt.sign({ sub: 'usr_demo_01' }, 'outro-segredo');
  assert.equal(runAuth(`Bearer ${forged}`).out.status, 401);
});

test('requireAuth rejeita token expirado e alg none', () => {
  const expired = jwt.sign({ sub: 'usr_x' }, config.JWT_SECRET, { expiresIn: -10 });
  assert.equal(runAuth(`Bearer ${expired}`).out.status, 401);

  const none = jwt.sign({ sub: 'usr_x' }, '', { algorithm: 'none' });
  assert.equal(runAuth(`Bearer ${none}`).out.status, 401);
});

test('UserModel: hash scrypt, senha legada e comprimentos inválidos', () => {
  const stored = UserModel.hashPassword('segredo');
  assert.equal(UserModel.verifyPassword('segredo', stored), true);
  assert.equal(UserModel.verifyPassword('errada', stored), false);
  assert.equal(UserModel.verifyPassword('abc', 'abc'), true);
  assert.equal(UserModel.isLegacyPassword('abc'), true);
  assert.equal(UserModel.isLegacyPassword(stored), false);
  assert.equal(UserModel.verifyPassword('x', 'abcd:0011'), false);
});

test('LibraryModel', async (t) => {
  const originalDir = LibraryModel.dir;
  LibraryModel.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-lib-'));
  t.after(() => {
    fs.rmSync(LibraryModel.dir, { recursive: true, force: true });
    LibraryModel.dir = originalDir;
  });

  const valid = {
    trackedShows: [{ showId: 1396, status: 'watching', addedAt: '2026-10-20T00:00:00Z' }],
    watchedEpisodes: { '1396_s1_e1': { watched: true, watchedAt: '2026-10-20T19:30:00Z', rewatchCount: 1 } },
    episodeNotes: {
      '1396_s1_e1': { text: 'ótimo', emotion: 'awesome', character: 'Walter', updatedAt: '2026-10-20T20:00:00Z', snapshots: [] }
    }
  };

  await t.test('biblioteca inexistente volta vazia', () => {
    const lib = LibraryModel.get('usr_novo_01');
    assert.deepEqual(lib.trackedShows, []);
    assert.equal(lib.updatedAt, null);
  });

  await t.test('round-trip de gravação e leitura', () => {
    const saved = LibraryModel.save('usr_rt_01', valid);
    assert.ok(saved.updatedAt);
    const read = LibraryModel.get('usr_rt_01');
    assert.deepEqual(read.trackedShows, valid.trackedShows);
    assert.deepEqual(read.watchedEpisodes, valid.watchedEpisodes);
    assert.deepEqual(read.episodeNotes, valid.episodeNotes);
    assert.deepEqual(fs.readdirSync(LibraryModel.dir), ['usr_rt_01.json']);
  });

  await t.test('rejeita userId malicioso (path traversal)', () => {
    for (const id of ['../x', 'usr_../../x', 'usr_a/b', '', null, undefined]) {
      assert.throws(() => LibraryModel.save(id, valid), /userId inválido/);
      assert.throws(() => LibraryModel.get(id), /userId inválido/);
    }
  });

  await t.test('rejeita payloads inválidos', () => {
    const bad = [
      null,
      {},
      { ...valid, trackedShows: {} },
      { ...valid, trackedShows: [{ showId: 'abc' }] },
      { ...valid, trackedShows: [{ showId: 1 }, { showId: 1 }] },
      { ...valid, watchedEpisodes: { '../etc': { watched: true } } },
      { ...valid, episodeNotes: { '1_s1_e1': 'texto' } }
    ];
    for (const payload of bad) {
      assert.throws(() => LibraryModel.validate(payload), /inválid|obrigat/i);
    }
  });

  await t.test('descarta campos desconhecidos', () => {
    const clean = LibraryModel.validate({
      ...valid,
      trackedShows: [{ showId: 5, status: 'watching', addedAt: 'x', admin: true }],
      extra: 'x'
    });
    assert.deepEqual(Object.keys(clean.trackedShows[0]).sort(), ['addedAt', 'showId', 'status']);
    assert.equal('extra' in clean, false);
  });
});
