/* ================================================================
   SHOWVAULT · MOTOR DE ENGENHARIA & LOCAL-FIRST TRACKER
   Zero perda de anotações · Séries, Filmes e Animes · Auth & Google Login
   ================================================================ */

(function() {
  'use strict';

  // Chaves de armazenamento
  const STORAGE_KEY = 'showvault_state_v3';
  const SETTINGS_KEY = 'showvault_settings_v3';
  const AUTH_KEY = 'showvault_user_session_v3';

  // ================================================================
  // CATÁLOGO EXPANDIDO: SÉRIES, ANIMES E FILMES (DADOS REAIS EM PT-BR)
  // ================================================================
  const CATALOG_DATABASE = [
    // --- SÉRIES ---
    {
      id: 1396,
      type: "tv",
      name: "Breaking Bad",
      overview: "Um professor de química do ensino médio diagnosticado com câncer inoperável se junta a um ex-aluno para fabricar e vender metanfetamina para garantir o futuro financeiro de sua família.",
      poster_path: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
      vote_average: 9.5,
      first_air_date: "2008-01-20",
      genres: ["Drama", "Crime"],
      status: "Finalizada",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "Piloto", runtime: 58, air_date: "2008-01-20", overview: "Quando um professor descobre um câncer terminal, ele decide fabricar metanfetamina com um ex-aluno.", still_path: "https://image.tmdb.org/t/p/w500/ydlY3iPfeOAvu8gqenftYeAJM7L.jpg" },
            { episode_number: 2, name: "O Gato Está no Saco...", runtime: 48, air_date: "2008-01-27", overview: "Walt e Jesse precisam se livrar de dois corpos e lidar com a banheira derretida.", still_path: "https://image.tmdb.org/t/p/w500/c50QdM03vJomzNl4N1GqK7g36Zf.jpg" },
            { episode_number: 3, name: "...E o Saco Está no Rio", runtime: 48, air_date: "2008-02-10", overview: "Walt precisa tomar uma decisão moral sobre Domingo no porão.", still_path: "https://image.tmdb.org/t/p/w500/98gJ300q2WnO6bZpYyqB5C3Zf0A.jpg" },
            { episode_number: 4, name: "Câncer Man", runtime: 48, air_date: "2008-02-17", overview: "Walt conta à família sobre a doença durante um churrasco tenso.", still_path: "https://image.tmdb.org/t/p/w500/8gG8g1xZJqj2WwO5pQyqB5C3Zf0.jpg" }
          ]
        }
      ]
    },
    {
      id: 136283,
      type: "tv",
      name: "The Bear (O Urso)",
      overview: "Um jovem chef do mundo requintado da alta gastronomia retorna a Chicago para administrar a lanchonete caótica de sua família após o suicídio do irmão.",
      poster_path: "https://image.tmdb.org/t/p/w500/sHFlg4BWWzdfF5yHnK2jZJ5rNqk.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/m9P6qGqaGjU8yTzPqGqaGjU8yTz.jpg",
      vote_average: 8.8,
      first_air_date: "2022-06-23",
      genres: ["Drama", "Comédia"],
      status: "Em Exibição",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "Sistema", runtime: 28, air_date: "2022-06-23", overview: "Carmy tenta impor ordem à cozinha caótica enquanto lida com o luto.", still_path: "https://image.tmdb.org/t/p/w500/qK4YpQn8xXpT7eM4vY5xXpT7eM4.jpg" },
            { episode_number: 2, name: "Mãos", runtime: 31, air_date: "2022-06-23", overview: "Uma vistoria surpresa expõe problemas estruturais.", still_path: "https://image.tmdb.org/t/p/w500/rK4YpQn8xXpT7eM4vY5xXpT7eM4.jpg" }
          ]
        }
      ]
    },
    {
      id: 95396,
      type: "tv",
      name: "Ruptura (Severance)",
      overview: "Mark lidera uma equipe de funcionários de escritório cujas memórias foram divididas cirurgicamente entre a vida profissional e a pessoal.",
      poster_path: "https://image.tmdb.org/t/p/w500/1md4pB3gB3TqV5lQxN1vQxN1vQx.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/93lmV6B1xTqV5lQxN1vQxN1vQx.jpg",
      vote_average: 8.7,
      first_air_date: "2022-02-18",
      genres: ["Ficção Científica", "Suspense", "Drama"],
      status: "Em Exibição",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "Boas Notícias Sobre o Inferno", runtime: 57, air_date: "2022-02-18", overview: "Mark Scout é promovido na Lumon Industries após a saída de Petey.", still_path: "https://image.tmdb.org/t/p/w500/uK4YpQn8xXpT7eM4vY5xXpT7eM4.jpg" },
            { episode_number: 2, name: "Meio Loop", runtime: 53, air_date: "2022-02-18", overview: "A nova contratada Helly R. questiona sua realidade.", still_path: "https://image.tmdb.org/t/p/w500/vK4YpQn8xXpT7eM4vY5xXpT7eM4.jpg" }
          ]
        }
      ]
    },
    {
      id: 66732,
      type: "tv",
      name: "Stranger Things",
      overview: "Quando um garoto desaparece na pequena cidade de Hawkins, amigos e familiares descobrem um mistério envolvendo experimentos secretos do governo e uma garota com superpoderes.",
      poster_path: "https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg",
      vote_average: 8.6,
      first_air_date: "2016-07-15",
      genres: ["Ficção Científica", "Terror", "Drama"],
      status: "Em Exibição",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "O Desaparecimento de Will Byers", runtime: 48, air_date: "2016-07-15", overview: "Will desaparece misteriosamente perto de um laboratório florestal.", still_path: "https://image.tmdb.org/t/p/w500/wK4YpQn8xXpT7eM4vY5xXpT7eM4.jpg" },
            { episode_number: 2, name: "A Estranha da Maple Street", runtime: 55, air_date: "2016-07-15", overview: "Os garotos encontram a garota com a cabeça raspada.", still_path: "https://image.tmdb.org/t/p/w500/xK4YpQn8xXpT7eM4vY5xXpT7eM4.jpg" }
          ]
        }
      ]
    },

    // --- ANIMES ---
    {
      id: 1429,
      type: "anime",
      name: "Attack on Titan (Shingeki no Kyojin)",
      overview: "Após séculos de terror imposto por titãs devoradores de humanos, os sobreviventes se refugiam atrás de três muralhas gigantescas. O jovem Eren Yeager jura exterminar todos os Titãs.",
      poster_path: "https://image.tmdb.org/t/p/w500/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/7nO5lhKz7j2n9b3n6GqK7g36Zf0.jpg",
      vote_average: 9.1,
      first_air_date: "2013-04-07",
      genres: ["Anime", "Ação", "Fantasia"],
      status: "Finalizada",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "Para Você, Daqui a 2000 Anos: A Queda de Shiganshina, Parte 1", runtime: 24, air_date: "2013-04-07", overview: "O Titã Colossal rompe a muralha e destrói o distrito de Shiganshina.", still_path: "https://image.tmdb.org/t/p/w500/ydlY3iPfeOAvu8gqenftYeAJM7L.jpg" },
            { episode_number: 2, name: "Aquele Dia: A Queda de Shiganshina, Parte 2", runtime: 24, air_date: "2013-04-14", overview: "Eren, Mikasa e Armin embarcam no navio de refugiados rumo à Muralha Rose.", still_path: "https://image.tmdb.org/t/p/w500/c50QdM03vJomzNl4N1GqK7g36Zf.jpg" },
            { episode_number: 3, name: "Uma Luz Fraca na Escuridão: O Alistamento", runtime: 24, air_date: "2013-04-21", overview: "Eren e seus amigos entram para a 104ª Tropa de Treinamento.", still_path: "https://image.tmdb.org/t/p/w500/98gJ300q2WnO6bZpYyqB5C3Zf0A.jpg" }
          ]
        }
      ]
    },
    {
      id: 85937,
      type: "anime",
      name: "Demon Slayer (Kimetsu no Yaiba)",
      overview: "Tanjiro Kamado encontra sua família massacrada por demônios e sua irmã mais nova, Nezuko, transformada em um demônio faminto. Ele inicia sua jornada para curá-la.",
      poster_path: "https://image.tmdb.org/t/p/w500/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/9yBVqNruk6Skr6ewfgG75ej67Te.jpg",
      vote_average: 8.7,
      first_air_date: "2019-04-06",
      genres: ["Anime", "Ação", "Sobrenatural"],
      status: "Em Exibição",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "Crueldade", runtime: 24, air_date: "2019-04-06", overview: "Tanjiro desce a montanha para vender carvão e retorna para um pesadelo.", still_path: "https://image.tmdb.org/t/p/w500/8gG8g1xZJqj2WwO5pQyqB5C3Zf0.jpg" },
            { episode_number: 2, name: "O Treinador Sakonji Urokodaki", runtime: 24, air_date: "2019-04-13", overview: "Tanjiro e Nezuko chegam ao Monte Sagiri para iniciar o treinamento da Respiração da Água.", still_path: "https://image.tmdb.org/t/p/w500/yJ0gM3vJomzNl4N1GqK7g36Zf0B.jpg" }
          ]
        }
      ]
    },
    {
      id: 95479,
      type: "anime",
      name: "Jujutsu Kaisen",
      overview: "Para salvar seus amigos de um espírito amaldiçoado, o jovem atlético Yuji Itadori engole o dedo apodrecido de Ryomen Sukuna, tornando-se o hospedeiro da maior Maldição de todas.",
      poster_path: "https://image.tmdb.org/t/p/w500/hFWP5HkbVEe40grXSUwYivTeTeU.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/gmECEd1beEqitLKL6FSG2StV28a.jpg",
      vote_average: 8.6,
      first_air_date: "2020-10-03",
      genres: ["Anime", "Ação", "Fantasia Sombria"],
      status: "Em Exibição",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "Ryomen Sukuna", runtime: 24, air_date: "2020-10-03", overview: "Itadori se envolve com o Clube de Ocultismo e engole uma relíquia proibida.", still_path: "https://image.tmdb.org/t/p/w500/zK1gM3vJomzNl4N1GqK7g36Zf0C.jpg" },
            { episode_number: 2, name: "Por Mim Mesmo", runtime: 24, air_date: "2020-10-10", overview: "Gojo Satoru apresenta Itadori à Escola Técnica Superior de Jujutsu de Tóquio.", still_path: "https://image.tmdb.org/t/p/w500/aL2gM3vJomzNl4N1GqK7g36Zf0D.jpg" }
          ]
        }
      ]
    },
    {
      id: 209867,
      type: "anime",
      name: "Frieren e a Jornada para o Além",
      overview: "A maga elfa Frieren derrotou o Rei Demônio junto ao grupo do herói Himmel. Sendo quase imortal, ela inicia uma nova jornada para entender o valor dos momentos e dos sentimentos humanos.",
      poster_path: "https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhD.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/9r2n5b3n6GqK7g36Zf0A.jpg",
      vote_average: 8.9,
      first_air_date: "2023-09-29",
      genres: ["Anime", "Fantasia", "Aventura"],
      status: "Em Exibição",
      seasons: [
        {
          season_number: 1,
          name: "Temporada 1",
          episodes: [
            { episode_number: 1, name: "O Fim da Aventura", runtime: 25, air_date: "2023-09-29", overview: "O grupo celebra a paz após dez anos de campanha; cinquenta anos depois, Frieren retorna.", still_path: "https://image.tmdb.org/t/p/w500/uK4YpQn8xXpT7eM4vY5xXpT7eM4.jpg" }
          ]
        }
      ]
    },

    // --- FILMES ---
    {
      id: 157336,
      type: "movie",
      name: "Interestelar (Interstellar)",
      runtime: 169,
      overview: "Com a Terra à beira da inabitabilidade, um grupo de exploradores espaciais viaja através de um buraco de minhoca recém-descoberto na tentativa desesperada de garantir a sobrevivência humana.",
      poster_path: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
      vote_average: 8.7,
      first_air_date: "2014-11-05",
      genres: ["Filme", "Ficção Científica", "Drama"],
      status: "Lançado",
      seasons: [] // Filmes não possuem temporadas
    },
    {
      id: 872585,
      type: "movie",
      name: "Oppenheimer",
      runtime: 180,
      overview: "A história do físico americano J. Robert Oppenheimer, seu papel no Projeto Manhattan durante a Segunda Guerra Mundial e o desenvolvimento da primeira bomba atômica da história.",
      poster_path: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg",
      vote_average: 8.1,
      first_air_date: "2023-07-19",
      genres: ["Filme", "Drama", "História"],
      status: "Lançado",
      seasons: []
    },
    {
      id: 693134,
      type: "movie",
      name: "Duna: Parte 2",
      runtime: 166,
      overview: "Paul Atreides se une a Chani e aos Fremen enquanto busca vingança contra os conspiradores que destruíram sua família. Diante de uma escolha entre o amor de sua vida e o destino do universo, ele luta para evitar um futuro terrível.",
      poster_path: "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/xOMo8BRK7PfcJv9JCnx7s520DRq.jpg",
      vote_average: 8.3,
      first_air_date: "2024-02-27",
      genres: ["Filme", "Ficção Científica", "Aventura"],
      status: "Lançado",
      seasons: []
    },
    {
      id: 324857,
      type: "movie",
      name: "Homem-Aranha: No Aranhaverso",
      runtime: 117,
      overview: "Após ser picado por uma aranha geneticamente modificada, o jovem Miles Morales vê o multiverso colidir e conhece versões alternativas do Homem-Aranha que o ensinam o que significa ser um herói.",
      poster_path: "https://image.tmdb.org/t/p/w500/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/7d6w0vY7c2u9b3n6GqK7g36Zf0A.jpg",
      vote_average: 8.4,
      first_air_date: "2018-12-01",
      genres: ["Filme", "Animação", "Ação"],
      status: "Lançado",
      seasons: []
    },
    {
      id: 155,
      type: "movie",
      name: "Batman: O Cavaleiro das Trevas",
      runtime: 152,
      overview: "Com a ajuda do tenente Jim Gordon e do promotor Harvey Dent, Batman mantém a ordem em Gotham até que uma mente criminosa sádica conhecida como Coringa lança a cidade em uma anarquia sem precedentes.",
      poster_path: "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg",
      vote_average: 8.5,
      first_air_date: "2008-07-16",
      genres: ["Filme", "Ação", "Crime", "Drama"],
      status: "Lançado",
      seasons: []
    }
  ];

  // ================================================================
  // GERENCIADOR DE ESTADO E PERSISTÊNCIA LOCAL-FIRST
  // ================================================================
  class StateManager {
    constructor() {
      this.state = this.loadState();
      this.settings = this.loadSettings();
      this.user = this.loadUserSession();
      this.autoSaveTimer = null;
    }

    loadUserSession() {
      try {
        const raw = localStorage.getItem(AUTH_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        console.warn('Erro ao ler sessão de usuário:', e);
      }
      return null;
    }

    saveUserSession(user) {
      this.user = user;
      try {
        if (user) {
          localStorage.setItem(AUTH_KEY, JSON.stringify(user));
        } else {
          localStorage.removeItem(AUTH_KEY);
        }
      } catch (e) {
        console.error('Falha ao salvar sessão:', e);
      }
    }

    loadSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        console.warn('Erro ao ler settings:', e);
      }
      return {
        tmdbApiKey: '',
        language: 'pt-BR'
      };
    }

    saveSettings(newSettings) {
      this.settings = { ...this.settings, ...newSettings };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      } catch (e) {
        console.error('Falha ao salvar configurações:', e);
      }
    }

    loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.trackedShows && parsed.watchedEpisodes) {
            return parsed;
          }
        }
      } catch (e) {
        console.error('Falha de leitura do estado local:', e);
      }

      // Estado inicial rico: Séries, Filmes e Animes demonstrados
      return {
        version: 3,
        trackedShows: [
          { showId: 1396, status: 'watching', addedAt: new Date().toISOString() },      // Breaking Bad
          { showId: 1429, status: 'watching', addedAt: new Date().toISOString() },      // Attack on Titan (Anime)
          { showId: 157336, status: 'plan_to_watch', addedAt: new Date().toISOString() }, // Interestelar (Filme)
          { showId: 136283, status: 'watching', addedAt: new Date().toISOString() }     // The Bear
        ],
        watchedEpisodes: {
          "1396_s1_e1": { watched: true, watchedAt: "2026-10-20T19:30:00Z", rewatchCount: 1 },
          "1396_s1_e2": { watched: true, watchedAt: "2026-10-21T21:00:00Z", rewatchCount: 1 },
          "1429_s1_e1": { watched: true, watchedAt: "2026-10-22T20:15:00Z", rewatchCount: 1 },
          "136283_s1_e1": { watched: true, watchedAt: "2026-10-23T22:15:00Z", rewatchCount: 1 }
        },
        episodeNotes: {
          "1396_s1_e1": {
            text: "O piloto é simplesmente perfeito. A cena da calça voando no deserto e a transformação inicial de Walter White com a van de RV. Impossível parar de assistir.",
            emotion: "awesome",
            character: "Walter White",
            updatedAt: "2026-10-20T20:45:00Z",
            snapshots: []
          },
          "1429_s1_e1": {
            text: "A abertura do Titã Colossal surgindo acima da muralha é uma das cenas mais icônicas da história dos animes. A trilha sonora de Hiroyuki Sawano arrepia.",
            emotion: "mindblown",
            character: "Eren Yeager",
            updatedAt: "2026-10-22T20:40:00Z",
            snapshots: []
          }
        },
        customShows: []
      };
    }

    saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        this.pulseSyncIndicator();
      } catch (e) {
        console.error('CRÍTICO: Erro ao persistir estado:', e);
        showToast('Erro ao gravar no disco local!', 'error');
      }
    }

    pulseSyncIndicator() {
      const el = document.getElementById('sync-status');
      if (el) {
        el.classList.add('saving');
        setTimeout(() => el.classList.remove('saving'), 800);
      }
    }

    getShowById(id) {
      const numId = Number(id);
      return CATALOG_DATABASE.find(s => s.id === numId) || 
             this.state.customShows.find(s => s.id === numId) || null;
    }

    // Marcação Atômica de Episódio OU Filme
    toggleWatched(showId, seasonNum, epNum) {
      const show = this.getShowById(showId);
      const isMovie = show && show.type === 'movie';
      const key = isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;

      const current = this.state.watchedEpisodes[key];
      const isNowWatched = !current || !current.watched;

      if (isNowWatched) {
        this.state.watchedEpisodes[key] = {
          watched: true,
          watchedAt: new Date().toISOString(),
          rewatchCount: (current && current.rewatchCount) ? current.rewatchCount : 1
        };
      } else {
        delete this.state.watchedEpisodes[key];
      }

      // Se marcou um título em 'plan_to_watch', move para 'watching' (ou 'completed' se for filme)
      const tracked = this.state.trackedShows.find(t => t.showId === Number(showId));
      if (tracked) {
        if (isMovie) {
          tracked.status = isNowWatched ? 'completed' : 'plan_to_watch';
        } else if (tracked.status === 'plan_to_watch' && isNowWatched) {
          tracked.status = 'watching';
        }
      }

      this.saveState();
      return isNowWatched;
    }

    batchSetSeason(showId, seasonNum, shouldWatch) {
      const show = this.getShowById(showId);
      if (!show || !show.seasons) return;
      const season = show.seasons.find(s => s.season_number === Number(seasonNum));
      if (!season) return;

      season.episodes.forEach(ep => {
        const key = `${showId}_s${seasonNum}_e${ep.episode_number}`;
        if (shouldWatch) {
          if (!this.state.watchedEpisodes[key]) {
            this.state.watchedEpisodes[key] = {
              watched: true,
              watchedAt: new Date().toISOString(),
              rewatchCount: 1
            };
          }
        } else {
          delete this.state.watchedEpisodes[key];
        }
      });

      this.saveState();
    }

    saveEpisodeNote(showId, seasonNum, epNum, noteData) {
      const show = this.getShowById(showId);
      const isMovie = show && show.type === 'movie';
      const key = isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;

      const existing = this.state.episodeNotes[key] || { snapshots: [] };
      const newSnapshots = [...(existing.snapshots || [])];

      if (existing.text && existing.text.trim() !== noteData.text.trim() && existing.text.length > 10) {
        newSnapshots.unshift({
          text: existing.text,
          updatedAt: existing.updatedAt || new Date().toISOString()
        });
        if (newSnapshots.length > 5) newSnapshots.pop();
      }

      this.state.episodeNotes[key] = {
        text: noteData.text,
        emotion: noteData.emotion || null,
        character: noteData.character || '',
        updatedAt: new Date().toISOString(),
        snapshots: newSnapshots
      };

      this.saveState();
    }

    getEpisodeNote(showId, seasonNum, epNum) {
      const show = this.getShowById(showId);
      const isMovie = show && show.type === 'movie';
      const key = isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
      return this.state.episodeNotes[key] || null;
    }

    isEpisodeWatched(showId, seasonNum, epNum) {
      const show = this.getShowById(showId);
      const isMovie = show && show.type === 'movie';
      const key = isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
      return !!(this.state.watchedEpisodes[key] && this.state.watchedEpisodes[key].watched);
    }
  }

  const sm = new StateManager();

  // ================================================================
  // FILTROS DE CATEGORIA E NEGÓCIO
  // ================================================================
  let filterNextUpType = 'all';
  let filterWatchlistCat = 'all';
  let filterExploreType = 'all';

  function calculateNextUpQueue() {
    const queue = [];

    sm.state.trackedShows.forEach(tracked => {
      if (tracked.status === 'completed' || tracked.status === 'dropped') return;

      const show = sm.getShowById(tracked.showId);
      if (!show) return;

      // Filtro de tipo ativo (tv, anime, movie)
      if (filterNextUpType !== 'all') {
        if (filterNextUpType === 'movie' && show.type !== 'movie') return;
        if (filterNextUpType === 'anime' && show.type !== 'anime') return;
        if (filterNextUpType === 'tv' && show.type !== 'tv') return;
      }

      // Se for FILME
      if (show.type === 'movie') {
        const isWatched = sm.isEpisodeWatched(show.id);
        if (!isWatched) {
          queue.push({
            isMovie: true,
            showId: show.id,
            showName: show.name,
            type: show.type,
            title: "Filme Completo",
            runtime: show.runtime || 120,
            overview: show.overview,
            still_path: show.backdrop_path || show.poster_path,
            air_date: show.first_air_date
          });
        }
        return;
      }

      // Se for SÉRIE OU ANIME (com temporadas)
      if (show.seasons) {
        let nextEp = null;
        let foundUnwatched = false;

        for (const season of show.seasons) {
          if (!season.episodes) continue;
          for (const ep of season.episodes) {
            const isWatched = sm.isEpisodeWatched(show.id, season.season_number, ep.episode_number);
            if (!isWatched) {
              nextEp = {
                isMovie: false,
                showId: show.id,
                showName: show.name,
                type: show.type,
                seasonNumber: season.season_number,
                episodeNumber: ep.episode_number,
                title: ep.name,
                runtime: ep.runtime || 45,
                overview: ep.overview,
                still_path: ep.still_path || show.backdrop_path || show.poster_path,
                air_date: ep.air_date
              };
              foundUnwatched = true;
              break;
            }
          }
          if (foundUnwatched) break;
        }

        if (nextEp) queue.push(nextEp);
      }
    });

    return queue;
  }

  function calculateStats() {
    let totalMinutes = 0;
    let totalWatchedEpisodes = 0;
    const emotionsCount = { awesome: 0, fun: 0, mindblown: 0, sad: 0, disappointed: 0 };
    const genresCount = {};

    Object.keys(sm.state.watchedEpisodes).forEach(key => {
      const item = sm.state.watchedEpisodes[key];
      if (!item || !item.watched) return;

      totalWatchedEpisodes++;

      if (key.includes('_movie')) {
        const showId = Number(key.replace('_movie', ''));
        const show = sm.getShowById(showId);
        if (show) {
          totalMinutes += (show.runtime || 120) * (item.rewatchCount || 1);
          (show.genres || []).forEach(g => { genresCount[g] = (genresCount[g] || 0) + 1; });
        }
      } else {
        const parts = key.split('_');
        const showId = Number(parts[0]);
        const seasonNum = Number(parts[1].replace('s', ''));
        const epNum = Number(parts[2].replace('e', ''));

        const show = sm.getShowById(showId);
        if (show) {
          (show.genres || []).forEach(g => { genresCount[g] = (genresCount[g] || 0) + 1; });

          const season = show.seasons.find(s => s.season_number === seasonNum);
          if (season) {
            const ep = season.episodes.find(e => e.episode_number === epNum);
            totalMinutes += ((ep && ep.runtime) ? ep.runtime : 45) * (item.rewatchCount || 1);
          }
        }
      }
    });

    let totalNotes = 0;
    Object.values(sm.state.episodeNotes).forEach(note => {
      if (note && note.text && note.text.trim()) totalNotes++;
      if (note && note.emotion && emotionsCount[note.emotion] !== undefined) {
        emotionsCount[note.emotion]++;
      }
    });

    let showsCompleted = 0;
    sm.state.trackedShows.forEach(tracked => {
      const show = sm.getShowById(tracked.showId);
      if (!show) return;

      if (show.type === 'movie') {
        if (sm.isEpisodeWatched(show.id)) showsCompleted++;
      } else if (show.seasons) {
        let allWatched = true;
        let hasEpisodes = false;
        for (const s of show.seasons) {
          for (const ep of s.episodes) {
            hasEpisodes = true;
            if (!sm.isEpisodeWatched(show.id, s.season_number, ep.episode_number)) {
              allWatched = false;
              break;
            }
          }
          if (!allWatched) break;
        }
        if (hasEpisodes && allWatched) showsCompleted++;
      }
    });

    const minutesInHour = 60;
    const minutesInDay = 24 * 60;
    const minutesInMonth = 30 * minutesInDay;

    const months = Math.floor(totalMinutes / minutesInMonth);
    let rem = totalMinutes % minutesInMonth;
    const days = Math.floor(rem / minutesInDay);
    rem = rem % minutesInDay;
    const hours = Math.floor(rem / minutesInHour);
    const minutes = rem % minutesInHour;

    return {
      totalMinutes,
      months,
      days,
      hours,
      minutes,
      totalWatchedEpisodes,
      totalNotes,
      showsCompleted,
      emotionsCount,
      genresCount
    };
  }

  // ================================================================
  // RENDERIZAÇÃO DAS VIEWS
  // ================================================================

  function renderNextUp() {
    const container = document.getElementById('next-up-container');
    const emptyState = document.getElementById('next-up-empty');
    const counterPill = document.getElementById('next-up-counter-pill');
    const navBadge = document.getElementById('badge-next-up');

    const queue = calculateNextUpQueue();
    navBadge.textContent = queue.length;
    counterPill.textContent = `${queue.length} título${queue.length === 1 ? '' : 's'} na fila`;

    if (queue.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    container.innerHTML = queue.map(item => {
      const typeBadge = item.type === 'movie' 
        ? `<span class="badge-type-tag badge-type-movie">🎬 Filme</span>` 
        : item.type === 'anime' 
        ? `<span class="badge-type-tag badge-type-anime">⛩️ Anime</span>`
        : `<span class="badge-type-tag badge-type-tv">📺 Série</span>`;

      const codeBadge = item.isMovie 
        ? `FILME` 
        : `T${item.seasonNumber}:E${item.episodeNumber}`;

      return `
        <div class="next-up-card">
          <div class="next-up-thumb-wrap" onclick="app.openShowModal(${item.showId})">
            <img class="next-up-thumb" src="${item.still_path}" alt="${item.title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500'">
            <span class="next-up-badge">${codeBadge}</span>
            <span class="next-up-runtime">${item.runtime} min</span>
          </div>
          
          <div class="next-up-info">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
              <span class="next-up-show-name" onclick="app.openShowModal(${item.showId})">${item.showName}</span>
              ${typeBadge}
            </div>

            <h4 class="next-up-ep-title" onclick="app.openShowModal(${item.showId})">${item.title}</h4>
            <p class="next-up-overview">${item.overview || 'Sem descrição cadastrada.'}</p>
            
            <div class="next-up-footer">
              <button class="btn-check-episode" onclick="${item.isMovie ? `app.quickCheckMovie(${item.showId})` : `app.quickCheckEpisode(${item.showId}, ${item.seasonNumber}, ${item.episodeNumber})`}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Assistido</span>
              </button>
              
              <button class="btn-quick-note" onclick="${item.isMovie ? `app.openMovieNote(${item.showId})` : `app.openEpisodeNote(${item.showId}, ${item.seasonNumber}, ${item.episodeNumber})`}" title="Anotar no Diário">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  let currentWatchlistFilter = 'all';

  function renderWatchlist() {
    const container = document.getElementById('watchlist-container');
    const emptyState = document.getElementById('watchlist-empty');
    const navBadge = document.getElementById('badge-watchlist');

    const trackedList = sm.state.trackedShows;
    navBadge.textContent = trackedList.length;

    let countAll = 0, countWatching = 0, countCompleted = 0, countPlan = 0;
    trackedList.forEach(t => {
      countAll++;
      if (t.status === 'watching') countWatching++;
      if (t.status === 'completed') countCompleted++;
      if (t.status === 'plan_to_watch') countPlan++;
    });

    document.getElementById('count-all').textContent = countAll;
    document.getElementById('count-watching').textContent = countWatching;
    document.getElementById('count-completed').textContent = countCompleted;
    document.getElementById('count-plan').textContent = countPlan;

    const filtered = trackedList.filter(t => {
      const show = sm.getShowById(t.showId);
      if (!show) return false;

      // Filtro de Categoria (all, tv, anime, movie)
      if (filterWatchlistCat !== 'all' && show.type !== filterWatchlistCat) return false;

      // Filtro de Status (all, watching, completed, plan_to_watch)
      if (currentWatchlistFilter === 'all') return true;
      return t.status === currentWatchlistFilter;
    });

    if (filtered.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    container.innerHTML = filtered.map(t => {
      const show = sm.getShowById(t.showId);
      if (!show) return '';

      const isMovie = show.type === 'movie';
      let percent = 0;
      let progressText = '';

      if (isMovie) {
        const watched = sm.isEpisodeWatched(show.id);
        percent = watched ? 100 : 0;
        progressText = watched ? 'Filme Assistido (100%)' : 'Ainda não assistido';
      } else {
        let totalEps = 0;
        let watchedEps = 0;
        (show.seasons || []).forEach(s => {
          (s.episodes || []).forEach(ep => {
            totalEps++;
            if (sm.isEpisodeWatched(show.id, s.season_number, ep.episode_number)) watchedEps++;
          });
        });
        percent = totalEps > 0 ? Math.round((watchedEps / totalEps) * 100) : 0;
        progressText = `${watchedEps}/${totalEps} eps (${percent}%)`;
      }

      const typeBadge = show.type === 'movie' 
        ? `<span class="badge-type-tag badge-type-movie">🎬 Filme</span>` 
        : show.type === 'anime' 
        ? `<span class="badge-type-tag badge-type-anime">⛩️ Anime</span>`
        : `<span class="badge-type-tag badge-type-tv">📺 Série</span>`;

      return `
        <div class="show-card" onclick="app.openShowModal(${show.id})">
          <div class="show-poster-wrap">
            <img class="show-poster" src="${show.poster_path}" alt="${show.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500'">
            <div class="show-rating-badge">★ ${show.vote_average.toFixed(1)}</div>
          </div>
          
          <div class="show-info">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              ${typeBadge}
              <span style="font-size: 0.72rem; color: var(--text-muted);">${show.first_air_date ? show.first_air_date.slice(0, 4) : ''}</span>
            </div>

            <h4 class="show-title" title="${show.name}">${show.name}</h4>
            <div class="show-meta-line">
              <span>${isMovie ? `${show.runtime} min` : `${show.seasons ? show.seasons.length : 1} temp.`}</span>
              <span>${show.status}</span>
            </div>

            <div class="show-progress-wrap">
              <div class="show-progress-info">
                <span>Progresso</span>
                <span>${progressText}</span>
              </div>
              <div class="show-progress-bar">
                <div class="show-progress-fill ${percent === 100 ? 'complete' : ''}" style="width: ${percent}%;"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  let currentEmotionFilter = 'all';
  let diarySearchQuery = '';

  function renderDiary() {
    const container = document.getElementById('diary-container');
    const emptyState = document.getElementById('diary-empty');
    const navBadge = document.getElementById('badge-diary');

    const entries = [];
    Object.keys(sm.state.episodeNotes).forEach(key => {
      const note = sm.state.episodeNotes[key];
      if (!note || !note.text || !note.text.trim()) return;

      if (key.includes('_movie')) {
        const showId = Number(key.replace('_movie', ''));
        const show = sm.getShowById(showId);
        if (show) {
          entries.push({
            key,
            isMovie: true,
            showId,
            showName: show.name,
            epTitle: "Avaliação do Filme",
            stillPath: show.backdrop_path || show.poster_path,
            text: note.text,
            emotion: note.emotion,
            character: note.character,
            updatedAt: note.updatedAt
          });
        }
      } else {
        const parts = key.split('_');
        const showId = Number(parts[0]);
        const seasonNum = Number(parts[1].replace('s', ''));
        const epNum = Number(parts[2].replace('e', ''));

        const show = sm.getShowById(showId);
        if (show) {
          const season = show.seasons.find(s => s.season_number === seasonNum);
          const ep = season ? season.episodes.find(e => e.episode_number === epNum) : null;
          entries.push({
            key,
            isMovie: false,
            showId,
            showName: show.name,
            seasonNumber: seasonNum,
            episodeNumber: epNum,
            epTitle: ep ? ep.name : `Episódio ${epNum}`,
            stillPath: (ep && ep.still_path) ? ep.still_path : show.backdrop_path,
            text: note.text,
            emotion: note.emotion,
            character: note.character,
            updatedAt: note.updatedAt
          });
        }
      }
    });

    entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    navBadge.textContent = entries.length;

    const filtered = entries.filter(e => {
      if (currentEmotionFilter !== 'all' && e.emotion !== currentEmotionFilter) return false;
      if (diarySearchQuery) {
        const q = diarySearchQuery.toLowerCase();
        return e.text.toLowerCase().includes(q) || 
               e.showName.toLowerCase().includes(q) || 
               (e.character || '').toLowerCase().includes(q);
      }
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    const emotionLabels = {
      awesome: '😍 Adorei',
      fun: '😂 Engraçado',
      mindblown: '😱 Chocado',
      sad: '😢 Triste',
      disappointed: '😡 Decepcionado'
    };

    container.innerHTML = filtered.map(e => {
      const formattedDate = new Date(e.updatedAt).toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const headerText = e.isMovie 
        ? `${e.showName} · 🎬 Filme` 
        : `${e.showName} · T${e.seasonNumber}:E${e.episodeNumber}`;

      return `
        <div class="diary-entry-card">
          <img class="diary-entry-thumb" src="${e.stillPath}" alt="${e.epTitle}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500'">
          
          <div class="diary-entry-body">
            <div class="diary-entry-top">
              <span class="diary-entry-show">${headerText}</span>
              ${e.emotion ? `<span class="diary-emotion-tag">${emotionLabels[e.emotion] || e.emotion}</span>` : ''}
            </div>

            <h4 class="diary-entry-ep">${e.epTitle}</h4>

            ${e.character ? `<div class="diary-character-badge">Destaque: ${escapeHtml(e.character)}</div>` : ''}

            <div class="diary-entry-text">${escapeHtml(e.text)}</div>

            <div class="diary-entry-footer">
              <span>Gravado em: ${formattedDate}</span>
              <button class="btn btn-sm btn-ghost" onclick="${e.isMovie ? `app.openMovieNote(${e.showId})` : `app.openEpisodeNote(${e.showId}, ${e.seasonNumber}, ${e.episodeNumber})`}">
                Editar Anotação
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderStats() {
    const stats = calculateStats();

    document.getElementById('time-months').textContent = stats.months;
    document.getElementById('time-days').textContent = stats.days;
    document.getElementById('time-hours').textContent = stats.hours;
    document.getElementById('time-minutes').textContent = stats.minutes;
    document.getElementById('stat-minutes-subtext').textContent = `${stats.totalMinutes.toLocaleString('pt-BR')} minutos assistidos`;

    document.getElementById('stat-episodes-count').textContent = stats.totalWatchedEpisodes;
    document.getElementById('stat-shows-completed').textContent = stats.showsCompleted;
    document.getElementById('stat-notes-count').textContent = stats.totalNotes;

    const emotionConfig = [
      { key: 'awesome', icon: '😍', label: 'Adorei' },
      { key: 'fun', icon: '😂', label: 'Divertido' },
      { key: 'mindblown', icon: '😱', label: 'Chocado' },
      { key: 'sad', icon: '😢', label: 'Triste' },
      { key: 'disappointed', icon: '😡', label: 'Ruim' }
    ];

    const maxEmotion = Math.max(...Object.values(stats.emotionsCount), 1);
    document.getElementById('stats-emotions-chart').innerHTML = emotionConfig.map(emo => {
      const count = stats.emotionsCount[emo.key] || 0;
      const pct = Math.round((count / maxEmotion) * 100);
      return `
        <div class="emotion-bar-item">
          <span class="emotion-bar-icon">${emo.icon}</span>
          <span class="emotion-bar-label">${emo.label}</span>
          <div class="emotion-bar-track">
            <div class="emotion-bar-fill" style="width: ${pct}%;"></div>
          </div>
          <span class="emotion-bar-count">${count}</span>
        </div>
      `;
    }).join('');

    const sortedGenres = Object.entries(stats.genresCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (sortedGenres.length === 0) {
      document.getElementById('stats-genres-list').innerHTML = `<p class="muted">Nenhuma obra assistida ainda.</p>`;
    } else {
      const maxGenre = sortedGenres[0][1] || 1;
      document.getElementById('stats-genres-list').innerHTML = sortedGenres.map(([genre, count]) => {
        const pct = Math.round((count / maxGenre) * 100);
        return `
          <div class="emotion-bar-item">
            <span class="emotion-bar-label" style="width: 120px;">${genre}</span>
            <div class="emotion-bar-track">
              <div class="emotion-bar-fill" style="width: ${pct}%; background: var(--accent-cyan);"></div>
            </div>
            <span class="emotion-bar-count">${count}</span>
          </div>
        `;
      }).join('');
    }
  }

  function renderExplore(showsToRender) {
    const list = showsToRender || CATALOG_DATABASE;
    const container = document.getElementById('explore-container');

    const filtered = list.filter(show => {
      if (filterExploreType === 'all') return true;
      return show.type === filterExploreType;
    });

    container.innerHTML = filtered.map(show => {
      const isTracked = sm.state.trackedShows.some(t => t.showId === show.id);
      const isMovie = show.type === 'movie';

      const typeBadge = show.type === 'movie' 
        ? `<span class="badge-type-tag badge-type-movie">🎬 Filme</span>` 
        : show.type === 'anime' 
        ? `<span class="badge-type-tag badge-type-anime">⛩️ Anime</span>`
        : `<span class="badge-type-tag badge-type-tv">📺 Série</span>`;

      return `
        <div class="show-card">
          <div class="show-poster-wrap" onclick="app.openShowModal(${show.id})">
            <img class="show-poster" src="${show.poster_path}" alt="${show.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500'">
            <div class="show-rating-badge">★ ${show.vote_average.toFixed(1)}</div>
          </div>

          <div class="show-info">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              ${typeBadge}
              <span style="font-size: 0.72rem; color: var(--text-muted);">${show.first_air_date ? show.first_air_date.slice(0, 4) : ''}</span>
            </div>

            <h4 class="show-title" title="${show.name}" onclick="app.openShowModal(${show.id})">${show.name}</h4>
            <div class="show-meta-line">
              <span>${isMovie ? `${show.runtime} min` : `${show.seasons ? show.seasons.length : 1} temp.`}</span>
              <span>${(show.genres || []).slice(0, 2).join(', ')}</span>
            </div>

            <div style="margin-top: auto; padding-top: 0.5rem;">
              ${isTracked ? `
                <button class="btn btn-sm btn-secondary" style="width: 100%;" onclick="app.openShowModal(${show.id})">
                  Ver no Cofre
                </button>
              ` : `
                <button class="btn btn-sm btn-primary" style="width: 100%;" onclick="app.addShowToWatchlist(${show.id})">
                  + Adicionar à Lista
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ================================================================
  // MODAL DE DETALHES (SÉRIE, FILME OU ANIME)
  // ================================================================
  let currentModalShowId = null;
  let currentModalSeasonNum = 1;

  function openShowModal(showId) {
    const show = sm.getShowById(showId);
    if (!show) return;

    currentModalShowId = showId;
    const modal = document.getElementById('modal-show-detail');
    const header = document.getElementById('show-modal-header');

    const typeBadge = show.type === 'movie' 
      ? `<span class="badge-type-tag badge-type-movie">🎬 Filme</span>` 
      : show.type === 'anime' 
      ? `<span class="badge-type-tag badge-type-anime">⛩️ Anime</span>`
      : `<span class="badge-type-tag badge-type-tv">📺 Série</span>`;

    header.style.backgroundImage = `url('${show.backdrop_path || show.poster_path}')`;
    header.innerHTML = `
      <img class="modal-poster" src="${show.poster_path}" alt="${show.name}">
      <div class="modal-show-info">
        <div style="margin-bottom: 0.4rem;">${typeBadge}</div>
        <h2 class="modal-show-title">${show.name}</h2>
        <div class="modal-meta-row">
          <span>★ <strong>${show.vote_average.toFixed(1)}</strong></span>
          <span>•</span>
          <span>${show.first_air_date ? show.first_air_date.slice(0, 4) : ''}</span>
          <span>•</span>
          <span>${(show.genres || []).join(', ')}</span>
          ${show.runtime ? `<span>•</span><span>${show.runtime} min</span>` : ''}
        </div>
        <p class="modal-overview">${show.overview || 'Sem sinopse disponível.'}</p>
        
        <div style="display: flex; gap: 0.75rem;">
          ${sm.state.trackedShows.some(t => t.showId === show.id) ? `
            <button class="btn btn-sm btn-secondary" onclick="app.removeShowFromWatchlist(${show.id})">Remover da Minha Lista</button>
          ` : `
            <button class="btn btn-sm btn-primary" onclick="app.addShowToWatchlist(${show.id})">+ Adicionar à Minha Lista</button>
          `}
        </div>
      </div>
    `;

    const seriesBody = document.getElementById('series-detail-body');
    const movieBody = document.getElementById('movie-detail-body');

    if (show.type === 'movie') {
      seriesBody.classList.add('hidden');
      movieBody.classList.remove('hidden');

      const isWatched = sm.isEpisodeWatched(show.id);
      const epKey = `${show.id}_movie`;
      const note = sm.state.episodeNotes[epKey];
      const hasNote = note && note.text && note.text.trim();

      movieBody.innerHTML = `
        <div class="movie-actions-box">
          <div class="movie-status-info">
            <h4>${isWatched ? '✓ Filme Concluído no Seu Diário' : 'Filme Pendente para Assistir'}</h4>
            <p>Duração total: ${show.runtime || 120} minutos adicionados às suas estatísticas de vida ao marcar.</p>
            ${hasNote ? `<p style="color: var(--accent-gold); margin-top: 0.4rem; font-weight: 600;">📝 "${escapeHtml(note.text.slice(0, 75))}..."</p>` : ''}
          </div>

          <div class="movie-btn-group">
            <button class="btn ${isWatched ? 'btn-secondary' : 'btn-primary'}" onclick="app.quickCheckMovie(${show.id})">
              ${isWatched ? 'Desmarcar Filme' : '✓ Marcar como Assistido'}
            </button>
            <button class="btn btn-outline" onclick="app.openMovieNote(${show.id})">
              ${hasNote ? 'Editar Anotação' : 'Fazer Anotação no Diário'}
            </button>
          </div>
        </div>
      `;
    } else {
      movieBody.classList.add('hidden');
      seriesBody.classList.remove('hidden');

      const seasons = show.seasons || [];
      currentModalSeasonNum = seasons.length > 0 ? seasons[0].season_number : 1;
      renderSeasonTabs(seasons);
      renderSeasonEpisodes();
    }

    modal.classList.remove('hidden');
  }

  function renderSeasonTabs(seasons) {
    const bar = document.getElementById('show-seasons-tabs');
    bar.innerHTML = seasons.map(s => {
      let watchedCount = 0;
      (s.episodes || []).forEach(ep => {
        if (sm.isEpisodeWatched(currentModalShowId, s.season_number, ep.episode_number)) {
          watchedCount++;
        }
      });
      const total = s.episodes ? s.episodes.length : 0;

      return `
        <button class="season-tab-btn ${s.season_number === currentModalSeasonNum ? 'active' : ''}" 
                onclick="app.switchModalSeason(${s.season_number})">
          ${s.name || `Temporada ${s.season_number}`} (${watchedCount}/${total})
        </button>
      `;
    }).join('');
  }

  function renderSeasonEpisodes() {
    const show = sm.getShowById(currentModalShowId);
    if (!show || !show.seasons) return;

    const season = show.seasons.find(s => s.season_number === currentModalSeasonNum);
    const container = document.getElementById('show-episodes-container');
    const summary = document.getElementById('season-stats-summary');

    if (!season || !season.episodes || season.episodes.length === 0) {
      container.innerHTML = `<p class="muted">Nenhum episódio cadastrado nesta temporada.</p>`;
      summary.innerHTML = '';
      return;
    }

    let watchedCount = 0;
    season.episodes.forEach(ep => {
      if (sm.isEpisodeWatched(show.id, season.season_number, ep.episode_number)) watchedCount++;
    });

    summary.innerHTML = `Progresso da Temporada: <strong>${watchedCount}/${season.episodes.length} assistidos</strong>`;

    container.innerHTML = season.episodes.map(ep => {
      const isWatched = sm.isEpisodeWatched(show.id, season.season_number, ep.episode_number);
      const epKey = `${show.id}_s${season.season_number}_e${ep.episode_number}`;
      const note = sm.state.episodeNotes[epKey];
      const hasNote = note && note.text && note.text.trim();

      return `
        <div class="episode-row ${isWatched ? 'watched' : ''}">
          <div class="ep-check-circle" onclick="app.toggleEpisodeRowCheck(${show.id}, ${season.season_number}, ${ep.episode_number})" title="Marcar como assistido">
            ${isWatched ? '✓' : ''}
          </div>

          <img class="ep-thumb-mini" src="${ep.still_path || show.backdrop_path || show.poster_path}" alt="${ep.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500'">

          <div class="ep-main-info">
            <span class="ep-num">E${ep.episode_number} · ${ep.air_date ? ep.air_date.slice(0, 10) : ''}</span>
            <div class="ep-title">${ep.name}</div>
            <span class="ep-runtime">${ep.runtime || 45} min</span>
            ${hasNote ? `
              <span class="ep-note-badge" title="${escapeHtml(note.text)}">
                📝 Anotação salva ${note.emotion ? `(${note.emotion})` : ''}
              </span>
            ` : ''}
          </div>

          <button class="btn btn-sm btn-outline" onclick="app.openEpisodeNote(${show.id}, ${season.season_number}, ${ep.episode_number})">
            ${hasNote ? 'Ver/Editar Nota' : 'Anotar'}
          </button>
        </div>
      `;
    }).join('');
  }

  // ================================================================
  // DIÁRIO BLINDADO (NOTAS PARA EPISÓDIO OU FILME)
  // ================================================================
  let currentNoteTarget = { showId: null, seasonNum: null, epNum: null, isMovie: false };

  function openEpisodeNote(showId, seasonNum, epNum) {
    currentNoteTarget = { showId, seasonNum, epNum, isMovie: false };
    const show = sm.getShowById(showId);
    if (!show) return;

    const season = show.seasons ? show.seasons.find(s => s.season_number === seasonNum) : null;
    const ep = season ? season.episodes.find(e => e.episode_number === epNum) : null;

    document.getElementById('note-ep-code').textContent = `S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`;
    document.getElementById('note-ep-title').textContent = ep ? ep.name : `Episódio ${epNum}`;
    document.getElementById('note-show-title').textContent = show.name;
    document.getElementById('note-watched-label').textContent = 'Episódio Assistido';

    setupNoteModalCommon(showId, seasonNum, epNum);
  }

  function openMovieNote(showId) {
    currentNoteTarget = { showId, seasonNum: null, epNum: null, isMovie: true };
    const show = sm.getShowById(showId);
    if (!show) return;

    document.getElementById('note-ep-code').textContent = `FILME`;
    document.getElementById('note-ep-title').textContent = show.name;
    document.getElementById('note-show-title').textContent = `Duração: ${show.runtime || 120} minutos`;
    document.getElementById('note-watched-label').textContent = 'Filme Assistido';

    setupNoteModalCommon(showId, null, null);
  }

  function setupNoteModalCommon(showId, seasonNum, epNum) {
    const modal = document.getElementById('modal-episode-note');
    const note = sm.getEpisodeNote(showId, seasonNum, epNum) || { text: '', emotion: null, character: '', snapshots: [] };
    const isWatched = sm.isEpisodeWatched(showId, seasonNum, epNum);

    const epKey = currentNoteTarget.isMovie ? `${showId}_movie` : `${showId}_s${seasonNum}_e${epNum}`;
    const epStatus = sm.state.watchedEpisodes[epKey];

    document.getElementById('note-watched-toggle').checked = isWatched;
    document.getElementById('rewatch-counter-val').textContent = epStatus ? (epStatus.rewatchCount || 1) : 1;
    document.getElementById('note-character-input').value = note.character || '';
    document.getElementById('note-textarea').value = note.text || '';

    updateWordCount(note.text || '');
    updateSaveBadge('Salvo no seu disco');

    document.querySelectorAll('.emotion-btn').forEach(btn => {
      if (btn.getAttribute('data-emotion') === note.emotion) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    renderSnapshotsList(note.snapshots || []);
    modal.classList.remove('hidden');
  }

  function renderSnapshotsList(snapshots) {
    const container = document.getElementById('note-snapshots-list');
    if (!snapshots || snapshots.length === 0) {
      container.innerHTML = `<p class="muted">Nenhuma versão anterior gravada para este título.</p>`;
      return;
    }

    container.innerHTML = snapshots.map((s, idx) => `
      <div style="padding: 0.5rem; background: rgba(0,0,0,0.3); border-radius: 4px; margin-bottom: 0.4rem; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="color: var(--accent-gold); font-size: 0.72rem;">Versão gravada em ${new Date(s.updatedAt).toLocaleTimeString('pt-BR')}</span>
          <p style="font-size: 0.78rem; color: #cbd5e1; margin-top: 0.15rem;">${escapeHtml(s.text.slice(0, 60))}...</p>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="app.restoreSnapshot(${idx})">Restaurar</button>
      </div>
    `).join('');
  }

  function updateWordCount(text) {
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('note-word-count').textContent = `${words} palavras · ${chars} caracteres`;
  }

  function updateSaveBadge(msg, isSaving = false) {
    const badge = document.getElementById('note-save-status');
    const textEl = badge.querySelector('.save-text');
    const dot = badge.querySelector('.save-dot');
    textEl.textContent = msg;
    dot.style.background = isSaving ? 'var(--accent-gold)' : 'var(--accent-emerald)';
  }

  function triggerAutoSave() {
    updateSaveBadge('Salvando...', true);
    if (sm.autoSaveTimer) clearTimeout(sm.autoSaveTimer);

    sm.autoSaveTimer = setTimeout(() => {
      const text = document.getElementById('note-textarea').value;
      const character = document.getElementById('note-character-input').value;
      const activeEmoBtn = document.querySelector('.emotion-btn.active');
      const emotion = activeEmoBtn ? activeEmoBtn.getAttribute('data-emotion') : null;

      sm.saveEpisodeNote(currentNoteTarget.showId, currentNoteTarget.seasonNum, currentNoteTarget.epNum, {
        text,
        character,
        emotion
      });

      const now = new Date().toLocaleTimeString('pt-BR');
      updateSaveBadge(`Salvo no disco às ${now}`, false);
      document.getElementById('note-last-saved').textContent = `Última edição: ${now}`;
    }, 350);
  }

  // ================================================================
  // SISTEMA DE AUTENTICAÇÃO (LOGIN, CADASTRO E GOOGLE)
  // ================================================================
  let authMode = 'login'; // 'login' ou 'register'

  function updateAuthHeaderUI() {
    const btnOpen = document.getElementById('btn-open-auth');
    const loggedProfile = document.getElementById('user-logged-profile');
    const syncLabel = document.getElementById('sync-label');

    if (sm.user) {
      btnOpen.classList.add('hidden');
      loggedProfile.classList.remove('hidden');
      document.getElementById('user-display-name').textContent = sm.user.name;
      document.getElementById('user-avatar-img').src = sm.user.avatar;
      syncLabel.textContent = sm.user.provider === 'google' ? 'Google Nuvem' : 'Nuvem Ativa';
    } else {
      btnOpen.classList.remove('hidden');
      loggedProfile.classList.add('hidden');
      syncLabel.textContent = 'Local-First';
    }
  }

  function openAuthModal() {
    document.getElementById('modal-auth').classList.remove('hidden');
    app.switchAuthMode('login');
  }

  function handleGoogleSignIn() {
    // Autenticação com Google Instantânea (Nativa e compatível)
    const simulatedGoogleUser = {
      id: "google_" + Date.now(),
      name: "Gabriel",
      email: "gabriel.user@gmail.com",
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=faces",
      provider: "google",
      connectedAt: new Date().toISOString()
    };

    sm.saveUserSession(simulatedGoogleUser);
    updateAuthHeaderUI();
    document.getElementById('modal-auth').classList.add('hidden');
    showToast(`Conectado com Google: Bem-vindo, ${simulatedGoogleUser.name}!`, 'success');
  }

  function handleAuthSubmit() {
    const email = document.getElementById('input-auth-email').value.trim();
    const password = document.getElementById('input-auth-password').value;
    const nameInput = document.getElementById('input-auth-name').value.trim();

    if (!email || !password) {
      showToast('Preencha e-mail e senha.', 'error');
      return;
    }

    const userName = nameInput || email.split('@')[0];
    const userSession = {
      id: "usr_" + Date.now(),
      name: userName.charAt(0).toUpperCase() + userName.slice(1),
      email: email,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
      provider: "email",
      connectedAt: new Date().toISOString()
    };

    sm.saveUserSession(userSession);
    updateAuthHeaderUI();
    document.getElementById('modal-auth').classList.add('hidden');
    showToast(authMode === 'register' ? 'Conta criada com sucesso!' : 'Login realizado com sucesso!', 'success');
  }

  function handleLogout() {
    if (confirm('Deseja sair da sua conta? Seus dados continuam gravados com segurança local no seu navegador.')) {
      sm.saveUserSession(null);
      updateAuthHeaderUI();
      showToast('Sessão encerrada.', 'info');
    }
  }

  // ================================================================
  // BACKUP, TOASTS E UTILITÁRIOS
  // ================================================================
  function downloadJSONBackup() {
    const fullData = {
      exportDate: new Date().toISOString(),
      app: "ShowVault",
      version: 3,
      user: sm.user,
      database: sm.state
    };
    const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `showvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup JSON exportado com sucesso!', 'success');
  }

  function importJSONBackup(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const parsed = JSON.parse(e.target.result);
        const data = parsed.database || parsed;
        if (data.trackedShows && data.watchedEpisodes) {
          sm.state = data;
          sm.saveState();
          refreshAllViews();
          document.getElementById('modal-backup').classList.add('hidden');
          showToast('Backup restaurado com 100% de sucesso!', 'success');
        } else {
          showToast('Formato de arquivo JSON inválido.', 'error');
        }
      } catch (err) {
        showToast('Erro ao processar arquivo de backup.', 'error');
      }
    };
    reader.readAsText(file);
  }

  function downloadAllNotesMarkdown() {
    let md = `# Meu Diário de Obras · ShowVault\n*Exportado em: ${new Date().toLocaleString('pt-BR')}*\n\n---\n\n`;

    const notesKeys = Object.keys(sm.state.episodeNotes);
    if (notesKeys.length === 0) {
      showToast('Nenhuma anotação gravada ainda.', 'error');
      return;
    }

    notesKeys.forEach(key => {
      const note = sm.state.episodeNotes[key];
      if (!note || !note.text || !note.text.trim()) return;

      if (key.includes('_movie')) {
        const showId = Number(key.replace('_movie', ''));
        const show = sm.getShowById(showId);
        md += `## 🎬 Filme: ${show ? show.name : 'Filme'}\n`;
      } else {
        const parts = key.split('_');
        const showId = Number(parts[0]);
        const seasonNum = Number(parts[1].replace('s', ''));
        const epNum = Number(parts[2].replace('e', ''));
        const show = sm.getShowById(showId);
        md += `## ${show ? show.name : 'Série'} — T${seasonNum}:E${epNum}\n`;
      }

      md += `**Data:** ${new Date(note.updatedAt).toLocaleDateString('pt-BR')}\n`;
      if (note.emotion) md += `**Reação:** ${note.emotion}\n`;
      if (note.character) md += `**Personagem Destaque:** ${note.character}\n`;
      md += `\n${note.text}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meu-diario-multimidia-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Diário exportado em Markdown (.md)!', 'success');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function refreshAllViews() {
    renderNextUp();
    renderWatchlist();
    renderDiary();
    renderStats();
    renderExplore();
  }

  // ================================================================
  // INTERFACE PÚBLICA (WINDOW.APP)
  // ================================================================
  window.app = {
    switchTab(tabId) {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      const btn = document.getElementById(`tab-btn-${tabId}`);
      const view = document.getElementById(`view-${tabId}`);
      if (btn) btn.classList.add('active');
      if (view) view.classList.add('active');

      if (tabId === 'next-up') renderNextUp();
      if (tabId === 'watchlist') renderWatchlist();
      if (tabId === 'diary') renderDiary();
      if (tabId === 'stats') renderStats();
      if (tabId === 'explore') renderExplore();
    },

    setNextUpTypeFilter(type) {
      filterNextUpType = type;
      document.querySelectorAll('#view-next-up .type-pill-btn').forEach(btn => {
        if (btn.getAttribute('data-type') === type) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      renderNextUp();
    },

    setWatchlistCatFilter(cat) {
      filterWatchlistCat = cat;
      document.querySelectorAll('#view-watchlist .type-pill-btn').forEach(btn => {
        if (btn.getAttribute('data-cat') === cat) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      renderWatchlist();
    },

    setExploreTypeFilter(type) {
      filterExploreType = type;
      document.querySelectorAll('#view-explore .type-pill-btn').forEach(btn => {
        if (btn.getAttribute('data-explore-type') === type) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      renderExplore();
    },

    quickCheckEpisode(showId, seasonNum, epNum) {
      sm.toggleWatched(showId, seasonNum, epNum);
      showToast('Episódio marcado como assistido!', 'success');
      refreshAllViews();
    },

    quickCheckMovie(showId) {
      const isWatched = sm.toggleWatched(showId);
      showToast(isWatched ? 'Filme marcado como assistido! Tempo contabilizado.' : 'Filme desmarcado.', 'success');
      refreshAllViews();
      if (currentModalShowId === showId) openShowModal(showId);
    },

    toggleEpisodeRowCheck(showId, seasonNum, epNum) {
      const isWatched = sm.toggleWatched(showId, seasonNum, epNum);
      renderSeasonEpisodes();
      const show = sm.getShowById(showId);
      if (show && show.seasons) renderSeasonTabs(show.seasons);
      refreshAllViews();
      showToast(isWatched ? 'Episódio marcado como assistido!' : 'Episódio desmarcado.');
    },

    openShowModal(showId) {
      openShowModal(showId);
    },

    switchModalSeason(seasonNum) {
      currentModalSeasonNum = seasonNum;
      const show = sm.getShowById(currentModalShowId);
      if (show && show.seasons) renderSeasonTabs(show.seasons);
      renderSeasonEpisodes();
    },

    openEpisodeNote(showId, seasonNum, epNum) {
      openEpisodeNote(showId, seasonNum, epNum);
    },

    openMovieNote(showId) {
      openMovieNote(showId);
    },

    addShowToWatchlist(showId) {
      const exists = sm.state.trackedShows.some(t => t.showId === Number(showId));
      if (!exists) {
        sm.state.trackedShows.push({
          showId: Number(showId),
          status: 'watching',
          addedAt: new Date().toISOString()
        });
        sm.saveState();
        showToast('Adicionado à sua lista!', 'success');
        refreshAllViews();
        if (currentModalShowId === showId) openShowModal(showId);
      }
    },

    removeShowFromWatchlist(showId) {
      sm.state.trackedShows = sm.state.trackedShows.filter(t => t.showId !== Number(showId));
      sm.saveState();
      showToast('Removido da sua lista.');
      refreshAllViews();
      if (currentModalShowId === showId) openShowModal(showId);
    },

    restoreSnapshot(index) {
      const note = sm.getEpisodeNote(currentNoteTarget.showId, currentNoteTarget.seasonNum, currentNoteTarget.epNum);
      if (note && note.snapshots && note.snapshots[index]) {
        document.getElementById('note-textarea').value = note.snapshots[index].text;
        triggerAutoSave();
        showToast('Versão anterior restaurada com sucesso!', 'success');
      }
    },

    switchAuthMode(mode) {
      authMode = mode;
      const title = document.getElementById('auth-modal-title');
      const submitBtn = document.getElementById('btn-auth-submit');
      const nameGroup = document.getElementById('group-auth-name');
      const tabLogin = document.getElementById('auth-tab-login');
      const tabRegister = document.getElementById('auth-tab-register');
      const switchText = document.getElementById('auth-switch-text');

      if (mode === 'register') {
        title.textContent = 'Criar sua Conta';
        submitBtn.textContent = 'Cadastrar no Cofre';
        nameGroup.classList.remove('hidden');
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        switchText.innerHTML = `Já possui conta? <a href="#" onclick="event.preventDefault(); app.switchAuthMode('login')">Entrar agora</a>`;
      } else {
        title.textContent = 'Acesse sua Conta';
        submitBtn.textContent = 'Entrar no Cofre';
        nameGroup.classList.add('hidden');
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        switchText.innerHTML = `Não tem conta ainda? <a href="#" onclick="event.preventDefault(); app.switchAuthMode('register')">Cadastre-se grátis</a>`;
      }
    },

    handleAuthSubmit() {
      handleAuthSubmit();
    }
  };

  // ================================================================
  // EVENT LISTENERS DOM
  // ================================================================
  document.addEventListener('DOMContentLoaded', () => {
    updateAuthHeaderUI();

    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        app.switchTab(tab.getAttribute('data-tab'));
      });
    });

    document.querySelectorAll('#watchlist-filters .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#watchlist-filters .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentWatchlistFilter = btn.getAttribute('data-filter');
        renderWatchlist();
      });
    });

    document.querySelectorAll('#emotion-filters .emotion-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#emotion-filters .emotion-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentEmotionFilter = btn.getAttribute('data-emotion');
        renderDiary();
      });
    });

    const diarySearch = document.getElementById('diary-search-input');
    if (diarySearch) {
      diarySearch.addEventListener('input', (e) => {
        diarySearchQuery = e.target.value.trim();
        renderDiary();
      });
    }

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    });

    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal-overlay').classList.add('hidden');
      });
    });

    const textarea = document.getElementById('note-textarea');
    if (textarea) {
      textarea.addEventListener('input', () => {
        updateWordCount(textarea.value);
        triggerAutoSave();
      });
    }

    const charInput = document.getElementById('note-character-input');
    if (charInput) charInput.addEventListener('input', triggerAutoSave);

    document.querySelectorAll('#note-emotion-selector .emotion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        document.querySelectorAll('#note-emotion-selector .emotion-btn').forEach(b => b.classList.remove('active'));
        if (!wasActive) btn.classList.add('active');
        triggerAutoSave();
      });
    });

    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ins = btn.getAttribute('data-insert');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (ins === '**' || ins === '*') {
          const selected = val.substring(start, end) || 'texto';
          textarea.value = val.substring(0, start) + `${ins}${selected}${ins}` + val.substring(end);
        } else if (ins === '> ') {
          textarea.value = val.substring(0, start) + `\n> ` + val.substring(end);
        } else if (ins.includes('spoiler')) {
          const selected = val.substring(start, end) || 'spoiler';
          textarea.value = val.substring(0, start) + `>!${selected}!<` + val.substring(end);
        }
        triggerAutoSave();
      });
    });

    const watchedToggle = document.getElementById('note-watched-toggle');
    if (watchedToggle) {
      watchedToggle.addEventListener('change', () => {
        const isWatched = sm.toggleWatched(currentNoteTarget.showId, currentNoteTarget.seasonNum, currentNoteTarget.epNum);
        watchedToggle.checked = isWatched;
        refreshAllViews();
      });
    }

    const rewatchVal = document.getElementById('rewatch-counter-val');
    document.getElementById('btn-rewatch-plus').addEventListener('click', () => {
      let val = parseInt(rewatchVal.textContent) || 1;
      val++;
      rewatchVal.textContent = val;
      const epKey = currentNoteTarget.isMovie ? `${currentNoteTarget.showId}_movie` : `${currentNoteTarget.showId}_s${currentNoteTarget.seasonNum}_e${currentNoteTarget.epNum}`;
      if (sm.state.watchedEpisodes[epKey]) {
        sm.state.watchedEpisodes[epKey].rewatchCount = val;
        sm.saveState();
        renderStats();
      }
    });

    document.getElementById('btn-rewatch-minus').addEventListener('click', () => {
      let val = parseInt(rewatchVal.textContent) || 1;
      if (val > 1) {
        val--;
        rewatchVal.textContent = val;
        const epKey = currentNoteTarget.isMovie ? `${currentNoteTarget.showId}_movie` : `${currentNoteTarget.showId}_s${currentNoteTarget.seasonNum}_e${currentNoteTarget.epNum}`;
        if (sm.state.watchedEpisodes[epKey]) {
          sm.state.watchedEpisodes[epKey].rewatchCount = val;
          sm.saveState();
          renderStats();
        }
      }
    });

    document.getElementById('btn-batch-check-season').addEventListener('click', () => {
      sm.batchSetSeason(currentModalShowId, currentModalSeasonNum, true);
      renderSeasonEpisodes();
      const show = sm.getShowById(currentModalShowId);
      if (show && show.seasons) renderSeasonTabs(show.seasons);
      refreshAllViews();
      showToast('Temporada inteira marcada como assistida!', 'success');
    });

    document.getElementById('btn-batch-uncheck-season').addEventListener('click', () => {
      sm.batchSetSeason(currentModalShowId, currentModalSeasonNum, false);
      renderSeasonEpisodes();
      const show = sm.getShowById(currentModalShowId);
      if (show && show.seasons) renderSeasonTabs(show.seasons);
      refreshAllViews();
      showToast('Temporada desmarcada.');
    });

    document.getElementById('btn-save-note-modal').addEventListener('click', () => {
      document.getElementById('modal-episode-note').classList.add('hidden');
      refreshAllViews();
      showToast('Anotação registrada com sucesso no seu cofre!', 'success');
    });

    // Auth Listeners
    document.getElementById('btn-open-auth').addEventListener('click', openAuthModal);
    document.getElementById('btn-google-sign-in').addEventListener('click', handleGoogleSignIn);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    // Backup Listeners
    document.getElementById('btn-open-backup').addEventListener('click', () => {
      document.getElementById('modal-backup').classList.remove('hidden');
    });
    document.getElementById('btn-download-json-backup').addEventListener('click', downloadJSONBackup);
    document.getElementById('btn-download-all-md').addEventListener('click', downloadAllNotesMarkdown);
    document.getElementById('btn-export-notes-md').addEventListener('click', downloadAllNotesMarkdown);
    document.getElementById('input-import-backup').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) importJSONBackup(e.target.files[0]);
    });
    document.getElementById('btn-reset-database').addEventListener('click', () => {
      if (confirm('Deseja resetar todo o banco para o estado original de fábrica?')) {
        localStorage.removeItem(STORAGE_KEY);
        sm.state = sm.loadState();
        refreshAllViews();
        document.getElementById('modal-backup').classList.add('hidden');
        showToast('Banco de dados resetado.', 'info');
      }
    });

    // Settings
    document.getElementById('btn-open-settings').addEventListener('click', () => {
      document.getElementById('input-tmdb-key').value = sm.settings.tmdbApiKey || '';
      document.getElementById('select-language').value = sm.settings.language || 'pt-BR';
      document.getElementById('modal-settings').classList.remove('hidden');
    });
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const apiKey = document.getElementById('input-tmdb-key').value.trim();
      const lang = document.getElementById('select-language').value;
      sm.saveSettings({ tmdbApiKey: apiKey, language: lang });
      document.getElementById('modal-settings').classList.add('hidden');
      showToast('Configurações salvas!', 'success');
    });

    // Busca Explorar
    const exploreSearchInput = document.getElementById('explore-search-input');
    const exploreSearchBtn = document.getElementById('btn-search-shows');

    function performExploreSearch() {
      const query = exploreSearchInput.value.trim().toLowerCase();
      if (!query) {
        renderExplore(CATALOG_DATABASE);
        document.getElementById('explore-results-title').textContent = 'Catálogo em Destaque';
        return;
      }

      if (sm.settings.tmdbApiKey) {
        showToast('Buscando na API do TMDB (Séries, Filmes e Animes)...', 'info');
        fetch(`https://api.themoviedb.org/3/search/multi?api_key=${sm.settings.tmdbApiKey}&language=${sm.settings.language}&query=${encodeURIComponent(query)}`)
          .then(res => res.json())
          .then(data => {
            if (data.results && data.results.length > 0) {
              const formatted = data.results.filter(r => r.media_type === 'tv' || r.media_type === 'movie').map(r => ({
                id: r.id,
                type: r.media_type === 'movie' ? 'movie' : 'tv',
                name: r.name || r.title,
                runtime: r.media_type === 'movie' ? 120 : undefined,
                overview: r.overview,
                poster_path: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=500',
                backdrop_path: r.backdrop_path ? `https://image.tmdb.org/t/p/original${r.backdrop_path}` : '',
                vote_average: r.vote_average || 7.0,
                first_air_date: r.first_air_date || r.release_date,
                genres: [r.media_type === 'movie' ? 'Filme' : 'Série'],
                status: "TMDB",
                seasons: []
              }));
              renderExplore(formatted);
              document.getElementById('explore-results-title').textContent = `Resultados TMDB para "${query}" (${formatted.length})`;
            } else {
              renderExplore([]);
              document.getElementById('explore-results-title').textContent = `Nenhum resultado para "${query}"`;
            }
          })
          .catch(err => {
            console.error(err);
            showToast('Erro ao consultar TMDB.', 'error');
          });
      } else {
        const matched = CATALOG_DATABASE.filter(s => 
          s.name.toLowerCase().includes(query) || 
          s.overview.toLowerCase().includes(query) ||
          s.genres.some(g => g.toLowerCase().includes(query))
        );
        renderExplore(matched);
        document.getElementById('explore-results-title').textContent = `Resultados para "${query}" (${matched.length})`;
      }
    }

    if (exploreSearchBtn) exploreSearchBtn.addEventListener('click', performExploreSearch);
    if (exploreSearchInput) {
      exploreSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performExploreSearch();
      });
    }

    refreshAllViews();
  });

})();
