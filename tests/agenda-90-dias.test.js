process.env.SHOWVAULT_SEED_PATH = require('path').join(__dirname, 'fixtures', 'seed-teste.json'); // seed de teste (textos fictícios), não o catálogo real
// Agenda de 90 dias (parte servidor): data BR de filmes (TMDB release_dates), grade recente da AniList e validade de filmes não lançados.
// Tudo com fetch falso: nenhum teste usa a internet.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const TmdbClient = require('../server/services/tmdbClient');
const AniListClient = require('../server/services/anilistClient');
const mapper = require('../server/services/anilistMapper');
const { MediaService } = require('../server/services/mediaService');
const { toInternalId } = require('../server/utils/ids');

// ---- TMDB: release_dates ----------------------------------------------------------------------------------------------------------

const movieJson = { id: 7, title: 'Filme Teste', release_date: '2030-05-10', status: 'Post Production', runtime: 100, genres: [] };

function tmdbWith(releaseDates) {
  const urls = [];
  const client = new TmdbClient({
    apiKey: 'chave-falsa',
    fetchJson: async url => {
      urls.push(url);
      if (url.includes('/release_dates')) return releaseDates(url);
      return movieJson;
    }
  });
  client.urls = urls;
  return client;
}

const br = (...entries) => ({
  results: [
    { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2030-01-01T00:00:00.000Z' }] },
    { iso_3166_1: 'BR', release_dates: entries }
  ]
});

test('TMDB getMovie: prefere a menor data de cinema (type 3) do Brasil, cortada em AAAA-MM-DD', async () => {
  const client = tmdbWith(() =>
    br(
      { type: 3, release_date: '2030-05-20T03:00:00.000Z' },
      { type: 3, release_date: '2030-05-15T03:00:00.000Z' },
      { type: 4, release_date: '2030-01-01T00:00:00.000Z' } // digital: não conta
    )
  );
  const movie = await client.getMovie(7);
  assert.equal(movie.first_air_date, '2030-05-15');
  assert.ok(client.urls.some(u => u.includes('/movie/7/release_dates')));
});

test('TMDB getMovie: sem entrada do Brasil (ou sem type 3) mantém o release_date', async () => {
  const semBr = await tmdbWith(() => ({
    results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2030-02-02T00:00:00.000Z' }] }]
  })).getMovie(7);
  assert.equal(semBr.first_air_date, '2030-05-10');
  const semCinema = await tmdbWith(() => br({ type: 4, release_date: '2030-03-03T00:00:00.000Z' })).getMovie(7);
  assert.equal(semCinema.first_air_date, '2030-05-10');
});

test('TMDB getMovie: erro em release_dates não quebra e mantém o release_date', async () => {
  const movie = await tmdbWith(() => {
    throw new Error('falha de rede');
  }).getMovie(7);
  assert.equal(movie.first_air_date, '2030-05-10');
  assert.equal(movie.name, 'Filme Teste');
});

// ---- AniList: grade dos últimos 90 dias -------------------------------------------------------------------------------------------

const NOW = Date.parse('2026-06-15T12:00:00Z');
const unix = iso => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);

const releasing = (extra = {}) => ({
  id: 21,
  idMal: 21,
  type: 'ANIME',
  format: 'TV',
  status: 'RELEASING',
  episodes: null,
  duration: 24,
  isAdult: false,
  title: { romaji: 'One Teste', english: 'One Test', native: null },
  synonyms: [],
  startDate: { year: 1999, month: 10, day: 20 },
  nextAiringEpisode: { episode: 1100, airingAt: unix('2026-06-21') },
  relations: { edges: [] },
  // a 1ª página (sem ordem) só tem os primeiros episódios, bem antigos
  airingSchedule: {
    nodes: [
      { episode: 1, airingAt: unix('1999-10-20') },
      { episode: 2, airingAt: unix('1999-10-27') }
    ]
  },
  ...extra
});

function anilistWith(media, extraQuery) {
  const calls = [];
  const client = new AniListClient({
    fetchJson: async (url, opts) => {
      const { query, variables } = JSON.parse(opts.body);
      calls.push({ query, variables });
      if (query.includes('airingSchedules')) return extraQuery(variables);
      return { data: { Media: media } };
    },
    sleep: async () => {},
    minIntervalMs: 0,
    retries: 0,
    now: () => NOW
  });
  client.calls = calls;
  return client;
}

test('AniList: obra em exibição ganha a grade dos últimos 90 dias e o mapper preenche as datas passadas', async () => {
  const client = anilistWith(releasing(), () => ({
    data: {
      Page: {
        airingSchedules: [
          { episode: 1098, airingAt: unix('2026-06-07') },
          { episode: 1099, airingAt: unix('2026-06-14') }
        ]
      }
    }
  }));
  const m = await client.getMedia({ id: 21 });
  const extra = client.calls.find(c => c.query.includes('airingSchedules'));
  assert.ok(extra, 'fez a consulta extra');
  assert.equal(client.calls.filter(c => c.query.includes('airingSchedules')).length, 1, 'uma só consulta extra');
  assert.equal(extra.variables.id, 21);
  const expectedAfter = Math.floor(NOW / 1000 / 86400) * 86400 - 90 * 86400;
  assert.equal(extra.variables.after, expectedAfter, 'agora - 90 dias (arredondado ao dia)');

  const eps = mapper.episodesFor(m);
  assert.equal(eps.length, 1100);
  assert.equal(eps[1097].air_date, '2026-06-07');
  assert.equal(eps[1098].air_date, '2026-06-14');
  assert.equal(eps[0].air_date, '1999-10-20', 'a data que já existia continua');
  assert.equal(eps[500].air_date, '', 'sem dado = vazio, nada inventado');
});

test('AniList: a data nova não sobrescreve uma data válida com vazia (nem com data inválida)', () => {
  const m = releasing({
    recentSchedule: {
      nodes: [
        { episode: 1, airingAt: null },
        { episode: 2, airingAt: 'x' },
        { episode: 3, airingAt: unix('2026-06-01') }
      ]
    }
  });
  const eps = mapper.episodesFor(m);
  assert.equal(eps[0].air_date, '1999-10-20');
  assert.equal(eps[1].air_date, '1999-10-27');
  assert.equal(eps[2].air_date, '2026-06-01');
});

test('AniList: falha da consulta extra não quebra a obra (segue com o que tem)', async () => {
  const client = anilistWith(releasing(), () => {
    throw new Error('queda da AniList');
  });
  const m = await client.getMedia({ id: 21 });
  assert.equal(m.id, 21);
  assert.equal(m.recentSchedule, undefined);
  assert.ok(mapper.episodesFor(m).length > 0);

  const semDados = anilistWith(releasing(), () => ({ errors: [{ message: 'x', status: 500 }] }));
  assert.equal((await semDados.getMedia({ id: 21 })).id, 21);
});

test('AniList: obra que não está em exibição não faz a consulta extra', async () => {
  const client = anilistWith(releasing({ status: 'FINISHED', episodes: 12 }), () => ({ data: { Page: { airingSchedules: [] } } }));
  await client.getMedia({ id: 21 });
  assert.equal(client.calls.length, 1);
});

// ---- Validade de filmes -----------------------------------------------------------------------------------------------------------

function service(tmdbKey) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-agenda90-'));
  return new MediaService({ dataDir: dir, jikanEnabled: false, anilistEnabled: false, tmdbKey });
}

test('validade: filme não lançado vence como "Em breve" (24h); filme já lançado nunca vence', () => {
  const svc = service('chave-falsa');
  const now = Date.parse('2026-06-15T12:00:00Z');
  const base = { id: toInternalId('tmdb_movie', 5), type: 'movie', ingestedAt: '2026-06-01T00:00:00.000Z' };
  const day = 24 * 60 * 60 * 1000;

  assert.equal(svc.refreshTtlMs({ ...base, first_air_date: '', status: '' }, now), day, 'sem data');
  assert.equal(svc.refreshTtlMs({ ...base, first_air_date: '2026-06-25', status: 'Em pós-produção' }, now), day, 'data futura');
  assert.equal(svc.refreshTtlMs({ ...base, first_air_date: '2026-06-15', status: 'Lançado' }, now), day, 'estreia é hoje');
  assert.equal(
    svc.refreshTtlMs({ ...base, first_air_date: '2026-05-01', status: 'Em pós-produção' }, now),
    day,
    'status ainda não é Lançado'
  );
  assert.equal(svc.refreshTtlMs({ ...base, first_air_date: '2026-05-01', status: 'Lançado' }, now), null, 'lançado');

  const old = { ...base, first_air_date: '', status: '', refreshedAt: '2026-06-10T00:00:00.000Z' };
  assert.equal(svc.isRefreshDue(old, now), true, 'passou de 24h desde a última atualização');
  assert.equal(svc.isRefreshDue({ ...old, refreshedAt: '2026-06-15T10:00:00.000Z' }, now), false, 'atualizado há pouco');
});

test('validade: sem chave do TMDB o filme não vence (sem tentativa nem erro)', () => {
  const svc = service('');
  const item = { id: toInternalId('tmdb_movie', 5), type: 'movie', ingestedAt: '2026-06-01T00:00:00.000Z', first_air_date: '', status: '' };
  assert.equal(svc.refreshTtlMs(item), null);
  assert.equal(svc.isRefreshDue(item, Date.parse('2026-07-01T00:00:00Z')), false);
});
