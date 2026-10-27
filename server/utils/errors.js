// Erros tipados do backend: cada um sabe qual status HTTP e qual mensagem (em português) o cliente recebe.
const path = require('path');

class MediaError extends Error {
  constructor(code, message, httpStatus = 500, extra = {}) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.assign(this, extra);
  }
}

const mediaErrors = {
  invalidId: () => new MediaError('INVALID_ID', 'ID inválido: use um número inteiro positivo.', 400),
  invalidQuery: msg => new MediaError('INVALID_QUERY', msg, 400),
  notFound: () => new MediaError('NOT_FOUND', 'Título não encontrado.', 404),
  unsupportedSource: () => new MediaError('UNSUPPORTED_SOURCE', 'Esta obra não pode ser adicionada ao catálogo (fonte não suportada).', 404),
  rateLimited: retryAfterMs => new MediaError('RATE_LIMITED', 'A fonte externa pediu para aguardar. Tente novamente em instantes.', 429, { retryAfterMs }),
  // extra.unreachable = true: a fonte nem respondeu (timeout/conexão recusada/DNS). O disjuntor (sourceBreaker) abre na hora e as
  // retentativas param, porque a próxima tentativa esperaria outro timeout inteiro (S13).
  upstream: (msg, extra = {}) => new MediaError('UPSTREAM', msg || 'A fonte externa está indisponível no momento.', 502, extra),
  catalogUnavailable: () => new MediaError('CATALOG_UNAVAILABLE', 'O catálogo está temporariamente somente leitura (arquivo de dados ilegível). Avise o administrador.', 503),
  tooManyRequests: retryAfterSec => new MediaError('TOO_MANY_REQUESTS', 'Muitas obras adicionadas em pouco tempo. Aguarde um pouco e tente de novo.', 429, { retryAfterSec }),
  notConfigured: msg => new MediaError('SOURCE_NOT_CONFIGURED', msg || 'Esta fonte de dados não está configurada neste servidor.', 503),
  tooManySearches: retryAfterSec => new MediaError('TOO_MANY_REQUESTS', 'Muitas buscas em pouco tempo. Aguarde alguns segundos e tente de novo.', 429, { retryAfterSec }),
  loginRequired: () => new MediaError('LOGIN_REQUIRED', 'Entre na sua conta para adicionar novas obras ao catálogo.', 401)
};

// Arquivo de dados existe mas não pôde ser lido (JSON quebrado e sem cópia .bak válida).
// Quem recebe este erro NUNCA deve tratar como "lista vazia" nem gravar por cima.
class DataCorruptionError extends Error {
  constructor(file, cause) {
    super(`Arquivo de dados ilegível (${path.basename(file)}). Nada foi sobrescrito; uma cópia foi preservada ao lado do arquivo.`);
    this.name = 'DataCorruptionError';
    this.code = 'DATA_CORRUPT';
    this.file = file;
    this.cause = cause;
  }
}

module.exports = { MediaError, mediaErrors, DataCorruptionError };
