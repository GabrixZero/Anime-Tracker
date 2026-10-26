// Defesa em profundidade: dados externos (TVMaze é editável por qualquer pessoa)
// nunca entram no catálogo com HTML. O frontend também escapa tudo na saída.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#039': "'", nbsp: ' ' };

// Remove tags HTML, decodifica entidades simples e tira <, > restantes. Sempre devolve string.
function stripHtml(value, max = 5000) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // conteúdo de <script>/<style> não faz sentido como texto
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<[^>]*>?/g, ' ');
  s = s.replace(/&(amp|lt|gt|quot|apos|#0?39|nbsp);/gi, (_, e) => ENTITIES[e.toLowerCase()]);
  // decodificar pode recriar tags (&lt;b&gt;): remove de novo e descarta < e > soltos
  s = s.replace(/<[^>]*>?/g, ' ').replace(/[<>]/g, '');
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

function stripHtmlList(list, max = 100) {
  return Array.isArray(list) ? list.map(v => stripHtml(v, max)).filter(Boolean) : [];
}

// Só aceita URLs http(s); o resto vira o fallback.
function safeHttpUrl(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : fallback;
}

module.exports = { stripHtml, stripHtmlList, safeHttpUrl };
