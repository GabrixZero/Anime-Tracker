// Testes do MediaService (S02): ids por fonte, ingestão, erros da fonte externa, escrita atômica, leitura corrompida, concorrência.
// Nada aqui escreve em server/data real: tudo usa diretórios temporários.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Os módulos-singleton leem config.DATA_DIR ao carregar: aponte para um diretório temporário ANTES de qualquer require do servidor.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-media-'));
process.env.SHOWVAULT_DATA_DIR = path.join(ROOT, 'singleton');
fs.mkdirSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true });
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

const { MediaService } = require('../server/services/mediaService');
const { writeJsonAtomic, readJson } = require('../server/utils/jsonStore');
const { parseId, describeId, toInternalId, SOURCES } = require('../server/utils/ids');
const { DataCorruptionError } = require('../server/utils/errors');

let counter = 0;
function newDir() {
  const dir = path.join(ROOT, `case-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newService(dir = newDir(), extra = {}) {
  const svc = new MediaService({ dataDir: dir, tvmazeBase: 'http://tvmaze.invalid', sleep: async () => {}, jikanEnabled: false, anilistEnabled: false, tmdbKey: '', ...extra });
  svc.calls = [];
  return svc;
}

function tvmazeShow(id, overrides = {}) {
  return {
    id,
    name: `Série ${id}`,
    type: 'Scripted',
    summary: '<p>Resumo <b>com</b> HTML</p>',
    premiered: '2020-01-01',
    status: 'Ended',
    genres: ['Drama'],
    rating: { average: 7.5 },
    image: { original: 'https://static.tvmaze.com/p.jpg' },
    _embedded: {
      episodes: [
        { season: 2, number: 1, name: 'S2E1', runtime: 40, airdate: '2021-01-01', summary: '<p>x</p>' },
        { season: 1, number: 1, name: 'Piloto', runtime: 50, airdate: '2020-01-01', summary: '<p>y</p>', image: { medium: 'https://static.tvmaze.com/e.jpg' } },
        { season: 1, number: 2, name: 'Segundo', runtime: 50, airdate: '2020-01-08', summary: '' }
      ]
    },
    ...overrides
  };
}

function mockFetch(svc, handler) {
  svc.fetchJson = async (url) => {
    svc.calls.push(url);
    return handler(url);
  };
}

const runtimeFile = dir => path.join(dir, 'mediaCatalog.runtime.json');
const readRuntime = dir => JSON.parse(fs.readFileSync(runtimeFile(dir), 'utf-8'));

// ---------------------------------------------------------------------------------------------------------------------

test('faixas de ids: nenhuma colisão entre fontes e conversão ida e volta', () => {
  const ranges = Object.values(SOURCES);
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      assert.ok(ranges[i].max < ranges[j].min || ranges[j].max < ranges[i].min, 'faixas se sobrepõem');
    }
  }
  assert.equal(toInternalId('tvmaze', 155), 1000155);
  assert.deepEqual(describeId(1000155), { source: 'tvmaze', externalId: 155, ingestable: true });
  assert.equal(describeId(155).source, 'seed'); // Batman (TMDB) continua com o id nativo
  assert.equal(toInternalId('jikan', 20), 10000020);
  assert.equal(toInternalId('tmdb_tv', 1396), 20001396);
  assert.equal(toInternalId('tmdb_movie', 155), 30000155);
  assert.equal(describeId(5000000).source, null);
  assert.throws(() => toInternalId('tvmaze', 1000000), /ID inválido/);
});

test('parseId aceita só inteiro positivo seguro', () => {
  assert.equal(parseId('42'), 42);
  assert.equal(parseId(42), 42);
  for (const bad of ['abc', '', '-1', '0', '1.5', '12abc', ' 5', NaN, Infinity, 1.5, -3, 0, null, undefined, {}, [], [1], 1e21, '99999999999999999999']) {
    assert.throws(() => parseId(bad), err => err.code === 'INVALID_ID' && err.httpStatus === 400, `deveria rejeitar ${String(bad)}`);
  }
});

test('catálogo de runtime nasce do seed: Batman volta e as 4 obras do TVMaze não existem', () => {
  const dir = newDir();
  const svc = newService(dir);
  const ids = svc.catalog.map(m => m.id);
  assert.equal(fs.existsSync(runtimeFile(dir)), true);
  assert.equal(svc.catalog.length, readRuntime(dir).length);

  const batman = svc.findLocal(155);
  assert.equal(batman.type, 'movie');
  assert.match(batman.name, /Batman/);
  for (const retired of [555, 13615, 495]) assert.equal(ids.includes(retired), false);
  assert.equal(svc.catalog.some(m => /Beauty|Naruto|Avatar|Hero Academia/.test(m.name)), false);
  assert.ok(ids.every(id => describeId(id).source === 'seed'), 'todo item do seed fica na faixa seed');
  assert.equal(new Set(ids).size, ids.length);
});

test('o seed versionado é só leitura: ingerir não altera mediaCatalog.seed.json', async () => {
  const seedPath = path.join(__dirname, '..', 'server', 'data', 'mediaCatalog.seed.json');
  const before = fs.readFileSync(seedPath, 'utf-8');
  const svc = newService();
  mockFetch(svc, () => tvmazeShow(10));
  await svc.ingest(1000010);
  assert.equal(fs.readFileSync(seedPath, 'utf-8'), before);
});

test('obra nova do seed é acrescentada ao runtime existente sem sobrescrever o que já está lá', () => {
  const dir = newDir();
  const seedPath = path.join(dir, 'seed.json');
  writeJsonAtomic(seedPath, [{ id: 1, name: 'A', type: 'tv' }, { id: 2, name: 'B', type: 'tv' }]);
  const first = newService(dir, { seedPath });
  assert.deepEqual(first.catalog.map(m => m.id), [1, 2]);

  const runtime = readRuntime(dir);
  runtime[0].name = 'A editada no runtime';
  writeJsonAtomic(runtimeFile(dir), runtime);
  writeJsonAtomic(seedPath, [{ id: 1, name: 'A', type: 'tv' }, { id: 2, name: 'B', type: 'tv' }, { id: 3, name: 'C', type: 'movie' }]);

  const second = newService(dir, { seedPath });
  assert.deepEqual(second.catalog.map(m => m.id), [1, 2, 3]);
  assert.equal(second.findLocal(1).name, 'A editada no runtime');
});

test('ingestão válida: ids na faixa do TVMaze, dados saneados e gravação em disco', async () => {
  const dir = newDir();
  const svc = newService(dir);
  mockFetch(svc, () => tvmazeShow(82, { name: '<img src=x onerror=alert(1)>Game', summary: '<script>alert(1)</script><p>ok</p>' }));

  const media = await svc.ingest(1000082);
  assert.equal(media.id, 1000082);
  assert.equal(media.type, 'tv');
  assert.equal(media.name, 'Game');
  assert.equal(media.overview, 'ok');
  assert.deepEqual(media.seasons.map(s => s.season_number), [1, 2]);
  assert.equal(media.seasons[0].episodes.length, 2);
  assert.ok(media.ingestedAt);
  assert.deepEqual(svc.calls, ['http://tvmaze.invalid/shows/82?embed=episodes']);

  const onDisk = readRuntime(dir).find(m => m.id === 1000082);
  assert.equal(onDisk.name, 'Game');
  assert.equal(fs.readdirSync(dir).some(f => f.endsWith('.tmp')), false);

  // segunda chamada: já está no catálogo, não vai à rede
  await svc.ingest(1000082);
  assert.equal(svc.calls.length, 1);
});

test('ingestão do TVMaze não colide com o seed: TVMaze 155 é 1000155 e o Batman (155) continua filme', async () => {
  const svc = newService();
  mockFetch(svc, () => tvmazeShow(155, { name: 'Beauty & the Beast' }));
  const media = await svc.ingest(1000155);
  assert.equal(media.id, 1000155);
  assert.equal(svc.findLocal(155).type, 'movie');
  assert.equal(svc.findLocal(155).name.includes('Batman'), true);
});

test('anime no caminho TVMaze: animação japonesa ou gênero Anime; desenho ocidental continua série', async () => {
  const svc = newService();
  mockFetch(svc, () => tvmazeShow(7, { type: 'Animation', language: 'Japanese' }));
  assert.equal((await svc.ingest(1000007)).type, 'anime');
  mockFetch(svc, () => tvmazeShow(8, { type: 'Animation', language: 'English', network: { country: { code: 'US' } } }));
  assert.equal((await svc.ingest(1000008)).type, 'tv');
  mockFetch(svc, () => tvmazeShow(9, { type: 'Scripted', genres: ['Anime', 'Action'] }));
  assert.equal((await svc.ingest(1000009)).type, 'anime');
});

test('404 do TVMaze (corpo de erro ou exceção) não grava nada', async () => {
  const dir = newDir();
  const svc = newService(dir);
  const before = fs.readFileSync(runtimeFile(dir), 'utf-8');
  const count = svc.catalog.length;

  mockFetch(svc, () => ({ name: 'Not Found', message: '', code: 0, status: 404 }));
  await assert.rejects(svc.ingest(1999999), err => err.code === 'NOT_FOUND');

  svc.fetchJson = async () => { throw require('../server/utils/errors').mediaErrors.notFound(); };
  await assert.rejects(svc.ingest(1000123), err => err.code === 'NOT_FOUND' && err.httpStatus === 404);

  mockFetch(svc, () => tvmazeShow(999)); // id diferente do pedido
  await assert.rejects(svc.ingest(1000123), err => err.code === 'NOT_FOUND');

  mockFetch(svc, () => null);
  await assert.rejects(svc.ingest(1000123), err => err.code === 'NOT_FOUND');

  assert.equal(svc.catalog.length, count);
  assert.equal(fs.readFileSync(runtimeFile(dir), 'utf-8'), before);
});

test('429 e 5xx da fonte externa viram erros tipados e não gravam nada', async () => {
  const { mediaErrors } = require('../server/utils/errors');
  const dir = newDir();
  const svc = newService(dir);
  const before = fs.readFileSync(runtimeFile(dir), 'utf-8');

  svc.fetchJson = async () => { throw mediaErrors.rateLimited(); };
  await assert.rejects(svc.ingest(1000050), err => err.code === 'RATE_LIMITED' && err.httpStatus === 429);
  svc.fetchJson = async () => { throw mediaErrors.upstream(); };
  await assert.rejects(svc.ingest(1000050), err => err.code === 'UPSTREAM' && err.httpStatus === 502);

  assert.equal(fs.readFileSync(runtimeFile(dir), 'utf-8'), before);
});

test('ids inválidos ou sem fonte ingerível são rejeitados sem tocar na rede', async () => {
  const svc = newService();
  mockFetch(svc, () => { throw new Error('não deveria chamar a rede'); });

  for (const bad of ['abc', -1, 0, 1.5, NaN, null, undefined, '12abc', 1e21]) {
    await assert.rejects(svc.ingest(bad), err => err.code === 'INVALID_ID', `id ${String(bad)}`);
  }
  await assert.rejects(svc.ingest(999), err => err.code === 'UNSUPPORTED_SOURCE'); // faixa do seed, fora do catálogo
  await assert.rejects(svc.ingest(5000000), err => err.code === 'NOT_FOUND');          // fora de qualquer faixa
  assert.equal(svc.calls.length, 0);
});

test('ingestões simultâneas do mesmo id fazem um único download e uma única obra', async () => {
  const dir = newDir();
  const svc = newService(dir);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  svc.fetchJson = async (url) => { svc.calls.push(url); await gate; return tvmazeShow(33); };

  const all = Promise.all([svc.ingest(1000033), svc.ingest('1000033'), svc.getById(1000033), svc.ingest(1000033)]);
  release();
  const results = await all;

  assert.equal(svc.calls.length, 1);
  assert.ok(results.every(r => r === results[0]));
  assert.equal(svc.catalog.filter(m => m.id === 1000033).length, 1);
  assert.equal(readRuntime(dir).filter(m => m.id === 1000033).length, 1);
  assert.equal(svc.inflight.size, 0);
});

test('ingestões simultâneas de ids diferentes preservam as duas obras', async () => {
  const dir = newDir();
  const svc = newService(dir);
  svc.fetchJson = async (url) => {
    const id = Number(/shows\/(\d+)/.exec(url)[1]);
    await new Promise(r => setTimeout(r, id === 1 ? 20 : 1));
    return tvmazeShow(id);
  };
  await Promise.all([svc.ingest(1000001), svc.ingest(1000002)]);
  const ids = readRuntime(dir).map(m => m.id);
  assert.ok(ids.includes(1000001) && ids.includes(1000002));
});

test('falha ao gravar: a ingestão rejeita e a memória não muda', async () => {
  const dir = newDir();
  const svc = newService(dir);
  mockFetch(svc, () => tvmazeShow(60));
  const count = svc.catalog.length;
  svc.saveCatalog = () => { throw new Error('disco cheio'); };
  await assert.rejects(svc.ingest(1000060), /disco cheio/);
  assert.equal(svc.catalog.length, count);
  assert.equal(svc.inflight.size, 0);
});

test('escrita atômica: sem .tmp sobrando, .bak guarda a versão anterior e falha de rename preserva o original', () => {
  const dir = newDir();
  const file = path.join(dir, 'dados.json');
  writeJsonAtomic(file, { v: 1 });
  writeJsonAtomic(file, { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8')), { v: 1 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['dados.json', 'dados.json.bak']);

  // destino impossível de substituir (é uma pasta): o rename falha, o .tmp é limpo
  const blocked = path.join(dir, 'pasta.json');
  fs.mkdirSync(blocked);
  assert.throws(() => writeJsonAtomic(blocked, { v: 3 }));
  assert.equal(fs.statSync(blocked).isDirectory(), true);
  assert.equal(fs.readdirSync(dir).some(f => f.endsWith('.tmp')), false);
});

test('um arquivo corrompido nunca vira o .bak', () => {
  const dir = newDir();
  const file = path.join(dir, 'dados.json');
  writeJsonAtomic(file, { v: 1 });
  writeJsonAtomic(file, { v: 2 });                 // .bak = v1
  fs.writeFileSync(file, '{quebrado');
  writeJsonAtomic(file, { v: 3 });                 // arquivo atual ilegível: .bak continua v1
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8')), { v: 1 });
});

test('catálogo de runtime corrompido: erro claro, cópia preservada, nada sobrescrito, ingestão bloqueada', async () => {
  const dir = newDir();
  const first = newService(dir);                     // cria o runtime
  assert.ok(first.catalog.length > 0);
  fs.writeFileSync(runtimeFile(dir), '{"id": 1, ');  // corrompe de propósito (sem .bak: nunca houve segunda gravação)
  const corrupted = fs.readFileSync(runtimeFile(dir), 'utf-8');

  const svc = newService(dir);
  assert.ok(svc.writeBlockedBy instanceof DataCorruptionError);
  assert.equal(svc.catalog.length > 0, true, 'leitura continua servindo o seed');
  mockFetch(svc, () => tvmazeShow(70));
  await assert.rejects(svc.ingest(1000070), err => err.code === 'CATALOG_UNAVAILABLE' && err.httpStatus === 503);
  assert.equal(svc.calls.length, 0);

  assert.equal(fs.readFileSync(runtimeFile(dir), 'utf-8'), corrupted, 'arquivo corrompido não foi tocado');
  assert.equal(fs.readdirSync(dir).some(f => f.startsWith('mediaCatalog.runtime.json.corrupt-')), true);
});

test('catálogo corrompido com .bak válido é recuperado sem perder obras ingeridas', async () => {
  const dir = newDir();
  const a = newService(dir);
  mockFetch(a, id => tvmazeShow(80));
  await a.ingest(1000080);
  mockFetch(a, () => tvmazeShow(81));
  await a.ingest(1000081);                           // agora existe .bak (com a obra 80)
  fs.writeFileSync(runtimeFile(dir), 'lixo');

  const b = newService(dir);
  assert.equal(b.writeBlockedBy, null);
  assert.ok(b.findLocal(1000080), 'obra ingerida sobreviveu via .bak');
});

test('itens inválidos no runtime (ex.: obra lixo sem id) são descartados na carga', () => {
  const dir = newDir();
  newService(dir);
  const items = readRuntime(dir);
  items.push({ name: 'Not Found', status: 404 }, { id: 'x', name: 'texto' }, null);
  writeJsonAtomic(runtimeFile(dir), items);
  const svc = newService(dir);
  assert.ok(svc.catalog.every(MediaService.isValidItem));
  assert.equal(readRuntime(dir).length, svc.catalog.length);
});

test('busca externa usa cache com TTL, mapeia ids para a faixa do TVMaze e não cacheia falhas', async () => {
  const svc = newService();
  mockFetch(svc, () => [{ show: tvmazeShow(500, { name: 'Zzzxqv Série' }) }, { show: { id: 2000000, name: 'id fora da faixa' } }, { show: null }]);

  const first = await svc.search('zzzxqv', 'all');
  assert.equal(first.length, 1);
  assert.equal(first[0].id, 1000500);
  assert.equal(first[0].isExternal, true);
  await svc.search('zzzxqv', 'all');
  assert.equal(svc.calls.length, 1, 'segunda busca saiu do cache');

  svc.cacheTtlMs = 0;
  await svc.search('zzzxqv', 'all');
  assert.equal(svc.calls.length, 2, 'cache expirado volta à rede');

  const failing = newService();
  failing.fetchJson = async () => { failing.calls.push(1); throw new Error('rede caiu'); };
  // Sem nenhum resultado e com a fonte caída: erro tipado (a interface mostra a mensagem), não "nenhuma obra".
  await assert.rejects(failing.search('abcdef', 'all'), err => err.code === 'UPSTREAM' && err.httpStatus === 502);
  await assert.rejects(failing.search('abcdef', 'all'), err => err.code === 'UPSTREAM');
  assert.equal(failing.calls.length, 2, 'falha não é cacheada');
});

test('fetchJson real: 404, 5xx, 429 com 1 nova tentativa, JSON inválido', async (t) => {
  const responses = [];
  const server = http.createServer((req, res) => {
    const next = responses.shift() || { status: 200, body: '{}' };
    res.writeHead(next.status, next.headers || { 'Content-Type': 'application/json' });
    res.end(next.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const sleeps = [];
  const svc = newService(newDir(), { tvmazeBase: base, sleep: async ms => { sleeps.push(ms); } });

  responses.push({ status: 404, body: '{"name":"Not Found","status":404}' });
  await assert.rejects(svc.fetchJson(`${base}/x`), err => err.code === 'NOT_FOUND');

  responses.push({ status: 503, body: 'indisponivel' });
  await assert.rejects(svc.fetchJson(`${base}/x`), err => err.code === 'UPSTREAM');

  responses.push({ status: 429, body: '{}', headers: { 'Retry-After': '2' } }, { status: 200, body: '{"ok":true}' });
  assert.deepEqual(await svc.fetchJson(`${base}/x`), { ok: true });
  assert.deepEqual(sleeps, [2000]);

  responses.push({ status: 429, body: '{}' }, { status: 429, body: '{}' });
  await assert.rejects(svc.fetchJson(`${base}/x`), err => err.code === 'RATE_LIMITED');
  assert.equal(sleeps.length, 2, 'uma única nova tentativa');

  responses.push({ status: 200, body: '<html>não é json' });
  await assert.rejects(svc.fetchJson(`${base}/x`), err => err.code === 'UPSTREAM');
});

test('readJson: arquivo ausente é null; BOM é aceito', () => {
  const dir = newDir();
  assert.equal(readJson(path.join(dir, 'nao-existe.json')), null);
  const f = path.join(dir, 'bom.json');
  fs.writeFileSync(f, '﻿[1,2]');
  assert.deepEqual(readJson(f).data, [1, 2]);
});
