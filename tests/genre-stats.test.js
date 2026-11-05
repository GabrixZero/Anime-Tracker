// Top gêneros: uma contagem por obra da lista, independente de episódios assistidos.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { countGenres, NO_GENRE } = require('../public/js/utils/genreStats');

const catalog = {
  1: { genres: ['Drama', 'Crime'] },
  2: { genres: ['Drama'] },
  3: { genres: [] },
  4: { genres: ['Drama', 'Drama', ' '] }
};
const get = id => catalog[id];

test('conta uma vez por obra, com vários gêneros por obra', () => {
  const r = countGenres([{ showId: 1 }, { showId: 2 }], get);
  assert.deepEqual(r, [
    { genre: 'Drama', count: 2 },
    { genre: 'Crime', count: 1 }
  ]);
});

test('não depende de episódios: obra repetida na lista ou gênero repetido na obra conta uma vez', () => {
  assert.deepEqual(countGenres([{ showId: 4 }, { showId: 4 }], get), [{ genre: 'Drama', count: 1 }]);
});

test('obra removida da lista não conta (só trackedShows entram)', () => {
  assert.deepEqual(countGenres([{ showId: 2 }], get), [{ genre: 'Drama', count: 1 }]);
  assert.deepEqual(countGenres([], get), []);
});

test('obra sem gênero conta como "Sem gênero"; obra sem detalhe carregado é ignorada', () => {
  assert.deepEqual(countGenres([{ showId: 3 }, { showId: 99 }], get), [{ genre: NO_GENRE, count: 1 }]);
});

test('limite e desempate alfabético', () => {
  const r = countGenres([{ showId: 1 }], get, 1);
  assert.deepEqual(r, [{ genre: 'Crime', count: 1 }]);
});
