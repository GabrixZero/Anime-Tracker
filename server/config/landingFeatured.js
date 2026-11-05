// Títulos reais mostrados no mockup da landing (D-CL-3). Lista FIXA: o endpoint público nunca recebe ids de fora.
// `title` é o texto local (aparece mesmo sem TMDB); o pôster vem da API do TMDB (os termos só permitem imagens ligadas aos dados da API).
//  - Harry Potter: série de TV da HBO (estreia 2026-12-25 no TMDB), NÃO os filmes · Naruto Shippuden: anime (série no TMDB)
//  - Homem-Aranha: Através do Aranhaverso: filme (2023)
const LANDING_FEATURED = Object.freeze([
  Object.freeze({ type: 'tv', kind: 'tv', tmdbId: 224377, title: 'Harry Potter' }),
  Object.freeze({ type: 'anime', kind: 'tv', tmdbId: 31910, title: 'Naruto Shippuden' }),
  Object.freeze({ type: 'movie', kind: 'movie', tmdbId: 569094, title: 'Homem-Aranha: Através do Aranhaverso' })
]);

module.exports = { LANDING_FEATURED };
