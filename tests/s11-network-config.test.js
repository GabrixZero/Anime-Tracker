// S11 (modo PC, D-29): HOST (onde o servidor escuta) e TRUST_PROXY (IP real atrás do Tailscale Funnel).
// Tudo em pastas temporárias e em portas livres escolhidas pelo próprio teste (nunca a 3000 de quem usa o app).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { parseHost, parseTrustProxy, describeListen, urlHost } = require('../server/config/network');

const REPO = path.join(__dirname, '..');
// Segredo descartável só dos testes (não é um segredo real).
const TEST_SECRET = 'teste-s11-0123456789abcdef0123456789abcdef-nao-e-segredo';

// Ambiente do processo filho: sem nada do ambiente de quem roda os testes que mude o comportamento do servidor.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of [
    'HOST',
    'PORT',
    'NODE_ENV',
    'STORAGE',
    'TRUST_PROXY',
    'JWT_SECRET',
    'SHOWVAULT_DATA_DIR',
    'GOOGLE_CLIENT_ID',
    'TMDB_API_KEY',
    'CORS_ORIGINS'
  ]) {
    delete env[key];
  }
  return { ...env, MEDIA_REFRESH_INTERVAL_MIN: '0', ...extra };
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const canConnect = (host, port) =>
  new Promise(resolve => {
    const s = net.connect({ host, port });
    s.setTimeout(1500);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    s.once('timeout', () => {
      s.destroy();
      resolve(false);
    });
  });

const lanAddress = () => {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
};

// Sobe `node server.js` num processo filho; encerra o processo e apaga a pasta de dados ao fim do teste.
async function startServer(t, { env = {}, port } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s11-'));
  const chosenPort = port || (await freePort());
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: cleanEnv({ SHOWVAULT_DATA_DIR: dir, NODE_ENV: 'test', PORT: String(chosenPort), ...env }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const server = { child, port: chosenPort, dir, output: '', exited: null };
  child.stdout.on('data', d => (server.output += d));
  child.stderr.on('data', d => (server.output += d));
  server.exit = new Promise(resolve =>
    child.once('exit', code => {
      server.exited = code;
      resolve(code);
    })
  );
  t.after(async () => {
    if (server.exited === null) {
      child.kill();
      await Promise.race([server.exit, new Promise(resolve => setTimeout(resolve, 3000).unref())]);
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  server.ready = async () => {
    for (let i = 0; i < 150 && server.exited === null; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${chosenPort}/health`);
        if (res.ok) return true;
      } catch {
        /* ainda subindo */
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };
  return server;
}

const configOf = env =>
  spawnSync(
    process.execPath,
    [
      '-e',
      "const c = require('./server/config/config'); console.log(JSON.stringify({ host: c.HOST, trust: c.TRUST_PROXY, port: c.PORT }))"
    ],
    { cwd: REPO, env: cleanEnv(env), encoding: 'utf8' }
  );

// ---- funções puras ----

test('parseHost: padrão por ambiente, valores válidos e erros claros', () => {
  assert.equal(parseHost('', { isProduction: true }), '127.0.0.1', 'produção sem HOST = só este computador');
  assert.equal(parseHost(undefined, { isProduction: true }), '127.0.0.1');
  assert.equal(parseHost('', { isProduction: false }), null, 'desenvolvimento sem HOST = todas as interfaces (como sempre foi)');
  assert.equal(parseHost('   ', {}), null);
  assert.equal(parseHost('0.0.0.0', { isProduction: true }), '0.0.0.0');
  assert.equal(parseHost('::', { isProduction: true }), '::');
  assert.equal(parseHost('::1'), '::1');
  assert.equal(parseHost('[::1]'), '::1', 'colchetes do IPv6 são aceitos e removidos');
  assert.equal(parseHost(' 127.0.0.1 '), '127.0.0.1');
  assert.equal(parseHost('localhost'), 'localhost');
  for (const bad of ['127.0.0.1:3000', 'http://localhost', 'dois nomes', '-x', 'a/b', '@']) {
    assert.throws(() => parseHost(bad), /HOST inválido/, `"${bad}" deve ser recusado`);
  }
});

test('parseTrustProxy: vazio não confia; número = quantos saltos; true/false e listas', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('  '), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(' 2 '), 2);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('10.0.0.0/8, 192.168.0.0/16'), '10.0.0.0/8, 192.168.0.0/16');
});

test('describeListen e urlHost descrevem o endereço em português', () => {
  assert.match(describeListen('127.0.0.1', 3000), /127\.0\.0\.1:3000 \(só este computador\)/);
  assert.match(describeListen('::1', 3000), /\[::1\]:3000/);
  assert.match(describeListen(null, 3000), /todas as interfaces, porta 3000/);
  assert.match(describeListen('0.0.0.0', 80), /todas as interfaces/);
  assert.equal(urlHost(null), 'localhost');
  assert.equal(urlHost('0.0.0.0'), 'localhost');
  assert.equal(urlHost('127.0.0.1'), '127.0.0.1');
  assert.equal(urlHost('::1'), '[::1]');
});

// ---- configuração lida de verdade (processo separado) ----

test('config: HOST e TRUST_PROXY chegam à configuração conforme o ambiente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s11-cfg-'));
  try {
    const run = env =>
      JSON.parse(
        configOf({ SHOWVAULT_DATA_DIR: dir, ...env })
          .stdout.trim()
          .split('\n')
          .pop()
      );
    assert.equal(run({}).host, null, 'desenvolvimento: todas as interfaces');
    assert.equal(run({}).trust, false);
    assert.equal(run({ NODE_ENV: 'production', JWT_SECRET: TEST_SECRET }).host, '127.0.0.1', 'produção: só este computador');
    assert.equal(run({ NODE_ENV: 'production', JWT_SECRET: TEST_SECRET, HOST: '0.0.0.0' }).host, '0.0.0.0');
    assert.equal(
      run({ NODE_ENV: 'production', JWT_SECRET: TEST_SECRET, HOST: '' }).host,
      '127.0.0.1',
      'HOST vazio (.env.example) = padrão'
    );
    assert.equal(run({ TRUST_PROXY: '1' }).trust, 1);

    const bad = configOf({ SHOWVAULT_DATA_DIR: dir, HOST: '127.0.0.1:3000' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /HOST inválido/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- servidor de verdade ----

test('produção sem HOST: escuta só em 127.0.0.1 (a rede local não consegue conectar)', async t => {
  const server = await startServer(t, { env: { NODE_ENV: 'production', JWT_SECRET: TEST_SECRET } });
  assert.ok(await server.ready(), `servidor não subiu:\n${server.output}`);
  assert.match(server.output, /Escutando: 127\.0\.0\.1:\d+ \(só este computador\)/);
  assert.equal(await canConnect('127.0.0.1', server.port), true);
  const lan = lanAddress();
  if (lan) assert.equal(await canConnect(lan, server.port), false, `${lan}:${server.port} não pode aceitar conexões`);
});

test('HOST=0.0.0.0 (modo Docker): continua respondendo em 127.0.0.1 e o aviso diz "todas as interfaces"', async t => {
  const server = await startServer(t, { env: { NODE_ENV: 'production', JWT_SECRET: TEST_SECRET, HOST: '0.0.0.0' } });
  assert.ok(await server.ready(), `servidor não subiu:\n${server.output}`);
  assert.match(server.output, /Escutando: todas as interfaces/);
  const health = await (await fetch(`http://127.0.0.1:${server.port}/health`)).json();
  assert.equal(health.status, 'ok');
});

test('porta já ocupada: o servidor avisa em português e sai com código 1 (não fica vivo sem escutar)', async t => {
  const first = await startServer(t);
  assert.ok(await first.ready(), `primeiro servidor não subiu:\n${first.output}`);
  const second = await startServer(t, { port: first.port });
  const code = await Promise.race([second.exit, new Promise(resolve => setTimeout(() => resolve('timeout'), 15000).unref())]);
  assert.equal(code, 1, `o segundo servidor deveria sair com código 1:\n${second.output}`);
  assert.match(second.output, /porta \d+ já está em uso/);
  assert.doesNotMatch(second.output, /Servidor MVC Ativo/, 'não pode anunciar "ativo" sem ter aberto a porta');
});

test('HOST inválido: o servidor não sobe e explica', async t => {
  const server = await startServer(t, { env: { HOST: 'http://localhost' } });
  const code = await Promise.race([server.exit, new Promise(resolve => setTimeout(() => resolve('timeout'), 15000).unref())]);
  assert.notEqual(code, 0);
  assert.notEqual(code, 'timeout');
  assert.match(server.output, /HOST inválido/);
});

// ---- TRUST_PROXY atrás do Tailscale Funnel ----
// O proxy do tailscaled (Serve/Funnel) é um httputil.ReverseProxy com Rewrite: apaga o X-Forwarded-* que o visitante mandou e define
// X-Forwarded-For (IP real do visitante), X-Forwarded-Host e X-Forwarded-Proto: https. Conecta ao app a partir de 127.0.0.1.
// Fonte: ipn/ipnlocal/serve.go do repositório tailscale/tailscale (ver o diário da S11). É isso que simulamos aqui.

async function failedLogins({ port, forwardedFor, count, emailPrefix }) {
  const statuses = [];
  for (let i = 0; i < count; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': forwardedFor,
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'maquina.exemplo.ts.net'
      },
      body: JSON.stringify({ email: `${emailPrefix}${i}@exemplo.test`, password: 'senha-errada-12345' })
    });
    statuses.push(res.status);
  }
  return statuses;
}

const LIMIT_ENV = { AUTH_LOGIN_IP_MAX: '2', AUTH_LOGIN_MAX: '100' };

test('TRUST_PROXY=1: o limite de tentativas enxerga o IP real de cada visitante (e ignora IPs forjados à esquerda)', async t => {
  const server = await startServer(t, { env: { ...LIMIT_ENV, TRUST_PROXY: '1' } });
  assert.ok(await server.ready(), `servidor não subiu:\n${server.output}`);

  // Visitante A erra 3 vezes seguidas: as 2 primeiras são 401, a 3ª bate no limite (429).
  assert.deepEqual(await failedLogins({ port: server.port, forwardedFor: '198.51.100.7', count: 3, emailPrefix: 'a' }), [401, 401, 429]);
  // Visitante B (outro IP real) não é afetado pelo bloqueio do A.
  assert.deepEqual(await failedLogins({ port: server.port, forwardedFor: '203.0.113.9', count: 2, emailPrefix: 'b' }), [401, 401]);
  // Quem tenta se esconder prefixando IPs falsos continua sendo o último salto (o que o proxy confiável escreveu).
  assert.deepEqual(
    await failedLogins({ port: server.port, forwardedFor: '1.2.3.4, 198.51.100.7', count: 1, emailPrefix: 'c' }),
    [429],
    'o IP forjado à esquerda não reinicia o contador do visitante A'
  );
});

test('sem TRUST_PROXY (padrão): todos os visitantes aparecem como 127.0.0.1 e dividem o mesmo limite', async t => {
  const server = await startServer(t, { env: LIMIT_ENV });
  assert.ok(await server.ready(), `servidor não subiu:\n${server.output}`);
  assert.deepEqual(await failedLogins({ port: server.port, forwardedFor: '198.51.100.7', count: 3, emailPrefix: 'a' }), [401, 401, 429]);
  assert.deepEqual(
    await failedLogins({ port: server.port, forwardedFor: '203.0.113.9', count: 1, emailPrefix: 'b' }),
    [429],
    'sem confiar no proxy, o X-Forwarded-For é ignorado (por isso o modo PC define TRUST_PROXY=1)'
  );
});

test('TRUST_PROXY=true gera um aviso de segurança na partida', async t => {
  const server = await startServer(t, { env: { TRUST_PROXY: 'true' } });
  assert.ok(await server.ready(), `servidor não subiu:\n${server.output}`);
  assert.match(server.output, /TRUST_PROXY=true confia em qualquer X-Forwarded-For/);
});
