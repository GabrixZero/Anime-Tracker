// Servidor FALSO das fontes externas (TVMaze, Jikan; AniList e TMDB respondem "fora do ar") para os testes E2E (S12).
// Roda dentro do processo do Playwright, em 127.0.0.1 numa porta livre. O servidor do app fala com ele assim:
//   - Jikan: pela variável que o app já tem (JIKAN_BASE_URL = <falso>/externo/api.jikan.moe/v4);
//   - o resto (o TVMaze ainda não tem variável de URL): o network-guard.js, carregado no processo do app, reescreve
//     qualquer pedido http(s) para fora de 127.0.0.1 como <falso>/externo/<host>/<caminho>.
// Host desconhecido = 503 e fica anotado em `unexpectedHosts()`: no fim da execução isso falha o teste (nada pode ir à internet).
'use strict';

const http = require('http');
const { TVMAZE_SHOWS, JIKAN_ANIME, JIKAN_EPISODES } = require('./data');

// Fontes conhecidas sem dados simulados: respondem como se estivessem fora do ar (o app precisa degradar sem quebrar).
const KNOWN_OFFLINE = new Set(['graphql.anilist.co', 'api.themoviedb.org']);

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

// Busca "boa o bastante" para o teste: todas as palavras da consulta aparecem no título (o app faz a relevância de verdade).
function matches(query, ...titles) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const hay = normalize(titles.join(' '));
  return words.length > 0 && words.every(w => hay.includes(w));
}

function tvmaze(path, params, res) {
  if (path === '/search/shows') {
    const q = params.get('q') || '';
    const found = TVMAZE_SHOWS.filter(s => matches(q, s.name)).map((s, i) => {
      const { episodes, ...show } = s;
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

function jikan(path, params, res) {
  const notFound = () => send(res, 404, { status: 404, type: 'BadResponseException', message: 'Resource does not exist' });
  if (path === '/v4/anime') {
    const q = params.get('q') || '';
    const data = JIKAN_ANIME.filter(a => matches(q, a.title, a.title_english));
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
    return send(res, 200, { pagination: { last_visible_page: 1, has_next_page: false }, data: Number(params.get('page') || 1) === 1 ? list : [] });
  }
  return notFound();
}

function startFakeSources({ host = '127.0.0.1' } = {}) {
  const unexpected = new Map(); // host -> nº de pedidos
  const counts = new Map(); // host -> nº de pedidos (diagnóstico)

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://servidor-falso');
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });

    const m = /^\/externo\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) return send(res, 404, { error: 'Caminho desconhecido no servidor falso.' });
    const target = m[1].toLowerCase();
    const path = m[2] || '/';
    counts.set(target, (counts.get(target) || 0) + 1);

    if (target === 'api.tvmaze.com') return tvmaze(path, url.searchParams, res);
    if (target === 'api.jikan.moe') return jikan(path, url.searchParams, res);
    if (KNOWN_OFFLINE.has(target)) return send(res, 503, { error: 'Fonte simulada fora do ar nos testes E2E.' });

    unexpected.set(target, (unexpected.get(target) || 0) + 1);
    return send(res, 503, { error: `Host externo inesperado nos testes E2E: ${target}` });
  });
  server.keepAliveTimeout = 1000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      resolve({
        url: `http://${host}:${port}`,
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
