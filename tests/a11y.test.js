// S07 · Acessibilidade: garantias estáticas (HTML/CSS/JS) + util de diálogo com um DOM mínimo simulado.
// A verificação com teclado de verdade foi feita no navegador do app (ver diário da S07).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(pub, ...p), 'utf8');
const html = read('index.html');
const cssFiles = fs.readdirSync(path.join(pub, 'css')).filter(f => f.endsWith('.css'));
const viewFiles = fs.readdirSync(path.join(pub, 'js', 'views'));

// ---------- contraste dos tokens de cor ----------
function token(css, name) {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `token --${name} não encontrado (esperado #rrggbb)`);
  return m[1];
}
function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('textos principais, secundário e discreto têm contraste AA (>= 4,5:1) em todas as superfícies escuras', () => {
  const vars = read('css', 'variables.css');
  const surfaces = ['bg-app', 'bg-surface', 'bg-surface-elevated'].map(n => [n, token(vars, n)]);
  for (const t of ['text-main', 'text-secondary', 'text-muted', 'tvtime-yellow']) {
    for (const [name, bg] of surfaces) {
      const r = ratio(token(vars, t), bg);
      assert.ok(r >= 4.5, `--${t} sobre --${name}: ${r.toFixed(2)}:1 (< 4,5)`);
    }
  }
});

test('o anel de foco (amarelo) tem contraste >= 3:1 com o fundo (WCAG 1.4.11)', () => {
  const vars = read('css', 'variables.css');
  assert.ok(ratio(token(vars, 'tvtime-yellow'), token(vars, 'bg-app')) >= 3);
});

// ---------- foco visível ----------
test('existe :focus-visible global e nenhum "outline: none" sem substituto', () => {
  const a11y = read('css', 'a11y.css');
  assert.ok(/:focus-visible\s*\{[^}]*outline:\s*3px solid/.test(a11y), 'falta :focus-visible global com anel');
  const allowed = new Set(['.show-open-btn:focus-visible', '.next-up-card .link-btn:focus-visible', '.app-main:focus']); // anel desenhado em ::after / alvo não interativo
  for (const f of cssFiles) {
    const css = read('css', f);
    for (const m of css.matchAll(/([^{}]+)\{[^{}]*outline:\s*none/g)) {
      const sel = m[1].trim().split('\n').pop().trim();
      assert.ok(allowed.has(sel), `${f}: outline: none sem substituto em "${sel}"`);
    }
  }
});

test('prefers-reduced-motion continua desligando as animações', () => {
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(read('css', 'variables.css')));
});

// ---------- HTML ----------
test('index.html não repete ids', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, []);
});

test('os 4 modais têm role=dialog, aria-modal e aria-labelledby apontando para um id existente', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const modal of ['tvtime-auth-modal', 'modal-show-detail', 'modal-episode-note', 'modal-backup']) {
    const start = html.indexOf(`id="${modal}"`);
    assert.ok(start > 0, `${modal} não existe`);
    const chunk = html.slice(start, start + 700);
    const m = chunk.match(/role="dialog"\s+aria-modal="true"\s+aria-labelledby="([^"]+)"/);
    assert.ok(m, `${modal} sem role="dialog" aria-modal aria-labelledby`);
    // o rótulo pode ser criado por script (título da obra no modal de detalhes)
    if (modal !== 'modal-show-detail') assert.ok(ids.has(m[1]), `${modal}: aria-labelledby="${m[1]}" não existe`);
  }
  assert.ok(/id="detail-modal-title"/.test(read('js', 'views', 'detailModalView.js')), 'o título do modal de detalhes precisa do id detail-modal-title');
});

test('todo botão só de ícone/símbolo tem aria-label e todo <img> estático tem alt', () => {
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim();
    assert.ok(text || /aria-label="[^"]+"/.test(m[1]), `botão sem nome acessível: <button${m[1]}>`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) assert.ok(/\salt="/.test(m[0]), `img sem alt: ${m[0]}`);
});

test('navegação principal usa o padrão de abas (tablist/tab/tabpanel) e cada aba aponta para um painel', () => {
  assert.ok(/<nav[^>]*role="tablist"/.test(html));
  const tabs = [...html.matchAll(/<button[^>]*data-tab="([a-z-]+)"[^>]*>/g)];
  assert.equal(tabs.length, 5);
  for (const [tag, name] of tabs) {
    assert.ok(/role="tab"/.test(tag) && /aria-selected="(true|false)"/.test(tag), `aba ${name} sem role/aria-selected`);
    assert.ok(new RegExp(`id="view-${name}"[^>]*role="tabpanel"`).test(html), `painel view-${name} sem role="tabpanel"`);
  }
});

test('filtros usam aria-pressed; emoções do modal de nota também; toasts são região aria-live', () => {
  for (const m of html.matchAll(/<button[^>]*class="[^"]*(?:type-pill-btn|pill-btn|emotion-btn)[^"]*"[^>]*>/g)) {
    assert.ok(/aria-pressed="(true|false)"/.test(m[0]), `sem aria-pressed: ${m[0]}`);
  }
  assert.ok(/id="toast-container"[^>]*aria-live="polite"/.test(html));
});

test('há link de atalho para o conteúdo e um <h1>', () => {
  assert.ok(/class="skip-link" href="#main-content"/.test(html));
  assert.ok(/id="main-content"/.test(html));
  assert.ok(/<h1\b/.test(html));
});

test('modais e utilitários de acessibilidade estão ligados no HTML antes das views', () => {
  const iDialog = html.indexOf('js/utils/dialog.js');
  const iA11y = html.indexOf('js/utils/a11y.js');
  assert.ok(iDialog > 0 && iA11y > iDialog);
  assert.ok(iA11y < html.indexOf('js/controllers/appController.js'), 'a11y.js precisa registrar o DOMContentLoaded antes do appController');
  assert.ok(html.includes('css/a11y.css'));
});

test('nada clicável é <div>/<span>/<h*>/<img>: só elementos focáveis (botão, select) levam data-action (sem exceções, S10)', () => {
  const sources = [html, ...viewFiles.map(f => read('js', 'views', f))];
  for (const src of sources) {
    for (const m of src.matchAll(/<(div|span|h[1-6]|li|p|img)\b[^>]*\sdata-(?:change-)?action=[^>]*>/g)) {
      assert.fail(`elemento não focável com data-action: ${m[0].slice(0, 100)}`);
    }
  }
});

test('o botão do título do A Seguir cobre o cartão (substitui os cliques só-de-mouse da miniatura e do nome)', () => {
  const css = read('css', 'a11y.css');
  assert.ok(/\.next-up-card \.link-btn::after\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/.test(css));
  assert.ok(/\.next-up-card \.next-up-footer\s*\{[^}]*z-index:\s*2/.test(css), 'botões Assistido/Anotar ficam por cima');
  const view = read('js', 'views', 'nextUpView.js');
  assert.ok(!/next-up-thumb-wrap[^>]*data-action/.test(view) && !/next-up-show-name[^>]*data-action/.test(view));
});

test('o círculo de marcar episódio é um checkbox acessível (button role=checkbox + aria-checked)', () => {
  const src = read('js', 'views', 'detailModalView.js');
  assert.ok(/<button[^>]*class="episode-check"[^>]*role="checkbox"[^>]*aria-checked=/.test(src));
});

test('o seletor de arquivo do backup não usa display:none (teclado alcança)', () => {
  assert.ok(!/input\[type="file"\]\s*\{[^}]*display:\s*none/.test(read('css', 'views.css')));
});

// ---------- util de diálogo (DOM simulado) ----------
const { createDialogManager, nextFocusIndex, FOCUSABLE } = require('../public/js/utils/dialog.js');
const { nextTabIndex, groupOf, actionOf } = require('../public/js/utils/a11y.js');

class FakeEl {
  constructor(doc, tag, { focusable = false, id = '', cls = [] } = {}) {
    Object.assign(this, { doc, tagName: tag.toUpperCase(), children: [], parentElement: null, id, focusable });
    this.attrs = new Map();
    this.classes = new Set(cls);
    this.classList = {
      add: c => this.classes.add(c), remove: c => this.classes.delete(c),
      contains: c => this.classes.has(c)
    };
  }
  append(...kids) { kids.forEach(k => { k.parentElement = this; this.children.push(k); }); return this; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  contains(el) { return el === this || this.descendants().includes(el); }
  get isConnected() { return this.doc.root.contains(this); }
  querySelectorAll(sel) { return sel === FOCUSABLE ? this.descendants().filter(e => e.focusable && !e.hiddenByClass()) : []; }
  querySelector(sel) {
    const all = this.descendants();
    if (sel.startsWith('#')) return all.find(e => e.id === sel.slice(1)) || null;
    if (sel.startsWith('.')) return all.find(e => e.classes.has(sel.slice(1))) || null;
    if (sel.startsWith('[data-focus-key="')) return all.find(e => e.getAttribute('data-focus-key') === sel.slice(17, -2)) || null;
    return null;
  }
  hiddenByClass() { for (let e = this; e; e = e.parentElement) if (e.classes.has('hidden')) return true; return false; }
  getClientRects() { return this.hiddenByClass() ? [] : [1]; }
  focus() {
    if (this.hiddenByClass() || this.hasAttribute('inert')) return;
    this.doc.activeElement = this;
    this.doc.dispatch('focusin', { target: this });
  }
}

function buildPage() {
  const doc = { listeners: {}, activeElement: null };
  doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };
  doc.dispatch = (t, ev) => { (doc.listeners[t] || []).forEach(fn => fn(ev)); };
  doc.contains = el => doc.root.contains(el);
  doc.querySelector = sel => doc.root.querySelector(sel);
  const mk = (tag, o) => new FakeEl(doc, tag, o);
  doc.root = mk('html');
  doc.body = mk('body');
  doc.root.append(doc.body);
  doc.documentElement = doc.root;
  const app = mk('div', { id: 'app' });
  doc.body.append(app);
  const header = mk('header');
  const opener = mk('button', { focusable: true, id: 'opener' });
  header.append(opener);
  const toasts = mk('div', { id: 'toasts' });
  toasts.setAttribute('aria-live', 'polite');
  const overlay = mk('div', { id: 'dlg', cls: ['hidden'] });
  const box = mk('div', { cls: ['box'] });
  const first = mk('button', { focusable: true, id: 'first' });
  const field = mk('input', { focusable: true, id: 'field' });
  const last = mk('button', { focusable: true, id: 'last' });
  box.append(first, field, last);
  overlay.append(box);
  const overlay2 = mk('div', { id: 'dlg2', cls: ['hidden'] });
  const box2 = mk('div', { cls: ['box'] });
  const inner = mk('button', { focusable: true, id: 'inner' });
  box2.append(inner);
  overlay2.append(box2);
  app.append(header, toasts, overlay, overlay2);
  const key = (k, extra = {}) => {
    const ev = { key: k, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    doc.dispatch('keydown', ev);
    return ev;
  };
  const dm = createDialogManager(doc, {});
  return { doc, dm, app, header, opener, toasts, overlay, box, first, field, last, overlay2, box2, inner, key };
}

test('nextFocusIndex: Tab/Shift+Tab dão a volta no diálogo e puxam o foco de fora para dentro', () => {
  assert.equal(nextFocusIndex(3, 2, false, true), 0);
  assert.equal(nextFocusIndex(3, 0, true, true), 2);
  assert.equal(nextFocusIndex(3, 1, false, true), -1);
  assert.equal(nextFocusIndex(3, -1, false, false), 0);
  assert.equal(nextFocusIndex(3, -1, true, false), 2);
  assert.equal(nextFocusIndex(0, -1, false, false), -2);
});

test('nextTabIndex: setas, Home e End nas abas; chaves auxiliares', () => {
  assert.equal(nextTabIndex('ArrowRight', 4, 5), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 5), 4);
  assert.equal(nextTabIndex('Home', 3, 5), 0);
  assert.equal(nextTabIndex('End', 0, 5), 4);
  assert.equal(nextTabIndex('a', 0, 5), -1);
  assert.equal(groupOf('nu:12:check'), 'nu:12:');
  assert.equal(actionOf('nu:12:check'), 'check');
});

test('Dialog: abrir move o foco, deixa o fundo inerte (menos o aria-live) e prende o Tab', () => {
  const p = buildPage();
  p.dm.register(p.overlay, { dialog: '.box', initialFocus: '#field' });
  assert.equal(p.box.getAttribute('role'), 'dialog');
  assert.equal(p.box.getAttribute('aria-modal'), 'true');
  p.opener.focus();
  p.dm.open(p.overlay);
  assert.equal(p.doc.activeElement, p.field);
  assert.ok(p.header.hasAttribute('inert') && p.header.getAttribute('aria-hidden') === 'true');
  assert.ok(!p.toasts.hasAttribute('inert'), 'avisos aria-live não podem ficar inertes');
  assert.ok(!p.overlay.hasAttribute('inert'));

  p.last.focus();
  const ev = p.key('Tab');
  assert.ok(ev.defaultPrevented);
  assert.equal(p.doc.activeElement, p.first, 'Tab no último volta ao primeiro');
  p.key('Tab', { shiftKey: true });
  assert.equal(p.doc.activeElement, p.last, 'Shift+Tab no primeiro vai ao último');
  p.opener.doc.activeElement = p.opener; // foco "escapou" para fora
  p.key('Tab');
  assert.equal(p.doc.activeElement, p.first, 'foco de fora é puxado de volta');
});

test('Dialog: Esc fecha, devolve o foco ao gatilho e desfaz o inert', () => {
  const p = buildPage();
  p.dm.register(p.overlay, { dialog: '.box' });
  p.opener.focus();
  p.dm.open(p.overlay);
  assert.equal(p.doc.activeElement, p.first, 'sem initialFocus vai ao primeiro focável');
  p.key('Escape');
  assert.ok(p.overlay.classList.contains('hidden'));
  assert.equal(p.doc.activeElement, p.opener);
  assert.ok(!p.header.hasAttribute('inert') && !p.header.hasAttribute('aria-hidden'));
  assert.equal(p.dm.activeCount(), 0);
});

test('Dialog: se o gatilho foi redesenhado, volta ao elemento de mesmo data-focus-key; senão ao fallback', () => {
  const p = buildPage();
  p.opener.setAttribute('data-focus-key', 'wl:1:open');
  p.dm.register(p.overlay, { dialog: '.box', fallbackFocus: '#fb' });
  p.opener.focus();
  p.dm.open(p.overlay);
  // a tela é redesenhada: o botão antigo sai e um novo com a mesma chave entra
  p.header.children.length = 0;
  const novo = new FakeEl(p.doc, 'button', { focusable: true });
  novo.setAttribute('data-focus-key', 'wl:1:open');
  p.header.append(novo);
  p.dm.close(p.overlay);
  assert.equal(p.doc.activeElement, novo);

  // sem a chave e sem gatilho: usa o fallback
  const q = buildPage();
  const fb = new FakeEl(q.doc, 'button', { focusable: true, id: 'fb' });
  q.header.append(fb);
  q.dm.register(q.overlay, { dialog: '.box', fallbackFocus: '#fb' });
  q.opener.focus();
  q.dm.open(q.overlay);
  q.header.children.splice(q.header.children.indexOf(q.opener), 1);
  q.dm.close(q.overlay);
  assert.equal(q.doc.activeElement, fb);
});

test('Dialog: diálogo aberto sobre outro (nota sobre detalhes): só o do topo fecha com Esc e o de baixo volta a ficar ativo', () => {
  const p = buildPage();
  p.dm.register(p.overlay, { dialog: '.box' });
  p.dm.register(p.overlay2, { dialog: '.box' });
  p.opener.focus();
  p.dm.open(p.overlay);
  p.last.focus();
  p.dm.open(p.overlay2);
  assert.equal(p.doc.activeElement, p.inner);
  assert.ok(p.overlay.hasAttribute('inert'), 'o diálogo de baixo fica inerte');
  assert.ok(!p.overlay2.hasAttribute('inert'));
  p.key('Escape');
  assert.ok(p.overlay2.classList.contains('hidden'));
  assert.ok(!p.overlay.classList.contains('hidden'), 'o de baixo continua aberto');
  assert.ok(!p.overlay.hasAttribute('inert'));
  assert.ok(p.header.hasAttribute('inert'), 'a página ainda está inerte por causa do primeiro');
  assert.equal(p.doc.activeElement, p.last, 'foco volta ao gatilho dentro do primeiro');
  p.key('Escape');
  assert.equal(p.doc.activeElement, p.opener);
  assert.ok(!p.header.hasAttribute('inert'));
});

test('Dialog: se a pessoa já levou o foco para outro lugar, o fechamento não o rouba', () => {
  const p = buildPage();
  p.dm.register(p.overlay, { dialog: '.box' });
  p.opener.focus();
  p.dm.open(p.overlay);
  p.overlay.classList.add('hidden');
  const outro = new FakeEl(p.doc, 'button', { focusable: true });
  p.header.append(outro);
  outro.focus();
  p.dm.sync(p.overlay);
  assert.equal(p.doc.activeElement, outro);
});
