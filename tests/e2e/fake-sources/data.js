// Dados FICTÍCIOS das fontes externas usados pelo servidor falso dos testes E2E (S12).
// Formato igual ao das APIs reais (TVMaze, AniList e Jikan v4), só com os campos que o app lê. Nada aqui vem da internet.
'use strict';

const ep = (season, number, name, airdate) => ({
  id: 900000 + season * 100 + number,
  name,
  season,
  number,
  airdate,
  runtime: 50,
  summary: `<p>Episódio ${number} da temporada ${season} (fictício).</p>`,
  image: null
});

// Dia civil (AAAA-MM-DD) de hoje + n dias no MESMO fuso do navegador dos testes (playwright.config.js: America/Sao_Paulo),
// gerado na hora para os episódios da Agenda (S15) nunca envelhecerem nem divergirem do "hoje" da página perto da meia-noite UTC.
const dayFromToday = n => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------------------------------------------------------------
// TVMaze: GET /search/shows?q=  e  GET /shows/:id?embed=episodes   (séries)
// ---------------------------------------------------------------------------------------------------------------------------------
const TVMAZE_SHOWS = [
  {
    id: 9001,
    name: 'Fronteira Sombria',
    type: 'Scripted',
    language: 'Portuguese',
    genres: ['Drama', 'Thriller'],
    status: 'Ended',
    premiered: '2021-03-10',
    averageRuntime: 50,
    rating: { average: 7.9 },
    network: { name: 'Rede Fictícia', country: { code: 'BR' } },
    webChannel: null,
    image: {
      medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/90/9001.jpg',
      original: 'https://static.tvmaze.com/uploads/images/original_untouched/90/9001.jpg'
    },
    summary: '<p>Série <b>fictícia</b> usada só nos testes ponta a ponta.</p>',
    episodes: [
      ep(1, 1, 'A Chegada', '2021-03-10'),
      ep(1, 2, 'O Mapa', '2021-03-17'),
      ep(1, 3, 'A Travessia', '2021-03-24'),
      ep(2, 1, 'Do Outro Lado', '2022-04-05'),
      ep(2, 2, 'O Retorno', '2022-04-12')
    ]
  },
  {
    id: 9002,
    name: 'Fronteira Final',
    type: 'Scripted',
    language: 'English',
    genres: ['Science-Fiction'],
    status: 'Running',
    premiered: '2024-09-01',
    averageRuntime: 42,
    rating: { average: null },
    network: { name: 'Canal Fictício', country: { code: 'US' } },
    webChannel: null,
    image: null,
    summary: '<p>Outra série fictícia, para a busca ter mais de um resultado.</p>',
    episodes: [ep(1, 1, 'Piloto', '2024-09-01'), ep(1, 2, 'Órbita', '2024-09-08')]
  },
  {
    // Série em exibição para a Agenda (S15): episódios hoje, amanhã, daqui a 3 dias e daqui a 20 dias (datas relativas a hoje).
    id: 9003,
    name: 'Estreias da Semana',
    type: 'Scripted',
    language: 'Portuguese',
    genres: ['Comedy'],
    status: 'Running',
    premiered: dayFromToday(-30),
    averageRuntime: 30,
    rating: { average: null },
    network: { name: 'Canal Fictício', country: { code: 'BR' } },
    webChannel: null,
    image: null,
    summary: '<p>Série fictícia com episódios futuros, usada só na Agenda dos testes.</p>',
    episodes: [
      ep(1, 1, 'Estreia de Hoje', dayFromToday(0)),
      ep(1, 2, 'Segundo Capítulo', dayFromToday(1)),
      ep(1, 3, 'Terceira Parte', dayFromToday(3)),
      ep(1, 4, 'Muito Mais Tarde', dayFromToday(20))
    ]
  },
  {
    // Série semanal em exibição para a Agenda (janela de 90 dias): 1 episódio por semana, 8 já exibidos (de -56 a -7 dias) e 3 a exibir.
    id: 9004,
    name: 'Ronda Semanal',
    type: 'Scripted',
    language: 'Portuguese',
    genres: ['Drama'],
    status: 'Running',
    premiered: dayFromToday(-56),
    averageRuntime: 45,
    rating: { average: null },
    network: { name: 'Canal Fictício', country: { code: 'BR' } },
    webChannel: null,
    image: null,
    summary: '<p>Série fictícia semanal, com episódios passados e futuros, usada só na Agenda dos testes.</p>',
    episodes: [-56, -49, -42, -35, -28, -21, -14, -7, 7, 14, 21].map((d, i) => ep(1, i + 1, `Ronda ${i + 1}`, dayFromToday(d)))
  }
];

// ---------------------------------------------------------------------------------------------------------------------------------
// AniList (GraphQL): busca (Page.media) e obra por id/idMal (Media, com relações e grade de exibição). É a fonte PRINCIPAL de anime.
// Uma franquia fictícia de duas temporadas (ids da AniList 190001 -> 190002, da MAL 90001 -> 90002): a busca agrupa as duas e a
// ingestão vira UMA obra com duas temporadas ("Temporada 1 · Outono 2023" e "Temporada 2 · Primavera 2024").
// ---------------------------------------------------------------------------------------------------------------------------------
const unix = iso => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);

// `relation` é opcional (sem ela a obra não tem sequência). `status: 'RELEASING'` imita a AniList de verdade: a grade da obra (airingSchedule)
// traz só os episódios a exibir e os já exibidos ficam em `fullSchedule`, que o servidor falso devolve na consulta `airingSchedules`.
const anilistEntry = ({ id, idMal, romaji, english, from, season, seasonYear, episodes, score, relation, dates, status = 'FINISHED' }) => {
  const [year, month, day] = from.split('-').map(Number);
  const todayUnix = unix(dayFromToday(0));
  const all = dates.map((d, i) => ({ episode: i + 1, airingAt: unix(d) }));
  const upcoming = all.filter(n => n.airingAt >= todayUnix);
  const releasing = status === 'RELEASING';
  return {
    id,
    idMal,
    type: 'ANIME',
    format: 'TV',
    status,
    episodes,
    duration: 24,
    season,
    seasonYear,
    isAdult: false,
    title: { romaji, english, native: '星の記憶' },
    synonyms: ['Memórias das Estrelas'],
    startDate: { year, month, day },
    averageScore: score,
    meanScore: score,
    genres: ['Adventure', 'Fantasy'],
    description: 'Anime fictício usado só nos testes ponta a ponta.<br><br>(Source: E2E)',
    coverImage: {
      large: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx${id}.jpg`,
      extraLarge: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${id}.jpg`
    },
    bannerImage: null,
    nextAiringEpisode: releasing && upcoming.length ? upcoming[0] : null,
    // Só aparecem na consulta de uma obra (a busca não pede):
    relations: {
      edges: relation
        ? [{ relationType: relation.type, node: { id: relation.id, idMal: relation.idMal, type: 'ANIME', format: 'TV', isAdult: false } }]
        : []
    },
    airingSchedule: { nodes: releasing ? upcoming : all },
    fullSchedule: all
  };
};

const ANILIST_MEDIA = [
  anilistEntry({
    id: 190001,
    idMal: 90001,
    romaji: 'Hoshi no Kioku',
    english: 'Star Memories',
    from: '2023-10-06',
    season: 'FALL',
    seasonYear: 2023,
    episodes: 3,
    score: 81,
    relation: { type: 'SEQUEL', id: 190002, idMal: 90002 },
    dates: ['2023-10-06', '2023-10-13', '2023-10-20']
  }),
  anilistEntry({
    id: 190002,
    idMal: 90002,
    romaji: 'Hoshi no Kioku 2nd Season',
    english: 'Star Memories Season 2',
    from: '2024-04-05',
    season: 'SPRING',
    seasonYear: 2024,
    episodes: 2,
    score: 84,
    relation: { type: 'PREQUEL', id: 190001, idMal: 90001 },
    dates: ['2024-04-05', '2024-04-12']
  }),
  // Anime semanal em exibição (sem total de episódios): 9 já exibidos (de -63 a -7 dias) e 3 a exibir.
  anilistEntry({
    id: 190003,
    idMal: 90003,
    romaji: 'Umi no Tsuki',
    english: 'Maré Viva',
    from: dayFromToday(-63),
    season: 'FALL',
    seasonYear: 2026,
    episodes: null,
    score: 77,
    status: 'RELEASING',
    dates: [-63, -56, -49, -42, -35, -28, -21, -14, -7, 7, 14, 21].map(dayFromToday)
  }),
  // Anime encerrado: o último episódio foi há 200 dias (fora da janela da Agenda).
  anilistEntry({
    id: 190004,
    idMal: 90004,
    romaji: 'Hai no Owari',
    english: 'Cinza do Fim',
    from: dayFromToday(-214),
    season: 'SPRING',
    seasonYear: 2026,
    episodes: 3,
    score: 70,
    dates: [-214, -207, -200].map(dayFromToday)
  })
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Jikan v4 (reserva da AniList; também completa os TÍTULOS dos episódios): GET /anime?q=  ·  /anime/:id/full  ·  /anime/:id/episodes
// ---------------------------------------------------------------------------------------------------------------------------------
const jikanAnime = ({ mal_id, title, title_english, from, season, year, episodes, relations, score }) => ({
  mal_id,
  url: `https://myanimelist.net/anime/${mal_id}`,
  images: {
    jpg: {
      image_url: `https://cdn.myanimelist.net/images/anime/90/${mal_id}.jpg`,
      large_image_url: `https://cdn.myanimelist.net/images/anime/90/${mal_id}l.jpg`
    }
  },
  title,
  title_english,
  title_japanese: '星の記憶',
  titles: [
    { type: 'Default', title },
    { type: 'English', title: title_english }
  ],
  title_synonyms: [],
  type: 'TV',
  episodes,
  status: 'Finished Airing',
  aired: { from: `${from}T00:00:00+00:00` },
  duration: '24 min per ep',
  score,
  synopsis: 'Anime fictício usado só nos testes ponta a ponta. [Written by E2E]',
  season,
  year,
  genres: [{ name: 'Adventure' }, { name: 'Fantasy' }],
  themes: [],
  relations
});

const JIKAN_ANIME = [
  jikanAnime({
    mal_id: 90001,
    title: 'Hoshi no Kioku',
    title_english: 'Star Memories',
    from: '2023-10-06',
    season: 'fall',
    year: 2023,
    episodes: 3,
    score: 8.1,
    relations: [{ relation: 'Sequel', entry: [{ mal_id: 90002, type: 'anime', name: 'Hoshi no Kioku 2nd Season' }] }]
  }),
  jikanAnime({
    mal_id: 90002,
    title: 'Hoshi no Kioku 2nd Season',
    title_english: 'Star Memories Season 2',
    from: '2024-04-05',
    season: 'spring',
    year: 2024,
    episodes: 2,
    score: 8.4,
    relations: [{ relation: 'Prequel', entry: [{ mal_id: 90001, type: 'anime', name: 'Hoshi no Kioku' }] }]
  })
];

const JIKAN_EPISODES = {
  90001: [
    { mal_id: 1, title: 'O Começo da Jornada', aired: '2023-10-06T00:00:00+00:00', duration: 1440 },
    { mal_id: 2, title: 'Constelações', aired: '2023-10-13T00:00:00+00:00', duration: 1440 },
    { mal_id: 3, title: 'A Estrela Cadente', aired: '2023-10-20T00:00:00+00:00', duration: 1440 }
  ],
  90002: [
    { mal_id: 1, title: 'Um Novo Céu', aired: '2024-04-05T00:00:00+00:00', duration: 1440 },
    { mal_id: 2, title: 'Memória Final', aired: '2024-04-12T00:00:00+00:00', duration: 1440 }
  ]
};

// ---------------------------------------------------------------------------------------------------------------------------------
// TMDB (v3, pt-BR; só vale com TMDB_API_KEY): /search/movie  ·  /search/tv  ·  /movie/:id   (filmes novos)
// ---------------------------------------------------------------------------------------------------------------------------------
const tmdbMovie = (id, title, original_title, release_date, status) => ({
  id,
  title,
  original_title,
  original_language: 'pt',
  overview: 'Filme fictício usado só nos testes ponta a ponta.',
  poster_path: `/e2e-filme-${id}.jpg`,
  backdrop_path: `/e2e-filme-${id}-fundo.jpg`,
  vote_average: 6.5,
  vote_count: 50,
  release_date,
  genres: [{ id: 35, name: 'Comédia' }],
  runtime: 100,
  status
});

const TMDB_MOVIES = [
  {
    id: 8801,
    title: 'Cidade Fantasma',
    original_title: 'Ghost City',
    original_language: 'pt',
    overview: 'Filme fictício usado só nos testes ponta a ponta.',
    poster_path: '/e2e-cidade-fantasma.jpg',
    backdrop_path: '/e2e-cidade-fantasma-fundo.jpg',
    vote_average: 7.2,
    vote_count: 120,
    release_date: '2022-06-01',
    genres: [
      { id: 878, name: 'Ficção científica' },
      { id: 53, name: 'Suspense' }
    ],
    runtime: 95,
    status: 'Released'
  },
  // Filmes da Agenda (datas relativas a hoje). O release_date global difere de propósito da estreia no Brasil (TMDB_RELEASE_DATES).
  tmdbMovie(8802, 'Estreia Próxima', 'Coming Soon', dayFromToday(12), 'Post Production'),
  tmdbMovie(8803, 'Lançamento Recente', 'Recent Release', dayFromToday(-35), 'Released'),
  tmdbMovie(8804, 'Clássico Antigo', 'Old Classic', dayFromToday(-125), 'Released')
];

// /movie/:id/release_dates: estreia no cinema (type 3) do Brasil. O 8801 só tem a dos EUA (o app cai no release_date).
const tmdbBr = date => ({ iso_3166_1: 'BR', release_dates: [{ type: 3, release_date: `${date}T00:00:00.000Z`, certification: '12' }] });
const TMDB_RELEASE_DATES = {
  8801: [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2022-06-01T00:00:00.000Z', certification: 'PG' }] }],
  8802: [tmdbBr(dayFromToday(10))],
  8803: [tmdbBr(dayFromToday(-30))],
  8804: [tmdbBr(dayFromToday(-120))]
};

// O que os testes esperam ver na tela (ids internos = faixa da fonte + id externo; ver server/utils/ids.js).
const EXPECTED = {
  tvShow: { name: 'Fronteira Sombria', otherName: 'Fronteira Final', query: 'Fronteira', id: 1_000_000 + 9001, seasons: 2, episodes: 5 },
  anime: {
    name: 'Star Memories',
    query: 'Star Memories',
    id: 10_000_000 + 90001,
    seasons: 2,
    episodes: 5,
    firstEpisode: 'O Começo da Jornada',
    seasonNames: ['Temporada 1 · Outono 2023', 'Temporada 2 · Primavera 2024']
  },
  calendar: {
    name: 'Estreias da Semana',
    query: 'Estreias da Semana',
    id: 1_000_000 + 9003,
    today: 'Estreia de Hoje',
    tomorrow: 'Segundo Capítulo',
    in3days: 'Terceira Parte',
    in20days: 'Muito Mais Tarde'
  },
  movie: { name: 'Cidade Fantasma', query: 'Cidade Fantasma', id: 30_000_000 + 8801, runtime: 95 },
  // Agenda de 90 dias (datas relativas a hoje; ver os dados acima)
  agenda90: {
    upcomingMovie: { name: 'Estreia Próxima', query: 'Estreia Próxima', id: 30_000_000 + 8802, inDays: 10 },
    recentMovie: { name: 'Lançamento Recente', query: 'Lançamento Recente', id: 30_000_000 + 8803, inDays: -30 },
    oldMovie: { name: 'Clássico Antigo', query: 'Clássico Antigo', id: 30_000_000 + 8804, inDays: -120 },
    weeklySeries: { name: 'Ronda Semanal', query: 'Ronda Semanal', id: 1_000_000 + 9004, pastEpisodes: 8, futureEpisodes: 3 },
    releasingAnime: { name: 'Maré Viva', query: 'Maré Viva', id: 10_000_000 + 90003, pastEpisodes: 9, futureEpisodes: 3 },
    endedAnime: { name: 'Cinza do Fim', query: 'Cinza do Fim', id: 10_000_000 + 90004, lastEpisodeDaysAgo: 200 }
  }
};

module.exports = { TVMAZE_SHOWS, ANILIST_MEDIA, JIKAN_ANIME, JIKAN_EPISODES, TMDB_MOVIES, TMDB_RELEASE_DATES, EXPECTED };
