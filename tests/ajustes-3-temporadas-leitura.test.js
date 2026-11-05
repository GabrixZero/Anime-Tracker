// Ajustes 3 · quadro de detalhe de série/anime: lista SÓ DE LEITURA com todas as temporadas e todos os episódios.
// O script real da view roda em `vm` com um DOM mínimo simulado (sem jsdom e sem rede).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'public');
const JS = path.join(ROOT, 'js');
const CHUNK = 60;

const episodes = (season, n) =>
  Array.from({ length: n }, (_, i) => ({
    episode_number: i + 1,
    name: `Episódio ${season}-${i + 1}`,
    air_date: i % 2 === 0 ? `2020-01-${String((i % 28) + 1).padStart(2, '0')}` : ''
  }));

// DOM mínimo: o contêiner guarda o HTML como texto; `details`/`ol` aceitam inserções e remoções por regex.
function makeApp(media) {
  const els = new Map();
  const container = {
    innerHTML: '',
    listeners: [],
    setAttribute() {},
    removeAttribute() {},
    addEventListener(type, fn, capture) {
      this.listeners.push({ type, fn, capture });
    },
    querySelector(sel) {
      const m = /^details\[data-season="(\d+)"\]$/.exec(sel);
      if (!m) return null;
      const n = m[1];
      if (!new RegExp(`<details class="season-block" data-season="${n}"`).test(container.innerHTML)) return null;
      return detailsStub(n);
    }
  };
  const blockRe = n => new RegExp(`(<details class="season-block" data-season="${n}"[^>]*>)([\\s\\S]*?)(</details>)`);
  const detailsStub = n => ({
    insertAdjacentHTML(where, html) {
      assert.equal(where, 'beforeend');
      container.innerHTML = container.innerHTML.replace(blockRe(n), (_, a, b, c) => a + b + html + c);
    },
    querySelector(sel) {
      const block = blockRe(n).exec(container.innerHTML)[2];
      if (sel === 'ol') {
        if (!block.includes('<ol')) return null;
        return {
          insertAdjacentHTML(where, html) {
            container.innerHTML = container.innerHTML.replace(blockRe(n), (_, a, b, c) =>
              where === 'beforeend' ? a + b.replace('</ol>', html + '</ol>') + c : a + b.replace('</ol>', '</ol>' + html) + c
            );
          }
        };
      }
      if (sel === '.episodes-more') {
        if (!block.includes('episodes-more')) return null;
        return {
          remove() {
            container.innerHTML = container.innerHTML.replace(
              blockRe(n),
              (_, a, b, c) => a + b.replace(/<div class="episodes-more">[\s\S]*?<\/div>/, '') + c
            );
          }
        };
      }
      return null;
    }
  });
  const stub = id => {
    if (id === 'show-episodes-container') return container;
    if (!els.has(id)) {
      els.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        style: {},
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        addEventListener() {},
        setAttribute() {},
        querySelector: () => null
      });
    }
    return els.get(id);
  };
  const ctx = {
    console,
    JSON,
    Math,
    Object,
    Array,
    Number,
    String,
    Map,
    Set,
    Date,
    Intl,
    isNaN,
    parseInt,
    Boolean,
    setTimeout: () => 0,
    clearTimeout() {},
    document: { getElementById: stub, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
  };
  ctx.window = ctx;
  ctx.appState = {
    getMedia: id => (Number(id) === media.id ? media : null),
    getTracked: () => null,
    hasDetail: () => true,
    isWatched: () => false
  };
  vm.createContext(ctx);
  [
    'utils/dom.js',
    'utils/mediaDisplay.js',
    'utils/viewKit.js',
    'utils/rating.js',
    'utils/watchStatus.js',
    'views/detailModalView.js'
  ].forEach(f => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf-8'), ctx, { filename: f }));
  return { ctx, container, view: ctx.detailModalView, els };
}

const count = (html, re) => (html.match(re) || []).length;

const SERIE = {
  id: 501,
  type: 'tv',
  name: 'Série <b>de</b> Teste',
  overview: 'Sinopse',
  genres: ['Drama'],
  first_air_date: '2020-01-01',
  vote_average: 7.5,
  seasons: [
    { season_number: 1, name: 'Temporada 1', episodes: episodes(1, 12) },
    { season_number: 2, name: 'Temporada 2', episodes: episodes(2, 1) },
    { season_number: 3, name: 'Temporada 3', episodes: episodes(3, 8) }
  ]
};

test('lista todas as temporadas em <details>, a primeira aberta, com a quantidade de episódios', () => {
  const { view, container } = makeApp(SERIE);
  view.open(SERIE.id, 'explore');
  const html = container.innerHTML;
  assert.equal(count(html, /<details class="season-block"/g), 3);
  assert.equal(count(html, /<details [^>]*\sopen>/g), 1);
  assert.match(html, /<details class="season-block" data-season="1" open><summary>Temporada 1 · 12 episódios<\/summary>/);
  assert.match(html, /<summary>Temporada 2 · 1 episódio<\/summary>/);
  assert.match(html, /<summary>Temporada 3 · 8 episódios<\/summary>/);
});

test('linha do episódio: "E1 · título · data" dentro de <ol>/<li>, sem botão, caixa de assistido, miniatura ou duração', () => {
  const { view, container } = makeApp(SERIE);
  view.open(SERIE.id, 'explore');
  const html = container.innerHTML;
  assert.match(html, /<ol class="episode-list" data-season-list="1">/);
  assert.match(
    html,
    /<li class="episode-line"><span class="episode-code">E1<\/span> · <span class="episode-name">Episódio 1-1<\/span> · <span class="episode-date">2020-01-01<\/span><\/li>/
  );
  // episódio sem data: sem o separador da data
  assert.match(
    html,
    /<li class="episode-line"><span class="episode-code">E2<\/span> · <span class="episode-name">Episódio 1-2<\/span><\/li>/
  );
  assert.equal(count(html, /<button/g), 0, 'nenhum botão na lista (12 episódios cabem num bloco)');
  assert.ok(
    !/checkbox|episode-check|quick-check|open-note|<img|episode-runtime|Anotação salva|Anotar|Progresso da Temporada|Marcar Temporada/.test(
      html
    )
  );
});

test('todos os episódios ficam alcançáveis: as temporadas fechadas desenham ao abrir (toggle) e só uma vez', () => {
  const { view, container } = makeApp(SERIE);
  view.open(SERIE.id, 'explore');
  assert.equal(count(container.innerHTML, /class="episode-line"/g), 12, 'só a temporada aberta tem linhas');
  const toggle = container.listeners.find(l => l.type === 'toggle');
  assert.ok(toggle && toggle.capture === true, 'toggle não borbulha: ouvinte na captura');
  const fakeDetails = n => ({ open: true, getAttribute: k => (k === 'data-season' ? String(n) : null) });
  toggle.fn({ target: fakeDetails(3) });
  toggle.fn({ target: fakeDetails(2) });
  toggle.fn({ target: fakeDetails(3) }); // reabrir não duplica
  assert.equal(count(container.innerHTML, /class="episode-line"/g), 12 + 8 + 1);
  assert.match(container.innerHTML, /Episódio 3-8/);
  toggle.fn({ target: { open: false, getAttribute: () => '1' } }); // fechar não faz nada
  assert.equal(count(container.innerHTML, /class="episode-line"/g), 21);
});

test('temporada de 1200 episódios: só o primeiro bloco (60) no início; "Mostrar mais" traz o resto aos poucos', () => {
  const big = { ...SERIE, id: 502, seasons: [{ season_number: 1, name: 'Temporada 1', episodes: episodes(1, 1200) }] };
  const { view, container } = makeApp(big);
  view.open(big.id, 'explore');
  assert.equal(count(container.innerHTML, /class="episode-line"/g), CHUNK);
  assert.match(container.innerHTML, /<summary>Temporada 1 · 1200 episódios<\/summary>/);
  assert.match(container.innerHTML, /data-action="more-episodes" data-season="1">Mostrar mais episódios \(faltam 1140\)</);
  assert.equal(count(container.innerHTML, /<button/g), 1);

  view.showMoreEpisodes(1);
  assert.equal(count(container.innerHTML, /class="episode-line"/g), CHUNK * 2);
  assert.match(container.innerHTML, /\(faltam 1080\)/);
  assert.equal(count(container.innerHTML, /episodes-more/g), 1, 'só um botão');
  for (let i = 0; i < 30; i++) view.showMoreEpisodes(1);
  assert.equal(count(container.innerHTML, /class="episode-line"/g), 1200);
  assert.ok(!/episodes-more/.test(container.innerHTML), 'sem botão quando acabou');
  assert.match(container.innerHTML, /Episódio 1-1200/);
});

test('o "Mostrar mais" sabe a temporada: cresce só a temporada pedida', () => {
  const two = {
    ...SERIE,
    id: 503,
    seasons: [
      { season_number: 1, name: 'Temporada 1', episodes: episodes(1, 100) },
      { season_number: 2, name: 'Temporada 2', episodes: episodes(2, 100) }
    ]
  };
  const { view, container } = makeApp(two);
  view.open(two.id, 'explore');
  const toggle = container.listeners.find(l => l.type === 'toggle');
  toggle.fn({ target: { open: true, getAttribute: () => '2' } });
  assert.equal(count(container.innerHTML, /class="episode-line"/g), CHUNK * 2);
  view.showMoreEpisodes(2);
  assert.equal(count(container.innerHTML, /Episódio 2-\d+</g), 100);
  assert.equal(count(container.innerHTML, /Episódio 1-\d+</g), CHUNK);
});

test('textos escapados e sem episódios: mensagens atuais continuam', () => {
  const evil = {
    ...SERIE,
    id: 504,
    seasons: [
      {
        season_number: 1,
        name: '<img src=x>',
        episodes: [{ episode_number: 1, name: '<script>x</script>', air_date: '2020-05-06T00:00:00Z' }]
      }
    ]
  };
  const a = makeApp(evil);
  a.view.open(evil.id, 'explore');
  assert.ok(!/<img|<script/.test(a.container.innerHTML));
  assert.match(a.container.innerHTML, /2020-05-06<\/span>/);
  assert.ok(!/T00:00/.test(a.container.innerHTML));

  const light = { ...SERIE, id: 505, seasons: undefined };
  const b = makeApp(light);
  b.view.open(light.id, 'explore');
  assert.match(b.container.innerHTML, /Carregando episódios/);
  const ext = { ...SERIE, id: 506, seasons: undefined, isExternal: true };
  const c = makeApp(ext);
  c.view.open(ext.id, 'explore');
  assert.match(c.container.innerHTML, /depois que a obra é adicionada/);
  const empty = { ...SERIE, id: 507, seasons: [] };
  const d = makeApp(empty);
  d.view.open(empty.id, 'explore');
  assert.match(d.container.innerHTML, /Nenhum episódio cadastrado/);
});

test('o HTML tem abas, barra de resumo e botões de temporada uma só vez (ids únicos); o modo explore os esconde', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  for (const id of [
    'show-seasons-tabs',
    'season-summary-bar',
    'season-stats-summary',
    'btn-batch-check-season',
    'btn-batch-uncheck-season',
    'show-episodes-container'
  ]) {
    assert.equal(count(html, new RegExp(`id="${id}"`, 'g')), 1, id);
  }
});
