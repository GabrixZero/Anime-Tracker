// ================================================================
// SHOWVAULT · MARKDOWN SIMPLES COM SPOILER (S08, D-19)
//
// Sintaxe aceita (a mesma da barra do editor de anotações):
//   **negrito**   *itálico*   ***negrito e itálico***
//   > citação     (linha começando com "> ")
//   >!spoiler!<   (escondido até clicar)
//
// SEGURANÇA: o texto é ESCAPADO primeiro (escapeHtml, S01) e só depois as marcas viram HTML.
// As únicas tags geradas são fixas (strong, em, blockquote, span.md-spoiler) e nunca levam
// conteúdo do usuário em atributos. HTML livre, links e imagens NÃO existem: `<script>`,
// `<img onerror=...>` e `[x](javascript:...)` saem como texto comum.
//
// Script "dual": navegador (window.NoteMarkdown) e Node (module.exports), para ser testado sem build.
// Não usa lookbehind (Safari antigo) e limita o tamanho de cada trecho (sem backtracking caro).
// ================================================================

(function (root) {
  // O texto escapado tem ">" como "&gt;" e "<" como "&lt;"
  const SPOILER_OPEN = '&gt;!';
  const SPOILER_CLOSE = '!&lt;';
  const SPOILER_LABEL = 'Spoiler escondido. Pressione para revelar.';
  const MAX_RUN = 500; // tamanho máximo de um trecho em negrito/itálico (numa linha)

  function esc(value) {
    const fn = typeof root.escapeHtml === 'function' ? root.escapeHtml : require('./dom.js').escapeHtml;
    return fn(value);
  }

  // *itálico* (sem espaço colado nos asteriscos e sem asterisco dentro)
  const italic = (s) => s.replace(
    new RegExp(`\\*([^\\s*]|[^\\s*][^*\\n]{0,${MAX_RUN - 2}}?[^\\s*])\\*`, 'g'),
    '<em>$1</em>'
  );

  // ***negrito e itálico*** e **negrito** (dentro do negrito ainda pode haver *itálico*)
  function bolds(s) {
    const re = new RegExp(
      `\\*\\*\\*(\\S|\\S[^\\n]{0,${MAX_RUN - 2}}?\\S)\\*\\*\\*|\\*\\*(\\S|\\S[^\\n]{0,${MAX_RUN - 2}}?\\S)\\*\\*`,
      'g'
    );
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      out += italic(s.slice(last, m.index));
      out += m[1] !== undefined ? `<strong><em>${m[1]}</em></strong>` : `<strong>${italic(m[2])}</strong>`;
      last = m.index + m[0].length;
    }
    return out + italic(s.slice(last));
  }

  // Texto JÁ ESCAPADO -> HTML com spoilers (que podem conter negrito/itálico, mas nunca outro spoiler).
  function inline(s) {
    let out = '';
    let pos = 0;
    for (;;) {
      const a = s.indexOf(SPOILER_OPEN, pos);
      if (a < 0) break;
      const b = s.indexOf(SPOILER_CLOSE, a + SPOILER_OPEN.length);
      if (b < 0) break; // sem fechamento: fica como texto (e nada mais adiante pode fechar)
      const inner = s.slice(a + SPOILER_OPEN.length, b);
      const end = b + SPOILER_CLOSE.length;
      if (!inner.trim()) { // ">!!<" vazio: texto comum
        out += bolds(s.slice(pos, end));
        pos = end;
        continue;
      }
      out += bolds(s.slice(pos, a));
      out += `<span class="md-spoiler" role="button" tabindex="0" aria-expanded="false" aria-label="${SPOILER_LABEL}">${bolds(inner)}</span>`;
      pos = end;
    }
    return out + bolds(s.slice(pos));
  }

  // ">" no começo da linha é citação, exceto ">!" (começo de spoiler)
  const isQuote = (line) => line.charAt(0) === '>' && line.charAt(1) !== '!';
  const stripQuote = (line) => line.replace(/^> ?/, '');

  function render(text) {
    if (typeof text !== 'string' || text === '') return '';
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    for (const line of lines) {
      const quote = isQuote(line);
      const last = blocks[blocks.length - 1];
      if (last && last.quote === quote) last.lines.push(quote ? stripQuote(line) : line);
      else blocks.push({ quote, lines: [quote ? stripQuote(line) : line] });
    }

    let html = '';
    blocks.forEach((block, i) => {
      if (block.quote) {
        html += `<blockquote class="md-quote">${inline(esc(block.lines.join('\n')))}</blockquote>`;
        return;
      }
      const prev = blocks[i - 1];
      // a linha em branco logo depois de uma citação é só o respiro entre os blocos
      const body = prev && prev.quote && block.lines[0] === '' ? block.lines.slice(1) : block.lines;
      html += inline(esc(body.join('\n')));
    });
    return html;
  }

  // Texto sem marcas (prévia curta, listas). Por padrão o spoiler vira "[spoiler]" para não vazar.
  function toPlainText(text, { hideSpoilers = true } = {}) {
    if (typeof text !== 'string') return '';
    let s = text.replace(/\r\n?/g, '\n');
    s = s.split('\n').map(line => (isQuote(line) ? stripQuote(line) : line)).join('\n');
    let out = '';
    let pos = 0;
    for (;;) {
      const a = s.indexOf('>!', pos);
      if (a < 0) break;
      const b = s.indexOf('!<', a + 2);
      if (b < 0) break;
      out += s.slice(pos, a) + (hideSpoilers ? '[spoiler]' : s.slice(a + 2, b));
      pos = b + 2;
    }
    out += s.slice(pos);
    return out
      .replace(/\*\*\*(\S|\S[^\n]*?\S)\*\*\*/g, '$1')
      .replace(/\*\*(\S|\S[^\n]*?\S)\*\*/g, '$1')
      .replace(/\*([^\s*]|[^\s*][^*\n]*?[^\s*])\*/g, '$1');
  }

  // Revela/esconde o spoiler (clique ou Enter/Espaço). Também usado pelos testes.
  function toggleSpoiler(el) {
    if (!el || !el.classList) return false;
    const revealed = !el.classList.contains('revealed');
    el.classList.toggle('revealed', revealed);
    el.setAttribute('aria-expanded', revealed ? 'true' : 'false');
    if (revealed) el.removeAttribute('aria-label');
    else el.setAttribute('aria-label', SPOILER_LABEL);
    return revealed;
  }

  const api = { render, toPlainText, toggleSpoiler };
  root.NoteMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // Um único ouvido no documento cobre todos os spoilers (diário, prévias, qualquer tela).
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && !root.__noteMarkdownBound) {
    root.__noteMarkdownBound = true;
    const target = (e) => (e.target && e.target.closest ? e.target.closest('.md-spoiler') : null);
    document.addEventListener('click', (e) => {
      const el = target(e);
      if (el) toggleSpoiler(el);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = target(e);
      if (el) { e.preventDefault(); toggleSpoiler(el); }
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
