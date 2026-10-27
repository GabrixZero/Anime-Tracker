// Disjuntor de fonte externa (S13): depois de uma falha de rede (timeout, conexão recusada) ou de várias falhas seguidas do
// servidor (5xx, resposta inválida), a fonte fica "fora do ar" por `cooldownMs` e os pedidos seguintes falham NA HORA, sem esperar
// outro timeout. Motivo: em 2026-10-27 a Jikan não respondia de lugar nenhum (timeout de TCP); sem isto cada busca/ingestão que
// precisasse dela esperaria vários segundos (8 s x 3 tentativas).
//  - falha "inalcançável" (`err.unreachable`, marcada por utils/httpJson.js): abre na primeira;
//  - outras falhas UPSTREAM (5xx, JSON inválido): abrem depois de `threshold` seguidas (padrão 3);
//  - 404 (obra não existe) e 429 (limite; a fonte está viva, quem chama respeita o Retry-After) nunca abrem;
//  - um sucesso fecha. cooldownMs = 0 desliga o disjuntor.
const { mediaErrors, MediaError } = require('./errors');

class SourceBreaker {
  constructor({ name = 'fonte', label = 'A fonte externa', cooldownMs = 0, threshold = 3, now = Date.now } = {}) {
    this.name = name;
    this.label = label;
    this.cooldownMs = cooldownMs;
    this.threshold = threshold;
    this.now = now;
    this.openUntil = 0;
    this.failures = 0;
  }

  get isOpen() {
    return this.cooldownMs > 0 && this.now() < this.openUntil;
  }

  // Segundos até a próxima tentativa (0 = fechado).
  get retryAfterSec() {
    return this.isOpen ? Math.ceil((this.openUntil - this.now()) / 1000) : 0;
  }

  // Lança na hora se a fonte caiu há pouco (erro tipado UPSTREAM, com `breakerOpen` para quem quiser distinguir).
  check() {
    if (!this.isOpen) return;
    const err = mediaErrors.upstream(`${this.label} está indisponível no momento (nova tentativa em ~${this.retryAfterSec} s).`);
    err.breakerOpen = true;
    throw err;
  }

  success() {
    this.failures = 0;
    this.openUntil = 0;
  }

  // Registra uma falha DEFINITIVA de um pedido (depois das retentativas). O erro lançado pelo próprio check() não prolonga a espera.
  failure(err) {
    if (err && err.breakerOpen) return;
    if (err instanceof MediaError && err.code !== 'UPSTREAM') return;
    this.failures++;
    if (this.cooldownMs <= 0) return;
    if ((err && err.unreachable) || this.failures >= this.threshold) this.openUntil = this.now() + this.cooldownMs;
  }
}

module.exports = SourceBreaker;
