// Extras de anime separados (servidor): categoria de cada temporada (season/movie/special), nomes sequenciais, idempotência e migração local.
// Fixtures inventadas (fontes falsas), sem internet; pasta de dados temporária.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SHOWVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-anime-extras-'));

const { categoryOf, reclassifyWork } = require('../server/services/animeSeasons');
const { migrateAnimeSeasons } = require('../server/services/animeMigration');
const anilist = require('../server/services/anilistMapper');
const jikan = require('../server/services/jikanMapper');
const { toSummaryItem } = require('../server/utils/mediaLight');

// Franquia inventada, em ordem de estreia: S1 (TV), filme, S2 (TV), OVA, ONA de 1 ep, ONA de 6 eps.
const PLAN = [
  { id: 101, kind: 'TV', eps: 12, date: [2020, 1, 10], title: 'Fonte Falsa' },
  { id: 102, kind: 'MOVIE', eps: 1, date: [2020, 8, 1], title: 'Fonte Falsa: O Filme Inventado' },
  { id: 103, kind: 'TV', eps: 13, date: [2021, 1, 10], title: 'Fonte Falsa 2' },
  { id: 104, kind: 'OVA', eps: 2, date: [2021, 6, 1], title: 'Fonte Falsa OVA' },
  { id: 105, kind: 'ONA', eps: 1, date: [2022, 1, 1], title: 'Fonte Falsa Curta' },
  { id: 106, kind: 'ONA', eps: 6, date: [2022, 6, 1], title: 'Fonte Falsa Web' }
];
const JIKAN_TYPE = { TV: 'TV', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA' };
const pad = n => String(n).padStart(2, '0');

function anilistWork() {
  const nodes = PLAN.map(p => ({
    id: p.id,
    format: p.kind,
    title: { english: p.title },
    episodes: p.eps,
    duration: 24,
    status: 'FINISHED',
    startDate: { year: p.date[0], month: p.date[1], day: p.date[2] },
    seasonYear: p.date[0]
  }));
  return anilist.buildAnimeWork(9001, { anilistId: 101 }, { nodes, visited: PLAN.map(p => p.id), truncated: false });
}

function jikanWork() {
  const nodes = PLAN.map(p => ({
    mal_id: p.id,
    type: JIKAN_TYPE[p.kind],
    title: p.title,
    episodes: p.eps,
    duration: '24 min per ep',
    status: 'Finished Airing',
    aired: { from: `${p.date[0]}-${pad(p.date[1])}-${pad(p.date[2])}T00:00:00+00:00` },
    year: p.date[0]
  }));
  return jikan.buildAnimeWork(9002, 101, { nodes, episodes: new Map(), visited: PLAN.map(p => p.id), truncated: false });
}

const WORKS = { AniList: anilistWork, Jikan: jikanWork };

test('categoryOf: regras para AniList e Jikan', () => {
  for (const k of [undefined, null, '', 'TV', 'TV_SHORT', 'TV Short']) assert.equal(categoryOf(k, 12), 'season');
  assert.equal(categoryOf('ONA', 1), 'special');
  assert.equal(categoryOf('ONA', 0), 'special');
  assert.equal(categoryOf('ONA', 2), 'season');
  for (const k of ['MOVIE', 'Movie']) assert.equal(categoryOf(k, 1), 'movie');
  for (const k of ['OVA', 'SPECIAL', 'Special', 'TV Special', 'MUSIC', 'Qualquer']) assert.equal(categoryOf(k, 3), 'special');
});

for (const [fonte, build] of Object.entries(WORKS)) {
  test(`${fonte}: categorias, nomes sequenciais e season_number estável`, () => {
    const work = build();
    assert.deepEqual(
      work.seasons.map(s => s.season_number),
      [1, 2, 3, 4, 5, 6]
    );
    assert.deepEqual(
      work.seasons.map(s => s.category),
      ['season', 'movie', 'season', 'special', 'special', 'season']
    );
    const names = work.seasons.map(s => s.name);
    assert.match(names[0], /^Temporada 1( · |$)/);
    assert.match(names[1], /^Filme: Fonte Falsa: O Filme Inventado/);
    assert.match(names[2], /^Temporada 2( · |$)/);
    assert.match(names[3], /^OVA: Fonte Falsa OVA/);
    assert.match(names[4], /^ONA: Fonte Falsa Curta/);
    assert.match(names[5], /^Temporada 3( · |$)/);
    assert.deepEqual(
      work.franchise.entries.map(e => e.season_number),
      [1, 2, 3, 4, 5, 6]
    );
  });

  test(`${fonte}: reclassifyWork é idempotente (devolve o mesmo objeto)`, () => {
    const work = build();
    assert.equal(reclassifyWork(work), work);
    assert.deepEqual(build(), work);
  });

  test(`${fonte}: obra guardada antes vs depois mantém episódios e marcações`, () => {
    const depois = build();
    // "Antes": tudo temporada (sem category), ONA solta como "Temporada 3" e a de 6 eps como "Temporada 4".
    const antigoNomes = [
      'Temporada 1 · 2020',
      'Filme: Fonte Falsa: O Filme Inventado',
      'Temporada 2 · 2021',
      'OVA: Fonte Falsa OVA',
      'Temporada 3',
      'Temporada 4'
    ];
    const antes = {
      ...depois,
      seasons: depois.seasons.map((s, i) => {
        const { category, ...rest } = s;
        return { ...rest, name: antigoNomes[i] };
      })
    };
    const marcacoes = {}; // simulação do que o usuário marcou (fica fora da obra)
    for (const s of antes.seasons) for (const ep of s.episodes) marcacoes[`${antes.id}_s${s.season_number}_e${ep.episode_number}`] = true;
    const antesMarcas = JSON.stringify(marcacoes);

    const migrada = reclassifyWork(antes);
    assert.notEqual(migrada, antes);
    assert.equal(migrada.seasons[4].name.startsWith('ONA: '), true);
    assert.equal(migrada.seasons[5].name, 'Temporada 3');
    assert.equal(migrada.seasons[0].name, 'Temporada 1 · 2020'); // sufixo preservado
    assert.deepEqual(
      migrada.seasons.map(s => [s.season_number, s.episodes]),
      antes.seasons.map(s => [s.season_number, s.episodes])
    );
    assert.deepEqual(migrada.franchise, antes.franchise);

    const depoisMarcas = {};
    for (const s of migrada.seasons)
      for (const ep of s.episodes) depoisMarcas[`${migrada.id}_s${s.season_number}_e${ep.episode_number}`] = true;
    assert.equal(JSON.stringify(depoisMarcas), antesMarcas);
    assert.equal(reclassifyWork(migrada), migrada);
  });
}

test('migrateAnimeSeasons: migra só anime, segunda passada não muda nada', () => {
  const novo = anilistWork();
  const velho = {
    ...novo,
    id: 9003,
    seasons: novo.seasons.map(({ category, ...s }) => ({ ...s, name: s.name.replace(/^ONA: .*/, 'Temporada 3') }))
  };
  const filme = { id: 9004, type: 'movie', name: 'Filme X', seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [] }] };
  const tv = {
    id: 9005,
    type: 'tv',
    name: 'Série Y',
    seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [{ episode_number: 1 }] }]
  };
  const semFranquia = {
    id: 9006,
    type: 'anime',
    name: 'Anime do seed',
    seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [] }]
  };
  const items = [velho, filme, tv, semFranquia];

  const r1 = migrateAnimeSeasons(items);
  assert.deepEqual(
    r1.changed.map(c => c.id),
    [9003]
  );
  assert.equal(r1.items[1], filme);
  assert.equal(r1.items[2], tv);
  assert.equal(r1.items[3], semFranquia);
  assert.equal(r1.items[0].seasons[0].category, 'season');
  assert.equal(r1.items[3].seasons[0].category, undefined);

  const r2 = migrateAnimeSeasons(r1.items);
  assert.equal(r2.changed.length, 0);
  assert.equal(r2.items, r1.items);
});

test('obra não-anime ou sem franquia volta intacta, sem category', () => {
  const tv = {
    id: 1,
    type: 'tv',
    seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [] }],
    franchise: { entries: [{ season_number: 1, kind: 'MOVIE' }] }
  };
  assert.equal(reclassifyWork(tv), tv);
  const sem = { id: 2, type: 'anime', seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [] }] };
  assert.equal(reclassifyWork(sem), sem);
});

test('nome fora do padrão "Temporada N" é mantido numa temporada de categoria season', () => {
  const work = {
    id: 3,
    type: 'anime',
    seasons: [{ season_number: 1, name: 'Parte Especial', episodes: [{ episode_number: 1 }, { episode_number: 2 }] }],
    franchise: { entries: [{ season_number: 1, kind: 'ONA', title: 'X' }] }
  };
  const r = reclassifyWork(work);
  assert.equal(r.seasons[0].name, 'Parte Especial');
  assert.equal(r.seasons[0].category, 'season');
});

test('toSummaryItem inclui category quando existir', () => {
  const s = toSummaryItem(anilistWork());
  assert.deepEqual(
    s.seasons.map(x => x.category),
    ['season', 'movie', 'season', 'special', 'special', 'season']
  );
  const sem = toSummaryItem({ id: 5, type: 'tv', name: 'Y', seasons: [{ season_number: 1, name: 'T1', episodes: [] }] });
  assert.equal('category' in sem.seasons[0], false);
});

test('carryOverEpisodeData mantém category', () => {
  const work = anilistWork();
  const out = anilist.carryOverEpisodeData(work, work);
  assert.deepEqual(
    out.seasons.map(s => s.category),
    work.seasons.map(s => s.category)
  );
});
