// Fix · sinopse curta no resumo leve da lista: truncamento e toSummaryItem. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const { truncateText } = require('../server/utils/sanitize');
const { toSummaryItem, SUMMARY_OVERVIEW_MAX } = require('../server/utils/mediaLight');

test('truncateText: texto curto fica igual (só espaços normalizados)', () => {
  assert.equal(truncateText('  Uma  frase   curta. '), 'Uma frase curta.');
  assert.equal(truncateText(null), '');
  assert.equal(truncateText(42), '');
});

test('truncateText: corta em ponto de palavra, termina em reticências e respeita o limite', () => {
  const text = Array.from({ length: 100 }, (_, i) => `palavra${i}`).join(' ');
  const out = truncateText(text, 50);
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= 51);
  const words = out.slice(0, -1).split(' ');
  assert.ok(
    words.every(w => /^palavra\d+$/.test(w)),
    'nenhuma palavra cortada ao meio'
  );
});

test('truncateText: não deixa pontuação antes das reticências nem parte um emoji', () => {
  assert.equal(truncateText('Olá, mundo, tudo bem com você hoje?', 15), 'Olá, mundo…');
  const emoji = '😀'.repeat(200);
  const out = truncateText(emoji, 11);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(out), 'sem meio emoji');
  assert.ok(out.endsWith('…'));
});

test('truncateText: entidades e aspas do texto já limpo ficam inteiras (sem "&am…")', () => {
  const out = truncateText('Tom & Jerry "juntos" ' + 'x'.repeat(300), 30);
  assert.ok(!/&[a-z#0-9]*…$/i.test(out));
});

test('toSummaryItem: traz a sinopse curta da obra; sem sinopse na fonte não inventa (campo ausente); episódios sem sinopse', () => {
  const base = {
    id: 1,
    type: 'anime',
    name: 'Obra',
    seasons: [
      {
        season_number: 1,
        name: 'T1',
        episodes: [{ episode_number: 1, name: 'E1', runtime: 24, air_date: '2020-01-01', overview: 'longa', still_path: null }]
      }
    ]
  };
  const withText = toSummaryItem({ ...base, overview: 'a '.repeat(500) });
  assert.ok(withText.overview.length <= SUMMARY_OVERVIEW_MAX + 1);
  assert.ok(withText.overview.endsWith('…'));
  assert.equal(withText.summary, true);
  assert.equal(withText.seasons[0].episodes[0].overview, undefined);

  assert.equal('overview' in toSummaryItem({ ...base, overview: '' }), false);
  assert.equal('overview' in toSummaryItem({ ...base }), false);
});
