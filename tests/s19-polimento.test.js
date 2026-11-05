// S19 · polimento final: dados do seed sem invenção e chave id_sN_eM montada num lugar só.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('seed: Demon Slayer, Jujutsu Kaisen e Death Note só têm episódio com título e data conferidos (nada de sinopse/imagem inventada)', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(root, 'server', 'data', 'mediaCatalog.seed.json'), 'utf8'));
  for (const id of [85937, 95479, 13916]) {
    const work = seed.find(m => m.id === id);
    assert.ok(work, `obra ${id} no seed`);
    for (const season of work.seasons) {
      for (const ep of season.episodes) {
        assert.ok(ep.name && ep.air_date, `${work.name}: episódio ${ep.episode_number} precisa de título e data`);
        for (const campo of ['overview', 'still_path', 'runtime'])
          assert.equal(ep[campo], undefined, `${work.name}: ${campo} não verificado`);
      }
    }
  }
});

test('a chave id_sN_eM é montada só por ViewKit.makeKey (state, importação e exportação não repetem o formato)', () => {
  for (const file of ['models/state.js', 'views/importView.js', 'utils/importExport.js']) {
    const src = fs.readFileSync(path.join(root, 'public', 'js', file), 'utf8');
    assert.ok(!/_s\$\{/.test(src), `${file} ainda monta a chave à mão`);
  }
  const ViewKit = require('../public/js/utils/viewKit.js');
  assert.equal(ViewKit.makeKey(7, 2, 5), '7_s2_e5');
  assert.equal(ViewKit.makeKey(7, null, null, true), '7_movie');
});
