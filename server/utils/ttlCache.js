// Cache em memória com validade (TTL) e tamanho máximo. Falhas nunca devem ser guardadas aqui (quem usa decide).
class TtlCache {
  constructor({ ttlMs = 10 * 60 * 1000, max = 200, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  get(key, ttlMs = this.ttlMs) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at >= ttlMs) { this.map.delete(key); return undefined; }
    return hit.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { at: this.now(), value });
  }

  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

module.exports = TtlCache;
