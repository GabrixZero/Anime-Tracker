// Testes S08: Markdown simples com spoiler (utils/markdown.js) — formatação, aninhamento e, principalmente, XSS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, toPlainText, toggleSpoiler } = require('../public/js/utils/markdown');

// Tags que o renderizador tem permissão de gerar. Qualquer outra no resultado = falha de segurança.
const ALLOWED_TAGS = new Set(['strong', 'em', 'blockquote', 'span']);
function tagsIn(html) {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map(m => m[1].toLowerCase());
}
function assertOnlySafeTags(html, label = '') {
  for (const t of tagsIn(html)) assert.ok(ALLOWED_TAGS.has(t), `${label} gerou <${t}>: ${html}`);
  // atributos só nos spans de spoiler, sempre os mesmos
  for (const m of html.matchAll(/<span\b([^>]*)>/g)) {
    assert.match(m[1], /^ class="md-spoiler" role="button" tabindex="0" aria-expanded="false" aria-label="[^"<>]*"$/, `${label} span com atributo estranho: ${m[0]}`);
  }
  for (const m of html.matchAll(/<(strong|em|blockquote)\b([^>]*)>/g)) {
    assert.ok(m[2] === '' || m[2] === ' class="md-quote"', `${label} <${m[1]}> com atributo: ${m[2]}`);
  }
}

test('negrito, itálico e os dois juntos', () => {
  assert.equal(render('**forte**'), '<strong>forte</strong>');
  assert.equal(render('*suave*'), '<em>suave</em>');
  assert.equal(render('***tudo***'), '<strong><em>tudo</em></strong>');
  assert.equal(render('um **negrito** e um *itálico* no meio'), 'um <strong>negrito</strong> e um <em>itálico</em> no meio');
});

test('asteriscos soltos ou colados em espaço continuam texto', () => {
  assert.equal(render('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(render('** sozinho **'), '** sozinho **');
  assert.equal(render('sem fechar **aqui'), 'sem fechar **aqui');
  assert.equal(render('a*b'), 'a*b');
});

test('citação: linhas com "> " viram blockquote, agrupadas', () => {
  assert.equal(render('> frase marcante'), '<blockquote class="md-quote">frase marcante</blockquote>');
  assert.equal(
    render('antes\n> linha 1\n> linha 2\ndepois'),
    'antes<blockquote class="md-quote">linha 1\nlinha 2</blockquote>depois'
  );
  // ">" no meio da linha não é citação
  assert.equal(render('1 > 0'), '1 &gt; 0');
});

test('spoiler: escondido até clicar, com acessibilidade básica', () => {
  const html = render('o vilão é >!o mordomo!<');
  assert.match(html, /^o vilão é <span class="md-spoiler" role="button" tabindex="0" aria-expanded="false" aria-label="[^"]+">o mordomo<\/span>$/);
  assert.equal(render('>!só isto!<').startsWith('<span class="md-spoiler"'), true, '">!" no começo da linha é spoiler, não citação');
  assert.equal(render('>!x!<').includes('blockquote'), false);
  // sem fechamento ou vazio: texto comum
  assert.equal(render('>!aberto'), '&gt;!aberto');
  assert.equal(render('>!!<'), '&gt;!!&lt;');
});

test('aninhamento: negrito/itálico dentro de citação e de spoiler, spoiler dentro de citação', () => {
  assert.equal(render('**negrito com *itálico* dentro**'), '<strong>negrito com <em>itálico</em> dentro</strong>');
  assert.match(render('>!segredo **forte** e *suave*!<'), />segredo <strong>forte<\/strong> e <em>suave<\/em><\/span>$/);
  const quote = render('> fala **dele** e >!spoiler!<');
  assert.match(quote, /^<blockquote class="md-quote">fala <strong>dele<\/strong> e <span class="md-spoiler"[^>]*>spoiler<\/span><\/blockquote>$/);
  // marcas que cruzam a fronteira do spoiler não geram HTML mal aninhado: viram texto
  const crossed = render('**a >!b**c!<');
  assert.ok(!crossed.includes('<strong>'), crossed);
  assertOnlySafeTags(crossed);
});

test('XSS: HTML cru é sempre escapado', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '"><script>alert(1)</script>',
    "'><img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">clique</a>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '</span><script>alert(1)</script>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '`<b>`'
  ];
  for (const a of attacks) {
    for (const wrapped of [a, `**${a}**`, `*${a}*`, `> ${a}`, `>!${a}!<`, `>!**${a}**!<`, `> >!${a}!<`]) {
      const html = render(wrapped);
      assert.ok(!/<(script|img|svg|iframe|a|div|b|style)\b/i.test(html), `tag perigosa em: ${html}`);
      assertOnlySafeTags(html, wrapped);
    }
  }
});

test('XSS: links e imagens do Markdown comum NÃO existem (javascript: vira texto)', () => {
  const html = render('[clique aqui](javascript:alert(1)) e ![x](javascript:alert(2)) e <javascript:alert(3)>');
  assert.ok(!html.includes('<a'));
  assert.ok(!html.includes('<img'));
  assert.ok(!/href\s*=/.test(html));
  assert.match(html, /\[clique aqui\]\(javascript:alert\(1\)\)/);
  assertOnlySafeTags(html);
});

test('XSS: atributos nunca recebem conteúdo do usuário (aspas e ">!" não escapam do span)', () => {
  const html = render('>!" onclick="alert(1)" x="!<');
  assertOnlySafeTags(html);
  assert.ok(html.includes('&quot;'), 'aspas do usuário viram &quot;');
  assert.ok(!/<span[^>]*onclick/.test(html));
  const html2 = render(">!'><img src=x onerror=alert(1)>!<");
  assert.ok(!html2.includes('<img'), html2);
  assertOnlySafeTags(html2);
});

test('entrada estranha não quebra: null, número, texto gigante e marcas em excesso', () => {
  assert.equal(render(null), '');
  assert.equal(render(undefined), '');
  assert.equal(render(123), '');
  assert.equal(render(''), '');
  for (const nasty of ['*'.repeat(30000), '**'.repeat(15000), '> '.repeat(15000), '>!'.repeat(15000), '!<'.repeat(15000), '*a '.repeat(10000), '** a '.repeat(8000)]) {
    const t0 = Date.now();
    const html = render(nasty);
    assert.ok(Date.now() - t0 < 1500, 'demorou demais (backtracking?)');
    assertOnlySafeTags(html);
  }
  assert.equal(render('linha 1\r\nlinha 2'), 'linha 1\nlinha 2');
});

test('toPlainText: tira as marcas e não vaza spoiler na prévia', () => {
  assert.equal(toPlainText('**forte** e *suave*'), 'forte e suave');
  assert.equal(toPlainText('> citado'), 'citado');
  assert.equal(toPlainText('o final: >!ele morre!< fim'), 'o final: [spoiler] fim');
  assert.equal(toPlainText('o final: >!ele morre!< fim', { hideSpoilers: false }), 'o final: ele morre fim');
  assert.equal(toPlainText(null), '');
});

test('toggleSpoiler revela e esconde, ajustando aria', () => {
  const attrs = new Map([['aria-expanded', 'false'], ['aria-label', 'Spoiler escondido']]);
  const classes = new Set();
  const el = {
    classList: { contains: (c) => classes.has(c), toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); } },
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k)
  };
  assert.equal(toggleSpoiler(el), true);
  assert.equal(classes.has('revealed'), true);
  assert.equal(attrs.get('aria-expanded'), 'true');
  assert.equal(attrs.has('aria-label'), false);
  assert.equal(toggleSpoiler(el), false);
  assert.equal(classes.has('revealed'), false);
  assert.equal(attrs.get('aria-expanded'), 'false');
  assert.ok(attrs.get('aria-label'));
  assert.equal(toggleSpoiler(null), false);
});
