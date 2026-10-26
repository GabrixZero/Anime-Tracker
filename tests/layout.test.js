// S05 · Layout e mobile: garantias estáticas (HTML/CSS). A verificação visual é feita no navegador.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(pub, ...p), 'utf8');
const cssFiles = fs.readdirSync(path.join(pub, 'css')).filter(f => f.endsWith('.css'));
const allCss = cssFiles.map(f => read('css', f)).join('\n');
const html = read('index.html');

test('index.html não usa mais estilos inline (grades, cabeçalhos e modais vão para classes)', () => {
  assert.equal((html.match(/\sstyle="/g) || []).length, 0, 'ainda há style="..." no index.html');
  assert.ok(!/grid-template-columns/.test(html), 'grade inline no HTML');
});

test('templates das views só usam style inline para larguras dinâmicas (width: N%)', () => {
  const dir = path.join(pub, 'js', 'views');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const inline = src.match(/style="[^"]*"/g) || [];
    for (const s of inline) {
      assert.ok(/^style="width: \$\{[a-zA-Z]+\}%;?"$/.test(s), `${f} tem estilo inline: ${s}`);
    }
  }
});

test('CSS define os breakpoints reais (<=480, <=768, <=1024) e a barra de abas inferior', () => {
  const layout = read('css', 'layout.css');
  for (const bp of ['480px', '768px', '1024px']) {
    assert.ok(new RegExp(`@media \\(max-width: ${bp}\\)`).test(layout), `falta @media (max-width: ${bp}) em layout.css`);
  }
  assert.ok(/\.main-nav\s*\{[^}]*position:\s*fixed/.test(layout), 'a navegação deve virar barra fixa no celular');
  assert.ok(/<meta name="viewport"[^>]*viewport-fit=cover/.test(html), 'viewport sem viewport-fit=cover (área segura do notch)');
});

test('as 5 abas existem na navegação e têm rótulo curto para a barra inferior', () => {
  const tabs = html.match(/class="nav-tab[^"]*"\s+data-tab="[a-z-]+"/g) || [];
  assert.equal(tabs.length, 5);
  assert.equal((html.match(/class="nav-short"/g) || []).length, 4);
});

test('prefers-reduced-motion desliga animações e a entrada das abas é curta', () => {
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(allCss));
  const m = read('css', 'layout.css').match(/\.tab-content\.active\s*\{[^}]*animation:\s*fadeIn\s+([0-9.]+)s/);
  assert.ok(m && parseFloat(m[1]) <= 0.2, 'animação de entrada das abas deve ser <= 0,2 s');
  assert.ok(/@keyframes fadeIn\s*\{\s*from\s*\{\s*opacity:\s*0\.[4-9]/.test(read('css', 'layout.css')), 'a entrada não pode partir de opacity 0 (tela escura)');
});

test('nenhum texto do CSS fica abaixo de 0,8rem (metadados legíveis)', () => {
  const small = [];
  for (const f of cssFiles) {
    const css = read('css', f);
    for (const m of css.matchAll(/font-size:\s*([0-9.]+)rem/g)) {
      if (parseFloat(m[1]) < 0.8) small.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(small, []);
});

test('o CSS novo tem chaves balanceadas e todos os arquivos estão ligados no HTML', () => {
  for (const f of cssFiles) {
    const css = read('css', f);
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, `${f} com chaves desbalanceadas`);
    assert.ok(html.includes(`css/${f}`), `${f} não está no index.html`);
  }
});
