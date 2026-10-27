// Testes S03 (integração): rotas da biblioteca, LibraryModel com marcas de exclusão e o frontend real (state.js + syncService.js
// + views) rodando em "aparelhos" simulados (vm), ligados ao LibraryModel de verdade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// Nunca escrever em server/data real: define antes de carregar os módulos que leem config.DATA_DIR.
process.env.SHOWVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s03-'));
process.on('exit', () => fs.rmSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true, force: true }));

const { LibraryModel } = require('../server/models/LibraryModel');
const { issueToken } = require('../server/middleware/auth');
const LM = require('../public/js/utils/libraryMerge');
const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

const ROOT = path.join(__dirname, '..', 'public', 'js');
const tmpModel = () => new LibraryModel(fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s03-lib-')));
const empty = () => ({ trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: LM.emptyTombstones(), resetAt: '' });

// ---------------------------------------------------------------- LibraryModel

test('LibraryModel: PUT de cliente da S03 MESCLA com o servidor (aparelho desatualizado não apaga o trabalho do outro)', () => {
  const lib = tmpModel();
  const t0 = ago(3);
  const t1 = ago(2);
  // aparelho A: tem as obras 1 e 2
  lib.save('usr_m1', { ...empty(), trackedShows: [{ showId: 1, status: 'watching', addedAt: t0, updatedAt: t0 }, { showId: 2, status: 'watching', addedAt: t0, updatedAt: t0 }] });
  // aparelho B (desatualizado) só conhece a 1 e adiciona a 3
  const fromB = lib.save('usr_m1', { ...empty(), trackedShows: [{ showId: 1, status: 'watching', addedAt: t0, updatedAt: t0 }, { showId: 3, status: 'plan_to_watch', addedAt: t1, updatedAt: t1 }] });
  assert.deepEqual(fromB.trackedShows.map(s => s.showId).sort(), [1, 2, 3]);
  assert.deepEqual(lib.get('usr_m1').trackedShows.map(s => s.showId).sort(), [1, 2, 3]);
});

test('LibraryModel: marca de exclusão propaga a remoção; o servidor guarda a marca', () => {
  const lib = tmpModel();
  const t0 = ago(3);
  const t1 = ago(2);
  lib.save('usr_m2', { ...empty(), trackedShows: [{ showId: 1, status: 'watching', addedAt: t0, updatedAt: t0 }], watchedEpisodes: { '1_s1_e1': { watched: true, watchedAt: t0, updatedAt: t0, rewatchCount: 1 } } });
  const afterRemoval = lib.save('usr_m2', { ...empty(), tombstones: { shows: { 1: t1 }, watched: { '1_s1_e1': t1 }, notes: {} } });
  assert.deepEqual(afterRemoval.trackedShows, []);
  assert.deepEqual(afterRemoval.watchedEpisodes, {});
  assert.equal(afterRemoval.tombstones.shows['1'], t1);

  // um aparelho que ainda tinha a obra (item mais velho que a marca) não a ressuscita
  const stale = lib.save('usr_m2', { ...empty(), trackedShows: [{ showId: 1, status: 'watching', addedAt: t0, updatedAt: t0 }] });
  assert.deepEqual(stale.trackedShows, []);
  assert.deepEqual(lib.get('usr_m2').trackedShows, []);
});

test('LibraryModel: cliente antigo (sem tombstones) continua com snapshot completo (last-write-wins)', () => {
  const lib = tmpModel();
  lib.save('usr_m3', { trackedShows: [{ showId: 1, status: 'watching', addedAt: 'x' }], watchedEpisodes: {}, episodeNotes: {} });
  const second = lib.save('usr_m3', { trackedShows: [{ showId: 2, status: 'watching', addedAt: 'y' }], watchedEpisodes: {}, episodeNotes: {} });
  assert.deepEqual(second.trackedShows.map(s => s.showId), [2]);
});

test('LibraryModel: biblioteca gravada antes da S03 volta com tombstones/resetAt vazios; clear() zera com resetAt', () => {
  const lib = tmpModel();
  fs.mkdirSync(lib.dir, { recursive: true });
  fs.writeFileSync(path.join(lib.dir, 'usr_old.json'), JSON.stringify({
    schemaVersion: 2, updatedAt: '2026-10-26T00:00:00.000Z',
    trackedShows: [{ showId: 9, status: 'watching', addedAt: 'x' }], watchedEpisodes: {}, episodeNotes: {}
  }));
  const got = lib.get('usr_old');
  assert.deepEqual(got.tombstones, LM.emptyTombstones());
  assert.equal(got.resetAt, '');
  assert.equal(got.trackedShows.length, 1);

  const cleared = lib.clear('usr_old');
  assert.deepEqual(cleared.trackedShows, []);
  assert.ok(Date.parse(cleared.resetAt) > 0);
  assert.equal(lib.get('usr_old').resetAt, cleared.resetAt);
  // depois do reset, um aparelho antigo com dados anteriores não traz nada de volta
  const back = lib.save('usr_old', { ...empty(), trackedShows: [{ showId: 9, status: 'watching', addedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }] });
  assert.deepEqual(back.trackedShows, []);
});

test('LibraryModel: marcas inválidas são recusadas', () => {
  const lib = tmpModel();
  assert.throws(() => lib.save('usr_m4', { ...empty(), tombstones: { shows: { abc: ago(3) } } }), /inválid/i);
  assert.throws(() => lib.save('usr_m4', { ...empty(), tombstones: 'x' }), /inválid/i);
});

// ---------------------------------------------------------------- Rotas

test('API: PUT mescla e devolve a biblioteca mesclada; DELETE zera; sem login = 401', async (t) => {
  const app = require('../server/app');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/user/library`;
  // S04: as rotas exigem conta existente (requireActiveUser): cadastra um usuário de teste no diretório temporário
  const user = await require('../server/models/UserModel').create({ name: 'Teste S03', email: 's03@exemplo.test', password: 'senha-de-teste-s03' });
  const auth = { Authorization: `Bearer ${issueToken(user)}`, 'Content-Type': 'application/json' };
  const t0 = ago(3);
  const put = (data) => fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ data, stateVersion: 2 }) });

  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(base, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);

  const first = await put({ ...empty(), trackedShows: [{ showId: 1, status: 'watching', addedAt: t0, updatedAt: t0 }] });
  assert.equal(first.status, 200);
  const second = await (await put({ ...empty(), trackedShows: [{ showId: 2, status: 'watching', addedAt: t0, updatedAt: t0 }] })).json();
  assert.ok(second.updatedAt);
  assert.deepEqual(second.data.trackedShows.map(s => s.showId).sort(), [1, 2], 'a resposta já traz o resultado do merge');
  assert.equal('schemaVersion' in second.data, false);

  assert.equal((await put({ trackedShows: 'x' })).status, 400);
  assert.equal((await put({ ...empty(), tombstones: { shows: { x: t0 } } })).status, 400);

  const got = await (await fetch(base, { headers: auth })).json();
  assert.deepEqual(got.data.trackedShows.map(s => s.showId).sort(), [1, 2]);
  assert.deepEqual(got.data.tombstones, LM.emptyTombstones());

  const del = await fetch(base, { method: 'DELETE', headers: auth });
  assert.equal(del.status, 200);
  const { resetAt } = await del.json();
  assert.ok(Date.parse(resetAt) > 0);
  const after = await (await fetch(base, { headers: auth })).json();
  assert.deepEqual(after.data.trackedShows, []);
  assert.equal(after.data.resetAt, resetAt);
});

// ---------------------------------------------------------------- Frontend real em aparelhos simulados

// Os horários são do relógio real (o servidor usa o dele); `tick` garante que ações em sequência não caiam no mesmo milissegundo.
const tick = () => new Promise(resolve => setTimeout(resolve, 4));
// Os objetos do aparelho (vm) vêm de outro "realm": normaliza para comparar com deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));

const SERIES = {
  id: 100, type: 'tv', name: 'Série A', genres: ['Drama'], status: 'Ended',
  seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, runtime: 40 }, { episode_number: 2, runtime: 40 }] }]
};
const MOVIE = { id: 200, type: 'movie', name: 'Filme B', genres: ['Ação'], runtime: 100 };
const OTHER = { id: 300, type: 'tv', name: 'Série C', genres: [], seasons: [{ season_number: 1, episodes: [{ episode_number: 1 }] }] };

// Um aparelho = um navegador (localStorage próprio) com os scripts reais do app carregados.
function makeDevice(model, { withViews = false, firstVisit = false } = {}) {
  const store = new Map();
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, { id, textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, addEventListener() {} });
    return elements.get(id);
  };
  const device = { elements, online: true, events: [], pushes: 0 };
  const ctx = {
    console, JSON, Promise, Math, Object, Array, Number, String, Map, Set, Error, TypeError, SyntaxError, Date,
    setTimeout: () => 0, clearTimeout: () => {}, // sem debounce: os testes chamam push()/pullAndMerge() à mão
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [] },
    addEventListener() {},
    dispatchEvent(e) { device.events.push(e.type); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const files = ['utils/dom.js', 'utils/emotions.js', 'utils/markdown.js', 'utils/mediaDisplay.js', 'utils/viewKit.js', 'utils/libraryMerge.js', 'utils/watchStatus.js', 'utils/backupValidator.js', 'utils/migrations.js'];

  const userFromToken = () => {
    const tok = store.get('showvault_auth_token');
    return tok ? tok.replace(/^tok_/, '') : null;
  };
  const strip = ({ schemaVersion, updatedAt, ...data }) => data;
  const fail = (message, status) => Object.assign(message === 'net' ? new TypeError('fetch failed') : new Error(message), status ? { status } : {});
  ctx.apiClient = {
    async getLibrary() {
      if (!device.online) throw fail('net');
      if (!userFromToken()) throw fail('Token ausente', 401);
      return { data: strip(model.get(userFromToken())), updatedAt: null };
    },
    async putLibrary(data) {
      if (!device.online) throw fail('net');
      if (!userFromToken()) throw fail('Token ausente', 401);
      device.pushes++;
      const saved = model.save(userFromToken(), JSON.parse(JSON.stringify(data)), { stateVersion: ctx.STATE_VERSION });
      return { updatedAt: saved.updatedAt, data: strip(saved) };
    },
    async deleteLibrary() {
      if (!device.online) throw fail('net');
      const cleared = model.clear(userFromToken());
      return { resetAt: cleared.resetAt, updatedAt: cleared.updatedAt };
    }
  };
  // navegador "já usado" (estado vazio salvo); `firstVisit` = nada salvo ainda (S08: a primeira visita também é vazia, mas `seeded`)
  if (!firstVisit) store.set('showvault_state_mvc_v1', JSON.stringify(empty()));
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf-8'), ctx, { filename: f });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'models/state.js'), 'utf-8'), ctx, { filename: 'state.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'services/syncService.js'), 'utf-8'), ctx, { filename: 'syncService.js' });
  if (withViews) {
    for (const f of ['views/nextUpView.js', 'views/watchlistView.js', 'views/statsView.js']) {
      // as views criam a instância em window.<x>View; classes ficam no escopo do script
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf-8'), ctx, { filename: f });
    }
  }

  device.window = ctx;
  device.state = ctx.appState;
  device.sync = ctx.syncService;
  device.store = store;
  device.cacheCatalog = () => ctx.appState.cacheMediaList([SERIES, MOVIE, OTHER]);
  device.login = async (userId, opts) => {
    store.set('showvault_auth_token', `tok_${userId}`);
    await ctx.syncService.pullAndMerge({ id: userId, name: userId }, opts);
  };
  device.logout = async () => {
    const result = await ctx.syncService.logout();
    store.delete('showvault_auth_token');
    return result;
  };
  device.ids = () => Array.from(device.state.data.trackedShows, s => s.showId).sort((a, b) => a - b);
  device.cacheCatalog();
  return device;
}

test('isolamento: duas contas no mesmo navegador não veem dados uma da outra (logout limpa)', async () => {
  const model = tmpModel();
  const dev = makeDevice(model);

  await dev.login('usr_alice');
  dev.state.addShow(100);
  dev.state.toggleWatched(100, 1, 1);
  await tick();
  await dev.sync.push();
  assert.deepEqual(dev.ids(), [100]);

  const out = await dev.logout();
  assert.equal(out.synced, true);
  assert.deepEqual(dev.ids(), [], 'navegador limpo depois de sair');
  assert.equal(dev.state.getOwner(), '');
  assert.equal(dev.store.get('showvault_archive_usr_alice'), undefined, 'tudo já estava na nuvem: sem arquivo');
  assert.equal(dev.window.LibraryMerge.hasContent(JSON.parse(dev.store.get('showvault_state_mvc_v1'))), false);

  await dev.login('usr_bruno');
  assert.deepEqual(dev.ids(), [], 'Bruno não herda a lista da Alice');
  assert.deepEqual(plain(dev.state.data.watchedEpisodes), {});
  dev.state.addShow(200);
  await tick();
  await dev.sync.push();
  await dev.logout();

  await dev.login('usr_alice');
  assert.deepEqual(dev.ids(), [100], 'Alice volta só com a dela');
  assert.equal(dev.state.isWatched(100, 1, 1), true);
  assert.deepEqual(model.get('usr_bruno').trackedShows.map(s => s.showId), [200], 'a nuvem do Bruno só tem a dele');
  assert.deepEqual(model.get('usr_alice').trackedShows.map(s => s.showId), [100]);
});

test('isolamento: trocar de conta SEM sair (sessão expirada) arquiva a anterior e não mescla', async () => {
  const model = tmpModel();
  const dev = makeDevice(model);
  await dev.login('usr_carla');
  dev.state.addShow(100);
  await tick();
  await dev.sync.push();
  dev.state.addShow(200); // alteração ainda não enviada
  dev.sync.stop();        // token expirou: a sessão encerra, o estado local continua sendo da Carla

  await dev.login('usr_davi'); // outra pessoa entra sem logout
  assert.deepEqual(dev.ids(), [], 'Davi não vê nada da Carla');
  assert.deepEqual(model.get('usr_davi').trackedShows, []);
  assert.ok(dev.store.get('showvault_archive_usr_carla'), 'o que era da Carla ficou guardado');
  await dev.logout();

  await dev.login('usr_carla'); // a alteração não enviada volta
  assert.deepEqual(dev.ids(), [100, 200]);
  assert.equal(dev.store.get('showvault_archive_usr_carla'), undefined, 'arquivo consumido');
  assert.deepEqual(model.get('usr_carla').trackedShows.map(s => s.showId).sort(), [100, 200]);
});

test('logout sem rede guarda uma cópia e a conta recupera no próximo login', async () => {
  const model = tmpModel();
  const dev = makeDevice(model);
  await dev.login('usr_eva');
  dev.state.addShow(100);
  await tick();
  await dev.sync.push();
  dev.state.addShow(300);
  dev.online = false;
  const out = await dev.logout();
  assert.equal(out.synced, false);
  assert.deepEqual(dev.ids(), [], 'mesmo assim o navegador é limpo');
  assert.ok(dev.store.get('showvault_archive_usr_eva'));

  dev.online = true;
  await dev.login('usr_eva');
  assert.deepEqual(dev.ids(), [100, 300]);
  assert.deepEqual(model.get('usr_eva').trackedShows.map(s => s.showId).sort(), [100, 300]);
});

test('visitante que entra numa conta leva o que fez antes de entrar; sessão retomada assume o estado antigo', async () => {
  const model = tmpModel();
  const dev = makeDevice(model);
  dev.state.addShow(100);                       // visitante (sem token)
  dev.state.toggleWatched(100, 1, 1);
  assert.equal(dev.state.getOwner(), '');
  await dev.login('usr_fabio');
  assert.deepEqual(model.get('usr_fabio').trackedShows.map(s => s.showId), [100]);
  assert.equal(dev.state.getOwner(), 'usr_fabio');

  // estado de antes da S03 (sem dono) + sessão retomada ao abrir a página: pertence ao usuário do token
  const legacy = makeDevice(model);
  legacy.state.addShow(300);
  legacy.store.set('showvault_auth_token', 'tok_usr_gina');
  await legacy.sync.pullAndMerge({ id: 'usr_gina' }, { resumed: true });
  assert.equal(legacy.state.getOwner(), 'usr_gina');
  assert.deepEqual(model.get('usr_gina').trackedShows.map(s => s.showId), [300]);
});

test('dois aparelhos: remover obra e desmarcar episódio num reflete no outro; aparelho desatualizado não ressuscita', async () => {
  const model = tmpModel();
  const A = makeDevice(model);
  const B = makeDevice(model);

  await A.login('usr_hugo');
  A.state.addShow(100);
  A.state.addShow(200);
  A.state.toggleWatched(100, 1, 1);
  A.state.toggleWatched(100, 1, 2);
  await tick();
  await A.sync.push();

  await tick();
  await B.login('usr_hugo');                 // aparelho novo: recebe tudo
  assert.deepEqual(B.ids(), [100, 200]);
  assert.equal(B.state.isWatched(100, 1, 2), true);

  await tick();
  A.state.removeShow(200);                   // A remove o filme e desmarca o ep. 2
  A.state.toggleWatched(100, 1, 2);
  await A.sync.push();
  assert.deepEqual(model.get('usr_hugo').trackedShows.map(s => s.showId), [100]);
  assert.ok(model.get('usr_hugo').tombstones.shows['200']);

  // B, ainda desatualizado, edita outra coisa e ENVIA antes de sincronizar: não pode desfazer o trabalho de A
  await tick();
  B.state.addShow(300);
  await B.sync.push();
  assert.deepEqual(B.ids(), [100, 300], 'a resposta do servidor já removeu a obra 200 no B');
  assert.equal(B.state.isWatched(100, 1, 2), false, 'e desmarcou o episódio');
  assert.equal(B.state.isWatched(100, 1, 1), true);
  assert.deepEqual(model.get('usr_hugo').trackedShows.map(s => s.showId).sort(), [100, 300]);

  // A traz a obra 300 do B
  await A.sync.pullAndMerge();
  assert.deepEqual(A.ids(), [100, 300]);

  // readicionar depois da exclusão volta a valer nos dois lados
  await tick();
  A.state.addShow(200);
  await A.sync.push();
  await B.sync.pullAndMerge();
  assert.deepEqual(B.ids(), [100, 200, 300]);
});

test('dois aparelhos: status e notas seguem a alteração mais recente', async () => {
  const model = tmpModel();
  const A = makeDevice(model);
  const B = makeDevice(model);
  await A.login('usr_ivo');
  A.state.addShow(100);
  A.state.saveNote(100, 1, 1, { text: 'primeira versão da nota', emotion: 'fun', character: '' });
  await tick();
  await A.sync.push();
  await B.login('usr_ivo');

  await tick();
  B.state.setShowStatus(100, 'paused');
  B.state.saveNote(100, 1, 1, { text: 'nota editada no B', emotion: 'sad', character: '' });
  await B.sync.push();
  await tick();
  A.state.setShowStatus(100, 'dropped');
  await A.sync.push();            // status do A é o mais novo; a nota do B é a mais nova

  assert.equal(A.state.getTracked(100).status, 'dropped');
  assert.equal(A.state.getNote(100, 1, 1).text, 'nota editada no B');
  await B.sync.pullAndMerge();
  assert.equal(B.state.getTracked(100).status, 'dropped');
});

test('Resetar com nuvem zera a conta em todos os aparelhos; só local não mexe na nuvem', async () => {
  const model = tmpModel();
  const A = makeDevice(model);
  const B = makeDevice(model);
  await A.login('usr_jana');
  A.state.addShow(100);
  A.state.toggleWatched(100, 1, 1);
  await tick();
  await A.sync.push();
  await B.login('usr_jana');
  assert.deepEqual(B.ids(), [100]);

  // reset só neste aparelho (sem apagar a nuvem): a nuvem continua e os dados voltam ao sincronizar
  await tick();
  B.state.resetLocal();
  assert.deepEqual(B.ids(), []);
  assert.deepEqual(model.get('usr_jana').trackedShows.map(s => s.showId), [100]);
  await B.sync.pullAndMerge();
  assert.deepEqual(B.ids(), [100]);

  // reset COM nuvem
  await tick();
  await A.sync.wipeCloud();
  assert.deepEqual(A.ids(), []);
  assert.deepEqual(model.get('usr_jana').trackedShows, []);
  await tick();
  await B.sync.pullAndMerge();      // B ainda tinha a obra 100: ao sincronizar, zera também
  assert.deepEqual(B.ids(), [], 'o outro aparelho também foi zerado');
  assert.deepEqual(plain(B.state.data.watchedEpisodes), {});

  // o que for criado DEPOIS do reset, em qualquer aparelho, vale
  await tick();
  B.state.addShow(200);
  await B.sync.push();
  await A.sync.pullAndMerge();
  assert.deepEqual(A.ids(), [200]);
});

test('falhas de sincronização ficam visíveis: offline, erro do servidor e sessão expirada; tentar de novo envia', async () => {
  const model = tmpModel();
  const dev = makeDevice(model);
  await dev.login('usr_kau');
  dev.state.addShow(100);
  await tick();

  dev.online = false;
  assert.equal(await dev.sync.push(), false);
  assert.equal(dev.sync.status, 'offline');
  assert.equal(dev.sync.dirty, true);
  assert.equal(dev.elements.get('sync-label').textContent, 'Offline · tentar de novo', 'o selo do cabeçalho mostra a falha');
  assert.equal(dev.elements.get('sync-status').dataset.syncState, 'offline');

  dev.online = true;
  assert.equal(await dev.sync.retry(), true);
  assert.equal(dev.sync.status, 'idle');
  assert.equal(dev.sync.dirty, false);
  assert.deepEqual(model.get('usr_kau').trackedShows.map(s => s.showId), [100]);

  const realPut = dev.window.apiClient.putLibrary;
  dev.window.apiClient.putLibrary = async () => { throw Object.assign(new Error('Erro interno'), { status: 500 }); };
  dev.state.addShow(300);
  assert.equal(await dev.sync.push(), false);
  assert.equal(dev.sync.status, 'error');
  dev.window.apiClient.putLibrary = async () => { throw Object.assign(new Error('Token inválido'), { status: 401 }); };
  assert.equal(await dev.sync.push(), false);
  assert.equal(dev.sync.status, 'auth');
  dev.window.apiClient.putLibrary = realPut;

  // sem o primeiro pull concluído (ex.: abriu offline) nada é enviado, e "tentar de novo" refaz o pull
  const fresh = makeDevice(model);
  fresh.online = false;
  await fresh.login('usr_kau');
  assert.equal(fresh.sync.ready, false);
  assert.equal(fresh.sync.status, 'offline');
  fresh.state.addShow(200);
  assert.equal(await fresh.sync.push(), false);
  assert.equal(fresh.pushes, 0);
  fresh.online = true;
  await fresh.sync.retry();
  assert.equal(fresh.sync.ready, true);
  assert.deepEqual(model.get('usr_kau').trackedShows.map(s => s.showId).sort(), [100, 200], 'o que ficou sem enviar (300) não foi para a nuvem; o 200 foi depois do retry');
});

test('resposta de uma sessão antiga é ignorada (logout durante o pull não grava dados da conta anterior)', async () => {
  const model = tmpModel();
  const dev = makeDevice(model);
  model.save('usr_lia', { ...empty(), trackedShows: [{ showId: 100, status: 'watching', addedAt: ago(3), updatedAt: ago(3) }] });

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const realGet = dev.window.apiClient.getLibrary;
  dev.window.apiClient.getLibrary = async () => { const r = await realGet(); await gate; return r; };

  dev.store.set('showvault_auth_token', 'tok_usr_lia');
  const pending = dev.sync.pullAndMerge({ id: 'usr_lia' });
  dev.sync.stop();                       // saiu (ou trocou de conta) enquanto a resposta não chegava
  dev.store.delete('showvault_auth_token');
  dev.state.clearForLogout();
  release();
  await pending;
  assert.deepEqual(dev.ids(), [], 'a resposta atrasada não foi aplicada');
  assert.equal(dev.state.getOwner(), '');
});

// ---------------------------------------------------------------- Status por obra: lista e estatísticas

test('status por obra: regras automáticas e as telas (lista, estatísticas, A Seguir) concordam', async () => {
  const model = tmpModel();
  const dev = makeDevice(model, { withViews: true });
  const w = dev.window;
  const state = dev.state;
  const txt = (id) => String(dev.elements.get(id).textContent);
  const renderAll = () => { w.watchlistView.render(); w.statsView.render(); };

  // séries/animes e filmes entram como "Quero ver"
  state.addShow(100); state.addShow(200); state.addShow(300);
  assert.deepEqual(state.data.trackedShows.map(s => s.status), ['plan_to_watch', 'plan_to_watch', 'plan_to_watch']);

  // marcar o 1º episódio -> Assistindo; último -> Finalizado; desmarcar -> volta a Assistindo
  state.toggleWatched(100, 1, 1);
  assert.equal(state.getTracked(100).status, 'watching');
  state.toggleWatched(100, 1, 2);
  assert.equal(state.getTracked(100).status, 'completed');
  state.toggleWatched(100, 1, 2);
  assert.equal(state.getTracked(100).status, 'watching');
  state.batchSetSeason(100, 1, true);
  assert.equal(state.getTracked(100).status, 'completed');

  // filme assistido -> Finalizado; desmarcar -> Quero ver
  state.toggleWatched(200);
  assert.equal(state.getTracked(200).status, 'completed');
  state.toggleWatched(200);
  assert.equal(state.getTracked(200).status, 'plan_to_watch');
  state.toggleWatched(200);

  // seletor manual: Pausado e Desisti valem e não entram na fila "A Seguir"
  assert.equal(state.setShowStatus(300, 'paused'), true);
  assert.equal(state.setShowStatus(300, 'invalido'), false);
  assert.equal(state.getTracked(300).status, 'paused');
  assert.deepEqual(plain(w.nextUpView.calculateQueue().map(q => q.showId)), [], 'Pausado/Finalizado fora da fila');

  renderAll();
  assert.equal(txt('count-all'), '3');
  assert.equal(txt('count-completed'), '2');
  assert.equal(txt('stat-shows-completed'), '2', 'estatística = contagem da lista');
  assert.equal(txt('count-plan'), '0');
  assert.equal(txt('count-watching'), '0');

  // marcar o único episódio de uma obra Pausada a finaliza (e desmarcar volta a Quero ver)
  state.toggleWatched(300, 1, 1);
  assert.equal(state.getTracked(300).status, 'completed', 'único episódio => Finalizado');
  state.toggleWatched(300, 1, 1);
  assert.equal(state.getTracked(300).status, 'plan_to_watch', 'desmarcou tudo de uma obra Finalizada: volta a Quero ver');

  // legado: item sem updatedAt, com tudo assistido e status "watching" é mostrado (e contado) como Finalizado nas duas telas
  state.data.trackedShows = state.data.trackedShows.filter(t => t.showId !== 300);
  state.data.trackedShows.push({ showId: 999, status: 'watching', addedAt: '2026-10-01T00:00:00.000Z' });
  state.mediaMap.set(999, { id: 999, type: 'tv', name: 'Antiga', seasons: [{ season_number: 1, episodes: [{ episode_number: 1 }] }] });
  state.data.watchedEpisodes['999_s1_e1'] = { watched: true, watchedAt: '2026-10-02T00:00:00.000Z', rewatchCount: 1 };
  renderAll();
  assert.equal(txt('count-completed'), '3');
  assert.equal(txt('stat-shows-completed'), '3');
  // e o usuário ainda consegue escolher "Assistindo" para rever
  state.setShowStatus(999, 'watching');
  renderAll();
  assert.equal(txt('count-completed'), '2');
  assert.equal(txt('stat-shows-completed'), '2');
  assert.equal(txt('count-watching'), '1');
});

test('importar backup propaga a substituição aos outros aparelhos', async () => {
  const model = tmpModel();
  const A = makeDevice(model);
  const B = makeDevice(model);
  await A.login('usr_mel');
  A.state.addShow(100);
  A.state.addShow(200);
  await tick();
  await A.sync.push();
  await B.login('usr_mel');

  await tick();
  const imported = A.window.validateBackup({ trackedShows: [{ showId: 300, status: 'completed', addedAt: '2026-01-01T00:00:00.000Z' }], watchedEpisodes: {}, episodeNotes: {} });
  A.state.importData(imported);
  assert.deepEqual(A.ids(), [300]);
  await A.sync.push();
  await tick();
  await B.sync.pullAndMerge();
  assert.deepEqual(B.ids(), [300], 'o que não estava no backup sumiu também no outro aparelho');
  assert.equal(B.state.getTracked(300).status, 'completed');
});

// ---------------------------------------------------------------- S08: estado inicial vazio, "Carregar exemplo" e histórico de versões da nota

const EXAMPLE_ITEMS = [
  { id: 157336, type: 'movie', name: 'Filme de exemplo 1', genres: [], runtime: 120 },
  { id: 872585, type: 'movie', name: 'Filme de exemplo 2', genres: [] },
  { id: 1396, type: 'tv', name: 'Série de exemplo', genres: [], seasons: [{ season_number: 1, episodes: [{ episode_number: 1 }] }] },
  { id: 1429, type: 'anime', name: 'Anime de exemplo', genres: [], seasons: [{ season_number: 1, episodes: [{ episode_number: 1 }] }] }
];

test('primeira visita: lista vazia, sem obras/datas/anotações de enfeite e nada gravado até o usuário agir', () => {
  const dev = makeDevice(tmpModel(), { firstVisit: true });
  assert.equal(dev.state.seeded, true);
  assert.deepEqual(dev.ids(), []);
  assert.deepEqual(plain(dev.state.data.watchedEpisodes), {});
  assert.deepEqual(plain(dev.state.data.episodeNotes), {});
  assert.equal(dev.store.get('showvault_state_mvc_v1'), undefined, 'ler o estado inicial não grava nada');
  dev.state.addShow(100);
  assert.equal(dev.state.seeded, false, 'depois da 1ª ação o estado é do usuário');
  assert.deepEqual(dev.ids(), [100]);
});

test('visitante vazio que entra numa conta recebe a nuvem (sem herdar nada) e quem já agiu como visitante leva o que fez', async () => {
  const model = tmpModel();
  const A = makeDevice(model);
  await A.login('usr_s08a');
  A.state.addShow(100);
  A.state.saveNote(100, 1, 1, { text: 'minha anotação na nuvem', emotion: 'fun', character: '' });
  await tick();
  await A.sync.push();

  const fresh = makeDevice(model, { firstVisit: true }); // navegador novo, visitante que nunca fez nada
  await fresh.login('usr_s08a');
  assert.deepEqual(fresh.ids(), [100]);
  assert.equal(fresh.state.getNote(100, 1, 1).text, 'minha anotação na nuvem');

  const newAccount = makeDevice(model, { firstVisit: true });
  await newAccount.login('usr_s08b'); // conta nova: continua vazia, sem exemplo nenhum
  assert.deepEqual(newAccount.ids(), []);
  assert.deepEqual(model.get('usr_s08b').trackedShows, []);

  const guest = makeDevice(model, { firstVisit: true });
  guest.state.addShow(300); // visitante que usou o app antes de entrar
  await guest.login('usr_s08a');
  assert.deepEqual(guest.ids(), [100, 300], 'une o que fez como visitante com a conta');
});

test('"Carregar exemplo": só obras do catálogo, como Quero ver, sem episódios, datas ou anotações; repetir não duplica', () => {
  const dev = makeDevice(tmpModel(), { firstVisit: true });
  const state = dev.state;

  const none = state.loadExample(); // catálogo ainda não chegou: nada entra (não cria obra sem dados)
  assert.deepEqual(plain(none.added), []);
  assert.equal(none.missing, 4);
  assert.deepEqual(dev.ids(), []);

  state.cacheMediaList(EXAMPLE_ITEMS);
  const out = state.loadExample();
  assert.deepEqual(plain(out.added), [157336, 872585, 1396, 1429]);
  assert.deepEqual(plain(state.data.trackedShows.map(t => t.status)), ['plan_to_watch', 'plan_to_watch', 'plan_to_watch', 'plan_to_watch']);
  assert.deepEqual(plain(state.data.watchedEpisodes), {});
  assert.deepEqual(plain(state.data.episodeNotes), {});
  assert.equal(state.seeded, false);

  const again = state.loadExample();
  assert.deepEqual(plain(again.added), []);
  assert.equal(state.data.trackedShows.length, 4);

  // exemplo é lista comum: remover vale e o resto do exemplo fica
  state.removeShow(1396);
  assert.deepEqual(dev.ids(), [1429, 157336, 872585]);
});

test('histórico de versões: nova sessão de edição guarda a versão anterior; digitar seguido não enche o histórico', () => {
  const dev = makeDevice(tmpModel());
  const state = dev.state;
  const key = '100_s1_e1';
  const older = (minutes) => { state.data.episodeNotes[key].updatedAt = new Date(Date.now() - minutes * 60000).toISOString(); };

  state.saveNote(100, 1, 1, { text: 'v1 texto', emotion: 'fun', character: 'Ana' });
  assert.deepEqual(plain(state.getNoteVersions(100, 1, 1)), [], 'primeira gravação não tem versão anterior');

  // digitando: várias gravações automáticas seguidas = uma sessão só
  state.saveNote(100, 1, 1, { text: 'v1 texto mais', emotion: 'fun', character: 'Ana' });
  state.saveNote(100, 1, 1, { text: 'v1 texto mais um pouco', emotion: 'fun', character: 'Ana' });
  assert.deepEqual(plain(state.getNoteVersions(100, 1, 1)), []);

  older(60); // anotação parada há uma hora: a próxima edição começa uma sessão nova
  state.saveNote(100, 1, 1, { text: 'v2 texto', emotion: 'sad', character: 'Ana' });
  assert.deepEqual(plain(state.getNoteVersions(100, 1, 1).map(v => v.text)), ['v1 texto mais um pouco']);

  state.saveNote(100, 1, 1, { text: 'v2 texto editado', emotion: 'sad', character: 'Ana' });
  assert.equal(state.getNoteVersions(100, 1, 1).length, 1, 'ainda a mesma sessão');

  older(60);
  state.saveNote(100, 1, 1, { text: 'v3 texto', emotion: 'sad', character: 'Ana' });
  assert.deepEqual(plain(state.getNoteVersions(100, 1, 1).map(v => v.text)), ['v2 texto editado', 'v1 texto mais um pouco']);

  // só emoção/personagem mudou, texto igual: nada de versão nova
  older(60);
  state.saveNote(100, 1, 1, { text: 'v3 texto', emotion: 'awesome', character: 'Bia' });
  assert.equal(state.getNoteVersions(100, 1, 1).length, 2);

  // limite de 5 (as mais novas ficam)
  for (let i = 4; i <= 9; i++) { older(60); state.saveNote(100, 1, 1, { text: `v${i} texto`, emotion: null, character: '' }); }
  const texts = state.getNoteVersions(100, 1, 1).map(v => v.text);
  assert.equal(texts.length, 5);
  assert.equal(texts[0], 'v8 texto');
  assert.equal(texts[4], 'v4 texto');
});

test('histórico de versões: restaurar em 1 clique troca o texto, guarda o atual como nova versão e não perde as demais', async () => {
  const model = tmpModel();
  const dev = makeDevice(model);
  const state = dev.state;
  const key = '100_s1_e1';
  const older = () => { state.data.episodeNotes[key].updatedAt = new Date(Date.now() - 3600000).toISOString(); };
  state.saveNote(100, 1, 1, { text: 'primeira versão da anotação', emotion: 'fun', character: 'Ana' });
  for (const t of ['segunda versão da anotação', 'terceira versão da anotação', 'quarta versão da anotação']) {
    older();
    state.saveNote(100, 1, 1, { text: t, emotion: 'sad', character: 'Ana' });
  }
  assert.deepEqual(plain(state.getNoteVersions(100, 1, 1).map(v => v.text)),
    ['terceira versão da anotação', 'segunda versão da anotação', 'primeira versão da anotação']);

  const restored = state.restoreNoteVersion(100, 1, 1, 2); // a mais antiga
  assert.equal(restored, 'primeira versão da anotação');
  assert.equal(state.getNote(100, 1, 1).text, 'primeira versão da anotação');
  assert.equal(state.getNote(100, 1, 1).emotion, 'sad', 'emoção e personagem não mudam');
  assert.deepEqual(plain(state.getNoteVersions(100, 1, 1).map(v => v.text)),
    ['quarta versão da anotação', 'terceira versão da anotação', 'segunda versão da anotação'],
    'o texto que valia virou a versão mais nova; as outras continuam');

  // restaurar de novo traz de volta o que estava valendo (desfazer)
  state.restoreNoteVersion(100, 1, 1, 0);
  assert.equal(state.getNote(100, 1, 1).text, 'quarta versão da anotação');
  assert.equal(state.getNoteVersions(100, 1, 1)[0].text, 'primeira versão da anotação');
  assert.equal(state.getNoteVersions(100, 1, 1).length, 3);

  // índices inválidos não mexem em nada
  const before = JSON.stringify(state.getNote(100, 1, 1));
  for (const bad of [-1, 3, 99, 1.5, null, undefined, '0']) assert.equal(state.restoreNoteVersion(100, 1, 1, bad), null, String(bad));
  assert.equal(state.restoreNoteVersion(100, 1, 7, 0), null, 'anotação inexistente');
  assert.equal(JSON.stringify(state.getNote(100, 1, 1)), before);

  // com o limite cheio (5), restaurar mantém 5 (a restaurada sai, a atual entra)
  for (let i = 0; i < 4; i++) { older(); state.saveNote(100, 1, 1, { text: `rascunho número ${i}`, emotion: null, character: '' }); }
  assert.equal(state.getNoteVersions(100, 1, 1).length, 5);
  state.restoreNoteVersion(100, 1, 1, 4);
  assert.equal(state.getNoteVersions(100, 1, 1).length, 5);

  // o histórico viaja com a anotação na sincronização
  await dev.login('usr_s08c');
  await tick();
  await dev.sync.push();
  const cloud = model.get('usr_s08c').episodeNotes[key];
  assert.equal(cloud.snapshots.length, 5);
  assert.equal(cloud.text, state.getNote(100, 1, 1).text);
});

test('histórico de versões: restaurar texto de filme usa a chave do filme e conta como edição mais recente', () => {
  const dev = makeDevice(tmpModel());
  const state = dev.state;
  state.saveNote(200, null, null, { text: 'opinião inicial sobre o filme', emotion: null, character: '' });
  state.data.episodeNotes['200_movie'].updatedAt = new Date(Date.now() - 3600000).toISOString();
  state.saveNote(200, null, null, { text: 'opinião nova sobre o filme', emotion: null, character: '' });
  const stampBefore = state.getNote(200).updatedAt;
  assert.equal(state.restoreNoteVersion(200, null, null, 0), 'opinião inicial sobre o filme');
  assert.ok(Date.parse(state.getNote(200).updatedAt) > Date.parse(stampBefore), 'a restauração vence no sync');
});
