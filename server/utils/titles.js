// Comparação de títulos para a busca (S06): normalização, relevância, chave de franquia e "é a mesma obra?".
// Funções puras. Não há correspondência difusa de propósito ("Frieden"/"Friheden" NÃO casam com "Frieren").

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

// minúsculas, sem acentos, sem pontuação; japonês/coreano/chinês e números são preservados.
function normalizeTitle(value) {
  return String(value ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Todos os nomes pelos quais a obra é conhecida (principal, original e alternativos), já normalizados e sem repetição.
function titlesOf(item) {
  if (!item) return [];
  const raw = [item.name, item.original_name, ...(Array.isArray(item.alt_titles) ? item.alt_titles : [])];
  const out = new Set();
  for (const t of raw) {
    const n = normalizeTitle(t);
    if (n) out.add(n);
    // "Ruptura (Severance)" também é conhecida como "Ruptura" e como "Severance"
    const paren = /^(.*?)\(([^)]+)\)\s*(.*)$/.exec(String(t ?? ''));
    if (paren) {
      for (const part of [`${paren[1]} ${paren[3]}`, paren[2]]) {
        const p = normalizeTitle(part);
        if (p) out.add(p);
      }
    }
  }
  return [...out];
}

// Pontuação de relevância de UM título normalizado contra a consulta normalizada (0 = não casa).
// 100 igual · 60..80 começa com a consulta · 50 contém a frase em limite de palavra · 30 todas as palavras, em qualquer ordem.
function scoreTitle(qn, tn) {
  if (!qn || !tn) return 0;
  if (tn === qn) return 100;
  const qTokens = qn.split(' ');
  const tTokens = tn.split(' ');
  const allMatch = qTokens.every(qt => (CJK.test(qt) ? tn.includes(qt) : tTokens.some(tt => tt.startsWith(qt))));
  if (!allMatch) return 0;
  const brevity = Math.min(20, (tn.length - qn.length) / 4); // título mais curto = mais próximo da consulta
  if (tn.startsWith(`${qn} `) || (CJK.test(qn) && tn.startsWith(qn))) return 80 - brevity;
  if (` ${tn} `.includes(` ${qn} `) || (CJK.test(qn) && tn.includes(qn))) return 55 - brevity / 2;
  return 30 - brevity / 4;
}

// Relevância de uma obra para a consulta: melhor pontuação entre todos os seus títulos.
// overviewHit (só obras locais): a consulta aparece na sinopse => relevância fraca (10), nunca acima de um título.
function relevance(query, item, { overviewHit = false } = {}) {
  const qn = normalizeTitle(query);
  if (!qn) return 0;
  let best = 0;
  for (const tn of titlesOf(item)) best = Math.max(best, scoreTitle(qn, tn));
  if (best === 0 && overviewHit && qn.length >= 3 && normalizeTitle(item.overview).includes(qn)) best = 10;
  return best;
}

// Tira marcas de temporada/parte do título normalizado: "attack on titan season 2" e "attack on titan the final season"
// viram a mesma chave. Subtítulos (": Junior High") ficam: são obras diferentes.
function franchiseKey(title) {
  let key = normalizeTitle(title);
  if (!key) return '';
  const patterns = [
    /\s(the\s)?final\sseason(\spart\s\d+)?$/,
    /\sseason\s\d+(\spart\s\d+)?$/,
    /\s\d+(st|nd|rd|th)\sseason(\spart\s\d+)?$/,
    /\s(part|cour)\s\d+$/,
    /\s\d+(st|nd|rd|th)\s(part|cour)$/,
    /\s(ii|iii|iv)$/,
    /\s[2-9]$/
  ];
  for (let i = 0; i < 4; i++) {
    const next = patterns.reduce((acc, p) => acc.replace(p, ''), key).trim();
    if (next === key || next.length < 2) break;
    key = next;
  }
  return key;
}

function yearOf(item) {
  const m = /^(\d{4})/.exec(String((item && item.first_air_date) || ''));
  return m ? Number(m[1]) : null;
}

function malIdsOf(item) {
  const ids = new Set();
  if (item && Array.isArray(item.mal_ids)) item.mal_ids.forEach(n => Number.isSafeInteger(n) && ids.add(n));
  if (item && Number.isSafeInteger(item.mal_id)) ids.add(item.mal_id);
  return ids;
}

// A e B são a mesma obra? (mesmo id da MAL; ou mesmo tipo + algum título normalizado em comum + anos compatíveis)
function sameWork(a, b) {
  if (!a || !b) return false;
  if (a.id !== undefined && a.id === b.id) return true;
  const ma = malIdsOf(a);
  for (const id of malIdsOf(b)) if (ma.has(id)) return true;
  if (a.type !== b.type) return false;
  const ya = yearOf(a);
  const yb = yearOf(b);
  if (ya && yb && Math.abs(ya - yb) > 1) return false;
  const tb = new Set(titlesOf(b));
  return titlesOf(a).some(t => tb.has(t));
}

module.exports = { normalizeTitle, titlesOf, scoreTitle, relevance, franchiseKey, yearOf, malIdsOf, sameWork };
