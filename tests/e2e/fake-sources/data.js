// Dados FICTÍCIOS das fontes externas usados pelo servidor falso dos testes E2E (S12).
// Formato igual ao das APIs reais (TVMaze e Jikan v4), só com os campos que o app lê. Nada aqui vem da internet.
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

// TVMaze: GET /search/shows?q=  e  GET /shows/:id?embed=episodes
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
  }
];

// Jikan v4: GET /anime?q=  ·  GET /anime/:id/full  ·  GET /anime/:id/episodes?page=
// Uma franquia fictícia de duas temporadas (90001 -> sequência 90002): a busca agrupa as duas e a ingestão vira 1 obra com 2 temporadas.
const anime = ({ mal_id, title, title_english, from, season, year, episodes, relations, score }) => ({
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
  anime({
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
  anime({
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

// O que os testes esperam ver na tela (ids internos = faixa da fonte + id externo; ver server/utils/ids.js).
const EXPECTED = {
  tvShow: { name: 'Fronteira Sombria', id: 1_000_000 + 9001, seasons: 2 },
  anime: { name: 'Star Memories', id: 10_000_000 + 90001, seasons: 2 }
};

module.exports = { TVMAZE_SHOWS, JIKAN_ANIME, JIKAN_EPISODES, EXPECTED };
