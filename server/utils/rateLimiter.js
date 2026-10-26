// Limitador simples em memória (janela deslizante por chave). Suficiente para uma instância única.

class RateLimiter {
  constructor({ windowMs = 10 * 60 * 1000, max = 30 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  // Registra uma tentativa. Retorna {ok:true} ou {ok:false, retryAfterSec}.
  hit(key, now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return { ok: true };
  }

  prune(now = Date.now()) {
    for (const [key, list] of this.hits) {
      if (!list.some(t => now - t < this.windowMs)) this.hits.delete(key);
    }
  }

  reset() {
    this.hits.clear();
  }
}

module.exports = RateLimiter;
