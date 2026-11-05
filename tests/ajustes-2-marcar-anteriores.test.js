'use strict';
// Ajustes 2 (D-AV2-3): marcar o episódio N como assistido marca também todos os anteriores já lançados.
// Cobre a regra pura (episodesToCascade), o estado real do app (markWatchedUpTo / undoMarkWatched) em aparelhos simulados (vm),
// a sincronização entre dois aparelhos, a validação do resultado e o desempenho com uma obra de 1.200 episódios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const WS = require('../public/js/utils/watchStatus');
const LM = require('../public/js/utils/libraryMerge');
const { validateBackup } = require('../public/js/utils/backupValidator');
const { LibraryModel } = require('../server/models/LibraryModel');

const ROOT = path.join(__dirname, '..', 'public', 'js');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 4));

const pad = n => String(n).padStart(2, '0');
const dayOffset = days => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const PAST = '2020-01-15';
const FUTURE = dayOffset(30);

// season(n, total, opts): episódios 1..total; `future` = números com data futura, `noDate` = números sem data.
const season = (n, total, { future = [], noDate = [] } = {}) => ({
  season_number: n,
  episodes: Array.from({ length: total }, (_, i) => {
    const ep = { episode_number: i + 1, runtime: 24 };
    if (!noDate.includes(i + 1)) ep.air_date = future.includes(i + 1) ? FUTURE : PAST;
    return ep;
  })
});
const show = (seasons, type = 'tv', id = 100) => ({ id, type, name: 'Obra de teste', genres: [], status: 'Returning Series', seasons });
const watchedSet = (...pairs) => {
  const set = new Set(pairs.map(([s, e]) => `${s}:${e}`));
  return (s, e) => set.has(`${s}:${e}`);
};
const TODAY = dayOffset(0);
const keys = list => list.map(x => `${x.season}x${x.episode}`);

// ---------------------------------------------------------------- regra pura

test('episodesToCascade: primeiro episódio da obra não marca nada além dele', () => {
  const media = show([season(1, 5), season(2, 5)]);
  assert.deepEqual(WS.episodesToCascade(media, 1, 1, watchedSet(), TODAY), []);
});

test('episodesToCascade: último episódio marca todos os anteriores (mesma temporada), sem o próprio clicado', () => {
  const media = show([season(1, 5)]);
  assert.deepEqual(keys(WS.episodesToCascade(media, 1, 5, watchedSet(), TODAY)), ['1x1', '1x2', '1x3', '1x4']);
  assert.deepEqual(keys(WS.episodesToCascade(media, 1, 3, watchedSet(), TODAY)), ['1x1', '1x2']);
});

test('episodesToCascade: várias temporadas — temporadas anteriores inteiras e os anteriores da própria; as seguintes não', () => {
  const media = show([season(1, 3), season(2, 3), season(3, 3)], 'anime');
  const got = keys(WS.episodesToCascade(media, 2, 2, watchedSet(), TODAY));
  assert.deepEqual(got, ['1x1', '1x2', '1x3', '2x1']);
  // primeiro da temporada 2: só a temporada 1 inteira
  assert.deepEqual(keys(WS.episodesToCascade(media, 2, 1, watchedSet(), TODAY)), ['1x1', '1x2', '1x3']);
  // aceita números como texto (vêm de data-attributes)
  assert.deepEqual(keys(WS.episodesToCascade(media, '2', '2', watchedSet(), TODAY)), ['1x1', '1x2', '1x3', '2x1']);
});

test('episodesToCascade: temporada 0 (especiais) só entra se for a do episódio clicado', () => {
  const media = show([season(0, 3), season(1, 3), season(2, 3)]);
  assert.deepEqual(keys(WS.episodesToCascade(media, 2, 2, watchedSet(), TODAY)), ['1x1', '1x2', '1x3', '2x1'], 'especiais fora');
  assert.deepEqual(
    keys(WS.episodesToCascade(media, 0, 3, watchedSet(), TODAY)),
    ['0x1', '0x2'],
    'clicou num especial: só os especiais anteriores'
  );
  assert.deepEqual(keys(WS.episodesToCascade(media, 1, 1, watchedSet(), TODAY)), [], 'ep 1 da T1 não puxa especiais');
});

test('episodesToCascade: já assistidos ficam de fora (nada a mudar neles)', () => {
  const media = show([season(1, 5)]);
  const got = WS.episodesToCascade(media, 1, 5, watchedSet([1, 2], [1, 4]), TODAY);
  assert.deepEqual(keys(got), ['1x1', '1x3']);
});

test('episodesToCascade: episódios com data futura não entram; sem data conta como lançado; o de hoje conta como lançado', () => {
  const media = show([season(1, 6, { future: [2, 3], noDate: [4] })]);
  assert.deepEqual(keys(WS.episodesToCascade(media, 1, 6, watchedSet(), TODAY)), ['1x1', '1x4', '1x5']);
  const hoje = show([
    {
      season_number: 1,
      episodes: [
        { episode_number: 1, air_date: TODAY },
        { episode_number: 2, air_date: TODAY }
      ]
    }
  ]);
  assert.deepEqual(keys(WS.episodesToCascade(hoje, 1, 2, watchedSet(), TODAY)), ['1x1']);
  // data com horário (ISO completo) usa só o dia
  const iso = show([
    { season_number: 1, episodes: [{ episode_number: 1, air_date: `${FUTURE}T10:00:00Z` }, { episode_number: 2 }, { episode_number: 3 }] }
  ]);
  assert.deepEqual(keys(WS.episodesToCascade(iso, 1, 3, watchedSet(), TODAY)), ['1x2']);
});

test('episodesToCascade: o episódio futuro clicado não é devolvido (quem chama o marca), mas os lançados antes dele entram', () => {
  const media = show([season(1, 4, { future: [3, 4] })]);
  assert.deepEqual(keys(WS.episodesToCascade(media, 1, 4, watchedSet(), TODAY)), ['1x1', '1x2']);
});

test('episodesToCascade: filme, obra nula ou sem temporadas devolvem []', () => {
  assert.deepEqual(WS.episodesToCascade({ id: 1, type: 'movie' }, 1, 1, watchedSet(), TODAY), []);
  assert.deepEqual(WS.episodesToCascade(null, 1, 3, watchedSet(), TODAY), []);
  assert.deepEqual(WS.episodesToCascade({ id: 1, type: 'tv' }, 1, 3, watchedSet(), TODAY), []);
  assert.deepEqual(WS.episodesToCascade({ id: 1, type: 'tv', seasons: [] }, 1, 3, watchedSet(), TODAY), []);
});

// ---------------------------------------------------------------- aparelho simulado (frontend real em vm)

function tmpModel() {
  return new LibraryModel(fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-aj2-lib-')));
}

function makeDevice(model, catalog) {
  const store = new Map();
  const el = () => ({
    textContent: '',
    innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    style: {},
    addEventListener() {}
  });
  const elements = new Map();
  const device = { online: true, counts: { save: 0, persist: 0 } };
  const ctx = {
    console,
    JSON,
    Promise,
    Math,
    Object,
    Array,
    Number,
    String,
    Map,
    Set,
    Error,
    TypeError,
    SyntaxError,
    Date,
    performance,
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: k => void store.delete(k)
    },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    document: {
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, el());
        return elements.get(id);
      },
      querySelector: () => null,
      querySelectorAll: () => []
    },
    addEventListener() {},
    dispatchEvent() {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const userFromToken = () => {
    const tok = store.get('showvault_auth_token');
    return tok ? tok.replace(/^tok_/, '') : null;
  };
  const strip = ({ schemaVersion, updatedAt, ...data }) => data;
  ctx.apiClient = {
    async getLibrary() {
      if (!device.online) throw new TypeError('fetch failed');
      return { data: strip(model.get(userFromToken())), updatedAt: null };
    },
    async putLibrary(data) {
      if (!device.online) throw new TypeError('fetch failed');
      const saved = model.save(userFromToken(), JSON.parse(JSON.stringify(data)), { stateVersion: ctx.STATE_VERSION });
      return { updatedAt: saved.updatedAt, data: strip(saved) };
    },
    async deleteLibrary() {
      return {};
    }
  };
  store.set(
    'showvault_state_mvc_v1',
    JSON.stringify({ trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: LM.emptyTombstones(), resetAt: '' })
  );
  const files = [
    'utils/dom.js',
    'utils/emotions.js',
    'utils/markdown.js',
    'utils/mediaDisplay.js',
    'utils/viewKit.js',
    'utils/libraryMerge.js',
    'utils/rating.js',
    'utils/genreStats.js',
    'utils/watchStatus.js',
    'utils/calendar.js',
    'utils/backupValidator.js',
    'utils/migrations.js',
    'models/state.js',
    'services/syncService.js'
  ];
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf-8'), ctx, { filename: f });

  device.window = ctx;
  device.state = ctx.appState;
  device.sync = ctx.syncService;
  device.store = store;
  device.state.cacheMediaList(catalog);
  // conta quantas gravações o estado faz
  for (const name of ['save', 'persist']) {
    const original = device.state[name].bind(device.state);
    device.state[name] = (...args) => {
      device.counts[name]++;
      return original(...args);
    };
  }
  device.resetCounts = () => {
    device.counts.save = 0;
    device.counts.persist = 0;
  };
  device.login = async userId => {
    store.set('showvault_auth_token', `tok_${userId}`);
    await ctx.syncService.pullAndMerge({ id: userId, name: userId });
  };
  device.pull = userId => ctx.syncService.pullAndMerge({ id: userId, name: userId });
  device.watchedKeys = () => Object.keys(device.state.data.watchedEpisodes).sort();
  return device;
}

// Obra 100: T0 (2 especiais), T1 (4 eps), T2 (4 eps, o 4 ainda não lançado). Obra 200: série curta, tudo lançado.
const catalogA = () => [
  show([season(0, 2), season(1, 4), season(2, 4, { future: [4] })], 'tv', 100),
  show([season(1, 3), season(2, 3)], 'anime', 200)
];
const watchedKeys = (dev, showId) =>
  Object.keys(dev.state.data.watchedEpisodes)
    .filter(k => dev.state.data.watchedEpisodes[k].watched && k.startsWith(`${showId}_s`))
    .sort();
const ep = (dev, showId, s, e) => dev.state.data.watchedEpisodes[dev.window.ViewKit.makeKey(showId, s, e)];

test('markWatchedUpTo: marca o clicado e os anteriores, grava UMA vez e devolve a contagem', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  dev.resetCounts();
  const { count, snapshot } = dev.state.markWatchedUpTo(200, 2, 2);
  assert.equal(count, 5, 'T1 inteira (3) + T2 ep 1 + o clicado (ep 2)');
  assert.equal(snapshot.length, 5);
  assert.equal(dev.counts.save, 1, 'save() uma única vez');
  assert.equal(dev.counts.persist, 1, 'persistência única (localStorage)');
  for (const [s, e] of [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 2]
  ])
    assert.equal(dev.state.isWatched(200, s, e), true, `${s}x${e}`);
  assert.equal(dev.state.isWatched(200, 2, 3), false, 'o seguinte não');
});

test('markWatchedUpTo: contagem correta (T1 3 eps + ep 1 e 2 da T2 = 5)', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  assert.equal(dev.state.markWatchedUpTo(200, 2, 2).count, 5);
});

test('markWatchedUpTo: preserva watchedAt e rewatchCount dos já marcados e só conta os novos', async () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(100);
  dev.state.toggleWatched(100, 1, 2);
  const antes = plain(ep(dev, 100, 1, 2));
  await tick();
  dev.resetCounts();
  const { count } = dev.state.markWatchedUpTo(100, 1, 4);
  assert.equal(count, 3, 'ep 1, 3 e 4 (o 2 já estava)');
  assert.deepEqual(plain(ep(dev, 100, 1, 2)), antes, 'o já assistido ficou idêntico (data incluída)');
  assert.equal(dev.counts.save, 1);
  // clicar de novo no que já está tudo marcado não grava nada
  dev.resetCounts();
  assert.equal(dev.state.markWatchedUpTo(100, 1, 4).count, 0);
  assert.equal(dev.counts.save, 0);
});

test('markWatchedUpTo: temporada 0 e episódios futuros não entram; o clicado entra mesmo sendo especial', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(100);
  dev.state.markWatchedUpTo(100, 2, 3);
  assert.equal(dev.state.isWatched(100, 0, 1), false);
  assert.equal(dev.state.isWatched(100, 0, 2), false);
  for (const e of [1, 2, 3, 4]) assert.equal(dev.state.isWatched(100, 1, e), true);
  assert.equal(dev.state.isWatched(100, 2, 4), false, 'futuro fora');
  // clicar no próprio episódio futuro marca só ele (e os lançados antes)
  dev.state.markWatchedUpTo(100, 2, 4);
  assert.equal(dev.state.isWatched(100, 2, 4), true);
  // especial clicado
  const dev2 = makeDevice(tmpModel(), catalogA());
  dev2.state.addShow(100);
  assert.equal(dev2.state.markWatchedUpTo(100, 0, 2).count, 2);
  assert.equal(dev2.state.isWatched(100, 1, 1), false);
});

test('status: Quero ver vira Assistindo; só vira Finalizado quando TUDO foi assistido; futuro impede Finalizado', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  assert.equal(dev.state.getTracked(200).status, 'plan_to_watch');
  dev.state.markWatchedUpTo(200, 2, 2);
  assert.equal(dev.state.getTracked(200).status, 'watching');
  dev.state.markWatchedUpTo(200, 2, 3);
  assert.equal(dev.state.getTracked(200).status, 'completed', 'tudo assistido => Finalizado');
  // desmarcar um episódio tira de Finalizado
  dev.state.toggleWatched(200, 1, 1);
  assert.equal(dev.state.getTracked(200).status, 'watching');

  // obra com episódio futuro e especiais não assistidos: marcar o último lançado não finaliza
  dev.state.addShow(100);
  dev.state.markWatchedUpTo(100, 2, 3);
  assert.equal(dev.state.getTracked(100).status, 'watching');
  assert.equal(dev.state.getProgress(100).complete, false);
  // mesmo sem especiais, com o futuro pendente continua Assistindo
  const solo = makeDevice(tmpModel(), [show([season(1, 3, { future: [3] })], 'tv', 300)]);
  solo.state.addShow(300);
  solo.state.markWatchedUpTo(300, 1, 2);
  assert.equal(solo.state.getTracked(300).status, 'watching');
});

test('status: Pausado e Desisti voltam a Assistindo ao marcar em lote', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  dev.state.getTracked(200).status = 'paused';
  dev.state.markWatchedUpTo(200, 1, 2);
  assert.equal(dev.state.getTracked(200).status, 'watching');
});

test('undoMarkWatched: restaura episódios, status e deixa marcas de exclusão coerentes (mais novas que a marcação)', async () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  dev.state.toggleWatched(200, 1, 2); // marca...
  dev.state.toggleWatched(200, 1, 2); // ...e desmarca: sobra uma marca de exclusão antiga do 1x2
  const tombAntiga = dev.state.data.tombstones.watched[dev.window.ViewKit.makeKey(200, 1, 2)];
  assert.ok(tombAntiga);
  const antes = plain(dev.state.data.watchedEpisodes);
  const statusAntes = dev.state.getTracked(200).status;
  await tick();

  const { count, snapshot } = dev.state.markWatchedUpTo(200, 2, 1);
  assert.equal(count, 4);
  const stamps = {};
  for (const item of snapshot) stamps[item.key] = dev.state.data.watchedEpisodes[item.key].updatedAt;
  assert.equal(dev.state.data.tombstones.watched[dev.window.ViewKit.makeKey(200, 1, 2)], undefined, 'marcar limpa a marca de exclusão');
  await tick();

  dev.resetCounts();
  assert.equal(dev.state.undoMarkWatched(200, snapshot), 4);
  assert.equal(dev.counts.save, 1, 'desfazer também grava uma vez só');
  assert.deepEqual(plain(dev.state.data.watchedEpisodes), antes, 'episódios exatamente como antes');
  assert.equal(dev.state.getTracked(200).status, statusAntes, 'voltou ao status anterior');
  for (const item of snapshot) {
    const tomb = dev.state.data.tombstones.watched[item.key];
    assert.ok(tomb, `marca de exclusão de ${item.key}`);
    assert.ok(Date.parse(tomb) > Date.parse(stamps[item.key]), 'a exclusão é mais nova que a marcação desfeita');
  }
  assert.ok(Date.parse(dev.state.data.tombstones.watched[dev.window.ViewKit.makeKey(200, 1, 2)]) > Date.parse(tombAntiga));
});

test('undoMarkWatched: não desmarca o que já estava assistido antes do lote e aceita snapshot vazio/inválido', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  dev.state.toggleWatched(200, 1, 1);
  const feito = plain(ep(dev, 200, 1, 1));
  const { snapshot } = dev.state.markWatchedUpTo(200, 1, 3);
  assert.equal(snapshot.length, 2);
  dev.state.undoMarkWatched(200, snapshot);
  assert.deepEqual(plain(ep(dev, 200, 1, 1)), feito);
  assert.equal(dev.state.isWatched(200, 1, 2), false);
  assert.equal(dev.state.undoMarkWatched(200, []), 0);
  assert.equal(dev.state.undoMarkWatched(200, null), 0);
});

test('undo: se o usuário desfaz uma obra que ficou Finalizada, ela volta a Assistindo', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  dev.state.markWatchedUpTo(200, 1, 1);
  const { snapshot } = dev.state.markWatchedUpTo(200, 2, 3);
  assert.equal(dev.state.getTracked(200).status, 'completed');
  dev.state.undoMarkWatched(200, snapshot);
  assert.equal(dev.state.getTracked(200).status, 'watching');
  assert.equal(dev.state.getProgress(200).watched, 1);
});

test('desmarcar um episódio mexe só nele (e não dispara cascata)', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  dev.state.addShow(200);
  dev.state.markWatchedUpTo(200, 2, 3);
  const antes = watchedKeys(dev, 200);
  assert.equal(antes.length, 6);
  dev.resetCounts();
  assert.equal(dev.state.toggleWatched(200, 1, 2), false);
  const depois = watchedKeys(dev, 200);
  assert.equal(depois.length, 5);
  assert.deepEqual(
    antes.filter(k => !depois.includes(k)),
    [dev.window.ViewKit.makeKey(200, 1, 2)]
  );
  assert.equal(dev.counts.save, 1);
});

test('filme: markWatchedUpTo não inventa nada (marca só o filme pelo caminho antigo)', () => {
  const dev = makeDevice(tmpModel(), [{ id: 500, type: 'movie', name: 'Filme', genres: [], runtime: 90 }]);
  dev.state.addShow(500);
  assert.equal(dev.state.toggleWatched(500, null, null), true);
  assert.equal(dev.state.getTracked(500).status, 'completed');
});

// ---------------------------------------------------------------- sincronização entre aparelhos

test('sincronização: marcação em lote chega ao outro aparelho sem perder nem duplicar; desfazer também se propaga', async () => {
  const model = tmpModel();
  const a = makeDevice(model, catalogA());
  const b = makeDevice(model, catalogA());
  await a.login('usr_lote');
  await b.login('usr_lote');
  a.state.addShow(200);
  await tick();
  await a.sync.push();
  await b.pull('usr_lote');
  assert.deepEqual(plain(b.state.data.trackedShows.map(t => t.showId)), [200]);

  await tick();
  const { count, snapshot } = a.state.markWatchedUpTo(200, 2, 2);
  assert.equal(count, 5);
  await a.sync.push();
  await b.pull('usr_lote');
  assert.equal(b.watchedKeys().length, 5, 'B recebeu as 5, sem duplicar');
  assert.deepEqual(b.watchedKeys(), a.watchedKeys());
  assert.equal(b.state.getTracked(200).status, 'watching');
  assert.equal(model.get('usr_lote').trackedShows.length, 1);
  assert.equal(Object.keys(model.get('usr_lote').watchedEpisodes).length, 5);

  // A desfaz: B enxerga a remoção (as marcas de exclusão vencem as marcações)
  await tick();
  a.state.undoMarkWatched(200, snapshot);
  await a.sync.push();
  await b.pull('usr_lote');
  assert.deepEqual(b.watchedKeys(), []);
  assert.deepEqual(Object.keys(model.get('usr_lote').watchedEpisodes), []);
  assert.equal(b.state.getTracked(200).status, 'plan_to_watch');
});

test('sincronização: lote em A e marcação avulsa em B ao mesmo tempo viram a união (nada se perde)', async () => {
  const model = tmpModel();
  const a = makeDevice(model, catalogA());
  const b = makeDevice(model, catalogA());
  await a.login('usr_uniao');
  await b.login('usr_uniao');
  a.state.addShow(200);
  await tick();
  await a.sync.push();
  await b.pull('usr_uniao');

  await tick();
  a.state.markWatchedUpTo(200, 1, 3); // 1x1..1x3
  b.state.toggleWatched(200, 2, 3); // 2x3 sozinho, B ainda não sabe do lote
  await tick();
  await a.sync.push();
  await b.sync.push(); // o servidor mescla
  await a.pull('usr_uniao');
  await b.pull('usr_uniao');
  const esperado = [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 3]
  ]
    .map(([s, e]) => a.window.ViewKit.makeKey(200, s, e))
    .sort();
  assert.deepEqual(a.watchedKeys(), esperado);
  assert.deepEqual(b.watchedKeys(), esperado);
  assert.equal(Object.keys(model.get('usr_uniao').watchedEpisodes).length, 4);
});

test('sincronização: desmarcar em B um episódio que A marcou em lote vence quando é mais novo', async () => {
  const model = tmpModel();
  const a = makeDevice(model, catalogA());
  const b = makeDevice(model, catalogA());
  await a.login('usr_novo');
  await b.login('usr_novo');
  a.state.addShow(200);
  await tick();
  await a.sync.push();
  await b.pull('usr_novo');
  await tick();
  a.state.markWatchedUpTo(200, 1, 3);
  await a.sync.push();
  await b.pull('usr_novo');
  await tick();
  b.state.toggleWatched(200, 1, 2); // desmarca só o 1x2
  await b.sync.push();
  await a.pull('usr_novo');
  assert.deepEqual(a.watchedKeys(), b.watchedKeys());
  assert.equal(a.watchedKeys().length, 2);
  assert.equal(a.state.isWatched(200, 1, 2), false);
});

test('validação: o estado depois do lote e depois do desfazer passa em validateBackup e LibraryModel.validate sem perder marcações', () => {
  const dev = makeDevice(tmpModel(), catalogA());
  const model = tmpModel();
  dev.state.addShow(200);
  const { snapshot } = dev.state.markWatchedUpTo(200, 2, 2);
  const data = plain(dev.state.data);

  const viaBackup = validateBackup(data);
  const viaServer = model.validate(data);
  assert.equal(Object.keys(viaBackup.watchedEpisodes).length, 5);
  assert.equal(Object.keys(viaServer.watchedEpisodes).length, 5);
  assert.deepEqual(plain(viaBackup.watchedEpisodes), plain(viaServer.watchedEpisodes));
  assert.deepEqual(plain(viaBackup.watchedEpisodes), data.watchedEpisodes, 'nada foi descartado nem alterado');

  dev.state.undoMarkWatched(200, snapshot);
  const depois = plain(dev.state.data);
  const v1 = validateBackup(depois);
  const v2 = model.validate(depois);
  assert.deepEqual(v1.watchedEpisodes, {});
  assert.deepEqual(v2.watchedEpisodes, {});
  assert.equal(Object.keys(v1.tombstones.watched).length, 5, 'marcas de exclusão preservadas');
  assert.equal(Object.keys(v2.tombstones.watched).length, 5);
});

// ---------------------------------------------------------------- desempenho

test('desempenho: obra falsa de 1.200 episódios marcada no último (uma temporada e várias) em bem menos de 1 s', () => {
  // (a) uma temporada de 1.200
  const big = show([season(1, 1200)], 'anime', 900);
  const dev = makeDevice(tmpModel(), [big]);
  dev.state.addShow(900);
  dev.resetCounts();
  let t0 = performance.now();
  const r = dev.state.markWatchedUpTo(900, 1, 1200);
  const ms1 = performance.now() - t0;
  assert.equal(r.count, 1200);
  assert.equal(dev.counts.save, 1);
  assert.equal(dev.state.getProgress(900).complete, true);
  assert.equal(dev.state.getTracked(900).status, 'completed');

  // desfazer também é rápido
  t0 = performance.now();
  dev.state.undoMarkWatched(900, r.snapshot);
  const msUndo = performance.now() - t0;
  assert.equal(Object.keys(dev.state.data.watchedEpisodes).length, 0);

  // (b) 12 temporadas de 100 episódios, com 300 já marcados espalhados e o resto da biblioteca com outras obras
  const seasons = Array.from({ length: 12 }, (_, i) => season(i + 1, 100));
  const dev2 = makeDevice(tmpModel(), [show(seasons, 'tv', 901), ...catalogA()]);
  dev2.state.addShow(901);
  for (let i = 1; i <= 300; i += 1) dev2.state.markWatchedUpTo(901, 1, i % 100 || 100);
  t0 = performance.now();
  const r2 = dev2.state.markWatchedUpTo(901, 12, 100);
  const ms2 = performance.now() - t0;
  assert.equal(dev2.state.getProgress(901).watched, 1200);
  assert.ok(r2.count >= 1000);

  console.log(
    `[desempenho] 1200 eps numa temporada: ${ms1.toFixed(1)} ms; desfazer: ${msUndo.toFixed(1)} ms; 12x100 eps: ${ms2.toFixed(1)} ms`
  );
  assert.ok(ms1 < 1000, `marcar 1200 levou ${ms1.toFixed(0)} ms`);
  assert.ok(msUndo < 1000, `desfazer 1200 levou ${msUndo.toFixed(0)} ms`);
  assert.ok(ms2 < 1000, `marcar 12x100 levou ${ms2.toFixed(0)} ms`);
});
