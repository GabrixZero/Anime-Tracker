process.env.SHOWVAULT_SEED_PATH = require('path').join(__dirname, 'fixtures', 'seed-teste.json'); // seed de teste (textos fictícios), não o catálogo real
// Ajustes 2 · Grupo 1: obra em exibição guardada por um mapeamento antigo (sem episódios futuros) é atualizada na hora, e a Agenda
// atualiza as obras em rodízio (as mais antigas primeiro). Nenhum teste usa a internet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { MediaService } = require('../server/services/mediaService');

const HOUR = 3600 * 1000;
const newSvc = () =>
  new MediaService({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sv-aj2-')),
    jikanEnabled: false,
    anilistEnabled: false,
    tmdbKey: ''
  });

test('Black Clover guardado sem scheduleVersion (versão antiga) vence na hora, mesmo atualizado há 1 h', () => {
  const svc = newSvc();
  const now = Date.parse('2026-11-05T13:48:00.000Z');
  const velha = {
    id: 10034572,
    type: 'anime',
    name: 'Black Clover',
    status: 'Em Exibição',
    ingestedAt: '2026-10-20T00:00:00.000Z',
    refreshedAt: '2026-11-05T12:48:00.000Z'
  };
  assert.equal(svc.refreshTtlMs(velha, now), 0);
  assert.equal(svc.isRefreshDue(velha, now), true);
  // já no mapeamento novo: volta à validade normal de 6 h
  const nova = { ...velha, scheduleVersion: 2 };
  assert.equal(svc.refreshTtlMs(nova, now), 6 * HOUR);
  assert.equal(svc.isRefreshDue(nova, now), false);
  // obra finalizada continua sem vencer
  assert.equal(svc.refreshTtlMs({ ...velha, status: 'Finalizada' }, now), null);
});

test('toda ingestão grava scheduleVersion (a obra atualizada deixa de ser "velha")', () => {
  assert.equal(MediaService.stamps(null).scheduleVersion, 2);
});

// ---- rodízio no cliente (calendarView.onOpen) -------------------------------------------------------------------------------------
function loadView({ medias, tracked }) {
  const calls = [];
  const win = {
    syncService: { isLoggedIn: () => true },
    appState: {
      data: { trackedShows: tracked },
      getStatus: () => 'watching',
      getMedia: id => medias[id],
      cacheMediaDetail: m => {
        medias[m.id] = m;
      }
    },
    apiClient: {
      refreshMedia: async id => {
        calls.push(id);
        return { data: { ...medias[id], refreshedAt: new Date().toISOString(), scheduleVersion: 2 } };
      }
    },
    appController: { dirty: new Set(), activeTab: 'other', renderTab() {} },
    Calendar: {}
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [] };
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'calendarView.js'), 'utf8');
  const ctx = vm.createContext({ window: win, document: doc, console, Date });
  vm.runInContext(code, ctx);
  return { view: win.calendarView, calls };
}

test('Agenda: com 10 obras em exibição, 8 por abertura, as mais desatualizadas primeiro; a abertura seguinte pega as que sobraram', async () => {
  const medias = {};
  const tracked = [];
  for (let i = 1; i <= 10; i++) {
    // obra 1 é a mais antiga (e a de mapeamento antigo); obra 10 a mais nova
    medias[i] = {
      id: i,
      type: 'anime',
      status: 'Em Exibição',
      refreshedAt: `2026-11-05T0${i % 10}:00:00.000Z`,
      scheduleVersion: i === 5 ? 0 : 2
    };
    tracked.push({ showId: i });
  }
  const { view, calls } = loadView({ medias, tracked });
  view.renderNotice = () => {};
  await view.onOpen();
  assert.equal(calls.length, 8);
  assert.equal(calls[0], 5, 'mapeamento antigo vai primeiro');
  assert.equal(new Set(calls).size, 8);
  const left = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(i => !calls.includes(i));
  assert.equal(left.length, 2);
  calls.length = 0;
  await view.onOpen(); // 2ª abertura logo depois: só as 2 que ainda não foram tentadas
  assert.deepEqual(
    [...calls].sort((a, b) => a - b),
    left
  );
  calls.length = 0;
  await view.onOpen(); // 3ª: todas já tentadas há menos de 30 min
  assert.equal(calls.length, 0);
});
