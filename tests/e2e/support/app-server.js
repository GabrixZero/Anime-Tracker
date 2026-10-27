// Sobe o servidor do ShowVault para os testes E2E (S12) numa pasta de dados TEMPORÁRIA e sem rede externa.
// Usado pelo global-setup (servidor principal, porta 3012) e por testes que precisam de outra configuração
// (ex.: GOOGLE_CLIENT_ID), sempre com pasta própria e processo próprio, encerrados e apagados no fim.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SERVER_JS = path.join(ROOT, 'server.js');
const GUARD = path.join(__dirname, '..', 'fake-sources', 'network-guard.js');
const SEED = path.join(ROOT, 'server', 'data', 'mediaCatalog.seed.json');
const TMP_PREFIX = 'showvault-e2e-';

// Variáveis do ambiente de quem roda os testes que mudariam o comportamento do app: o servidor de teste nunca as herda.
const SCRUB = [
  'NODE_ENV',
  'PORT',
  'HOST',
  'SHOWVAULT_DATA_DIR',
  'SHOWVAULT_BACKUP_DIR',
  'STORAGE',
  'SQLITE_FILE',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'TMDB_API_KEY',
  'GOOGLE_CLIENT_ID',
  'JIKAN_BASE_URL',
  'ANILIST_BASE_URL',
  'TVMAZE_BASE_URL',
  'TMDB_BASE_URL',
  'MEDIA_AIRING_TTL_HOURS',
  'MEDIA_REFRESH_INTERVAL_MIN',
  'CORS_ORIGINS',
  'TRUST_PROXY',
  'SEED_DEMO_USER',
  'STATIC_MAX_AGE_SEC'
];

// Chave do TMDB só dos testes (o TMDB falso exige alguma; não é uma chave de verdade e nada sai da máquina).
const FAKE_TMDB_KEY = 'chave-de-teste-e2e-nao-e-segredo';

// Obras fictícias acrescentadas ao catálogo (depois das 16 do seed) para a lista do Explorar ter mais de uma página (60 por página).
const EXTRA_CATALOG_SIZE = 50;

function extraCatalog() {
  return Array.from({ length: EXTRA_CATALOG_SIZE }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    const movie = i % 3 === 2;
    return {
      id: 990001 + i,
      type: movie ? 'movie' : 'tv',
      name: `Obra de Catálogo E2E ${n}`,
      overview: 'Obra fictícia criada pelos testes ponta a ponta (paginação do Explorar).',
      poster_path: null,
      backdrop_path: null,
      vote_average: null,
      first_air_date: '2020-01-01',
      genres: [],
      status: '',
      runtime: movie ? 100 : null,
      seasons: movie
        ? []
        : [
            {
              season_number: 1,
              name: 'Temporada 1',
              episodes: [{ episode_number: 1, name: 'Episódio 1', runtime: 30, air_date: '2020-01-01', overview: '', still_path: null }]
            }
          ]
    };
  });
}

// Pasta nova em os.tmpdir() (showvault-e2e-XXXXXX) com o catálogo de runtime = seed + obras fictícias.
function prepareDataDir({ withExtraCatalog = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  if (withExtraCatalog) {
    const seed = JSON.parse(fs.readFileSync(SEED, 'utf-8'));
    fs.writeFileSync(path.join(dir, 'mediaCatalog.runtime.json'), JSON.stringify([...seed, ...extraCatalog()]));
  }
  return dir;
}

// Apaga SÓ uma pasta criada por prepareDataDir (confere o prefixo e que está direto em os.tmpdir()).
function removeDataDir(dir) {
  if (!dir) return;
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(TMP_PREFIX)) {
    throw new Error(`[e2e] Recusei apagar uma pasta que não é dos testes E2E: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function portIsFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function getHealth(url) {
  return new Promise(resolve => {
    const req = http.get(`${url}/health`, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => req.destroy());
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sobe `node server.js` com a rede de segurança e espera o /health. Devolve { url, port, dataDir, stop() }.
// O servidor falso das fontes (global-setup) deixa a URL e as variáveis *_BASE_URL em E2E_FAKE_SOURCES_URL e E2E_FAKE_ENV (JSON).
async function startApp({ port, dataDir, env = {}, logFile, timeoutMs = 30000 }) {
  const fakeSourcesUrl = process.env.E2E_FAKE_SOURCES_URL;
  if (!fakeSourcesUrl)
    throw new Error('[e2e] O servidor falso das fontes não está no ar (E2E_FAKE_SOURCES_URL vazio): suba-o no global-setup.');
  const fakeEnv = JSON.parse(process.env.E2E_FAKE_ENV || '{}');
  if (!(await portIsFree(port))) {
    throw new Error(`[e2e] A porta ${port} já está em uso. Feche o outro servidor (ou rode com E2E_PORT=<outra porta>).`);
  }

  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (SCRUB.includes(key) || key.startsWith('AUTH_')) delete childEnv[key];
  Object.assign(childEnv, {
    PORT: String(port),
    HOST: '127.0.0.1', // só neste computador (e o Windows não pergunta do firewall)
    SHOWVAULT_DATA_DIR: dataDir,
    STORAGE: process.env.E2E_STORAGE || 'json',
    MEDIA_REFRESH_INTERVAL_MIN: '0', // sem a conferência automática de obras em exibição (os testes controlam o que acontece)
    TMDB_API_KEY: FAKE_TMDB_KEY,
    ...fakeEnv,
    E2E_FAKE_SOURCES_URL: fakeSourcesUrl,
    // Limites de tentativas de login/cadastro bem altos: todos os testes usam o mesmo IP (127.0.0.1).
    AUTH_REGISTER_MAX: '100000',
    AUTH_LOGIN_MAX: '100000',
    AUTH_LOGIN_IP_MAX: '100000',
    AUTH_GOOGLE_MAX: '100000',
    AUTH_SENSITIVE_MAX: '100000',
    ...env
  });

  const child = spawn(process.execPath, ['--require', GUARD, SERVER_JS], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  const tail = [];
  const log = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
  const collect = chunk => {
    const text = chunk.toString();
    if (log) log.write(text);
    tail.push(text);
    if (tail.length > 60) tail.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let exited = null;
  const exitPromise = new Promise(resolve =>
    child.once('exit', (code, signal) => {
      exited = { code, signal };
      resolve(exited);
    })
  );

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (!(await getHealth(url))) {
    if (exited || Date.now() > deadline) {
      if (!exited) child.kill();
      if (log) log.end();
      throw new Error(
        `[e2e] O servidor de teste não respondeu em ${url}/health (${exited ? `saiu com código ${exited.code}` : 'tempo esgotado'}).\n` +
          tail.join('').slice(-3000)
      );
    }
    await sleep(150);
  }

  async function stop() {
    if (!exited) {
      child.kill();
      const timer = sleep(5000).then(() => 'timeout');
      if ((await Promise.race([exitPromise, timer])) === 'timeout' && !exited) {
        child.kill('SIGKILL');
        await exitPromise;
      }
    }
    if (log) await new Promise(r => log.end(r));
  }

  return { url, port, dataDir, pid: child.pid, stop, logTail: () => tail.join('') };
}

module.exports = { prepareDataDir, removeDataDir, startApp, freePort, TMP_PREFIX };
