// Ajudante dos testes da S13: serve as respostas REAIS da AniList gravadas em tests/fixtures/anilist/*.json (nenhuma rede).
// Cada arquivo tem {requests:[{kind:'search'|'media', variables, response}]}. A busca é achada pelo texto; uma obra, pelo id da AniList
// ou pelo idMal (de modo que a franquia pode ser percorrida a partir de qualquer entrada). Também monta um MediaService de teste.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'anilist');
const { mediaErrors } = require('../../server/utils/errors');

const searchKey = text => String(text).trim().toLowerCase();   // a AniList não diferencia maiúsculas na busca
const searches = new Map();   // texto buscado -> resposta
const medias = new Map();     // 'id:<anilist>' / 'mal:<idMal>' -> resposta
for (const file of fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'))) {
  const json = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8'));
  for (const r of json.requests) {
    if (r.kind === 'search') {
      searches.set(searchKey(r.variables.search), r.response);
    } else {
      const m = r.response.data.Media;
      medias.set(`id:${m.id}`, r.response);
      if (m.idMal) medias.set(`mal:${m.idMal}`, r.response);
    }
  }
}

// O que a AniList responderia a este corpo GraphQL ({query, variables}), com as respostas reais. Busca desconhecida = lista vazia
// (como a API de verdade); obra desconhecida = 404 (NOT_FOUND tipado, como o httpJson faz).
function respond(body) {
  if (body.query.includes('Page(')) return structuredClone(searches.get(searchKey(body.variables.search)) || { data: { Page: { media: [] } } });
  const v = body.variables;
  const hit = medias.get(v.id ? `id:${v.id}` : `mal:${v.idMal}`);
  if (!hit) throw mediaErrors.notFound();
  return structuredClone(hit);
}

// Uma resposta real de obra (cópia), para os testes que alteram um campo (ex.: o próximo episódio de One Piece).
const media = key => structuredClone(medias.get(key));

const FAKE = { anilist: 'http://anilist.invalid/graphql', jikan: 'http://jikan.invalid/v4', tvmaze: 'http://tvmaze.invalid' };

// Jikan "fora do ar", como estava em 2026-10-27: nem responde (timeout).
const jikanDown = () => { throw mediaErrors.upstream('Tempo esgotado na fonte externa.', { unreachable: true }); };

// MediaService de teste: AniList = fixtures reais, Jikan = fora do ar (padrão), TVMaze = vazio. `handlers` troca qualquer fonte.
// svc.calls = [{source, kind, variables|url}] de todas as requisições externas.
function makeService(MediaService, dir, { handlers = {}, extra = {} } = {}) {
  const svc = new MediaService({
    dataDir: dir, tvmazeBase: FAKE.tvmaze, jikanBase: FAKE.jikan, anilistBase: FAKE.anilist, tmdbKey: '', sleep: async () => {},
    anilist: { minIntervalMs: 0 }, jikan: { minIntervalMs: 0 }, ...extra
  });
  svc.calls = [];
  const fixture = (url, opts) => respond(JSON.parse(opts.body));
  const h = { anilist: fixture, jikan: jikanDown, tvmaze: () => [], ...handlers };
  svc.handlers = h;   // o teste pode trocar uma fonte no meio (ex.: a Jikan cai depois da 1ª ingestão)
  svc.fetchJson = async (url, opts = {}) => {
    if (url.startsWith(FAKE.anilist)) {
      const body = JSON.parse(opts.body);
      svc.calls.push({ source: 'anilist', kind: body.query.includes('Page(') ? 'search' : 'media', variables: body.variables });
      return h.anilist(url, opts);
    }
    if (url.startsWith(FAKE.jikan)) {
      svc.calls.push({ source: 'jikan', url });
      return h.jikan(url, opts);
    }
    if (url.startsWith(FAKE.tvmaze)) {
      svc.calls.push({ source: 'tvmaze', url });
      return h.tvmaze(url, opts);
    }
    throw new Error(`URL inesperada na fonte simulada: ${url}`);
  };
  svc.callsTo = source => svc.calls.filter(c => c.source === source);
  return svc;
}

function tempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
  let n = 0;
  return { root, newDir: () => { const d = path.join(root, `c${++n}`); fs.mkdirSync(d, { recursive: true }); return d; } };
}

module.exports = { FIXTURES_DIR, respond, media, makeService, tempRoot, jikanDown, FAKE, fixtureKeys: () => [...medias.keys()] };
