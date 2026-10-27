// S13 · qualidade do catálogo: migração idempotente (com backup) do catálogo de runtime ANTIGO (nota 8.0 / "Drama" / Unsplash) e
// atualização das obras em exibição (validade por obra, refresh, conferência automática). Fontes simuladas; pastas temporárias.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeService, tempRoot, respond } = require('./helpers/anilistFixtures');
const T = tempRoot('showvault-s13-catalog-');
process.env.SHOWVAULT_DATA_DIR = path.join(T.root, 'singleton');
fs.mkdirSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true });

const { MediaService } = require('../server/services/mediaService');
const { migrateLegacyCatalog, legacyKind } = require('../server/services/catalogMigration');
const { mediaErrors } = require('../server/utils/errors');

const clone = v => JSON.parse(JSON.stringify(v));
const HOUR = 60 * 60 * 1000;
const UNSPLASH_POSTER = 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500';
const UNSPLASH_BACKDROP = 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?w=600';
const backups = dir => fs.readdirSync(dir).filter(n => /^mediaCatalog\.backup-pre-s13-.+\.json$/.test(n));
const runtimeFile = dir => path.join(dir, 'mediaCatalog.runtime.json');
const readRuntime = dir => JSON.parse(fs.readFileSync(runtimeFile(dir), 'utf-8'));

// Obra gravada pelo mapper ANTIGO do TVMaze (antes da S06): inventava nota 8.0, gênero "Drama" e fotos do banco de imagens.
const legacy = (id, o = {}) => ({
  id, type: 'tv', name: `Série ${id}`, overview: 'x', poster_path: UNSPLASH_POSTER, backdrop_path: UNSPLASH_BACKDROP, vote_average: 8, first_air_date: '2013-01-01',
  genres: ['Drama'], status: 'Em Exibição', ingestedAt: '2026-10-25T10:00:00.000Z',
  seasons: [{ season_number: 1, name: 'Temporada 1', episodes: [{ episode_number: 1, name: 'Piloto', runtime: 45, air_date: '2013-01-01', overview: '', still_path: UNSPLASH_POSTER }] }], ...o
});

function legacyRuntime() {
  return [
    legacy(1000155),                                                                                                          // A: foto + 8.0 + Drama (certo)
    legacy(1000555, { poster_path: 'https://static.tvmaze.com/p.jpg', backdrop_path: 'https://static.tvmaze.com/b.jpg' }),   // B: 8.0 + Drama, mas fotos reais (talvez verdadeiro)
    legacy(1000777, { vote_average: 7.5, genres: ['Crime', 'Drama'], poster_path: 'https://static.tvmaze.com/p2.jpg' }),      // C: só o fundo é do banco de imagens
    legacy(10000020, { type: 'anime' }),                                                                                       // D: anime da Jikan/AniList: nunca passou pelo mapper antigo
    legacy(1000888, { refreshedAt: '2026-10-27T09:00:00.000Z' }),                                                              // E: já atualizado na S13
    legacy(1000999, { poster_path: 'https://static.tvmaze.com/p3.jpg', backdrop_path: null, vote_average: 7.9, genres: ['Comédia'] }) // F: obra limpa
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Migração
// ---------------------------------------------------------------------------------------------------------------------

test('migração (função pura): só TVMaze com foto do Unsplash é "certa"; 8.0 + só Drama é "talvez"; o resto fica intacto, mesmo objeto', () => {
  const items = legacyRuntime();
  assert.deepEqual(items.map(legacyKind), ['certain', 'maybe', 'certain', null, null, null]);
  const { items: out, changed } = migrateLegacyCatalog(items);
  assert.deepEqual(changed.map(c => [c.id, c.kind]), [[1000155, 'certain'], [1000555, 'maybe'], [1000777, 'certain']]);
  assert.equal(out[3], items[3]);
  assert.equal(out[4], items[4]);
  assert.equal(out[5], items[5]);
  const [a, b, c] = out;
  assert.deepEqual([a.poster_path, a.backdrop_path, a.vote_average, a.genres, a.needsRefresh], [null, null, null, [], true]);
  assert.equal(a.seasons[0].episodes[0].still_path, null, 'foto do Unsplash no episódio também sai');
  assert.deepEqual([b.poster_path, b.vote_average, b.genres, b.needsRefresh], ['https://static.tvmaze.com/p.jpg', 8, ['Drama'], true], 'talvez verdadeiro: só marca');
  assert.deepEqual([c.poster_path, c.backdrop_path, c.vote_average, c.genres], ['https://static.tvmaze.com/p2.jpg', null, 7.5, ['Crime', 'Drama']], 'só o que é inventado vira nulo');
  // idempotente: passar de novo não muda nada
  const again = migrateLegacyCatalog(out);
  assert.deepEqual(again.changed, []);
  assert.equal(again.items, out);
  // nada é alterado no objeto original
  assert.equal(items[0].poster_path, UNSPLASH_POSTER);
  assert.equal(migrateLegacyCatalog([]).items.length, 0);
});

test('migração na partida: backup do arquivo como estava, obras limpas e marcadas, e uma 2ª partida não faz mais nada (idempotente)', () => {
  const dir = T.newDir();
  const original = legacyRuntime();
  fs.writeFileSync(runtimeFile(dir), JSON.stringify(original));

  const svc = new MediaService({ dataDir: dir, jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  const files = backups(dir);
  assert.equal(files.length, 1, 'um backup');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8')), original, 'o backup é o catálogo EXATAMENTE como estava');

  const a = svc.findLocal(1000155);
  assert.deepEqual([a.poster_path, a.backdrop_path, a.vote_average, a.genres, a.needsRefresh], [null, null, null, [], true]);
  assert.equal(svc.findLocal(1000555).vote_average, 8);
  assert.deepEqual(svc.findLocal(10000020), original[3]);
  assert.deepEqual(svc.findLocal(1000888), original[4]);
  assert.deepEqual(svc.findLocal(1000999), original[5]);
  assert.equal(readRuntime(dir).find(m => m.id === 1000155).needsRefresh, true, 'gravado em disco');
  assert.ok(readRuntime(dir).some(m => m.id === 1396), 'as obras do seed continuam no catálogo');

  const snapshot = fs.readFileSync(runtimeFile(dir), 'utf-8');
  const again = new MediaService({ dataDir: dir, jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  assert.equal(backups(dir).length, 1, 'segunda partida: nenhum backup novo');
  assert.equal(fs.readFileSync(runtimeFile(dir), 'utf-8'), snapshot, 'e o arquivo nem foi regravado');
  assert.deepEqual(again.findLocal(1000155), svc.findLocal(1000155));
});

test('migração: se o backup não puder ser gravado, NADA é migrado (tenta de novo na próxima partida)', () => {
  const dir = T.newDir();
  fs.writeFileSync(runtimeFile(dir), JSON.stringify(legacyRuntime()));
  const real = MediaService.prototype.backupBeforeMigration;
  MediaService.prototype.backupBeforeMigration = () => false;
  try {
    const svc = new MediaService({ dataDir: dir, jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
    assert.equal(svc.findLocal(1000155).poster_path, UNSPLASH_POSTER, 'sem backup, a obra segue como estava');
    assert.equal(svc.findLocal(1000155).needsRefresh, undefined);
  } finally {
    MediaService.prototype.backupBeforeMigration = real;
  }
  assert.equal(backups(dir).length, 0);
  const later = new MediaService({ dataDir: dir, jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  assert.equal(later.findLocal(1000155).needsRefresh, true, 'na partida seguinte (com backup possível) migra');
  assert.equal(backups(dir).length, 1);
});

test('migração: catálogo sem obras antigas não gera backup nem reescreve; catálogo ilegível continua somente leitura', () => {
  const dir = T.newDir();
  fs.writeFileSync(runtimeFile(dir), JSON.stringify([legacy(1000999, { poster_path: 'https://static.tvmaze.com/p.jpg', backdrop_path: null, vote_average: 7.1, genres: ['Comédia'] })]));
  new MediaService({ dataDir: dir, jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  assert.equal(backups(dir).length, 0);

  const bad = T.newDir();
  fs.writeFileSync(runtimeFile(bad), '{ isto não é json');
  const svc = new MediaService({ dataDir: bad, jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  assert.ok(svc.writeBlockedBy, 'ilegível: somente leitura');
  assert.equal(backups(bad).length, 0);
  assert.equal(fs.readFileSync(runtimeFile(bad), 'utf-8'), '{ isto não é json', 'não sobrescreve');
});

const TVMAZE_155 = { id: 155, name: 'Beauty and the Beast', type: 'Scripted', summary: '<p>Resumo real</p>', premiered: '2012-10-11', status: 'Ended', genres: ['Drama', 'Romance'],
  rating: { average: 7.6 }, image: { medium: 'https://static.tvmaze.com/m155.jpg', original: 'https://static.tvmaze.com/o155.jpg' },
  _embedded: { episodes: [{ season: 1, number: 1, name: 'Piloto', runtime: 60, airdate: '2012-10-11', summary: '' }, { season: 1, number: 2, name: 'Segundo', runtime: 60, airdate: '2012-10-18', summary: '' }] } };

test('obra migrada é atualizada pela fonte: dados reais entram, o selo some, ingestedAt fica e a migração não a pega de novo', async () => {
  const dir = T.newDir();
  fs.writeFileSync(runtimeFile(dir), JSON.stringify(legacyRuntime()));
  const svc = makeService(MediaService, dir, { handlers: { tvmaze: (url) => { if (url.includes('/shows/155?')) return clone(TVMAZE_155); throw mediaErrors.notFound(); } } });
  const old = svc.findLocal(1000155);
  assert.equal(svc.isRefreshDue(old), true, 'marcada pela migração: vence na hora');

  const res = await svc.refresh(1000155);
  assert.equal(res.refreshed, true);
  assert.equal(res.newEpisodes, 1, '1 episódio antes, 2 agora');
  const fresh = svc.findLocal(1000155);
  assert.equal(fresh.poster_path, 'https://static.tvmaze.com/m155.jpg');
  assert.equal(fresh.vote_average, 7.6);
  assert.deepEqual(fresh.genres, ['Drama', 'Romance']);
  assert.equal(fresh.needsRefresh, undefined);
  assert.equal(fresh.ingestedAt, old.ingestedAt, 'a data da 1ª ingestão não muda');
  assert.ok(Date.parse(fresh.refreshedAt) > Date.parse(old.ingestedAt));
  assert.equal(svc.isRefreshDue(fresh), false, 'finalizada: nunca vence');
  assert.equal(readRuntime(dir).find(m => m.id === 1000155).vote_average, 7.6);
  assert.equal(legacyKind({ ...fresh, vote_average: 8, genres: ['Drama'] }), null, 'depois de atualizada, 8.0 + Drama (mesmo verdadeiro) não é mais suspeito');
  assert.equal(svc.callsTo('tvmaze').length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Validade por obra (TTL) e refresh
// ---------------------------------------------------------------------------------------------------------------------

test('validade por obra: em exibição 6 h, em breve 24 h; finalizada, filme e obra do seed nunca vencem', () => {
  const svc = new MediaService({ dataDir: T.newDir(), jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  const base = { id: 1000001, type: 'tv', name: 'X', ingestedAt: '2026-10-27T00:00:00.000Z' };
  const t0 = Date.parse(base.ingestedAt);
  assert.equal(svc.refreshTtlMs({ ...base, status: 'Em Exibição' }), 6 * HOUR);
  assert.equal(svc.refreshTtlMs({ ...base, status: 'Em breve' }), 24 * HOUR);
  assert.equal(svc.refreshTtlMs({ ...base, status: 'Finalizada' }), null);
  assert.equal(svc.refreshTtlMs({ ...base, status: 'Em Exibição', type: 'movie' }), null);
  assert.equal(svc.refreshTtlMs({ ...base, status: 'Em Exibição', ingestedAt: undefined }), null, 'amostra do seed (nunca ingerida)');
  assert.equal(svc.refreshTtlMs({ ...base, status: '', needsRefresh: true }), 0);

  const airing = { ...base, status: 'Em Exibição' };
  assert.equal(svc.isRefreshDue(airing, t0 + 6 * HOUR - 1), false);
  assert.equal(svc.isRefreshDue(airing, t0 + 6 * HOUR), true);
  assert.equal(svc.isRefreshDue({ ...airing, refreshedAt: '2026-10-27T05:00:00.000Z' }, t0 + 6 * HOUR), false, 'conta a partir da última atualização');
  assert.equal(svc.isRefreshDue({ ...airing, id: 1396 }, t0 + 100 * HOUR), false, 'id do seed (TMDB) não é ingerível');

  const custom = new MediaService({ dataDir: T.newDir(), jikanEnabled: false, anilistEnabled: false, tmdbKey: '', airingTtlMs: 1000, upcomingTtlMs: 5000 });
  assert.equal(custom.refreshTtlMs({ ...base, status: 'Em Exibição' }), 1000);
  assert.equal(custom.refreshTtlMs({ ...base, status: 'Em breve' }), 5000);
});

test('refreshCheck: "fresh" dentro da validade, "recent" para força repetida em 10 min; seed e desconhecida dão erro tipado', () => {
  const dir = T.newDir();
  const now = Date.now();
  fs.writeFileSync(runtimeFile(dir), JSON.stringify([
    legacy(1000010, { poster_path: 'https://static.tvmaze.com/p.jpg', backdrop_path: null, vote_average: 7, genres: ['Comédia'], status: 'Em Exibição', refreshedAt: new Date(now - HOUR).toISOString() }),
    legacy(1000011, { poster_path: 'https://static.tvmaze.com/p.jpg', backdrop_path: null, vote_average: 7, genres: ['Comédia'], status: 'Em Exibição', refreshedAt: new Date(now - 7 * HOUR).toISOString() })
  ]));
  const svc = new MediaService({ dataDir: dir, jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  assert.deepEqual([svc.refreshCheck(1000010).run, svc.refreshCheck(1000010).reason], [false, 'fresh']);
  assert.deepEqual([svc.refreshCheck(1000011).run], [true]);
  assert.deepEqual([svc.refreshCheck(1000010, { force: true }).run, svc.refreshCheck(1000010, { force: true }).reason], [true, undefined], 'força: passou 1 h > 10 min');
  svc.findLocal(1000010).refreshedAt = new Date(now - 60 * 1000).toISOString();
  assert.equal(svc.refreshCheck(1000010, { force: true }).reason, 'recent');
  assert.throws(() => svc.refreshCheck(1000099), e => e.code === 'NOT_FOUND');
  assert.throws(() => svc.refreshCheck(1396), e => e.code === 'UNSUPPORTED_SOURCE', 'obra do seed não tem fonte para atualizar');
  assert.throws(() => svc.refreshCheck('abc'), e => e.code === 'INVALID_ID');
});

test('refresh de anime em exibição pela AniList: episódios novos entram, o cache é ignorado, a obra continua com o mesmo id e as marcas certas', async () => {
  const svc = makeService(MediaService, T.newDir(), { extra: { seedPath: undefined } });
  const first = await svc.ingest(10000021);   // One Piece: 1180 episódios (o próximo é o 1181)
  assert.equal(first.seasons[0].episodes.length, 1180);
  assert.equal(first.status, 'Em Exibição');

  const before = svc.callsTo('anilist').length;
  const nextEpisode = 1183;
  svc.handlers.anilist = (url, opts) => {
    const r = respond(JSON.parse(opts.body));
    if (r.data.Media && r.data.Media.id === 21) r.data.Media.nextAiringEpisode = { episode: nextEpisode, airingAt: 1799000000 };
    return r;
  };
  assert.equal((await svc.refresh(10000021)).refreshed, false, 'acabou de ser ingerida: dentro da validade');
  assert.equal(svc.callsTo('anilist').length, before, 'dentro da validade: nem toca na fonte');

  svc.findLocal(10000021).refreshedAt = new Date(Date.now() - 7 * HOUR).toISOString();   // 7 h depois
  const res = await svc.refresh(10000021);
  assert.equal(res.refreshed, true);
  assert.equal(res.newEpisodes, 2, 'agora o próximo é o 1183: já foram 1182');
  assert.equal(res.item.id, 10000021);
  assert.equal(res.item.seasons[0].episodes.length, 1182);
  assert.equal(res.item.ingestedAt, first.ingestedAt);
  assert.ok(Date.parse(res.item.refreshedAt) > Date.now() - 5000);
  assert.ok(svc.callsTo('anilist').length > before, 'ignorou o cache da AniList (fresh)');
  assert.equal(svc.catalog.filter(m => m.id === 10000021).length, 1);
  assert.equal(readRuntime(path.dirname(svc.catalogPath)).find(m => m.id === 10000021).seasons[0].episodes.length, 1182, 'gravado em disco');
  assert.equal((await svc.refresh(10000021)).reason, 'fresh');
});

test('refresh não perde os títulos de episódio que a Jikan já tinha dado quando ela não responde mais', async () => {
  const titles = (url) => {
    const m = /\/anime\/(\d+)\/episodes/.exec(url);
    if (!m) throw new Error(`inesperado: ${url}`);
    const total = { 52991: 28, 59978: 10 }[m[1]] || 0;
    return { pagination: { has_next_page: false }, data: Array.from({ length: total }, (_, i) => ({ mal_id: i + 1, title: `Título ${m[1]}-${i + 1}`, aired: '2023-09-29T00:00:00+00:00', duration: 1440 })) };
  };
  const svc = makeService(MediaService, T.newDir(), { handlers: { jikan: titles } });
  const first = await svc.ingest(10052991);   // amostra do seed (Frieren) é trocada pela obra real
  assert.equal(first.seasons[1].episodes[4].name, 'Título 59978-5');

  svc.handlers.jikan = () => { throw mediaErrors.upstream('fora', { unreachable: true }); };   // a Jikan cai
  svc.jikan.breaker.success();
  svc.findLocal(first.id).refreshedAt = '2026-01-01T00:00:00.000Z';
  const res = await svc.refresh(first.id, { force: true });
  assert.equal(res.refreshed, true);
  assert.equal(res.item.seasons[0].episodes[0].name, 'Título 52991-1', 'títulos de antes mantidos');
  assert.equal(res.item.seasons[1].episodes[9].name, 'Título 59978-10');
  assert.equal(res.item.seasons[0].episodes[0].air_date, '2023-09-29');
});

test('conferência automática: atualiza só as vencidas, as mais antigas primeiro, respeita o limite e não insiste em quem falhou', async () => {
  const dir = T.newDir();
  const now = Date.now();
  const airing = (id, hoursAgo, extra = {}) => legacy(id, { poster_path: 'https://static.tvmaze.com/p.jpg', backdrop_path: null, vote_average: 7, genres: ['Comédia'], status: 'Em Exibição', refreshedAt: new Date(now - hoursAgo * HOUR).toISOString(), ...extra });
  fs.writeFileSync(runtimeFile(dir), JSON.stringify([
    airing(1000021, 8), airing(1000022, 30), airing(1000023, 2), airing(1000024, 12),
    airing(1000025, 50, { status: 'Finalizada' })     // finalizada: nunca
  ]));
  const shows = new Map();
  const tvmaze = (url) => {
    const m = /\/shows\/(\d+)\?/.exec(url);
    if (!m) return [];
    shows.set(Number(m[1]), (shows.get(Number(m[1])) || 0) + 1);
    if (m[1] === '21') throw mediaErrors.upstream();                   // 1000021 falha
    return { id: Number(m[1]), name: `Série ${m[1]}`, type: 'Scripted', status: 'Running', genres: ['Comédia'], rating: { average: 7 }, _embedded: { episodes: [{ season: 1, number: 1, name: 'E1', runtime: 30 }, { season: 1, number: 2, name: 'E2', runtime: 30 }] } };
  };
  const svc = makeService(MediaService, dir, { handlers: { tvmaze } });
  const out = await svc.refreshDueWorks({ limit: 2, now });
  assert.deepEqual(out.refreshed.map(r => r.id), [1000022, 1000024], 'as mais antigas vencidas primeiro, no máximo 2');
  assert.equal(out.checked, 2);
  assert.equal(shows.has(23), false, '1000023 (2 h) ainda não venceu');
  assert.equal(shows.has(25), false, 'finalizada nunca é consultada');

  const next = await svc.refreshDueWorks({ limit: 5, now });
  assert.deepEqual(next.refreshed.map(r => r.id), [], '1000021 falha');
  assert.deepEqual(next.failed.map(f => [f.id, f.code]), [[1000021, 'UPSTREAM']]);
  const later = await svc.refreshDueWorks({ limit: 5, now: now + 10 * 60 * 1000 });
  assert.equal(later.checked, 0, 'quem falhou não é tentado de novo por 30 min (e as outras já estão em dia)');
  const afterBackoff = await svc.refreshDueWorks({ limit: 5, now: now + 31 * 60 * 1000 });
  assert.equal(afterBackoff.checked, 1);
  assert.equal(shows.get(21), 2);
});

test('conferência automática: fonte inalcançável interrompe a rodada (não bate em todas as obras à toa); catálogo somente leitura não tenta', async () => {
  const dir = T.newDir();
  const old = new Date(Date.now() - 20 * HOUR).toISOString();
  fs.writeFileSync(runtimeFile(dir), JSON.stringify([1000031, 1000032, 1000033].map(id => legacy(id, { poster_path: 'https://static.tvmaze.com/p.jpg', backdrop_path: null, vote_average: 7, genres: ['Comédia'], refreshedAt: old }))));
  let calls = 0;
  const svc = makeService(MediaService, dir, { handlers: { tvmaze: () => { calls++; throw mediaErrors.upstream('Tempo esgotado', { unreachable: true }); } } });
  const out = await svc.refreshDueWorks({ limit: 5 });
  assert.equal(calls, 1);
  assert.deepEqual(out.failed.map(f => f.code), ['UPSTREAM']);

  const bad = T.newDir();
  fs.writeFileSync(runtimeFile(bad), 'quebrado');
  const blocked = makeService(MediaService, bad);
  assert.deepEqual(await blocked.refreshDueWorks(), { checked: 0, refreshed: [], failed: [] });
  await assert.rejects(blocked.refresh(1000031), e => e.code === 'NOT_FOUND' || e.code === 'CATALOG_UNAVAILABLE');
});

test('laço de conferência: liga, não bloqueia o processo (unref) e desliga', async () => {
  const svc = new MediaService({ dataDir: T.newDir(), jikanEnabled: false, anilistEnabled: false, tmdbKey: '' });
  let ran = 0;
  svc.refreshDueWorks = async () => { ran++; return { checked: 0, refreshed: [], failed: [] }; };
  svc.startRefreshLoop({ intervalMs: 20, initialDelayMs: 5, log: () => {} });
  assert.equal(svc.refreshTimers.length, 1);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(ran >= 2, `rodou ${ran} vezes`);
  svc.stopRefreshLoop();
  const stopped = ran;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(ran, stopped, 'parou');
  assert.equal(svc.refreshTimers.length, 0);
});
