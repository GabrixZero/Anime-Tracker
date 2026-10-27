// Base dos clientes de fontes externas com limite de uso (Jikan e AniList; S06/S13). Um cliente concreto só diz COMO pedir
// (`perform`) e qual a chave do cache; o resto é daqui:
//  - fila única com espaçamento mínimo entre pedidos e teto por minuto (espera longa demais = RATE_LIMITED, sem tocar na rede);
//  - cache com validade e pedidos iguais simultâneos viram um só (falhas nunca vão para o cache);
//  - nova tentativa com espera crescente em 429/5xx (respeita Retry-After); fonte "inalcançável" (timeout/conexão) não repete;
//  - disjuntor (utils/sourceBreaker.js): fonte que acabou de cair falha na hora, sem esperar outro timeout;
//  - opcional `pauseOnRateLimit`: um 429 com Retry-After pausa a fila inteira (a AniList limita por IP, não por pedido).
const TtlCache = require('../utils/ttlCache');
const SourceBreaker = require('../utils/sourceBreaker');
const { mediaErrors, MediaError } = require('../utils/errors');

const BASE_DEFAULTS = {
  minIntervalMs: 400,        // espaço mínimo entre dois pedidos
  perMinute: 50,             // teto por minuto
  maxQueue: 40,              // pedidos esperando na fila; acima disso responde "tente de novo" em vez de acumular
  maxWaitMs: 25000,          // quanto um pedido aceita esperar na fila antes de desistir (RATE_LIMITED)
  retries: 2,                // novas tentativas em 429/5xx (além da primeira)
  backoffMs: 1000,           // espera inicial entre tentativas (dobra a cada uma, respeitando Retry-After)
  breakerCooldownMs: 60000,  // fonte fora do ar: quanto tempo os pedidos falham na hora (0 desliga o disjuntor)
  breakerThreshold: 3,       // falhas seguidas (que não sejam "inalcançável") para abrir o disjuntor
  pauseOnRateLimit: false
};

class SourceClient {
  // fetchJson(url, opts) => Promise<json>: injetado (o MediaService usa o dele, com timeout e erros tipados).
  constructor({ fetchJson, sleep, now, name = 'fonte', label = 'A fonte externa', defaults = {}, cacheMax = 400, ...opts } = {}) {
    if (typeof fetchJson !== 'function') throw new Error(`O cliente ${name} precisa de fetchJson.`);
    Object.assign(this, BASE_DEFAULTS, defaults, Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)));
    this.fetchJson = fetchJson;
    this.now = now || Date.now;
    this.sleep = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.cache = new TtlCache({ max: cacheMax, now: this.now });
    this.inflight = new Map();   // mesma chave pedida ao mesmo tempo = uma única requisição
    this.tail = Promise.resolve();
    this.pending = 0;
    this.lastAt = 0;
    this.stamps = [];
    this.pauseUntil = 0;
    this.requestCount = 0;       // quantas requisições reais foram feitas (diagnóstico e testes)
    this.breaker = new SourceBreaker({ name, label, cooldownMs: this.breakerCooldownMs, threshold: this.breakerThreshold, now: this.now });
  }

  // Espera a vez na fila (espaçamento + teto por minuto + pausa por 429). Rejeita se a espera for longa demais.
  _slot() {
    if (this.pending >= this.maxQueue) return Promise.reject(mediaErrors.rateLimited(this.minIntervalMs * this.pending));
    this.pending++;
    const run = this.tail.then(async () => {
      try {
        const t0 = this.now();
        this.stamps = this.stamps.filter(t => t0 - t < 60000);
        let wait = Math.max(0, this.lastAt + this.minIntervalMs - t0);
        if (this.pauseUntil > t0) wait = Math.max(wait, this.pauseUntil - t0);
        if (this.stamps.length >= this.perMinute) wait = Math.max(wait, this.stamps[0] + 60000 - t0);
        if (wait > this.maxWaitMs) throw mediaErrors.rateLimited(wait);
        if (wait > 0) await this.sleep(wait);
        const t1 = this.now();
        this.lastAt = t1;
        this.stamps.push(t1);
      } finally {
        this.pending--;
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }

  // Resposta em cache, pedido já em andamento ou pedido novo (`perform` faz a requisição de verdade).
  // `fresh`: ignora o cache e o pedido em andamento (atualização de obra em exibição); a resposta nova renova o cache.
  // Com o disjuntor aberto o pedido falha na hora (respostas já em cache continuam valendo).
  async cached(key, ttlMs, perform, { fresh = false } = {}) {
    if (!fresh) {
      const hit = this.cache.get(key, ttlMs);
      if (hit !== undefined) return hit;
      if (this.inflight.has(key)) return this.inflight.get(key);
    }
    this.breaker.check();

    const promise = this._withRetry(perform).then((data) => {
      this.cache.set(key, data);
      return data;
    }).finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  async _withRetry(perform) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this._slot();
      this.requestCount++;
      try {
        const data = await perform();
        this.breaker.success();
        return data;
      } catch (err) {
        lastErr = err;
        const typed = err instanceof MediaError;
        if (typed && err.code === 'RATE_LIMITED' && this.pauseOnRateLimit && err.retryAfterMs) {
          this.pauseUntil = Math.max(this.pauseUntil, this.now() + Math.min(err.retryAfterMs, this.maxWaitMs));
        }
        // 404 não repete; "inalcançável" (timeout/conexão) também não: a próxima tentativa esperaria outro timeout inteiro
        const retryable = typed && (err.code === 'RATE_LIMITED' || err.code === 'UPSTREAM') && !err.unreachable && !err.breakerOpen;
        if (!retryable || attempt === this.retries) break;
        const wait = Math.max(err.retryAfterMs || 0, this.backoffMs * 2 ** attempt);
        await this.sleep(Math.min(wait, 8000));
      }
    }
    this.breaker.failure(lastErr);
    throw lastErr;
  }
}

module.exports = SourceClient;
module.exports.BASE_DEFAULTS = BASE_DEFAULTS;
