// S13 · AniList como fonte principal de anime: cliente + mapper com respostas REAIS gravadas (tests/fixtures/anilist), busca e
// ingestão no MediaService (AniList -> Jikan -> local/TVMaze, com avisos por fonte), episódios, franquia e deduplicação seed x fonte.
// Nenhuma requisição real; tudo em pastas temporárias.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeService, tempRoot, respond, media: fixtureMedia } = require('./helpers/anilistFixtures');
const T = tempRoot('showvault-s13-anilist-');
process.env.SHOWVAULT_DATA_DIR = path.join(T.root, 'singleton');
fs.mkdirSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true });

const { MediaService } = require('../server/services/mediaService');
const AniListClient = require('../server/services/anilistClient');
const mapper = require('../server/services/anilistMapper');
const { mediaErrors } = require('../server/utils/errors');
const { toInternalId, describeId } = require('../server/utils/ids');

const RSQUO = '’'; // a AniList escreve "Journey’s" com apóstrofo tipográfico
const newService = (o = {}) => makeService(MediaService, T.newDir(), o);
const ids = items => items.map(i => i.id);
const assertUnique = items => assert.equal(new Set(ids(items)).size, items.length, `ids repetidos: ${ids(items)}`);
const totalEpisodes = work => work.seasons.reduce((n, s) => n + s.episodes.length, 0);

// Seed mínimo (sem nenhum anime): para provar o id pedido sem a troca de amostras do seed.
function seedWithoutAnime() {
  const file = path.join(T.newDir(), 'seed.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 1396, type: 'tv', name: 'Breaking Bad', overview: 'x', genres: ['Drama'], seasons: [{ season_number: 1, name: 'T1', episodes: [{ episode_number: 1, name: 'Piloto' }] }] }]));
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cliente + mapper com respostas reais
// ---------------------------------------------------------------------------------------------------------------------

function rawClient(extra = {}) {
  const calls = [];
  const client = new AniListClient({
    fetchJson: async (url, opts) => { calls.push(JSON.parse(opts.body).variables); return respond(JSON.parse(opts.body)); },
    sleep: async () => {}, minIntervalMs: 0, ...extra
  });
  client.calls = calls;
  return client;
}

test('cliente: busca "Frieren" devolve só obras de anime com título, sem adultos nem clipes, e o mapper usa os ids certos', async () => {
  const client = rawClient();
  const found = await client.searchAnime('Frieren');
  assert.equal(found.length, 6);
  const entries = found.map(mapper.mapAnimeSearchEntry);

  const s1 = entries.find(e => e.anilist_id === 154587);
  assert.equal(s1.id, toInternalId('jikan', 52991), 'com idMal: mesma faixa e mesmo id da Jikan');
  assert.equal(s1.mal_id, 52991);
  assert.equal(s1.name, `Frieren: Beyond Journey${RSQUO}s End`);
  assert.equal(s1.original_name, 'Sousou no Frieren');
  assert.ok(s1.alt_titles.includes('葬送のフリーレン'), 'título em japonês entra nos alternativos (busca em japonês)');
  assert.ok(!s1.alt_titles.includes(s1.name));
  assert.equal(s1.vote_average, 9.1, 'averageScore 91/100 -> 9.1');
  assert.equal(s1.first_air_date, '2023-09-29');
  assert.equal(s1.status, 'Finalizada');
  assert.equal(s1.season_label, 'Outono 2023');
  assert.equal(s1.anime_kind, '');
  assert.equal(s1.episode_count, 28);
  assert.equal(s1.type, 'anime');
  assert.equal(s1.isExternal, true);
  assert.match(s1.poster_path, /^https:\/\/s4\.anilist\.co\/.+\/bx154587-/);
  assert.match(s1.backdrop_path, /\/banner\/154587-/, 'fundo = banner');
  assert.ok(s1.overview.startsWith('The adventure is over'));
  assert.ok(!/[<>]/.test(s1.overview), 'sem HTML');

  const noMal = entries.find(e => e.anilist_id === 189513);
  assert.equal(noMal.id, toInternalId('anilist', 189513), 'sem idMal: faixa própria da AniList (40.000.000+)');
  assert.equal(describeId(noMal.id).source, 'anilist');
  assert.equal('mal_id' in noMal, false);

  const s3 = entries.find(e => e.anilist_id === 209939);
  assert.equal(s3.status, 'Em breve');
  assert.equal(s3.first_air_date, '2027-10', 'data parcial fica parcial (nada inventado)');
  assert.equal(s3.vote_average, null, 'sem nota = null, nunca 8.0');
  assert.equal(s3.episode_count, null);
  assert.equal(s3.backdrop_path, s3.poster_path.replace('/medium/', '/large/'), 'sem banner, o fundo é a capa grande');
});

test('cliente: busca vazia não consulta; resposta de erro vira erro tipado; cache e pedidos iguais simultâneos viram uma requisição', async () => {
  const client = rawClient();
  assert.deepEqual(await client.searchAnime('   '), []);
  assert.equal(client.calls.length, 0);
  await Promise.all([client.searchAnime('Naruto'), client.searchAnime('Naruto')]);
  await client.searchAnime('Naruto');
  assert.equal(client.calls.length, 1);

  const err = res => new AniListClient({ fetchJson: async () => res, sleep: async () => {}, minIntervalMs: 0, retries: 0 });
  await assert.rejects(err({ errors: [{ message: 'Not Found.', status: 404 }], data: { Media: null } }).getMedia({ id: 1 }), e => e.code === 'NOT_FOUND');
  await assert.rejects(err({ errors: [{ message: 'Too Many Requests.', status: 429 }], data: null }).searchAnime('a'), e => e.code === 'RATE_LIMITED');
  await assert.rejects(err({ errors: [{ message: 'Validation', status: 400 }], data: null }).searchAnime('a'), e => e.code === 'UPSTREAM');
  await assert.rejects(err('lixo').searchAnime('a'), e => e.code === 'UPSTREAM');
  await assert.rejects(err({ data: { Page: { media: 'x' } } }).searchAnime('a'), e => e.code === 'UPSTREAM');
  // obra de outro id / sem título / adulta não vale
  const wrong = respond({ query: 'Media(', variables: { idMal: 52991 } });
  await assert.rejects(err(wrong).getMedia({ id: 999 }), e => e.code === 'NOT_FOUND');
  wrong.data.Media.isAdult = true;
  await assert.rejects(err(wrong).getMedia({ idMal: 52991 }), e => e.code === 'NOT_FOUND');
});

test('franquia Frieren: S1 + S2 viram temporadas; a 3ª (anunciada, sem episódios) fica de fora; datas só quando a AniList sabe', async () => {
  const client = rawClient();
  const franchise = await client.getFranchise({ idMal: 52991 });
  assert.deepEqual(franchise.nodes.map(n => n.id).sort((a, b) => a - b), [154587, 182255, 209939]);
  assert.equal(franchise.truncated, false);

  const work = mapper.buildAnimeWork(toInternalId('jikan', 52991), { malId: 52991 }, franchise);
  assert.equal(work.id, 10052991);
  assert.equal(work.mal_id, 52991);
  assert.deepEqual(work.mal_ids.sort((a, b) => a - b), [52991, 59978, 63816]);
  assert.deepEqual(work.anilist_ids.sort((a, b) => a - b), [154587, 182255, 209939]);
  assert.deepEqual(work.seasons.map(s => s.name), ['Temporada 1 · Outono 2023', 'Temporada 2 · Inverno 2026']);
  assert.deepEqual(work.seasons.map(s => s.episodes.length), [28, 10]);
  assert.deepEqual(work.franchise.entries.map(e => [e.anilist_id, e.mal_id, e.season_number, e.kind]), [[154587, 52991, 1, 'TV'], [182255, 59978, 2, 'TV']]);
  assert.equal(work.status, 'Finalizada');
  assert.equal(work.name, `Frieren: Beyond Journey${RSQUO}s End`);

  const s1 = work.seasons[0].episodes;
  assert.deepEqual(s1[0], { episode_number: 1, name: 'Episódio 1', runtime: 24, air_date: '2023-09-29', overview: '', still_path: null }, 'sem título (AniList não tem); o 1º episódio estreia na data de início');
  assert.equal(s1[1].air_date, '', 'episódios 2 a 4 não estão na grade da AniList: sem data, nada inventado');
  assert.equal(s1[4].air_date, '2023-10-06', 'episódio 5 vem da grade (airingAt 1696600800, UTC)');
  assert.equal(s1[27].episode_number, 28);
  assert.ok(work.seasons[1].episodes.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.air_date)), 'a 2ª temporada tem a grade inteira');
});

test('franquia Naruto: série, filme, especial e Boruto na ordem de exibição; Boruto Part 2 (anunciada) fica de fora', async () => {
  const franchise = await rawClient().getFranchise({ idMal: 20 });
  assert.equal(franchise.nodes.length, 6);
  const work = mapper.buildAnimeWork(10000020, { malId: 20 }, franchise);
  assert.deepEqual(work.seasons.map(s => s.episodes.length), [220, 500, 1, 1, 293]);
  assert.deepEqual(work.seasons.map(s => s.name.split(':')[0]), ['Temporada 1 · Outono 2002', 'Temporada 2 · Inverno 2007', 'Filme', 'Especial', 'Temporada 3 · Primavera 2017'].map(n => n.split(':')[0]));
  assert.ok(work.seasons[2].name.startsWith('Filme: Boruto: Naruto the Movie'));
  assert.equal(work.seasons[2].episodes[0].runtime, 95, 'filme: 1 episódio com a duração real');
  assert.equal(work.seasons[1].episodes[499].air_date, '2017-03-23', 'últimos episódios do Shippuden estão na grade');
  assert.equal(work.seasons[1].episodes[300].air_date, '', 'sem grade: sem data');
  assert.equal(work.status, 'Finalizada');
  assert.deepEqual(work.mal_ids, [20, 1735, 32365, 34566, 28755, 54687].sort((a, b) => a - b).sort((a, b) => work.mal_ids.indexOf(a) - work.mal_ids.indexOf(b)), 'inclui até a entrada sem episódios (para a busca não mostrá-la de novo)');
});

test('franquia Attack on Titan: 9 entradas (temporadas, OVA e especiais), uma sem idMal; o limite de entradas marca truncated', async () => {
  const client = rawClient();
  const franchise = await client.getFranchise({ idMal: 16498 });
  assert.equal(franchise.nodes.length, 9);
  const work = mapper.buildAnimeWork(10016498, { malId: 16498 }, franchise);
  assert.deepEqual(work.seasons.map(s => s.episodes.length), [25, 2, 12, 12, 10, 16, 12, 1, 1]);
  assert.deepEqual(work.seasons.map(s => s.name.replace(/:.*/, '')), [
    'Temporada 1 · Primavera 2013', 'OVA', 'Temporada 2 · Primavera 2017', 'Temporada 3 · Verão 2018', 'Temporada 4 · Primavera 2019',
    'Temporada 5 · Inverno 2021', 'Temporada 6 · Inverno 2022', 'Especial', 'Especial'
  ]);
  assert.equal(work.mal_ids.length, 8, 'a entrada sem idMal não entra em mal_ids...');
  assert.equal(work.anilist_ids.length, 9, '...mas está em anilist_ids');
  assert.equal(work.franchise.entries.filter(e => e.mal_id === undefined).length, 1);
  assert.equal(work.name, 'Attack on Titan');
  assert.ok(work.alt_titles.includes('進撃の巨人'));
  assert.equal(totalEpisodes(work), 91);

  const small = await rawClient().getFranchise({ idMal: 16498 }, { maxNodes: 3 });
  assert.equal(small.nodes.length, 3);
  assert.equal(small.truncated, true);
});

test('franquia One Piece: sem total de episódios, vale até o último já exibido; ONA de um episódio não vira "Temporada 2"', async () => {
  const work = mapper.buildAnimeWork(10000021, { malId: 21 }, await rawClient().getFranchise({ idMal: 21 }));
  assert.equal(work.status, 'Em Exibição');
  assert.equal(work.seasons[0].episodes.length, 1180, 'próximo episódio é o 1181: já foram 1180');
  assert.equal(work.seasons[0].episodes[1122].air_date.length, 10, 'episódios da grade têm data');
  assert.equal(work.seasons[0].episodes[10].air_date, '', 'sem grade: sem data');
  assert.match(work.seasons[1].name, /^ONA: MONSTERS/);
  assert.equal(work.vote_average, 8.7);
  assert.deepEqual(work.genres.slice(0, 2), ['Action', 'Adventure']);
});

test('mapper: nada inventado quando a fonte não traz (sem nota, imagem, gêneros, duração, datas)', () => {
  const bare = { id: 999001, idMal: null, type: 'ANIME', format: 'TV', status: 'RELEASING', episodes: 3, title: { romaji: 'Obra Sem Dados', english: null, native: null }, synonyms: [], startDate: {}, genres: [], coverImage: null, bannerImage: null, description: null, duration: null };
  const entry = mapper.mapAnimeSearchEntry(bare);
  assert.equal(entry.id, toInternalId('anilist', 999001));
  assert.equal(entry.vote_average, null);
  assert.equal(entry.poster_path, null);
  assert.equal(entry.backdrop_path, null);
  assert.deepEqual(entry.genres, []);
  assert.equal(entry.first_air_date, '');
  assert.equal(entry.overview, '');
  assert.equal(entry.season_label, '');
  assert.equal(entry.name, 'Obra Sem Dados');
  assert.equal(entry.original_name, '');
  const eps = mapper.episodesFor(bare);
  assert.deepEqual(eps.map(e => [e.name, e.runtime, e.air_date]), [['Episódio 1', null, ''], ['Episódio 2', null, ''], ['Episódio 3', null, '']]);
  // textos externos passam pelo sanitizador (HTML e URLs perigosas)
  const evil = mapper.mapAnimeBase({ ...bare, title: { romaji: '<img src=x onerror=alert(1)>Obra' }, description: '<script>alert(1)</script>Sinopse<br>linha 2', coverImage: { large: 'javascript:alert(1)' }, bannerImage: 'data:text/html,x' });
  assert.equal(evil.name, 'Obra');
  assert.equal(evil.overview, 'Sinopse linha 2');
  assert.equal(evil.poster_path, null);
  assert.equal(evil.backdrop_path, null);
});

// ---------------------------------------------------------------------------------------------------------------------
// MediaService: busca (AniList -> Jikan -> local/TVMaze) com as buscas reais
// ---------------------------------------------------------------------------------------------------------------------

test('busca "Frieren" (Jikan fora do ar): as temporadas viram UMA obra, a amostra do seed some (catalog_id) e não há aviso', async () => {
  const svc = newService();
  const { items, warnings } = await svc.searchDetailed('Frieren', 'all');
  assert.deepEqual(warnings, []);
  assertUnique(items);
  assert.equal(items.length, 2, items.map(i => i.name).join(' | '));
  const [main, shorts] = items;
  assert.equal(main.id, toInternalId('jikan', 52991));
  assert.equal(main.name, `Frieren: Beyond Journey${RSQUO}s End`);
  assert.equal(main.related_count, 2, 'S2 e S3 agrupadas');
  assert.deepEqual(main.mal_ids.sort((a, b) => a - b), [52991, 59978, 63816]);
  assert.equal(main.catalog_id, 209867, 'é a mesma obra da amostra do seed (Frieren e a Jornada para o Além)');
  assert.ok(!items.some(i => i.id === 209867), 'a amostra não aparece de novo');
  assert.equal(main.isExternal, true);
  assert.equal(main.vote_average, 9.1);
  assert.equal(shorts.anime_kind, 'ONA', 'o spin-off em ONA continua separado');
  assert.equal(svc.callsTo('jikan').length, 0, 'a Jikan (reserva) não é consultada quando a AniList responde');
  assert.equal(svc.callsTo('anilist').length, 1);
});

test('busca "Naruto": "Naruto" primeiro, cada entrada uma vez, sem duplicatas; depois de ingerir a franquia, Shippuden não reaparece', async () => {
  const svc = newService();
  const { items } = await svc.searchDetailed('Naruto', 'anime');
  assertUnique(items);
  assert.equal(items[0].name, 'Naruto');
  assert.equal(items[0].id, 10000020);
  assert.equal(items.filter(i => i.mal_ids.includes(1735)).length, 1, 'Shippuden aparece uma vez');
  assert.equal(items.filter(i => i.name === 'Boruto: Naruto Next Generations').length, 1);
  assert.ok(items.length <= 30);

  await svc.ingest(10000020);
  const again = (await svc.searchDetailed('Shippuden', 'anime')).items;
  assertUnique(again);
  assert.equal(again[0].id, 10000020, 'o que aparece é a obra que já está no catálogo');
  assert.ok(!again[0].isExternal);
  assert.ok(!again.some(i => i.mal_ids && i.mal_ids.includes(1735) && i.isExternal), 'Shippuden não volta como "nova obra"');
});

test('busca "Attack on Titan" e "進撃の巨人": a franquia vira um resultado só (temporadas agrupadas) e a amostra do seed (1429) some', async () => {
  const svc = newService();
  for (const q of ['Attack on Titan', '進撃の巨人']) {
    const { items } = await svc.searchDetailed(q, 'anime');
    assertUnique(items);
    assert.equal(items[0].id, 10016498, q);
    assert.equal(items[0].name, 'Attack on Titan');
    assert.equal(items[0].related_count, 5, 'S1, S2, S3, S3 Part 2, Final Season e Part 2 agrupadas');
    assert.equal(items[0].catalog_id, 1429);
    assert.ok(!items.some(i => i.id === 1429));
    assert.equal(items.filter(i => (i.mal_ids || []).includes(16498)).length, 1);
    assert.ok(items.some(i => i.id === toInternalId('anilist', 162314)), 'entrada sem idMal entra pela faixa da AniList');
  }
});

test('busca "One Piece": a série (título igual) vem antes dos filmes; sem total de episódios o cartão não inventa', async () => {
  const svc = newService();
  const { items } = await svc.searchDetailed('One Piece', 'anime');
  assertUnique(items);
  assert.equal(items[0].name, 'ONE PIECE');
  assert.equal(items[0].episode_count, null);
  assert.equal(items[0].status, 'Em Exibição');
  assert.ok(items.slice(1).every(i => i.name !== 'ONE PIECE'));
});

test('busca por tipo: série não chama a AniList; anime não chama o TVMaze (com a AniList respondendo)', async () => {
  const svc = newService();
  await svc.searchDetailed('Naruto', 'tv');
  assert.equal(svc.callsTo('anilist').length, 0);
  assert.equal(svc.callsTo('tvmaze').length, 1);
  const svc2 = newService();
  await svc2.searchDetailed('Naruto', 'anime');
  assert.equal(svc2.callsTo('tvmaze').length, 0);
  assert.equal(svc2.callsTo('anilist').length, 1);
});

// Jikan simulada mínima (formato real da API v4) para os testes de reserva
const jikanAnime = (id, o = {}) => ({
  mal_id: id, title: `Anime ${id}`, title_english: null, title_japanese: null, title_synonyms: [], titles: [], type: 'TV', episodes: 12, status: 'Finished Airing',
  aired: { from: '2013-04-07T00:00:00+00:00' }, duration: '24 min per ep', score: 8.5, season: 'spring', year: 2013, synopsis: 'Sinopse.', genres: [{ name: 'Action' }], themes: [],
  images: { jpg: { image_url: `https://cdn.myanimelist.net/images/anime/${id}.jpg` } }, relations: [], ...o
});
const JIKAN_FRIEREN = jikanAnime(52991, { title: 'Sousou no Frieren', title_english: "Frieren: Beyond Journey's End", title_japanese: '葬送のフリーレン', episodes: 3, aired: { from: '2023-09-29T00:00:00+00:00' }, season: 'fall', year: 2023 });
function jikanHandler(animes) {
  const byId = new Map(animes.map(a => [a.mal_id, a]));
  return (url) => {
    const u = new URL(url);
    let m;
    if (u.pathname === '/v4/anime') return { data: animes.filter(a => (a.title + (a.title_english || '')).toLowerCase().includes(u.searchParams.get('q').toLowerCase())) };
    if ((m = /^\/v4\/anime\/(\d+)\/full$/.exec(u.pathname))) { const a = byId.get(Number(m[1])); if (!a) throw mediaErrors.notFound(); return { data: a }; }
    if ((m = /^\/v4\/anime\/(\d+)\/episodes$/.exec(u.pathname))) {
      const a = byId.get(Number(m[1]));
      return { pagination: { has_next_page: false }, data: Array.from({ length: a.episodes || 0 }, (_, i) => ({ mal_id: i + 1, title: `Título ${i + 1}`, aired: '2023-09-29T00:00:00+00:00', duration: 1440 })) };
    }
    throw new Error(`URL inesperada na Jikan simulada: ${url}`);
  };
}
const anilistDown = () => { throw mediaErrors.upstream('Tempo esgotado na fonte externa.', { unreachable: true }); };

test('reserva: AniList fora do ar -> a Jikan responde; o aviso da AniList fica (fallback) e o disjuntor evita esperar de novo', async () => {
  const svc = newService({ handlers: { anilist: anilistDown, jikan: jikanHandler([JIKAN_FRIEREN]) } });
  const { items, warnings } = await svc.searchDetailed('Frieren', 'anime');
  assert.deepEqual(warnings.map(w => [w.source, w.code, w.fallback]), [['anilist', 'UPSTREAM', 'jikan']]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, toInternalId('jikan', 52991));
  assert.equal(items[0].catalog_id, 209867, 'a troca da amostra do seed vale também para a reserva');
  assert.equal(items[0].isExternal, true);
  assert.equal(svc.callsTo('anilist').length, 1);

  // segunda busca: o disjuntor da AniList está aberto, nenhuma requisição nova a ela
  const again = await svc.searchDetailed('Frieren x', 'anime');
  assert.deepEqual(again.warnings.map(w => w.fallback), ['jikan']);
  assert.equal(svc.callsTo('anilist').length, 1, 'AniList não foi consultada de novo');
});

test('reserva: AniList com 429 também cai para a Jikan e o aviso leva o tempo de espera', async () => {
  const svc = newService({ handlers: { anilist: () => { throw mediaErrors.rateLimited(30000); }, jikan: jikanHandler([JIKAN_FRIEREN]) }, extra: { anilist: { minIntervalMs: 0, retries: 0 } } });
  const { items, warnings } = await svc.searchDetailed('Frieren', 'anime');
  assert.equal(items.length, 1);
  assert.deepEqual(warnings.map(w => [w.source, w.code, w.retryAfterSec, w.fallback]), [['anilist', 'RATE_LIMITED', 30, 'jikan']]);
});

test('reserva: uma lista VAZIA da AniList é uma resposta (a obra não existe) e não aciona a Jikan', async () => {
  const svc = newService({ handlers: { jikan: jikanHandler([JIKAN_FRIEREN]) } });
  const { items, warnings } = await svc.searchDetailed('zzzzqqqq', 'anime');
  assert.deepEqual(items, []);
  assert.deepEqual(warnings, []);
  assert.equal(svc.callsTo('jikan').length, 0);
});

test('reserva: AniList e Jikan fora do ar -> o catálogo local responde com um aviso por fonte; sem nada local, sobe o erro tipado', async () => {
  const svc = newService({ handlers: { anilist: anilistDown } });
  const local = await svc.searchDetailed('Death Note', 'anime');
  assert.deepEqual(local.items.map(i => i.id), [13916], 'a amostra do seed continua aparecendo, uma vez');
  assert.deepEqual(local.warnings.map(w => [w.source, w.code, w.fallback]), [['anilist', 'UPSTREAM', undefined], ['jikan', 'UPSTREAM', undefined]]);

  await assert.rejects(newService({ handlers: { anilist: anilistDown } }).searchDetailed('algo que ninguém tem', 'anime'), e => e.code === 'UPSTREAM');
  // 429 da AniList e Jikan fora: o "aguarde" (429) é o erro mais útil
  const limited = newService({ handlers: { anilist: () => { throw mediaErrors.rateLimited(9000); } }, extra: { anilist: { minIntervalMs: 0, retries: 0 } } });
  await assert.rejects(limited.searchDetailed('algo que ninguém tem', 'anime'), e => e.code === 'RATE_LIMITED' && e.retryAfterMs === 9000);
});

test('anime com as duas fontes desligadas ainda acha o que é anime no TVMaze (reserva final)', async () => {
  const show = { show: { id: 321, name: 'Naruto TVMaze', type: 'Animation', language: 'Japanese', genres: ['Anime'], premiered: '2002-10-03', status: 'Ended', summary: '<p>x</p>' } };
  const svc = newService({ extra: { anilistEnabled: false, jikanEnabled: false }, handlers: { tvmaze: () => [show] } });
  const { items } = await svc.searchDetailed('Naruto TVMaze', 'anime');
  assert.deepEqual(items.map(i => i.id), [1000321]);
  assert.equal(svc.callsTo('anilist').length + svc.callsTo('jikan').length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// MediaService: ingestão
// ---------------------------------------------------------------------------------------------------------------------

test('ingestão pela AniList: Naruto vira UMA obra (id pedido), grava em disco com as marcas de tempo, e Shippuden devolve a mesma obra sem rede', async () => {
  const dir = T.newDir();
  const svc = makeService(MediaService, dir);
  const work = await svc.ingest(10000020);
  assert.equal(work.id, 10000020);
  assert.equal(work.type, 'anime');
  assert.equal(work.name, 'Naruto');
  assert.deepEqual(work.seasons.map(s => s.episodes.length), [220, 500, 1, 1, 293]);
  assert.equal(work.status, 'Finalizada');
  assert.ok(work.ingestedAt && work.refreshedAt === work.ingestedAt, 'primeira vez: as duas marcas iguais');
  assert.equal(svc.callsTo('jikan').length, 1, 'tentou os títulos na Jikan (fora do ar) uma vez e não insistiu');
  assert.ok(work.seasons[0].episodes.every(e => /^Episódio \d+$/.test(e.name)), 'sem a Jikan: "Episódio N"');

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'mediaCatalog.runtime.json'), 'utf-8')).find(m => m.id === 10000020);
  assert.equal(onDisk.seasons.length, 5);

  const before = svc.calls.length;
  const alias = await svc.ingest(10001735);   // Shippuden: já está dentro da franquia gravada
  assert.equal(alias.id, 10000020);
  assert.equal(svc.calls.length, before, 'nenhuma requisição nova');
  assert.equal(svc.catalog.filter(m => (m.mal_ids || []).includes(1735)).length, 1, 'uma única obra no catálogo');
  assert.equal(svc.needsIngest(10001735), false);
  assert.equal(svc.resolveExisting(10001735).id, 10000020);
  assert.equal((await svc.getById(10034566)).id, 10000020, 'Boruto também é essa franquia');
});

test('ingestão: títulos de episódio vêm da Jikan quando ela responde (e só preenchem o que a AniList não tinha)', async () => {
  const jikan = jikanHandler([
    jikanAnime(52991, { episodes: 28 }),
    jikanAnime(59978, { episodes: 10, status: 'Finished Airing' })
  ]);
  const svc = newService({ handlers: { jikan }, extra: { seedPath: seedWithoutAnime() } });
  const work = await svc.ingest(10052991);
  assert.equal(work.id, 10052991);
  const s1 = work.seasons[0].episodes;
  assert.equal(s1[0].name, 'Título 1');
  assert.equal(s1[27].name, 'Título 28');
  assert.equal(s1[0].air_date, '2023-09-29', 'a data da AniList continua');
  assert.equal(s1[0].runtime, 24);
  assert.equal(work.seasons[1].episodes[9].name, 'Título 10');
  assert.ok(!svc.callsTo('jikan').some(c => c.url.includes('/63816/')), 'temporada anunciada não consulta a Jikan');
});

test('ingestão: a Jikan com erro no meio não atrapalha (segue com "Episódio N") e uma entrada sem lista na MAL não derruba as outras', async () => {
  let n = 0;
  const jikan = (url) => {
    n++;
    if (url.includes('/52991/')) throw mediaErrors.notFound();           // essa entrada não tem lista de episódios
    if (url.includes('/59978/')) return { pagination: { has_next_page: false }, data: [{ mal_id: 1, title: 'Só este', aired: '2026-01-16T00:00:00+00:00', duration: 1440 }] };
    throw new Error('inesperado');
  };
  const svc = newService({ handlers: { jikan }, extra: { seedPath: seedWithoutAnime() } });
  const work = await svc.ingest(10052991);
  assert.equal(work.seasons[0].episodes[0].name, 'Episódio 1');
  assert.equal(work.seasons[1].episodes[0].name, 'Só este');
  assert.equal(work.seasons[1].episodes[1].name, 'Episódio 2');
  assert.equal(n, 2);

  const broken = newService({ handlers: { jikan: () => { throw mediaErrors.upstream(); } }, extra: { seedPath: seedWithoutAnime() } });
  const ok = await broken.ingest(10052991);
  assert.equal(totalEpisodes(ok), 38);
});

test('amostra do seed x fonte externa: ingerir Attack on Titan pelo id externo troca a amostra (1429) pela obra real, sem criar uma segunda', async () => {
  const dir = T.newDir();
  const svc = makeService(MediaService, dir);
  const sample = svc.findLocal(1429);
  assert.equal(MediaService.isSeedSample(sample), true);
  assert.equal(totalEpisodes(sample), 2, 'a amostra tem 2 episódios inventados');
  assert.equal(svc.needsIngest(10025777), true, 'a amostra não conta como "já existe": precisa ser trocada');

  const work = await svc.ingest(toInternalId('jikan', 25777));   // pedido pela Season 2, no meio da cadeia
  assert.equal(work.id, 1429, 'ocupa o lugar da amostra: quem já tinha a amostra na lista continua com a mesma obra');
  assert.equal(totalEpisodes(work), 91);
  assert.equal(work.mal_id, 25777, 'mal_id = o pedido (como na S06); a franquia inteira está em mal_ids');
  assert.ok(work.mal_ids.includes(16498));
  assert.equal(MediaService.isSeedSample(svc.findLocal(1429)), false);
  assert.equal(svc.findLocal(10025777), null);
  assert.equal(svc.catalog.filter(m => (m.mal_ids || []).includes(16498) || m.mal_id === 16498).length, 1, 'uma única obra de Attack on Titan');
  assert.equal(svc.needsIngest(10016498), false);
  assert.equal(svc.resolveExisting(10016498).id, 1429, 'a 1ª temporada, pelo id externo, devolve a mesma obra');

  // gravado em disco e estável na próxima partida
  const reborn = makeService(MediaService, dir);
  assert.equal(totalEpisodes(reborn.findLocal(1429)), 91);
  assert.equal(reborn.catalog.filter(m => (m.mal_ids || []).includes(16498)).length, 1);

  // depois disso a busca devolve a obra do catálogo, não um resultado externo
  const { items } = await reborn.searchDetailed('Attack on Titan', 'anime');
  assert.equal(items[0].id, 1429);
  assert.ok(!items[0].isExternal);
  assert.ok(!items.some(i => i.id === 10016498));
});

test('amostra do seed x Frieren: o aviso e o dedupe valem também para o título em japonês e para pedir qualquer temporada', async () => {
  const svc = newService();
  const viaS2 = await svc.ingest(toInternalId('jikan', 59978));
  assert.equal(viaS2.id, 209867, 'Frieren e a Jornada para o Além (amostra) vira a obra real');
  assert.equal(totalEpisodes(viaS2), 38);
  const jp = await svc.searchDetailed('葬送のフリーレン', 'anime');
  assert.equal(jp.items[0].id, 209867);
  assert.ok(!jp.items[0].isExternal);
});

test('dois pedidos ao mesmo tempo por temporadas diferentes da mesma franquia gravam UMA obra só', async () => {
  const svc = newService({ extra: { seedPath: seedWithoutAnime() } });
  const [a, b] = await Promise.all([svc.ingest(toInternalId('jikan', 52991)), svc.ingest(toInternalId('jikan', 59978))]);
  assert.equal(a.id, b.id);
  assert.equal(svc.catalog.filter(m => (m.mal_ids || []).includes(52991)).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(svc.catalogPath, 'utf-8')).filter(m => (m.mal_ids || []).includes(59978)).length, 1);
});

test('anime só da AniList (sem idMal): ingestão pela faixa 40.000.000+, id pedido, alias pelas entradas da MAL', async () => {
  const svc = newService({ extra: { seedPath: seedWithoutAnime() } });
  const id = toInternalId('anilist', 162314);   // "THE FINAL CHAPTERS Special 2": sem idMal na AniList
  assert.equal(svc.canIngest(id), true);
  const work = await svc.ingest(id);
  assert.equal(work.id, id);
  assert.equal(work.anilist_id, 162314);
  assert.equal(totalEpisodes(work), 91, 'a franquia inteira, a partir de qualquer entrada');
  assert.equal(svc.resolveExisting(10016498).id, id, 'a 1ª temporada (id da MAL) é a mesma obra');
  assert.equal(svc.resolveExisting(toInternalId('anilist', 20958)).id, id);

  // com a AniList desligada essa faixa não funciona (só ela conhece essas obras)
  const off = newService({ extra: { anilistEnabled: false } });
  await assert.rejects(off.ingest(id), e => e.code === 'SOURCE_NOT_CONFIGURED');
});

test('ingestão: AniList fora do ar -> Jikan faz o mesmo trabalho (id pedido); as duas falhando sobe o erro mais útil', async () => {
  const jikan = jikanHandler([jikanAnime(52991, { title: 'Sousou no Frieren', episodes: 3, aired: { from: '2023-09-29T00:00:00+00:00' }, season: 'fall', year: 2023, relations: [{ relation: 'Sequel', entry: [{ mal_id: 59978, type: 'anime' }] }] }), jikanAnime(59978, { title: 'Sousou no Frieren 2nd Season', episodes: 2, aired: { from: '2026-01-16T00:00:00+00:00' }, season: 'winter', year: 2026, relations: [{ relation: 'Prequel', entry: [{ mal_id: 52991, type: 'anime' }] }] })]);
  const svc = newService({ handlers: { anilist: anilistDown, jikan }, extra: { seedPath: seedWithoutAnime() } });
  const work = await svc.ingest(10052991);
  assert.equal(work.id, 10052991);
  assert.deepEqual(work.seasons.map(s => s.episodes.length), [3, 2]);
  assert.equal(work.seasons[0].episodes[0].name, 'Título 1', 'títulos reais da Jikan');
  assert.equal(work.seasons[0].name, 'Temporada 1 · Outono 2023');
  assert.ok(work.ingestedAt && work.refreshedAt);

  const mk = (a, j) => newService({ handlers: { anilist: () => { throw a; }, jikan: () => { throw j; } }, extra: { seedPath: seedWithoutAnime(), anilist: { minIntervalMs: 0, retries: 0 } } });
  await assert.rejects(mk(mediaErrors.rateLimited(5000), mediaErrors.upstream()).ingest(10000020), e => e.code === 'RATE_LIMITED');
  await assert.rejects(mk(mediaErrors.upstream(), mediaErrors.notFound()).ingest(10000020), e => e.code === 'UPSTREAM');
  await assert.rejects(mk(mediaErrors.notFound(), mediaErrors.notFound()).ingest(10000020), e => e.code === 'NOT_FOUND');
  // AniList não conhece a obra (404) mas a Jikan conhece: serve a Jikan
  const j = newService({ handlers: { anilist: () => { throw mediaErrors.notFound(); }, jikan }, extra: { seedPath: seedWithoutAnime() } });
  assert.equal((await j.ingest(10052991)).seasons.length, 2);
  // faixa só da AniList não tem reserva: o erro da AniList sobe
  await assert.rejects(newService({ handlers: { anilist: anilistDown }, extra: { seedPath: seedWithoutAnime() } }).ingest(toInternalId('anilist', 162314)), e => e.code === 'UPSTREAM');
});

test('AniList fora do ar com o disjuntor aberto: a ingestão cai para a Jikan na hora, sem esperar outro timeout', async () => {
  const jikan = jikanHandler([jikanAnime(20, { title: 'Naruto', episodes: 2 })]);
  const svc = newService({ handlers: { anilist: anilistDown, jikan }, extra: { seedPath: seedWithoutAnime() } });
  await svc.searchDetailed('Naruto', 'anime');                     // a busca já derrubou o disjuntor
  assert.equal(svc.anilist.breaker.isOpen, true);
  const n = svc.callsTo('anilist').length;
  const work = await svc.ingest(10000020);
  assert.equal(work.seasons[0].episodes.length, 2);
  assert.equal(svc.callsTo('anilist').length, n, 'nenhuma tentativa à AniList caída');
});

test('rotas de ids: a faixa 40.000.000+ e a da Jikan são ingeríveis; id fora das faixas continua inválido', () => {
  const svc = newService();
  assert.equal(svc.canIngest(40000001), true);
  assert.equal(svc.canIngest(10000001), true);
  assert.equal(svc.canIngest(50000000), false);
  assert.equal(svc.canIngest(5000000), false);
  assert.ok(fixtureMedia('id:154587').data.Media.id === 154587, 'helper de fixtures funciona');
});
