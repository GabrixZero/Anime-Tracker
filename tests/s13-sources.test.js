// S13 · peças comuns das fontes externas: faixa de ids da AniList, requisição JSON com POST, disjuntor e fila/cache/retentativa
// do SourceClient (base da Jikan e da AniList). Nenhuma rede real: servidores HTTP locais em porta efêmera e relógio falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');

const { SOURCES, describeId, toInternalId } = require('../server/utils/ids');
const { requestJson } = require('../server/utils/httpJson');
const { mediaErrors } = require('../server/utils/errors');
const SourceBreaker = require('../server/utils/sourceBreaker');
const SourceClient = require('../server/services/sourceClient');

function fakeClock() {
  const c = { t: 1_000_000, slept: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.slept.push(ms); c.t += ms; };
  return c;
}

// ------------------------------------------------------------------------------------------------- ids

test('ids: AniList sem idMal tem faixa própria (40.000.000+), ingerível, sem sobrepor as outras', () => {
  assert.deepEqual(SOURCES.anilist, { min: 40000000, max: 49999999, offset: 40000000, ingestable: true });
  assert.equal(toInternalId('anilist', 154587), 40154587);
  assert.deepEqual(describeId(40154587), { source: 'anilist', externalId: 154587, ingestable: true });
  // quem tem idMal continua na faixa da Jikan: AniList e Jikan descrevem a mesma obra com o mesmo id
  assert.deepEqual(describeId(toInternalId('jikan', 52991)), { source: 'jikan', externalId: 52991, ingestable: true });
  assert.throws(() => toInternalId('anilist', 10000000), err => err.code === 'INVALID_ID', 'passaria do fim da faixa');
  for (const [name, r] of Object.entries(SOURCES)) {
    if (name === 'anilist') continue;
    assert.ok(r.max < SOURCES.anilist.min || r.min > SOURCES.anilist.max, `${name} sobrepõe a faixa da AniList`);
  }
});

// ------------------------------------------------------------------------------------------------- httpJson

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/graphql` }));
  });
}

test('httpJson: POST envia o corpo JSON com Content-Type e Content-Length corretos; GET continua igual', async (t) => {
  const seen = [];
  const { server, url } = await listen((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, type: req.headers['content-type'], length: Number(req.headers['content-length']), body: Buffer.concat(chunks).toString('utf-8') });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
  });
  t.after(() => server.close());

  const body = JSON.stringify({ query: '{ Media { title } }', variables: { texto: 'Ação — 進撃の巨人' } });
  const post = await requestJson(url, { method: 'POST', body });
  assert.deepEqual(post, { ok: true, method: 'POST' });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].type, 'application/json');
  assert.equal(seen[0].length, Buffer.byteLength(body), 'Content-Length em bytes, não em caracteres');
  assert.equal(seen[0].body, body);

  const get = await requestJson(url);
  assert.equal(get.method, 'GET');
  assert.equal(seen[1].body, '');
});

test('httpJson: 404, 429 (Retry-After) e 5xx viram erros tipados; timeout e conexão recusada são marcados como inalcançáveis', async (t) => {
  const { server, url } = await listen((req, res) => {
    if (req.url.endsWith('?s=404')) { res.statusCode = 404; return res.end('{}'); }
    if (req.url.endsWith('?s=429')) { res.statusCode = 429; res.setHeader('Retry-After', '7'); return res.end('{}'); }
    if (req.url.endsWith('?s=500')) { res.statusCode = 500; return res.end('{}'); }
    if (req.url.endsWith('?s=slow')) return; // nunca responde
    res.end('não é json');
  });
  t.after(() => { server.closeAllConnections(); server.close(); });

  await assert.rejects(requestJson(`${url}?s=404`), err => err.code === 'NOT_FOUND');
  await assert.rejects(requestJson(`${url}?s=429`), err => err.code === 'RATE_LIMITED' && err.retryAfterMs === 7000);
  await assert.rejects(requestJson(`${url}?s=500`), err => err.code === 'UPSTREAM' && !err.unreachable, 'servidor respondeu: não é "inalcançável"');
  await assert.rejects(requestJson(`${url}?s=texto`), err => err.code === 'UPSTREAM' && !err.unreachable);
  await assert.rejects(requestJson(`${url}?s=slow`, { timeoutMs: 80 }), err => err.code === 'UPSTREAM' && err.unreachable === true);

  const free = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  await assert.rejects(requestJson(`http://127.0.0.1:${free}/x`), err => err.code === 'UPSTREAM' && err.unreachable === true);
});

// ------------------------------------------------------------------------------------------------- disjuntor

test('disjuntor: "inalcançável" abre na primeira falha; outras falhas só depois de 3 seguidas; 404/429 nunca; sucesso fecha', () => {
  const clock = fakeClock();
  const b = new SourceBreaker({ name: 'x', label: 'A fonte X', cooldownMs: 30000, now: clock.now });
  assert.equal(b.isOpen, false);
  b.check(); // fechado: não lança

  b.failure(mediaErrors.notFound());
  b.failure(mediaErrors.rateLimited(1000));
  assert.equal(b.isOpen, false, '404 e 429 não contam');

  b.failure(mediaErrors.upstream());
  b.failure(mediaErrors.upstream());
  assert.equal(b.isOpen, false, 'duas falhas de servidor ainda não abrem');
  b.success();
  b.failure(mediaErrors.upstream());
  b.failure(mediaErrors.upstream());
  assert.equal(b.isOpen, false, 'o sucesso zerou a contagem');
  b.failure(mediaErrors.upstream());
  assert.equal(b.isOpen, true, 'a terceira seguida abre');

  assert.throws(() => b.check(), err => err.code === 'UPSTREAM' && err.breakerOpen === true && /A fonte X/.test(err.message) && /30 s/.test(err.message));
  clock.t += 12000;
  assert.equal(b.retryAfterSec, 18);
  b.failure(Object.assign(mediaErrors.upstream(), { breakerOpen: true }));
  assert.equal(b.retryAfterSec, 18, 'o erro do próprio disjuntor não prolonga a espera');
  clock.t += 18000;
  assert.equal(b.isOpen, false, 'passou o tempo: tenta de novo');

  const dead = new SourceBreaker({ cooldownMs: 1000, now: clock.now });
  dead.failure(mediaErrors.upstream('Tempo esgotado', { unreachable: true }));
  assert.equal(dead.isOpen, true, 'timeout abre de uma vez');

  const off = new SourceBreaker({ cooldownMs: 0, now: clock.now });
  off.failure(mediaErrors.upstream('x', { unreachable: true }));
  assert.equal(off.isOpen, false, 'cooldown 0 = desligado');
  off.check();
});

// ------------------------------------------------------------------------------------------------- SourceClient

function makeClient(fetchJson, extra = {}) {
  const clock = fakeClock();
  const client = new SourceClient({ fetchJson, sleep: clock.sleep, now: clock.now, name: 'teste', label: 'A fonte de teste', minIntervalMs: 0, ...extra });
  return { client, clock };
}
const via = (client, key, perform, opts) => client.cached(key, 60000, perform, opts);

test('SourceClient: fonte inalcançável não repete, abre o disjuntor e os pedidos seguintes falham sem rede; depois do cooldown tenta de novo', async () => {
  let calls = 0;
  let alive = false;
  const { client, clock } = makeClient(async () => {
    calls++;
    if (!alive) throw mediaErrors.upstream('Tempo esgotado na fonte externa.', { unreachable: true });
    return { ok: true };
  }, { breakerCooldownMs: 30000 });
  const go = key => via(client, key, () => client.fetchJson('http://x/' + key));

  await assert.rejects(go('a'), err => err.code === 'UPSTREAM' && err.unreachable);
  assert.equal(calls, 1, 'timeout não é repetido (cada tentativa esperaria outro timeout)');
  assert.deepEqual(clock.slept, [], 'nem esperou entre tentativas');

  await assert.rejects(go('b'), err => err.breakerOpen === true);
  await assert.rejects(go('c'), err => err.breakerOpen === true);
  assert.equal(calls, 1, 'disjuntor aberto: nenhuma requisição nova');

  clock.t += 30001;
  alive = true;
  assert.deepEqual(await go('d'), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(await go('e'), { ok: true });
  assert.equal(client.breaker.isOpen, false);
});

test('SourceClient: 5xx repete com espera crescente; 3 pedidos que falham de vez abrem o disjuntor; resposta em cache continua valendo', async () => {
  let calls = 0;
  let fail = false;
  const { client, clock } = makeClient(async () => { calls++; if (fail) throw mediaErrors.upstream(); return { n: calls }; }, { breakerCooldownMs: 30000, retries: 1, backoffMs: 500 });
  const first = await via(client, 'k', () => client.fetchJson('u'));
  fail = true;
  for (const key of ['f1', 'f2', 'f3']) await assert.rejects(via(client, key, () => client.fetchJson('u')), err => err.code === 'UPSTREAM' && !err.breakerOpen);
  assert.equal(calls, 1 + 3 * 2, '1 tentativa + 1 nova por pedido');
  assert.deepEqual(clock.slept, [500, 500, 500]);
  assert.equal(client.breaker.isOpen, true);
  await assert.rejects(via(client, 'f4', () => client.fetchJson('u')), err => err.breakerOpen === true);
  assert.equal(calls, 7);
  assert.deepEqual(await via(client, 'k', () => client.fetchJson('u')), first, 'o que já estava em cache continua respondendo');
});

test('SourceClient: 404 e 429 não abrem o disjuntor; `fresh` ignora o cache e renova a resposta', async () => {
  let n = 0;
  const { client } = makeClient(async () => { n++; if (n === 1) throw mediaErrors.notFound(); if (n === 2) throw mediaErrors.rateLimited(); return { n }; }, { breakerCooldownMs: 30000, retries: 0 });
  await assert.rejects(via(client, 'a', () => client.fetchJson('u')), err => err.code === 'NOT_FOUND');
  await assert.rejects(via(client, 'b', () => client.fetchJson('u')), err => err.code === 'RATE_LIMITED');
  assert.equal(client.breaker.isOpen, false);
  assert.deepEqual(await via(client, 'c', () => client.fetchJson('u')), { n: 3 });
  assert.deepEqual(await via(client, 'c', () => client.fetchJson('u')), { n: 3 }, 'cache');
  assert.deepEqual(await via(client, 'c', () => client.fetchJson('u'), { fresh: true }), { n: 4 }, 'fresh pede de novo');
  assert.deepEqual(await via(client, 'c', () => client.fetchJson('u')), { n: 4 }, 'e o cache ficou com a resposta nova');
});

test('SourceClient: com pauseOnRateLimit um 429 com Retry-After segura a fila inteira (os outros pedidos esperam em vez de tomar outro 429)', async () => {
  const stamps = [];
  let n = 0;
  const { client, clock } = makeClient(async () => {
    stamps.push(clock.now());
    n++;
    if (n === 1) throw mediaErrors.rateLimited(5000);
    return { n };
  }, { pauseOnRateLimit: true, retries: 1, backoffMs: 100, maxWaitMs: 20000 });
  const [a, b] = await Promise.all([via(client, 'a', () => client.fetchJson('u')), via(client, 'b', () => client.fetchJson('u'))]);
  assert.ok(a.n >= 2 && b.n >= 2);
  const t0 = stamps[0];
  for (const t of stamps.slice(1)) assert.ok(t - t0 >= 5000, `pedido saiu ${t - t0} ms depois do 429 (< 5000)`);
});
