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

// Sinopse curta (resumo leve da lista): corta em ponto de palavra e termina em reticências. O texto do catálogo já passou por
// stripHtml (sem tags nem entidades), então não há HTML/entidade para quebrar; cuida-se só de par substituto (emoji) e espaços.
function truncateText(value, max = 240) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= max * 0.6)
    cut = cut.slice(0, lastSpace); // volta ao fim da palavra anterior (se houver uma razoável)
  else if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1); // sem espaço: não deixa meio emoji
  cut = cut.replace(/[\s,;:.\-–—!?(]+$/, '');
  return cut ? `${cut}…` : '';
}

module.exports = { stripHtml, stripHtmlList, safeHttpUrl, truncateText };
