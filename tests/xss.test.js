const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dom = require('../public/js/utils/dom');
const { validateBackup } = require('../public/js/utils/backupValidator');
const { stripHtml, stripHtmlList, safeHttpUrl } = require('../server/utils/sanitize');
const LibraryModel = require('../server/models/LibraryModel');

const PAYLOAD = '<img src=x onerror=alert(1)>';

test('escapeHtml neutraliza HTML e aceita qualquer tipo', () => {
  const out = dom.escapeHtml(PAYLOAD);
  assert.ok(!out.includes('<') && !out.includes('>'));
  assert.equal(dom.escapeHtml('" onmouseover="x'), '&quot; onmouseover=&quot;x');
  assert.equal(dom.escapeHtml("'"), '&#039;');
  assert.equal(dom.escapeHtml(null), '');
  assert.equal(dom.escapeHtml(undefined), '');
  assert.equal(dom.escapeHtml(0), '0');
  assert.equal(dom.escapeHtml(12.5), '12.5');
  assert.equal(dom.escapeHtml({ toString: () => '<b>' }), '&lt;b&gt;');
  assert.equal(dom.escapeHtml(['<a>']), '&lt;a&gt;');
});

test('safeUrl só aceita http(s) e data:image', () => {
  assert.equal(dom.safeUrl('https://exemplo.com/a.jpg'), 'https://exemplo.com/a.jpg');
  assert.equal(dom.safeUrl('http://exemplo.com/a.jpg'), 'http://exemplo.com/a.jpg');
  assert.ok(dom.safeUrl('data:image/png;base64,AAAA'));
  const bad = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:x', '//evil.com/x.png', 'file:///etc/passwd', '', null, undefined, 42, {}];
  for (const b of bad) assert.equal(dom.safeUrl(b), '', String(b));
});

test('safeSrc e cssUrl não deixam fechar atributo nem url()', () => {
  const evil = 'https://x.com/a.jpg" onerror="alert(1)';
  assert.ok(!dom.safeSrc(evil).includes('"'));
  const css = dom.cssUrl("https://x.com/a.jpg');background:url('https://evil");
  assert.ok(css.startsWith('url("') && css.endsWith('")'));
  const inner = css.slice(5, -2);
  assert.ok(!/["'()\s]/.test(inner), inner);
  assert.equal(dom.cssUrl('javascript:alert(1)'), 'none');
  assert.equal(dom.cssUrl(undefined), 'none');
});

test('toInt e formatRating não quebram com null ou texto', () => {
  assert.equal(dom.toInt('12'), 12);
  assert.equal(dom.toInt('1);alert(1);//'), 0);
  assert.equal(dom.toInt(null, 5), 5);
  assert.equal(dom.formatRating(8.349), '8.3');
  assert.equal(dom.formatRating('7.5'), '7.5');
  assert.equal(dom.formatRating(null), '–');
  assert.equal(dom.formatRating(undefined), '–');
  assert.equal(dom.formatRating('abc'), '–');
  assert.equal(dom.formatRating(0), '0.0');
});

test('validateBackup aceita backup válido e descarta campos extras', () => {
  const ok = validateBackup({
    trackedShows: [{ showId: 1, status: 'watching', addedAt: 'x', admin: true }],
    watchedEpisodes: { '1_s1_e1': { watched: true, watchedAt: 'x', rewatchCount: 2 } },
    episodeNotes: { '1_movie': { text: 'ok', emotion: 'fun', character: 'A', updatedAt: 'x', snapshots: [], extra: 1 } },
    seeded: true
  });
  assert.deepEqual(Object.keys(ok).sort(), ['episodeNotes', 'resetAt', 'tombstones', 'trackedShows', 'watchedEpisodes']);
  assert.deepEqual(Object.keys(ok.trackedShows[0]).sort(), ['addedAt', 'showId', 'status']);
  assert.equal('extra' in ok.episodeNotes['1_movie'], false);
});

test('validateBackup recusa backups malformados ou malignos', () => {
  const base = { trackedShows: [], watchedEpisodes: {}, episodeNotes: {} };
  const bad = [
    null, 'texto', [], {},
    { ...base, trackedShows: {} },
    { ...base, trackedShows: [{ showId: '1' }] },
    { ...base, trackedShows: [{ showId: 1 }, { showId: 1 }] },
    { ...base, watchedEpisodes: { '<img>': { watched: true } } },
    { ...base, watchedEpisodes: { '1_s1_e1': 'sim' } },
    { ...base, episodeNotes: { '1_s1_e1<script>': { text: 'x' } } },
    { ...base, episodeNotes: { '1_s1_e1': 'texto' } }
  ];
  for (const b of bad) assert.throws(() => validateBackup(b), /inválido/i, JSON.stringify(b));
});

test('validateBackup limita tamanhos e trata emotion como texto curto', () => {
  const out = validateBackup({
    trackedShows: [],
    watchedEpisodes: {},
    episodeNotes: { '1_s1_e1': { text: 'a'.repeat(30000), emotion: PAYLOAD.repeat(10), character: 'b'.repeat(500), snapshots: [] } }
  });
  const n = out.episodeNotes['1_s1_e1'];
  assert.equal(n.text.length, 20000);
  assert.equal(n.character.length, 200);
  assert.ok(n.emotion.length <= 40);
  const numeric = validateBackup({ trackedShows: [], watchedEpisodes: {}, episodeNotes: { '1_s1_e1': { emotion: 5 } } });
  assert.equal(numeric.episodeNotes['1_s1_e1'].emotion, null);
});

test('validateBackup do navegador e LibraryModel.validate dão o mesmo resultado', () => {
  const samples = [
    {
      trackedShows: [{ showId: 7, status: 'watching', addedAt: 'a' }],
      watchedEpisodes: { '7_s2_e3': { watched: true, rewatchCount: 5 } },
      episodeNotes: { '7_movie': { text: 't', emotion: 'sad', character: 'c', updatedAt: 'u', snapshots: [{ text: 's', updatedAt: 'u', z: 1 }] } }
    },
    { trackedShows: [], watchedEpisodes: { '1_movie': { watched: 'yes', rewatchCount: -3 } }, episodeNotes: {} },
    // S03: updatedAt, marcas de exclusão e resetAt
    {
      trackedShows: [{ showId: 3, status: 'paused', addedAt: 'a', updatedAt: '2026-10-26T10:00:00.000Z' }, { showId: 4, status: 'x', updatedAt: 'lixo' }],
      watchedEpisodes: { '3_s1_e1': { watched: true, watchedAt: 'w', updatedAt: '2026-10-26T10:00:00.000Z', rewatchCount: 1 } },
      episodeNotes: {},
      tombstones: { shows: { 9: '2026-10-26T11:00:00.000Z' }, watched: { '3_s1_e2': '2026-10-26T11:00:00.000Z' }, notes: { '3_movie': '2026-10-26T11:00:00.000Z' } },
      resetAt: '2026-10-25T00:00:00.000Z'
    },
    { trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: null, resetAt: 12345 }
  ];
  for (const s of samples) assert.deepEqual(validateBackup(s), LibraryModel.validate(s));

  // entradas inválidas nas marcas de exclusão: os dois recusam
  const badTombstones = [
    { shows: { abc: '2026-10-26T11:00:00.000Z' } },
    { shows: { 1: 'não é data' } },
    { watched: { '1_s1_e1': 5 } },
    { notes: { '../x': '2026-10-26T11:00:00.000Z' } },
    { watched: [] },
    'texto'
  ];
  for (const tombstones of badTombstones) {
    const s = { trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones };
    assert.throws(() => validateBackup(s), /inválido/i, JSON.stringify(tombstones));
    assert.throws(() => LibraryModel.validate(s), /inválid/i, JSON.stringify(tombstones));
  }
});

test('stripHtml remove tags, scripts e entidades que recriam tags', () => {
  assert.equal(stripHtml('<p>Olá <b>mundo</b></p>'), 'Olá mundo');
  assert.equal(stripHtml(PAYLOAD), '');
  assert.equal(stripHtml('Nome <script>alert(1)</script>Normal'), 'Nome Normal');
  assert.equal(stripHtml('&lt;img src=x onerror=alert(1)&gt;'), '');
  assert.ok(!/[<>]/.test(stripHtml('a < b > c <i')));
  assert.equal(stripHtml('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
  assert.equal(stripHtml(123), '123');
  assert.equal(stripHtml('x'.repeat(50), 10).length, 10);
});

test('stripHtmlList e safeHttpUrl', () => {
  assert.deepEqual(stripHtmlList(['<b>Drama</b>', PAYLOAD, 'Ação']), ['Drama', 'Ação']);
  assert.deepEqual(stripHtmlList('x'), []);
  assert.equal(safeHttpUrl('https://a.com/x.jpg'), 'https://a.com/x.jpg');
  assert.equal(safeHttpUrl('javascript:alert(1)', 'fb'), 'fb');
  assert.equal(safeHttpUrl(null, 'fb'), 'fb');
});

test('views não definem escapeHtml própria e toast usa textContent', () => {
  const viewsDir = path.join(__dirname, '..', 'public', 'js', 'views');
  for (const f of fs.readdirSync(viewsDir)) {
    const src = fs.readFileSync(path.join(viewsDir, f), 'utf8');
    assert.ok(!/^\s*escapeHtml\s*\(.*\)\s*\{/m.test(src), `${f} tem cópia própria de escapeHtml`);
    assert.ok(!/this\.escapeHtml\(/.test(src), `${f} usa this.escapeHtml`);
  }
  const ctrl = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controllers', 'appController.js'), 'utf8');
  assert.ok(!/toast\.innerHTML/.test(ctrl), 'showToast não pode usar innerHTML');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/utils/dom.js') > -1 && html.indexOf('js/utils/dom.js') < html.indexOf('js/views/nextUpView.js'));
});
