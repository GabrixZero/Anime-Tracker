// S17 · Nota pessoal de 0 a 10 (uma casa decimal): regra única, estado, merge/sync, espelhos servidor x backup, estatísticas e HTML escapado.
// Nada de rede e nada em server/data: o servidor usa uma pasta temporária; o estado roda em `vm` com localStorage falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const Rating = require('../public/js/utils/rating');
const LM = require('../public/js/utils/libraryMerge');
const { validateBackup } = require('../public/js/utils/backupValidator');
const { LibraryModel } = require('../server/models/LibraryModel');

const ROOT = path.join(__dirname, '..', 'public');
const NOW = Date.parse('2026-06-01T12:00:00.000Z');

// ---------------------------------------------------------------- regra da nota

test('normalizeRating: aceita 0 a 10 com 1 casa; rejeita mais casas, fora da faixa e lixo (sem arredondar)', () => {
  for (const [input, expected] of [
    [2.3, 2.3],
    [6.6, 6.6],
    [9.2, 9.2],
    [0, 0],
    [10, 10],
    ['6.6', 6.6],
    [' 7 ', 7],
    ['0', 0],
    [5, 5],
    ['2.30', 2.3]
  ]) {
    assert.equal(Rating.normalizeRating(input), expected, String(input));
  }
  for (const bad of [2.35, -1, 10.1, 'abc', '', null, undefined, NaN, Infinity, '6,6', '1e1', true, [], {}, '-1', 10.01, 0.05, '2.35']) {
    assert.equal(Rating.normalizeRating(bad), null, String(bad));
  }
  assert.equal(Rating.formatUserRating(6.6), '6.6');
  assert.equal(Rating.formatUserRating(7), '7.0');
  assert.equal(Rating.formatUserRating(0), '0.0');
  assert.equal(Rating.formatUserRating('abc'), '');
});

// ---------------------------------------------------------------- servidor x backup (espelhados)

function validateOnServer(show) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-s17-'));
  try {
    return new LibraryModel(dir).validate({ trackedShows: [show], watchedEpisodes: {}, episodeNotes: {} }).trackedShows[0];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const validateInBackup = show => validateBackup({ trackedShows: [show], watchedEpisodes: {}, episodeNotes: {} }).trackedShows[0];

test('LibraryModel.validate e validateBackup dão o mesmo resultado para a nota (inválida = rejeita, com mensagem em português)', () => {
  const base = { showId: 1, status: 'watching', addedAt: '2026-01-01T00:00:00.000Z' };
  for (const rating of [2.3, 6.6, 9.2, 0, 10, '6.6']) {
    const a = validateOnServer({ ...base, rating });
    const b = validateInBackup({ ...base, rating });
    assert.deepEqual(a, b);
    assert.equal(a.rating, Number(rating));
  }
  // sem nota (ausente, null ou vazio): o campo some nos dois
  for (const rating of [undefined, null, '']) {
    assert.ok(!('rating' in validateOnServer({ ...base, rating })));
    assert.ok(!('rating' in validateInBackup({ ...base, rating })));
  }
  for (const rating of [2.35, -1, 10.1, 'abc', true, {}, [3]]) {
    assert.throws(() => validateOnServer({ ...base, rating }), /Nota inválida/, String(rating));
    assert.throws(() => validateInBackup({ ...base, rating }), /nota incorreta/, String(rating));
  }
});

// ---------------------------------------------------------------- estado (vm com o state.js real)

function makeDevice() {
  const store = new Map();
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
    WeakMap,
    Error,
    Date,
    Intl,
    isNaN,
    parseInt,
    Symbol,
    Boolean,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        store.set(k, String(v));
      },
      removeItem: k => {
        store.delete(k);
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of [
    'utils/dom.js',
    'utils/mediaDisplay.js',
    'utils/viewKit.js',
    'utils/libraryMerge.js',
    'utils/rating.js',
    'utils/watchStatus.js',
    'models/state.js'
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf-8'), ctx, { filename: f });
  }
  return ctx.appState;
}
const plain = v => JSON.parse(JSON.stringify(v));

test('AppState.setRating/getRating: grava, valida, remove e renova updatedAt; valor inválido não grava', () => {
  const s = makeDevice();
  assert.equal(s.setRating(1, 5), false, 'obra fora da lista');
  s.addShow(1);
  const t0 = s.getTracked(1).updatedAt;
  assert.equal(s.getRating(1), null);

  assert.equal(s.setRating(1, '6.6'), true);
  assert.equal(s.getRating(1), 6.6);
  const t1 = s.getTracked(1).updatedAt;
  assert.ok(Date.parse(t1) > Date.parse(t0));

  assert.equal(s.setRating(1, 0), true);
  assert.equal(s.getRating(1), 0, '0 é uma nota válida');
  for (const bad of [2.35, -1, 10.1, 'abc']) {
    assert.equal(s.setRating(1, bad), false, String(bad));
    assert.equal(s.getRating(1), 0, 'nota anterior intacta');
  }
  const t2 = s.getTracked(1).updatedAt;
  assert.equal(s.setRating(1, 0), true);
  assert.equal(s.getTracked(1).updatedAt, t2, 'mesma nota: nada muda');

  assert.equal(s.setRating(1, ''), true);
  assert.equal(s.getRating(1), null);
  assert.ok(!('rating' in s.getTracked(1)), 'remover apaga o campo');
  assert.ok(Date.parse(s.getTracked(1).updatedAt) > Date.parse(t2));
  assert.equal(s.setRating(1, null), true, 'remover de novo é inofensivo');
});

// ---------------------------------------------------------------- merge / sync

const show = (extra = {}) => ({ showId: 7, status: 'watching', addedAt: '2026-01-01T00:00:00.000Z', ...extra });
const data = shows => ({ trackedShows: shows, watchedEpisodes: {}, episodeNotes: {} });

test('merge: a nota mais nova vence; alterar e remover sincronizam; a nota antiga não ressuscita', () => {
  const old = show({ rating: 4.5, updatedAt: '2026-02-01T00:00:00.000Z' });
  const changed = show({ rating: 8.1, updatedAt: '2026-03-01T00:00:00.000Z' });
  const removed = show({ updatedAt: '2026-04-01T00:00:00.000Z' }); // sem rating

  for (const [a, b] of [
    [old, changed],
    [changed, old]
  ]) {
    assert.equal(LM.merge(data([a]), data([b]), { now: NOW }).trackedShows[0].rating, 8.1, 'alterar');
  }
  for (const [a, b] of [
    [changed, removed],
    [removed, changed],
    [old, removed],
    [removed, old]
  ]) {
    const out = LM.merge(data([a]), data([b]), { now: NOW }).trackedShows[0];
    assert.ok(!('rating' in out), 'remover vence e não ressuscita a nota antiga');
  }
  // empate exato: vale o local (primeiro argumento), sem misturar campos
  const same = '2026-05-01T00:00:00.000Z';
  const l = show({ rating: 3.3, updatedAt: same });
  const r = show({ rating: 9.9, updatedAt: same });
  assert.equal(LM.merge(data([l]), data([r]), { now: NOW }).trackedShows[0].rating, 3.3);
  assert.equal(LM.merge(data([r]), data([l]), { now: NOW }).trackedShows[0].rating, 9.9);
});

test('dois aparelhos pelo estado real: nota dada num aparelho chega ao outro; remoção também', () => {
  const a = makeDevice();
  a.addShow(7);
  const b = makeDevice();
  b.replaceData(plain(a.data));

  a.setRating(7, 6.6);
  b.replaceData(LM.merge(b.data, plain(a.data), { now: Date.now() }));
  assert.equal(b.getRating(7), 6.6);

  b.setRating(7, '');
  a.replaceData(LM.merge(a.data, plain(b.data), { now: Date.now() }));
  assert.equal(a.getRating(7), null, 'remoção propagada');
  assert.ok(!('rating' in a.getTracked(7)));
});

test('replaceWith (importar backup) mantém a nota das obras importadas', () => {
  const imported = data([show({ rating: 9.2, updatedAt: '2026-02-01T00:00:00.000Z' })]);
  const out = LM.replaceWith(data([]), imported, { now: NOW });
  assert.equal(out.trackedShows[0].rating, 9.2);
});

// ---------------------------------------------------------------- estatísticas

test('computeRatingStats: média, distribuição por faixa e top 5 (desempate por título)', () => {
  const items = [
    { showId: 1, title: 'Zeta', rating: 9.2 },
    { showId: 2, title: 'Alfa', rating: 9.2 },
    { showId: 3, title: 'Beta', rating: 6.6 },
    { showId: 4, title: 'Gama', rating: 2.3 },
    { showId: 5, title: 'Delta', rating: 0 },
    { showId: 6, title: 'Épsilon', rating: 10 },
    { showId: 7, title: 'Sem nota', rating: undefined },
    { showId: 8, title: 'Lixo', rating: 2.35 },
    { showId: 9, title: 'Eta', rating: 8 }
  ];
  const s = Rating.computeRatingStats(items);
  assert.equal(s.count, 7);
  assert.equal(s.average, 6.5); // (9.2+9.2+6.6+2.3+0+10+8)/7 = 45.3/7 = 6.47 -> 6.5
  assert.deepEqual(
    s.distribution.map(b => [b.label, b.count]),
    [
      ['0–2', 1],
      ['2–4', 1],
      ['4–6', 0],
      ['6–8', 1],
      ['8–10', 4]
    ]
  );
  assert.deepEqual(
    s.top.map(t => t.title),
    ['Épsilon', 'Alfa', 'Zeta', 'Eta', 'Beta']
  );
  assert.equal(s.top.length, 5);

  const empty = Rating.computeRatingStats([{ showId: 1, title: 'x' }]);
  assert.deepEqual([empty.count, empty.average, empty.top.length], [0, null, 0]);
  assert.equal(Rating.computeRatingStats(null).count, 0);
});

// ---------------------------------------------------------------- HTML

test('HTML da nota: escapa título/valores, sem style/onclick, com rótulo acessível, botão type=button e ações registradas', () => {
  const evil = '<img src=x onerror=alert(1)>"\'';
  const html = [
    Rating.ratingControlHtml({ showId: '7"><b>', name: evil, rating: 6.6, idPrefix: 'detail-rating' }),
    Rating.userRatingBadgeHtml(6.6)
  ].join('');
  assert.ok(!html.includes('<img') && !html.includes('<b>'), 'nada de tag solta');
  // (o texto malicioso escapado contém "onerror=" só como texto; a checagem de atributos usa um nome inofensivo)
  const clean = Rating.ratingControlHtml({ showId: 7, name: 'X', rating: 6.6 });
  assert.ok(!/\son[a-z]+\s*=|\sstyle\s*=/i.test(clean), 'sem onclick/style inline');
  assert.match(html, /Minha nota \(0 a 10\)/);
  assert.match(html, /type="number" class="rating-input"[^>]*min="0" max="10" step="0.1" inputmode="decimal"/);
  assert.match(html, /<button type="button"[^>]*data-action="clear-rating"[^>]*>Remover nota<\/button>/);
  assert.ok(!html.includes('Nota do catálogo'), 'o texto "Nota do catálogo" foi removido (D-AV3-1)');
  assert.match(html, /★ 6\.6/);

  // sem nota: o botão Remover nasce desabilitado e o selo some
  const none = Rating.ratingControlHtml({ showId: 7, name: 'X', rating: undefined });
  assert.match(none, /value=""/);
  assert.match(none, /clear-rating"[^>]*disabled/);
  assert.equal(Rating.userRatingBadgeHtml(undefined), '');

  const handlers = fs.readFileSync(path.join(ROOT, 'js', 'controllers', 'actionHandlers.js'), 'utf-8');
  assert.match(handlers, /A\.onChange\('set-rating'/);
  assert.match(handlers, /A\.on\('clear-rating'/);
  assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8'), /<script src="js\/utils\/rating\.js"><\/script>/);
});
