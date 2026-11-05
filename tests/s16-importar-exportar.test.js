// S16 · Importar (MyAnimeList XML, TV Time CSV) e exportar (CSV, XML da MAL): leitura segura, correspondência, soma à biblioteca.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const IE = require('../public/js/utils/importExport');
const { validateBackup } = require('../public/js/utils/backupValidator');
const LibraryMerge = require('../public/js/utils/libraryMerge');

const fx = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'import', name), 'utf8');

test('MAL XML: lê campos, status, nota 1–10 como está e descarta item sem id', () => {
  const r = IE.parseMalXml(fx('mal-exemplo.xml'));
  assert.equal(r.items.length, 2);
  assert.equal(r.skipped.length, 1);
  assert.deepEqual(
    { id: r.items[0].malId, w: r.items[0].watched, s: r.items[0].status, score: r.items[0].score, t: r.items[0].title },
    { id: 900001, w: 5, s: 'watching', score: 8, t: 'Anime Ficticio Um' }
  );
  assert.equal(r.items[1].title, 'Teste & <b>Dois</b>'); // decodificado como TEXTO (a tela escapa)
  assert.equal(r.items[1].score, 0);
  assert.equal(r.items[1].status, 'completed');
  assert.equal(r.items[0].finishDate, '');
});

test('MAL XML: recusa DOCTYPE/ENTITY (XXE), arquivo errado e arquivo enorme', () => {
  const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><myanimelist><anime><series_animedb_id>1</series_animedb_id><series_title>&a;</series_title></anime></myanimelist>';
  assert.throws(() => IE.parseMalXml(evil), /DOCTYPE|ENTITY/);
  assert.throws(() => IE.parseMalXml('<html></html>'), /MyAnimeList/);
  assert.throws(() => IE.parseMalXml('x'.repeat(IE.MAX_FILE_CHARS + 1)), /grande demais/);
  const many = '<myanimelist>' + '<anime><series_animedb_id>5</series_animedb_id></anime>'.repeat(IE.MAX_ITEMS + 1) + '</myanimelist>';
  assert.throws(() => IE.parseMalXml(many), /demais/);
});

test('MAL XML: entidades desconhecidas não são expandidas', () => {
  const xml = '<myanimelist><anime><series_animedb_id>7</series_animedb_id><series_title>A&bomba;B&#60;i&#x3E;</series_title></anime></myanimelist>';
  assert.equal(IE.parseMalXml(xml).items[0].title, 'AB<i>');
});

test('CSV: aspas, vírgulas, quebras de linha e BOM', () => {
  const rows = IE.parseCsv('\uFEFFa,b\r\n"x, y","linha1\nlinha2"\r\n"aspas ""duplas""",z\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'linha1\nlinha2'], ['aspas "duplas"', 'z']]);
});

test('TV Time CSV: agrupa por obra, filmes à parte e ignora linhas sem episódio', () => {
  const r = IE.parseTvTimeCsv(fx('tvtime-exemplo.csv'));
  const serie = r.items.find(i => i.name === 'Serie Ficticia');
  assert.equal(serie.episodes.length, 2);
  assert.equal(serie.episodes[0].season, 1);
  assert.equal(serie.episodes[0].episode, 1);
  assert.match(serie.episodes[0].at, /^2024-02-0[12]T/);
  assert.ok(r.items.find(i => i.name === 'Serie, com virgula' && i.episodes[0].season === 2));
  const filme = r.items.find(i => i.movie);
  assert.equal(filme.name, 'Filme Ficticio');
  assert.equal(r.skippedCount, 1);
  assert.throws(() => IE.parseTvTimeCsv('foo,bar\n1,2\n'), /colunas/);
});

test('correspondência por título e ano', () => {
  const cand = { name: 'Café Noir', first_air_date: '2020-05-01' };
  assert.equal(IE.matchLevel({ name: 'cafe noir', year: 2020 }, cand), 'sure');
  assert.equal(IE.matchLevel({ name: 'Cafe Noir', year: 1999 }, cand), 'maybe');
  assert.equal(IE.matchLevel({ name: 'Cafe Noir: A Volta', year: null }, cand), 'maybe');
  assert.equal(IE.matchLevel({ name: 'Outra', year: null }, cand), 'no');
});

test('combineStatuses: temporadas da mesma franquia', () => {
  assert.equal(IE.combineStatuses(['completed', 'completed']), 'completed');
  assert.equal(IE.combineStatuses(['completed', 'plan_to_watch']), 'watching');
  assert.equal(IE.combineStatuses(['plan_to_watch', 'watching']), 'watching');
  assert.equal(IE.combineStatuses(['dropped', 'plan_to_watch']), 'dropped');
});

test('applyEntries: soma sem apagar, mantém o que já existe, relata conflitos e passa pelo validateBackup', () => {
  const data = LibraryMerge.emptyData();
  data.trackedShows.push({ showId: 10000900, status: 'paused', addedAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', rating: 5 });
  data.watchedEpisodes['10000900_s1_e1'] = { watched: true, watchedAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', rewatchCount: 1 };
  data.tombstones.shows['10000901'] = '2024-01-02T00:00:00.000Z';
  const entries = [
    { showId: 10000900, isMovie: false, status: 'watching', rating: 8, episodes: [{ season: 1, episode: 1, at: '' }, { season: 1, episode: 2, at: '2024-05-05T00:00:00.000Z' }] },
    { showId: 10000901, isMovie: false, status: 'watching', rating: 7.5, episodes: [{ season: 1, episode: 1, at: '' }] },
    { showId: 555, isMovie: true, status: 'completed', rating: null, episodes: [], movieAt: '' }
  ];
  const before = JSON.stringify(data);
  const { data: out, report } = IE.applyEntries(data, entries, { now: '2026-11-04T10:00:00.000Z' });
  assert.equal(JSON.stringify(data), before, 'não altera a entrada');
  assert.equal(report.showsNew, 2);
  assert.equal(report.episodesAdded, 3);
  assert.equal(report.episodesExisting, 1);
  assert.equal(report.conflicts.length, 1);
  const kept = out.trackedShows.find(t => t.showId === 10000900);
  assert.equal(kept.status, 'paused');
  assert.equal(kept.rating, 5);
  assert.equal(out.trackedShows.find(t => t.showId === 10000901).rating, 7.5);
  assert.equal(out.tombstones.shows['10000901'], undefined);
  assert.equal(out.watchedEpisodes['10000900_s1_e2'].watchedAt, '2024-05-05T00:00:00.000Z');
  assert.ok(out.watchedEpisodes['555_movie'].watched);
  assert.equal(validateBackup(out).trackedShows.length, 3);
});

test('nota fora do formato novo é ignorada (nunca arredonda)', () => {
  const { data } = IE.applyEntries(LibraryMerge.emptyData(), [{ showId: 1, isMovie: false, status: 'watching', rating: 8.55, episodes: [] }]);
  assert.equal(data.trackedShows[0].rating, undefined);
});

test('exportCsv: escapa aspas e neutraliza fórmulas', () => {
  const csv = IE.exportCsv([
    { showId: 1, type: 'anime', title: '=HYPERLINK("x")', status: 'watching', rating: 7.5, watched: 3, total: 12, addedAt: '2024-01-01' },
    { showId: 2, type: 'tv', title: 'A, B', status: 'completed', rating: null, watched: 1, total: 1, addedAt: '' }
  ]);
  assert.match(csv, /^\uFEFFid,tipo,titulo/);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"A, B"'));
  assert.equal(IE.parseCsv(csv).length, 3);
});

test('exportMalXml: formato da MAL, texto escapado, status e nota inteira, e ida-e-volta', () => {
  const xml = IE.exportMalXml([{ malId: 12, title: 'A & <B> "C"', type: 'TV', episodes: 12, watched: 12, status: 'completed', score: 8 }]);
  assert.match(xml, /<myanimelist>/);
  assert.match(xml, /<series_animedb_id>12<\/series_animedb_id>/);
  assert.match(xml, /<series_title>A &amp; &lt;B&gt; &quot;C&quot;<\/series_title>/);
  assert.match(xml, /<my_status>Completed<\/my_status>/);
  assert.match(xml, /<my_score>8<\/my_score>/);
  const back = IE.parseMalXml(xml);
  assert.equal(back.items[0].malId, 12);
  assert.equal(back.items[0].status, 'completed');
  assert.equal(back.items[0].title, 'A & <B> "C"');
});

test('tela: HTML tem os controles, scripts na ordem e nada inline', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const id of ['input-import-mal', 'input-import-tvtime', 'btn-export-csv', 'btn-export-mal-xml', 'modal-import', 'import-body']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.indexOf('js/utils/importExport.js') < html.indexOf('js/views/importView.js'));
  const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'importView.js'), 'utf8');
  assert.ok(!/onclick=|style=/.test(view));
});
