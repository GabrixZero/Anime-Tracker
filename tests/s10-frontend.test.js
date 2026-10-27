// S10 fase B: delegação de eventos (data-action), peças comuns das telas (ViewKit) e CSP sem 'unsafe-inline'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s10fe-'));
process.env.SHOWVAULT_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
delete process.env.STORAGE;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const pub = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(pub, ...p), 'utf8');
const html = read('index.html');
const viewFiles = fs.readdirSync(path.join(pub, 'js', 'views'));
const jsFiles = ['views', 'utils', 'controllers', 'services', 'models', 'api'].flatMap(d =>
  fs.readdirSync(path.join(pub, 'js', d)).map(f => ['js', d, f])
);

// ---------------------------------------------------------------- nada inline

test('nenhum onclick/onchange/onerror/style/javascript: inline no HTML nem nos templates do JS', () => {
  const sources = [['index.html', html], ...jsFiles.map(p => [p.join('/'), read(...p)])];
  for (const [name, src] of sources) {
    // comentários (// ...) podem citar os nomes; só vale o que está dentro de HTML de verdade
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(code), `${name}: manipulador on* inline`);
    assert.ok(!/<[a-z][^>]*\sstyle\s*=/i.test(code), `${name}: atributo style inline`);
    assert.ok(!/(href|src|action)\s*=\s*["']\s*javascript:/i.test(code), `${name}: URL javascript:`);
  }
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'index.html tem <script> inline');
  assert.ok(!/<style[\s>]/i.test(html), 'index.html tem <style> inline');
});

test('toda ação usada nos templates está registrada em actionHandlers.js (e vice-versa)', () => {
  const handlers = read('js', 'controllers', 'actionHandlers.js');
  const registeredClick = new Set([...handlers.matchAll(/A\.on\('([a-z-]+)'/g)].map(m => m[1]));
  const registeredChange = new Set([...handlers.matchAll(/A\.onChange\('([a-z-]+)'/g)].map(m => m[1]));
  const usedClick = new Set();
  const usedChange = new Set();
  for (const src of [html, ...viewFiles.map(f => read('js', 'views', f))]) {
    for (const m of src.matchAll(/\sdata-action="([a-z-]+)"/g)) usedClick.add(m[1]);
    for (const m of src.matchAll(/\sdata-change-action="([a-z-]+)"/g)) usedChange.add(m[1]);
  }
  for (const a of usedClick) assert.ok(registeredClick.has(a), `ação de clique sem handler: ${a}`);
  for (const a of usedChange) assert.ok(registeredChange.has(a), `ação de change sem handler: ${a}`);
  for (const a of registeredClick) assert.ok(usedClick.has(a), `handler de clique sem uso: ${a}`);
  for (const a of registeredChange) assert.ok(usedChange.has(a), `handler de change sem uso: ${a}`);
});

test('atributos S09 dos templates continuam (data-show-id, data-ep, data-focus-key)', () => {
  assert.ok(/data-show-id="\$\{toInt\(item\.showId\)\}"/.test(read('js', 'views', 'nextUpView.js')));
  assert.ok(/data-show-id="\$\{toInt\(media\.id\)\}"/.test(read('js', 'views', 'watchlistView.js')));
  assert.ok(/class="episode-row [^"]*" data-ep="/.test(read('js', 'views', 'detailModalView.js')));
  assert.ok(
    /data-action="retry-details"/.test(read('js', 'views', 'nextUpView.js')) &&
      /data-focus-key="nuload:retry"/.test(read('js', 'views', 'nextUpView.js'))
  );
  assert.ok(
    /data-action="load-more"/.test(read('js', 'views', 'exploreView.js')) &&
      /data-focus-key="ex:more:load"/.test(read('js', 'views', 'exploreView.js'))
  );
});

test('scripts novos estão no HTML na ordem certa', () => {
  const idx = f => html.indexOf(`js/${f}`);
  assert.ok(idx('utils/actions.js') > idx('utils/dom.js'));
  assert.ok(idx('utils/viewKit.js') > idx('utils/mediaDisplay.js') && idx('utils/viewKit.js') < idx('views/nextUpView.js'));
  assert.ok(idx('controllers/actionHandlers.js') > idx('controllers/appController.js'));
});

test('as 101 classes de largura das barras de progresso existem (.pct-0 a .pct-100)', () => {
  const css = read('css', 'views.css');
  for (let i = 0; i <= 100; i++) assert.ok(css.includes(`.pct-${i} { width: ${i}%; }`), `.pct-${i}`);
});

// ---------------------------------------------------------------- Actions (DOM simulado)

function fakeDoc() {
  const listeners = {};
  return {
    listeners,
    addEventListener: (type, fn, capture) => {
      (listeners[type] = listeners[type] || []).push({ fn, capture: !!capture });
    },
    fire(type, target) {
      for (const l of listeners[type] || []) l.fn({ type, target });
    }
  };
}
// Elemento mínimo: atributos + closest() subindo pela cadeia de pais
function el(attrs = {}, parent = null, extra = {}) {
  const e = {
    parent,
    attrs: { ...attrs },
    tagName: extra.tag || 'BUTTON',
    disabled: !!extra.disabled,
    value: extra.value,
    getAttribute: k => (k in e.attrs ? e.attrs[k] : null),
    setAttribute: (k, v) => {
      e.attrs[k] = v;
    },
    closest(sel) {
      const name = sel.slice(1, -1);
      for (let n = e; n; n = n.parent) if (name in n.attrs) return n;
      return null;
    }
  };
  return e;
}

test('Actions: clique delegado acha o data-action mais próximo, passa os parâmetros e respeita disabled', () => {
  const { createActionRouter } = require('../public/js/utils/actions');
  const doc = fakeDoc();
  const A = createActionRouter(doc);
  const calls = [];
  A.on('open', target => calls.push(['open', A.int(target, 'show'), A.int(target, 'season')]));

  const card = el({ 'data-action': 'open', 'data-show': '7', 'data-season': '0' });
  const inner = el({}, card, { tag: 'SPAN' }); // clique no ícone dentro do botão
  doc.fire('click', inner);
  assert.deepEqual(calls, [['open', 7, 0]], 'temporada 0 é válida');

  doc.fire('click', el({})); // sem data-action
  doc.fire('click', el({ 'data-action': 'desconhecida' }));
  doc.fire('click', el({ 'data-action': 'open', 'data-show': '1' }, null, { disabled: true }));
  assert.equal(calls.length, 1);

  assert.equal(A.int(el({ 'data-show': 'abc' }), 'show'), null);
  assert.equal(A.int(el({ 'data-show': '1.5' }), 'show'), null);
  assert.equal(A.int(el({}), 'show'), null);
  assert.deepEqual(A.names(), { click: ['open'], change: [] });
});

test('Actions: change, erro de handler não derruba os outros e fallback de imagem sem laço', () => {
  const { createActionRouter } = require('../public/js/utils/actions');
  const doc = fakeDoc();
  const A = createActionRouter(doc);
  const seen = [];
  A.onChange('status', target => seen.push([A.int(target, 'show'), target.value]));
  A.on('boom', () => {
    throw new Error('x');
  });
  const origError = console.error;
  console.error = () => {};
  try {
    doc.fire('click', el({ 'data-action': 'boom' })); // não propaga
  } finally {
    console.error = origError;
  }
  doc.fire('change', el({ 'data-change-action': 'status', 'data-show': '9' }, null, { tag: 'SELECT', value: 'paused' }));
  doc.fire('click', el({ 'data-change-action': 'status' })); // change-action não responde a clique
  assert.deepEqual(seen, [[9, 'paused']]);

  A.fallbacks.poster = 'img/poster-placeholder.svg';
  const errorListener = doc.listeners.error[0];
  assert.equal(errorListener.capture, true, '"error" não borbulha: precisa de captura');
  const img = el({ src: 'https://x/quebrada.jpg', 'data-fallback': 'poster' }, null, { tag: 'IMG' });
  doc.fire('error', img);
  assert.equal(img.getAttribute('src'), 'img/poster-placeholder.svg');
  doc.fire('error', img); // a própria reserva falhou: não troca de novo
  assert.equal(img.getAttribute('src'), 'img/poster-placeholder.svg');
  const other = el({ src: 'a.jpg' }, null, { tag: 'IMG' }); // sem data-fallback
  doc.fire('error', other);
  assert.equal(other.getAttribute('src'), 'a.jpg');
});

// ---------------------------------------------------------------- ViewKit

test('ViewKit: selo de tipo, imagem com reserva, chave de episódio, barra de progresso e tela vazia', () => {
  const VK = require('../public/js/utils/viewKit');
  assert.equal(VK.typeBadge('movie'), '<span class="badge-type-tag badge-type-movie">Filme</span>');
  assert.equal(VK.typeBadge('anime'), '<span class="badge-type-tag badge-type-anime">Anime</span>');
  assert.equal(VK.typeBadge('tv'), '<span class="badge-type-tag badge-type-tv">Série</span>');
  assert.equal(VK.typeBadge('algo-estranho'), VK.typeBadge('tv'));

  assert.equal(VK.imgAttrs('https://image.tmdb.org/a.jpg'), 'src="https://image.tmdb.org/a.jpg" data-fallback="poster"');
  assert.equal(VK.imgAttrs('javascript:alert(1)', 'still'), 'src="img/still-placeholder.svg" data-fallback="still"');
  assert.equal(VK.imgAttrs('', 'poster'), 'src="img/poster-placeholder.svg" data-fallback="poster"');
  const hostile = VK.imgAttrs('https://x.com/a.jpg" onerror="alert(1)');
  assert.ok(!/"\sonerror=/.test(hostile), hostile);

  assert.deepEqual(VK.parseKey('155_movie'), { showId: 155, seasonNum: null, epNum: null, isMovie: true });
  assert.deepEqual(VK.parseKey('1396_s2_e13'), { showId: 1396, seasonNum: 2, epNum: 13, isMovie: false });
  assert.deepEqual(VK.parseKey('10000001_s0_e1'), { showId: 10000001, seasonNum: 0, epNum: 1, isMovie: false });
  for (const bad of ['', 'x', '1_s1', '1_s1_e', 'a_s1_e1', '1_movie_x', '1_s1_e1_', null, undefined, 12])
    assert.equal(VK.parseKey(bad), null, String(bad));
  assert.equal(VK.makeKey(5, 1, 2), '5_s1_e2');
  assert.equal(VK.makeKey(5, null, null, true), '5_movie');
  assert.equal(VK.parseKey(VK.makeKey(7, 3, 4)).epNum, 4);

  assert.equal(VK.pctClass(0), 'pct-0');
  assert.equal(VK.pctClass(33.6), 'pct-34');
  assert.equal(VK.pctClass(100), 'pct-100');
  assert.equal(VK.pctClass(250), 'pct-100');
  assert.equal(VK.pctClass(-5), 'pct-0');
  assert.equal(VK.pctClass(NaN), 'pct-0');
  assert.equal(VK.pctClass('"><script>'), 'pct-0');

  const empty = VK.emptyStateHtml({
    iconSvg: '<svg></svg>',
    title: 'A <b>b</b>',
    text: 'c & d',
    narrow: true,
    actionsHtml: '<button>x</button>'
  });
  assert.ok(empty.includes('<svg></svg>') && empty.includes('empty-text empty-text--narrow') && empty.includes('<button>x</button>'));
  assert.ok(empty.includes('A &lt;b&gt;b&lt;/b&gt;') && empty.includes('c &amp; d'), 'título e texto são escapados');
});

// ---------------------------------------------------------------- CSP

const { buildCspDirectives } = require('../server/config/csp');

test('CSP: sem unsafe-inline/unsafe-eval em scripts e estilos; só o necessário liberado', () => {
  for (const isProduction of [false, true]) {
    const d = buildCspDirectives({ isProduction });
    for (const key of ['scriptSrc', 'styleSrc', 'defaultSrc']) {
      assert.ok(!d[key].some(v => /unsafe-|\*/.test(v)), `${key} não pode ter unsafe-* nem curinga`);
    }
    assert.deepEqual(d.scriptSrc, ["'self'", 'https://accounts.google.com/gsi/client']);
    assert.ok(d.styleSrc.includes('https://fonts.googleapis.com'));
    assert.ok(d.fontSrc.includes('https://fonts.gstatic.com'));
    assert.deepEqual(d.objectSrc, ["'none'"]);
    assert.deepEqual(d.frameAncestors, ["'none'"]);
    assert.equal('upgradeInsecureRequests' in d, isProduction);
  }
});

test('CSP: com login Google configurado, só ESTILOS inline são aceitos (scripts continuam estritos)', () => {
  const off = buildCspDirectives({ isProduction: false });
  const on = buildCspDirectives({ isProduction: false, googleEnabled: true });
  assert.ok(!off.styleSrc.includes("'unsafe-inline'"));
  assert.ok(on.styleSrc.includes("'unsafe-inline'"));
  assert.deepEqual(on.scriptSrc, off.scriptSrc);
  assert.ok(!on.scriptSrc.some(v => /unsafe-/.test(v)));
});

test('CSP: o servidor envia o cabeçalho em páginas e na API, e o HTML servido cabe nela', async t => {
  const app = require('../server/app');
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['/', '/health', '/api/media/trending', '/css/views.css']) {
    const res = await fetch(base + route);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, `${route} sem Content-Security-Policy`);
    assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client(;|$)/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), `${route}: ${csp}`);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
  }

  // Tudo que o index.html carrega é do próprio site, de Google Fonts, ou das origens liberadas
  const page = await (await fetch(base + '/')).text();
  const external = [...page.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => new URL(m[1]).origin);
  const allowed = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  for (const origin of external) assert.ok(allowed.has(origin), `origem não prevista na CSP: ${origin}`);
  // e cada arquivo local referenciado existe e é servido
  for (const m of page.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) {
    assert.equal((await fetch(`${base}/${m[1]}`)).status, 200, m[1]);
  }
});
