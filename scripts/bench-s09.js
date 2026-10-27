// Benchmark da S09 (performance). Não faz parte de `npm test`; serve para medir antes/depois e fica para repetir a medição.
//
//   node scripts/bench-s09.js seed <pasta> [atual|grande]   grava um catálogo SINTÉTICO em <pasta>/mediaCatalog.runtime.json e
//                                                           imprime (em JSON) a biblioteca de exemplo para colar no navegador
//   node scripts/bench-s09.js payload [atual|grande]        mede o tamanho (bytes e gzip) da lista /api/media/trending:
//                                                           formato antigo (catálogo inteiro) × lista leve atual
//
// Perfis: "atual" = 19 obras / ~536 episódios (o catálogo real da época da auditoria); "grande" = 60 obras / ~3.600 episódios,
// uma delas com 1.100 episódios numa só temporada (estilo One Piece). Nenhum dado real é usado: tudo é gerado aqui.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const PROFILES = {
  atual: { works: 19, perWork: [26, 29, 28, 24, 30, 28, 25, 32, 27, 30, 28, 24, 29, 26, 28, 30, 27, 25, 21], big: null },
  grande: { works: 60, perWork: null, big: 1100 }
};

// Gerador pseudo-aleatório determinístico (as duas medições usam exatamente os mesmos dados).
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const WORDS = 'o a de que e do da em um para com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele'.split(' ');
function sentence(rand, n) {
  return Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ');
}

function buildCatalog(profile) {
  const cfg = PROFILES[profile];
  const rand = rng(20261027);
  const items = [];
  for (let i = 0; i < cfg.works; i++) {
    const id = 1000000 + 1000 + i;                       // faixa do TVMaze (ingerida)
    const type = i % 5 === 4 ? 'anime' : 'tv';
    const isBig = cfg.big && i === 0;
    const total = isBig ? cfg.big : (cfg.perWork ? cfg.perWork[i] : 20 + Math.floor(rand() * 20));
    const seasons = [];
    if (isBig) {
      seasons.push({ season_number: 1, name: 'Temporada 1', episodes: makeEpisodes(rand, id, 1, total) });
    } else {
      const perSeason = type === 'anime' ? 12 : 10;
      for (let s = 1, left = total; left > 0; s++, left -= perSeason) {
        seasons.push({ season_number: s, name: `Temporada ${s}`, episodes: makeEpisodes(rand, id, s, Math.min(perSeason, left)) });
      }
    }
    items.push({
      id, type,
      name: isBig ? 'Maratona Sem Fim' : `Obra Sintética ${i + 1}`,
      overview: sentence(rand, 60),
      poster_path: `https://static.tvmaze.com/uploads/images/medium_portrait/${id}.jpg`,
      backdrop_path: `https://static.tvmaze.com/uploads/images/original_untouched/${id}.jpg`,
      vote_average: Math.round((6 + rand() * 3.5) * 10) / 10,
      first_air_date: `${2005 + (i % 20)}-0${1 + (i % 9)}-15`,
      genres: ['Drama', 'Ação', 'Comédia'].slice(0, 1 + (i % 3)),
      status: i % 2 ? 'Finalizada' : 'Em Exibição',
      seasons,
      ingestedAt: '2026-10-27T00:00:00.000Z'
    });
  }
  return items;
}

function makeEpisodes(rand, id, season, count) {
  return Array.from({ length: count }, (_, k) => ({
    episode_number: k + 1,
    name: `Episódio ${k + 1}: ${sentence(rand, 3)}`,
    runtime: 22 + Math.floor(rand() * 40),
    air_date: `20${10 + (season % 15)}-0${1 + (k % 9)}-1${k % 9}`,
    overview: sentence(rand, 28),
    still_path: `https://static.tvmaze.com/uploads/images/medium_landscape/${id}-${season}-${k + 1}.jpg`
  }));
}

// Biblioteca de exemplo: todas as obras na lista; metade dos episódios das obras pequenas e 300 da grande assistidos.
function buildLibrary(catalog) {
  const now = new Date().toISOString();
  const data = { trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: { shows: {}, watched: {}, notes: {} }, resetAt: '' };
  catalog.forEach((m, i) => {
    data.trackedShows.push({ showId: m.id, status: 'watching', addedAt: now, updatedAt: now });
    let n = 0;
    const limit = m.seasons[0].episodes.length > 500 ? 300 : null;
    for (const s of m.seasons) {
      for (const e of s.episodes) {
        n++;
        if (limit ? n <= limit : n <= Math.floor(totalEpisodes(m) / 2)) {
          data.watchedEpisodes[`${m.id}_s${s.season_number}_e${e.episode_number}`] = { watched: true, watchedAt: now, updatedAt: now, rewatchCount: 1 };
        }
      }
    }
  });
  return data;
}

const totalEpisodes = m => m.seasons.reduce((n, s) => n + s.episodes.length, 0);
const gz = buf => zlib.gzipSync(buf, { level: 6 }).length;
const kb = n => `${(n / 1024).toFixed(1)} KB`;

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'seed') {
    const dir = path.resolve(a || '');
    if (!a) throw new Error('Informe a pasta: node scripts/bench-s09.js seed <pasta> [atual|grande]');
    const catalog = buildCatalog(b || 'grande');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mediaCatalog.runtime.json'), JSON.stringify(catalog));
    const library = buildLibrary(catalog);
    fs.writeFileSync(path.join(dir, 'bench-library.json'), JSON.stringify(library));
    console.log(JSON.stringify({ works: catalog.length, episodes: catalog.reduce((n, m) => n + totalEpisodes(m), 0), watched: Object.keys(library.watchedEpisodes).length, dir }));
    return;
  }
  if (cmd === 'payload') {
    const profile = a || 'atual';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s09-bench-'));
    process.env.SHOWVAULT_DATA_DIR = dir;
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
    const catalog = buildCatalog(profile);
    fs.writeFileSync(path.join(dir, 'mediaCatalog.runtime.json'), JSON.stringify(catalog));
    const app = require('../server/app');
    const mediaService = require('../server/services/mediaService');
    const all = mediaService.catalog;
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;

    // formato antigo = catálogo inteiro com todos os episódios, sem paginação
    const oldBody = Buffer.from(JSON.stringify({ count: all.length, data: all }));
    const lite = await get(`${base}/api/media/trending?type=all`, { 'Accept-Encoding': 'identity' });
    const liteGz = await get(`${base}/api/media/trending?type=all`, { 'Accept-Encoding': 'gzip' });
    const ids = all.map(m => m.id).join(',');
    const batch = await get(`${base}/api/media/batch?ids=${ids.split(',').slice(0, 50).join(',')}`, { 'Accept-Encoding': 'identity' });
    const batchGz = await get(`${base}/api/media/batch?ids=${ids.split(',').slice(0, 50).join(',')}`, { 'Accept-Encoding': 'gzip' });
    const etag = lite.headers.etag;
    const cond = await get(`${base}/api/media/trending?type=all`, { 'If-None-Match': etag });
    server.close();

    const eps = all.reduce((n, m) => n + totalEpisodes(m), 0);
    console.log(`Perfil "${profile}": ${all.length} obras, ${eps} episódios`);
    console.log(`  ANTES  /trending (catálogo inteiro): ${oldBody.length} bytes (${kb(oldBody.length)}) · gzip ${kb(gz(oldBody))}`);
    console.log(`  DEPOIS /trending (lista leve):       ${lite.body.length} bytes (${kb(lite.body.length)}) · gzip (servidor) ${kb(liteGz.body.length)} [Content-Encoding: ${liteGz.headers['content-encoding']}]`);
    console.log(`  Redução da lista: ${(oldBody.length / lite.body.length).toFixed(1)}x sem gzip · ${(gz(oldBody) / liteGz.body.length).toFixed(1)}x com gzip`);
    console.log(`  Detalhe em lote (/batch, até 50 obras, só obras da lista do usuário): ${kb(batch.body.length)} · gzip ${kb(batchGz.body.length)}`);
    console.log(`  Revalidação com ETag: HTTP ${cond.status} (${cond.body.length} bytes)`);
    return;
  }
  console.log('Uso: node scripts/bench-s09.js seed <pasta> [atual|grande] | payload [atual|grande]');
}

main().catch((err) => { console.error(err); process.exit(1); });
