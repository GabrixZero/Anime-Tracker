// Esquema de ids de obra (D-06 / D-11): ids continuam NUMÉRICOS (o frontend usa Number(id) e ids sem aspas em onclick),
// mas cada fonte tem uma FAIXA própria para que ids de fontes diferentes nunca colidam.
// Documentado em Documentacao/01-visao-geral-e-arquitetura.md (a S06 depende disto).

const { mediaErrors } = require('./errors');

const SOURCES = {
  // Catálogo inicial (seed) curado: usa o id nativo do TMDB, sem deslocamento.
  seed:       { min: 1,        max: 999999,   offset: 0,        ingestable: false },
  // Ingestão sob demanda do TVMaze (séries): id interno = 1_000_000 + id do TVMaze.
  tvmaze:     { min: 1000000,  max: 1999999,  offset: 1000000,  ingestable: true },
  // Reservado para a S06 (Jikan/MAL): 10_000_000 + mal_id.
  jikan:      { min: 10000000, max: 19999999, offset: 10000000, ingestable: false },
  // Reservado (TMDB externo, D-17). Séries e filmes têm faixas separadas porque no TMDB os dois tipos reutilizam os mesmos números.
  tmdb_tv:    { min: 20000000, max: 29999999, offset: 20000000, ingestable: false },
  tmdb_movie: { min: 30000000, max: 39999999, offset: 30000000, ingestable: false }
};

// Aceita número ou string de dígitos; devolve inteiro positivo seguro ou lança MediaError(400).
function parseId(raw) {
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d{1,15}$/.test(raw)) n = Number(raw);
  else throw mediaErrors.invalidId();
  if (!Number.isSafeInteger(n) || n <= 0) throw mediaErrors.invalidId();
  return n;
}

// {source, externalId, ingestable} para um id interno; source = null se estiver fora de todas as faixas.
function describeId(id) {
  for (const [source, r] of Object.entries(SOURCES)) {
    if (id >= r.min && id <= r.max) {
      return { source, externalId: id - r.offset, ingestable: r.ingestable };
    }
  }
  return { source: null, externalId: null, ingestable: false };
}

function toInternalId(source, externalId) {
  const r = SOURCES[source];
  if (!r || !Number.isSafeInteger(externalId) || externalId <= 0) throw mediaErrors.invalidId();
  const id = externalId + r.offset;
  if (id > r.max) throw mediaErrors.invalidId();
  return id;
}

module.exports = { SOURCES, parseId, describeId, toInternalId };
