// Testes S03 (funções puras): merge com marcas de exclusão, importação de backup, decisão no login e regra de status por obra.
const test = require('node:test');
const assert = require('node:assert/strict');

const LM = require('../public/js/utils/libraryMerge');
const WS = require('../public/js/utils/watchStatus');

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const iso = (offsetMin) => new Date(NOW + offsetMin * 60000).toISOString();
const lib = (parts = {}) => ({ trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: LM.emptyTombstones(), resetAt: '', ...parts });
const show = (showId, status, minutes, extra = {}) => ({ showId, status, addedAt: iso(-1000), updatedAt: iso(minutes), ...extra });
const watched = (minutes, extra = {}) => ({ watched: true, watchedAt: iso(minutes), updatedAt: iso(minutes), rewatchCount: 1, ...extra });
const note = (text, minutes) => ({ text, emotion: null, character: '', updatedAt: iso(minutes), snapshots: [] });
const merge = (a, b) => LM.merge(a, b, { now: NOW });
const ids = (l) => l.trackedShows.map(s => s.showId).sort((a, b) => a - b);

test('merge: união — nada que existe só de um lado se perde', () => {
  const local = lib({ trackedShows: [show(1, 'watching', -10)], watchedEpisodes: { '1_s1_e1': watched(-10) }, episodeNotes: { '1_s1_e1': note('local', -10) } });
  const remote = lib({ trackedShows: [show(2, 'completed', -20)], watchedEpisodes: { '2_s1_e1': watched(-20) }, episodeNotes: { '2_s1_e1': note('remota', -20) } });
  const out = merge(local, remote);
  assert.deepEqual(ids(out), [1, 2]);
  assert.deepEqual(Object.keys(out.watchedEpisodes).sort(), ['1_s1_e1', '2_s1_e1']);
  assert.deepEqual(Object.keys(out.episodeNotes).sort(), ['1_s1_e1', '2_s1_e1']);
});

test('merge: aceita bibliotecas antigas (sem tombstones/updatedAt) e não altera os argumentos', () => {
  const oldRemote = { trackedShows: [{ showId: 5, status: 'watching', addedAt: iso(-50) }], watchedEpisodes: { '5_s1_e1': { watched: true, watchedAt: iso(-50), rewatchCount: 1 } }, episodeNotes: {} };
  const oldLocal = { trackedShows: [{ showId: 6, status: 'plan_to_watch', addedAt: iso(-40) }], watchedEpisodes: {}, episodeNotes: {} };
  const snapshotBefore = JSON.stringify([oldLocal, oldRemote]);
  const out = merge(oldLocal, oldRemote);
  assert.deepEqual(ids(out), [5, 6]);
  assert.deepEqual(out.tombstones, LM.emptyTombstones());
  assert.equal(JSON.stringify([oldLocal, oldRemote]), snapshotBefore, 'argumentos intactos');
  assert.deepEqual(merge(null, undefined), LM.emptyData());
});

test('merge: status — vence a alteração mais recente (não "o status mais avançado")', () => {
  const a = lib({ trackedShows: [show(1, 'completed', -5)] });
  const b = lib({ trackedShows: [show(1, 'dropped', -1)] });
  assert.equal(merge(a, b).trackedShows[0].status, 'dropped');
  assert.equal(merge(b, a).trackedShows[0].status, 'dropped');
  // addedAt: mantém o mais antigo
  const c = lib({ trackedShows: [show(1, 'watching', -1, { addedAt: iso(-500) })] });
  assert.equal(merge(a, c).trackedShows[0].addedAt, iso(-1000));
  assert.equal(merge(c, lib({ trackedShows: [show(1, 'watching', -3, { addedAt: iso(-200) })] })).trackedShows[0].addedAt, iso(-500));
});

test('merge: obra removida num aparelho some no outro (marca de exclusão mais nova que o item)', () => {
  const stale = lib({ trackedShows: [show(1, 'watching', -60), show(2, 'watching', -60)] });
  const afterRemoval = lib({ trackedShows: [show(2, 'watching', -60)], tombstones: { shows: { 1: iso(-10) }, watched: {}, notes: {} } });
  for (const out of [merge(stale, afterRemoval), merge(afterRemoval, stale)]) {
    assert.deepEqual(ids(out), [2]);
    assert.equal(out.tombstones.shows['1'], iso(-10), 'a marca continua para os próximos aparelhos');
  }
});

test('merge: item readicionado DEPOIS da exclusão volta (item mais novo vence a marca) e a marca é descartada', () => {
  const removed = lib({ tombstones: { shows: { 1: iso(-30) }, watched: {}, notes: {} } });
  const readded = lib({ trackedShows: [show(1, 'plan_to_watch', -5)] });
  const out = merge(removed, readded);
  assert.deepEqual(ids(out), [1]);
  assert.deepEqual(out.tombstones.shows, {});
});

test('merge: empate exato entre item e marca — o item fica (nunca perder dado por empate)', () => {
  const a = lib({ trackedShows: [show(1, 'watching', -5)] });
  const b = lib({ tombstones: { shows: { 1: iso(-5) }, watched: {}, notes: {} } });
  assert.deepEqual(ids(merge(a, b)), [1]);
  assert.deepEqual(ids(merge(b, a)), [1]);
});

test('merge: episódio desmarcado em um aparelho some no outro; marcar de novo depois volta', () => {
  const stale = lib({ watchedEpisodes: { '1_s1_e1': watched(-60), '1_s1_e2': watched(-60) } });
  const unmarked = lib({ watchedEpisodes: { '1_s1_e2': watched(-60) }, tombstones: { shows: {}, watched: { '1_s1_e1': iso(-10) }, notes: {} } });
  const out = merge(stale, unmarked);
  assert.deepEqual(Object.keys(out.watchedEpisodes), ['1_s1_e2']);
  assert.equal(out.tombstones.watched['1_s1_e1'], iso(-10));

  const remarked = lib({ watchedEpisodes: { '1_s1_e1': watched(-2) } });
  const again = merge(out, remarked);
  assert.deepEqual(Object.keys(again.watchedEpisodes).sort(), ['1_s1_e1', '1_s1_e2']);
  assert.deepEqual(again.tombstones.watched, {});
});

test('merge: rewatchCount fica com o maior e o episódio marcado dos dois lados continua marcado', () => {
  const out = merge(lib({ watchedEpisodes: { '1_s1_e1': watched(-5, { rewatchCount: 2 }) } }), lib({ watchedEpisodes: { '1_s1_e1': watched(-9, { rewatchCount: 4 }) } }));
  assert.equal(out.watchedEpisodes['1_s1_e1'].rewatchCount, 4);
  assert.equal(out.watchedEpisodes['1_s1_e1'].watched, true);
});

test('merge: nota mais nova vence; nota apagada (marca) some no outro aparelho', () => {
  const out = merge(lib({ episodeNotes: { '1_s1_e1': note('velha', -30) } }), lib({ episodeNotes: { '1_s1_e1': note('nova', -3) } }));
  assert.equal(out.episodeNotes['1_s1_e1'].text, 'nova');
  const deleted = merge(lib({ episodeNotes: { '1_s1_e1': note('x', -30) } }), lib({ tombstones: { shows: {}, watched: {}, notes: { '1_s1_e1': iso(-5) } } }));
  assert.deepEqual(deleted.episodeNotes, {});
});

test('merge: relógio adiantado — a data futura é aparada para agora + 5 min e depois edições reais voltam a vencer', () => {
  const wrongClock = lib({ episodeNotes: { '1_s1_e1': note('de um relógio 30 dias adiantado', 60 * 24 * 30) } });
  const first = merge(wrongClock, lib());
  assert.equal(first.episodeNotes['1_s1_e1'].updatedAt, iso(5), 'regravada com o limite');
  // 10 minutos depois alguém edita a nota num aparelho com o relógio certo: agora ela vence
  const edit = lib({ episodeNotes: { '1_s1_e1': note('edição real', 8) } });
  assert.equal(LM.merge(first, edit, { now: NOW + 10 * 60000 }).episodeNotes['1_s1_e1'].text, 'edição real');
  // marca de exclusão com data absurda também é aparada
  const futureTomb = lib({ tombstones: { shows: { 4: iso(60 * 24 * 365) }, watched: {}, notes: {} } });
  assert.equal(merge(futureTomb, lib()).tombstones.shows['4'], iso(5));
});

test('merge: preserva a ordem das obras (a lista não é reordenada por id)', () => {
  const out = merge(lib({ trackedShows: [show(50, 'watching', -9), show(7, 'watching', -8)] }), lib({ trackedShows: [show(900, 'watching', -7)] }));
  assert.deepEqual(out.trackedShows.map(s => s.showId), [900, 50, 7]);
});

test('merge: resetAt ("zerar a conta") descarta tudo anterior e mantém o que veio depois', () => {
  const resetRemote = lib({ resetAt: iso(-20) });
  const local = lib({
    trackedShows: [show(1, 'watching', -100), show(2, 'watching', -5)],
    watchedEpisodes: { '1_s1_e1': watched(-100), '2_s1_e1': watched(-5) },
    episodeNotes: { '1_s1_e1': note('velha', -100) },
    tombstones: { shows: { 9: iso(-100) }, watched: {}, notes: {} }
  });
  const out = merge(local, resetRemote);
  assert.deepEqual(ids(out), [2]);
  assert.deepEqual(Object.keys(out.watchedEpisodes), ['2_s1_e1']);
  assert.deepEqual(out.episodeNotes, {});
  assert.deepEqual(out.tombstones.shows, {}, 'marcas anteriores ao reset também saem');
  assert.equal(out.resetAt, iso(-20));
  // sem timestamps (dados bem antigos) e sem reset: nada é descartado
  assert.equal(merge(lib({ trackedShows: [{ showId: 3, status: 'watching', addedAt: '' }] }), lib()).trackedShows.length, 1);
});

test('merge: marcas muito antigas (> 180 dias) são descartadas; recentes ficam', () => {
  const out = merge(lib({ tombstones: { shows: { 1: iso(-60 * 24 * 200), 2: iso(-60 * 24 * 10) }, watched: {}, notes: {} } }), lib());
  assert.deepEqual(Object.keys(out.tombstones.shows), ['2']);
});

test('merge: é comutativo e idempotente em cenários sem empate', () => {
  const a = lib({
    trackedShows: [show(1, 'watching', -9), show(2, 'completed', -8)],
    watchedEpisodes: { '1_s1_e1': watched(-9), '2_s1_e1': watched(-30) },
    episodeNotes: { '1_s1_e1': note('a', -7) },
    tombstones: { shows: { 3: iso(-3) }, watched: { '1_s1_e2': iso(-2) }, notes: {} }
  });
  const b = lib({
    trackedShows: [show(1, 'paused', -6), show(3, 'watching', -50)],
    watchedEpisodes: { '2_s1_e1': watched(-5), '1_s1_e2': watched(-20) },
    episodeNotes: { '1_s1_e1': note('b', -10) },
    tombstones: { shows: { 2: iso(-4) }, watched: {}, notes: {} }
  });
  const sortShows = (l) => ({ ...l, trackedShows: [...l.trackedShows].sort((x, y) => x.showId - y.showId) });
  assert.deepEqual(sortShows(merge(a, b)), sortShows(merge(b, a)));
  const once = merge(a, b);
  assert.deepEqual(sortShows(merge(once, a)), sortShows(once));
  assert.deepEqual(sortShows(merge(once, once)), sortShows(once));
  assert.deepEqual(ids(once), [1]); // 2 foi removida (-4 > -8), 3 existe mas a marca (-3) é mais nova que o item (-50)
});

test('replaceWith: importar backup — o que sumiu vira marca de exclusão, o importado vence marcas antigas', () => {
  const current = lib({
    trackedShows: [show(1, 'watching', -100), show(2, 'watching', -100)],
    watchedEpisodes: { '1_s1_e1': watched(-100) },
    episodeNotes: { '1_s1_e1': note('x', -100) },
    tombstones: { shows: { 7: iso(-50) }, watched: {}, notes: {} }
  });
  const imported = lib({ trackedShows: [{ showId: 2, status: 'completed', addedAt: iso(-2000) }, { showId: 7, status: 'watching', addedAt: iso(-3000) }], watchedEpisodes: {}, episodeNotes: {} });
  const out = LM.replaceWith(current, imported, { now: NOW });
  assert.deepEqual(ids(out), [2, 7]);
  assert.equal(out.trackedShows.find(s => s.showId === 2).updatedAt, new Date(NOW).toISOString());
  assert.ok(out.tombstones.shows['1']);
  assert.equal(out.tombstones.shows['7'], undefined, 'item importado cancela a marca antiga');
  assert.ok(out.tombstones.watched['1_s1_e1']);
  assert.ok(out.tombstones.notes['1_s1_e1']);

  // um aparelho desatualizado, ao mesclar com o resultado, adota a importação (não ressuscita o que foi descartado)
  const staleDevice = lib({ trackedShows: [show(1, 'watching', -100), show(2, 'watching', -100)], watchedEpisodes: { '1_s1_e1': watched(-100) } });
  const merged = LM.merge(staleDevice, out, { now: NOW + 1000 });
  assert.deepEqual(ids(merged), [2, 7]);
  assert.equal(merged.trackedShows.find(s => s.showId === 2).status, 'completed');
  assert.deepEqual(merged.watchedEpisodes, {});
});

test('decideLogin: mesma conta mescla; conta diferente substitui (e manda arquivar); visitante mescla; demo cede ao servidor', () => {
  const local = lib({ trackedShows: [show(1, 'watching', -5)] });
  const remote = lib({ trackedShows: [show(2, 'watching', -5)] });

  const same = LM.decideLogin({ ownerId: 'usr_a', userId: 'usr_a', seeded: false, local, remote });
  assert.equal(same.action, 'merge');
  assert.deepEqual(ids(same.data), [1, 2]);

  const other = LM.decideLogin({ ownerId: 'usr_a', userId: 'usr_b', seeded: false, local, remote });
  assert.equal(other.action, 'replace');
  assert.equal(other.archiveLocal, true);
  assert.deepEqual(ids(other.data), [2], 'dados da conta A NÃO entram na conta B');
  assert.equal(LM.decideLogin({ ownerId: 'usr_a', userId: 'usr_b', seeded: false, local, remote: lib() }).data.trackedShows.length, 0);

  const guest = LM.decideLogin({ ownerId: '', userId: 'usr_b', seeded: false, local, remote });
  assert.equal(guest.action, 'merge');
  assert.deepEqual(ids(guest.data), [1, 2]);

  const demo = LM.decideLogin({ ownerId: '', userId: 'usr_b', seeded: true, local, remote: lib() });
  assert.equal(demo.action, 'replace');
  assert.equal(demo.data.trackedShows.length, 0, 'conta nova não herda a lista de exemplo');
});

// ---------------- regra de status por obra ----------------

const series = { id: 10, type: 'tv', seasons: [{ season_number: 1, episodes: [{ episode_number: 1 }, { episode_number: 2 }] }] };
const movie = { id: 20, type: 'movie' };
const progressOf = (media, done) => WS.computeProgress(media, (s, e) => done.has(media.type === 'movie' ? 'movie' : `${s}_${e}`));

test('watchStatus: progresso de série e filme', () => {
  assert.deepEqual(progressOf(series, new Set()), { total: 2, watched: 0, complete: false });
  assert.deepEqual(progressOf(series, new Set(['1_1'])), { total: 2, watched: 1, complete: false });
  assert.deepEqual(progressOf(series, new Set(['1_1', '1_2'])), { total: 2, watched: 2, complete: true });
  assert.deepEqual(progressOf(movie, new Set(['movie'])), { total: 1, watched: 1, complete: true });
  assert.equal(WS.computeProgress(null, () => true).complete, false);
  assert.equal(WS.computeProgress({ type: 'tv', seasons: [] }, () => true).complete, false, 'sem episódios conhecidos nunca é "completo"');
});

test('watchStatus: status inicial e transições automáticas', () => {
  assert.equal(WS.initialStatus(progressOf(series, new Set())), 'plan_to_watch');
  assert.equal(WS.initialStatus(progressOf(series, new Set(['1_1']))), 'watching');
  assert.equal(WS.initialStatus(progressOf(series, new Set(['1_1', '1_2']))), 'completed');

  const p1 = progressOf(series, new Set(['1_1']));
  const all = progressOf(series, new Set(['1_1', '1_2']));
  const none = progressOf(series, new Set());
  assert.equal(WS.statusAfterProgress('plan_to_watch', series, p1, true), 'watching');
  assert.equal(WS.statusAfterProgress('paused', series, p1, true), 'watching');
  assert.equal(WS.statusAfterProgress('dropped', series, p1, true), 'watching');
  assert.equal(WS.statusAfterProgress('watching', series, all, true), 'completed');
  assert.equal(WS.statusAfterProgress('completed', series, p1, false), 'watching');
  assert.equal(WS.statusAfterProgress('completed', series, none, false), 'plan_to_watch');
  assert.equal(WS.statusAfterProgress('paused', series, p1, false), 'paused', 'desmarcar não mexe em Pausado/Desisti');
  assert.equal(WS.statusAfterProgress('dropped', series, none, false), 'dropped');
  // filme
  assert.equal(WS.statusAfterProgress('plan_to_watch', movie, progressOf(movie, new Set(['movie'])), true), 'completed');
  assert.equal(WS.statusAfterProgress('completed', movie, progressOf(movie, new Set()), false), 'plan_to_watch');
  assert.equal(WS.statusAfterProgress('dropped', movie, progressOf(movie, new Set()), false), 'dropped');
});

test('watchStatus: effectiveStatus corrige só itens antigos e a fila ignora Finalizado/Pausado/Desisti', () => {
  const all = (s, e) => true;
  assert.equal(WS.effectiveStatus({ status: 'watching' }, series, all), 'completed', 'item antigo, tudo assistido');
  assert.equal(WS.effectiveStatus({ status: 'watching', updatedAt: iso(-1) }, series, all), 'watching', 'item novo: vale o que o usuário escolheu');
  assert.equal(WS.effectiveStatus({ status: 'paused' }, series, all), 'paused');
  assert.equal(WS.effectiveStatus({ status: '???' }, null, all), 'watching');
  assert.equal(WS.effectiveStatus({ status: '' }, null, all), 'watching');
  assert.deepEqual(['watching', 'plan_to_watch', 'paused', 'completed', 'dropped'].filter(WS.isQueueStatus), ['watching', 'plan_to_watch']);
  assert.match(WS.statusOptionsHtml('paused'), /<option value="paused" selected>Pausado<\/option>/);
  assert.equal((WS.statusOptionsHtml('paused').match(/selected/g) || []).length, 1);
});
