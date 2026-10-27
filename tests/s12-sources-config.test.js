// S12 (D-S12-3): TVMAZE_BASE_URL e TMDB_BASE_URL apontam as fontes de séries/filmes para um servidor falso (como JIKAN_BASE_URL e
// ANILIST_BASE_URL já faziam). Sem as variáveis, o app continua usando os endereços oficiais.
// A config lê o ambiente ao ser carregada, então cada caso roda num processo filho com pasta de dados temporária (nada em server/data).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

// Imprime, em JSON, o que o MediaService e a config enxergam com este ambiente.
const SCRIPT = `
const config = require('./server/config/config');
const MediaService = require('./server/services/mediaService').MediaService;
const svc = require('./server/services/mediaService');
console.log(JSON.stringify({
  tvmazeEnv: config.TVMAZE_BASE_URL,
  tmdbEnv: config.TMDB_BASE_URL,
  tvmaze: svc.tvmazeBase,
  tmdb: svc.tmdb.baseUrl,
  anilist: svc.anilist.baseUrl,
  jikan: svc.jikan.baseUrl,
  ok: typeof MediaService === 'function'
}));
process.exit(0);
`;

function inspect(extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s12cfg-'));
  try {
    const env = { ...process.env };
    for (const key of ['TVMAZE_BASE_URL', 'TMDB_BASE_URL', 'ANILIST_BASE_URL', 'JIKAN_BASE_URL', 'TMDB_API_KEY', 'STORAGE', 'NODE_ENV']) delete env[key];
    Object.assign(env, { SHOWVAULT_DATA_DIR: dir, MEDIA_REFRESH_INTERVAL_MIN: '0' }, extraEnv);
    const run = spawnSync(process.execPath, ['-e', SCRIPT], { cwd: REPO, env, encoding: 'utf-8', timeout: 20000 });
    assert.equal(run.status, 0, `o processo filho falhou:\n${run.stderr}`);
    return JSON.parse(run.stdout.trim().split('\n').pop());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('sem as variáveis, TVMaze e TMDB usam os endereços oficiais', () => {
  const seen = inspect({});
  assert.equal(seen.tvmazeEnv, '');
  assert.equal(seen.tmdbEnv, '');
  assert.equal(seen.tvmaze, 'https://api.tvmaze.com');
  assert.equal(seen.tmdb, 'https://api.themoviedb.org/3');
  assert.equal(seen.anilist, 'https://graphql.anilist.co');
  assert.equal(seen.jikan, 'https://api.jikan.moe/v4');
});

test('TVMAZE_BASE_URL e TMDB_BASE_URL trocam o endereço das fontes (sem a barra final)', () => {
  const seen = inspect({
    TVMAZE_BASE_URL: ' http://127.0.0.1:4010/tvmaze/ ',
    TMDB_BASE_URL: 'http://127.0.0.1:4010/tmdb/3//',
    ANILIST_BASE_URL: 'http://127.0.0.1:4010/anilist',
    JIKAN_BASE_URL: 'http://127.0.0.1:4010/jikan/v4'
  });
  assert.equal(seen.tvmazeEnv, 'http://127.0.0.1:4010/tvmaze');
  assert.equal(seen.tmdbEnv, 'http://127.0.0.1:4010/tmdb/3');
  assert.equal(seen.tvmaze, 'http://127.0.0.1:4010/tvmaze');
  assert.equal(seen.tmdb, 'http://127.0.0.1:4010/tmdb/3');
  assert.equal(seen.anilist, 'http://127.0.0.1:4010/anilist');
  assert.equal(seen.jikan, 'http://127.0.0.1:4010/jikan/v4');
});

test('o que o código passa explicitamente (testes unitários) vence a variável de ambiente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s12cfg-'));
  try {
    const env = { ...process.env, SHOWVAULT_DATA_DIR: dir, TVMAZE_BASE_URL: 'http://127.0.0.1:4010/tvmaze', TMDB_BASE_URL: 'http://127.0.0.1:4010/tmdb' };
    const script = `
      const MediaService = require('./server/services/mediaService').MediaService;
      const svc = new MediaService({ dataDir: process.env.SHOWVAULT_DATA_DIR, tvmazeBase: 'http://x.invalid/a', tmdbBase: 'http://x.invalid/b', tmdbKey: 'k' });
      console.log(JSON.stringify({ tvmaze: svc.tvmazeBase, tmdb: svc.tmdb.baseUrl }));
      process.exit(0);
    `;
    const run = spawnSync(process.execPath, ['-e', script], { cwd: REPO, env, encoding: 'utf-8', timeout: 20000 });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').pop()), { tvmaze: 'http://x.invalid/a', tmdb: 'http://x.invalid/b' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
