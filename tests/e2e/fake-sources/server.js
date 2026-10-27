// Servidor FALSO das fontes externas (TVMaze, AniList, Jikan e TMDB) para os testes E2E (S12).
// Roda dentro do processo do Playwright, em 127.0.0.1 numa porta livre. O servidor do app fala com ele pelas variáveis de URL que o
// próprio app já tem (D-S12-3): TVMAZE_BASE_URL, ANILIST_BASE_URL, JIKAN_BASE_URL e TMDB_BASE_URL.
//
//   <falso>/tvmaze/...          TVMaze:  /search/shows?q=  ·  /shows/:id?embed=episodes
//   <falso>/anilist             AniList: POST GraphQL (busca por texto e obra por id/idMal, com relações e grade de exibição)
//   <falso>/jikan/v4/...        Jikan:   /anime?q=  ·  /anime/:id/full  ·  /anime/:id/episodes?page=
//   <falso>/tmdb/3/...          TMDB:    /search/movie  ·  /search/tv  ·  /movie/:id   (exige api_key, como o de verdade)
//   <falso>/externo/<host>/...  NÃO é uma fonte: é para onde o network-guard.js manda qualquer pedido do servidor do app para fora
//                               de 127.0.0.1. Responde 503 e fica anotado em `unexpectedHosts()`; no fim da execução isso falha os
//                               testes (nenhum teste pode usar a internet).
'use strict';

const http = require('http');
const { TVMAZE_SHOWS, ANILIST_MEDIA, JIKAN_ANIME, JIKAN_EPISODES, TMDB_MOVIES } = require('./data');

const normalize = s =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

// Busca "boa o bastante" para o teste: todas as palavras da consulta aparecem nos títulos (o app faz a relevância de verdade).
function matches(query, ...titles) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const hay = normalize(titles.flat().join(' '));
  return words.length > 0 && words.every(w => hay.includes(w));
}

// ---- TVMaze ----------------------------------------------------------------------------------------------------------------------
function tvmaze(path, params, res) {
  if (path === '/search/shows') {
    const found = TVMAZE_SHOWS.filter(s => matches(params.get('q'), s.name)).map((s, i) => {
      const { episodes: _episodes, ...show } = s;
      return { score: 0.9 - i * 0.1, show };
    });
    return send(res, 200, found);
  }
  const m = /^\/shows\/(\d+)$/.exec(path);
  if (m) {
    const show = TVMAZE_SHOWS.find(s => s.id === Number(m[1]));
    if (!show) return send(res, 404, { name: 'Not Found', message: '', code: 0, status: 404 });
    const { episodes, ...rest } = show;
    return send(res, 200, params.get('embed') === 'episodes' ? { ...rest, _embedded: { episodes } } : rest);
  }
  return send(res, 404, { name: 'Not Found', status: 404 });
}

// ---- AniList (GraphQL) -----------------------------------------------------------------------------------------------------------
const titlesOf = a => [a.title.romaji, a.title.english, a.title.native, ...a.synonyms];

function anilist(body, res) {
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return send(res, 400, { errors: [{ message: 'Corpo inválido.', status: 400 }] });
  }
  const query = String(json.query || '');
  const variables = json.variables || {};

  if (query.includes('Page(')) {
    const media = ANILIST_MEDIA.filter(a => matches(variables.search, titlesOf(a))).map(a => {
      const { relations: _relations, airingSchedule: _schedule, ...entry } = a; // a busca não pede relações nem grade
      return entry;
    });
    return send(res, 200, { data: { Page: { media } } });
  }

  const hit = ANILIST_MEDIA.find(a => (variables.id ? a.id === variables.id : a.idMal === variables.idMal));
  if (!hit) return send(res, 404, { data: { Media: null }, errors: [{ message: 'Not Found.', status: 404 }] });
  return send(res, 200, { data: { Media: hit } });
}

// ---- Jikan v4 --------------------------------------------------------------------------------------------------------------------
function jikan(path, params, res) {
  const notFound = () => send(res, 404, { status: 404, type: 'BadResponseException', message: 'Resource does not exist' });
  if (path === '/v4/anime') {
    const data = JIKAN_ANIME.filter(a => matches(params.get('q'), a.title, a.title_english));
    return send(res, 200, { pagination: { last_visible_page: 1, has_next_page: false }, data });
  }
  let m = /^\/v4\/anime\/(\d+)\/full$/.exec(path);
  if (m) {
    const a = JIKAN_ANIME.find(x => x.mal_id === Number(m[1]));
    return a ? send(res, 200, { data: a }) : notFound();
  }
  m = /^\/v4\/anime\/(\d+)\/episodes$/.exec(path);
  if (m) {
    const list = JIKAN_EPISODES[m[1]];
    if (!list) return notFound();
    return send(res, 200, {
      pagination: { last_visible_page: 1, has_next_page: false },
      data: Number(params.get('page') || 1) === 1 ? list : []
    });
  }
  return notFound();
}

// ---- TMDB v3 ---------------------------------------------------------------------------------------------------------------------
function tmdb(path, params, res) {
  if (!params.get('api_key')) return send(res, 401, { status_code: 7, status_message: 'Invalid API key.', success: false });
  if (path === '/search/movie') {
    const results = TMDB_MOVIES.filter(m => matches(params.get('query'), m.title, m.original_title)).map(m => {
      // a busca só traz os números dos gêneros e não traz a duração (como o TMDB de verdade)
      const { genres, runtime: _runtime, status: _status, ...rest } = m;
      return { ...rest, genre_ids: genres.map(g => g.id) };
    });
    return send(res, 200, { page: 1, total_results: results.length, total_pages: 1, results });
  }
  if (path === '/search/tv') return send(res, 200, { page: 1, total_results: 0, total_pages: 1, results: [] });
  const m = /^\/movie\/(\d+)$/.exec(path);
  const movie = m && TMDB_MOVIES.find(x => x.id === Number(m[1]));
  if (movie) return send(res, 200, movie);
  return send(res, 404, { status_code: 34, status_message: 'The resource you requested could not be found.', success: false });
}

function startFakeSources({ host = '127.0.0.1' } = {}) {
  const unexpected = new Map(); // host -> nº de pedidos fora de qualquer fonte conhecida
  const counts = new Map(); // fonte -> nº de pedidos (diagnóstico)
  const count = key => counts.set(key, (counts.get(key) || 0) + 1);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://servidor-falso');
    const { pathname, searchParams } = url;
    if (pathname === '/health') return send(res, 200, { status: 'ok' });

    if (pathname.startsWith('/tvmaze/')) {
      count('tvmaze');
      return tvmaze(pathname.slice('/tvmaze'.length), searchParams, res);
    }
    if (pathname.startsWith('/jikan/')) {
      count('jikan');
      return jikan(pathname.slice('/jikan'.length), searchParams, res);
    }
    if (pathname.startsWith('/tmdb/3/')) {
      count('tmdb');
      return tmdb(pathname.slice('/tmdb/3'.length), searchParams, res);
    }
    if (pathname === '/anilist' && req.method === 'POST') {
      count('anilist');
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => anilist(Buffer.concat(chunks).toString('utf-8'), res));
      return undefined;
    }

    const external = /^\/externo\/([^/]+)/.exec(pathname);
    if (external) {
      const target = external[1].toLowerCase();
      unexpected.set(target, (unexpected.get(target) || 0) + 1);
      return send(res, 503, { error: `Host externo inesperado nos testes E2E: ${target}` });
    }
    return send(res, 404, { error: 'Caminho desconhecido no servidor falso.' });
  });
  server.keepAliveTimeout = 1000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      const base = `http://${host}:${port}`;
      resolve({
        url: base,
        // Valores das variáveis de ambiente do app (cada fonte aponta para o seu pedaço do servidor falso).
        env: {
          TVMAZE_BASE_URL: `${base}/tvmaze`,
          ANILIST_BASE_URL: `${base}/anilist`,
          JIKAN_BASE_URL: `${base}/jikan/v4`,
          TMDB_BASE_URL: `${base}/tmdb/3`
        },
        unexpectedHosts: () => [...unexpected.entries()].map(([h, n]) => `${h} (${n}x)`),
        requestCounts: () => Object.fromEntries(counts),
        close: () =>
          new Promise(done => {
            server.closeAllConnections?.();
            server.close(() => done());
          })
      });
    });
  });
}

module.exports = { startFakeSources };
