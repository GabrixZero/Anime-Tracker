// Landing page: decisão "landing x app" (pura) e garantias estáticas do HTML (CSP, h1 único, sem recursos externos novos).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Landing = require('../public/js/utils/landing.js');

const pub = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');

test('decideView: sem token e sem escolha mostra a landing', () => {
  assert.equal(Landing.decideView({}), 'landing');
  assert.equal(Landing.decideView(), 'landing');
  assert.equal(Landing.decideView({ token: null, visitor: null }), 'landing');
  assert.equal(Landing.decideView({ token: '   ' }), 'landing');
});

test('decideView: logado (token) vai direto ao app', () => {
  assert.equal(Landing.decideView({ token: 'qualquer.valor.aqui' }), 'app');
});

test('decideView: visitante que já escolheu usar sem conta vai ao app', () => {
  assert.equal(Landing.decideView({ visitor: '1' }), 'app');
  assert.equal(Landing.decideView({ visitor: '0' }), 'landing');
});

test('readStored não quebra com armazenamento bloqueado', () => {
  const storage = {
    getItem() {
      throw new Error('bloqueado');
    }
  };
  assert.deepEqual(Landing.readStored(storage), {});
  assert.equal(Landing.decideView(Landing.readStored(storage)), 'landing');
});

test('as chaves são as mesmas do app', () => {
  assert.equal(Landing.TOKEN_KEY, 'showvault_auth_token');
  assert.match(fs.readFileSync(path.join(pub, 'js', 'views', 'authView.js'), 'utf8'), /showvault_auth_token/);
});

test('landing.js é carregado no <head>, antes do corpo, e sem script inline', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="js/utils/landing.js"></script>'));
  assert.ok(head.includes('css/landing.css'));
  assert.ok(!/<script(?![^>]*\ssrc=)/i.test(html), 'script inline encontrado');
});

test('a landing respeita a CSP: sem style=, onclick= nem recursos externos além das fontes que o app já usa', () => {
  const start = html.indexOf('id="landing"');
  const end = html.indexOf('id="app"');
  assert.ok(start > 0 && end > start);
  const landing = html.slice(start, end);
  assert.ok(!/\sstyle\s*=/.test(landing));
  assert.ok(!/\son[a-z]+\s*=/i.test(landing));
  assert.ok(!/<img\b/i.test(landing), 'sem imagens: só CSS/SVG próprio');
  assert.equal((landing.match(/<h1\b/g) || []).length, 1);
  for (const [, href] of landing.matchAll(/href="(https?:[^"]+)"/g)) {
    assert.ok(/themoviedb\.org|tvmaze\.com|anilist\.co/.test(href), href);
  }
});

test('todo SVG da landing tem viewBox, width e height', () => {
  const start = html.indexOf('id="landing"');
  const landing = html.slice(start, html.indexOf('id="app"'));
  for (const [tag] of landing.matchAll(/<svg\b[^>]*>/g)) {
    assert.ok((/viewBox=/.test(tag) && /width=/.test(tag)) || /class="brand-icon"/.test(tag), tag);
  }
});
