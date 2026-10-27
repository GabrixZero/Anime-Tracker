// Testes S08: tabela única de emoções, textos sem dados inventados e rótulos honestos (HTML/JS estáticos).
// Os testes de estado (primeira visita vazia, "Carregar exemplo", histórico de versões) rodam o frontend real em
// tests/library-sync.test.js (usam o mesmo "aparelho" simulado).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Emotions = require('../public/js/utils/emotions');
const MD = require('../public/js/utils/mediaDisplay');

const pub = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(pub, ...p), 'utf8');
const html = read('index.html');

// ---------------------------------------------------------------- emoções

test('tabela de emoções: 5 ids únicos com rótulo e ícone, imutável', () => {
  assert.deepEqual(Emotions.IDS, ['awesome', 'fun', 'mindblown', 'sad', 'disappointed']);
  assert.equal(new Set(Emotions.LIST.map(e => e.label)).size, 5);
  assert.equal(new Set(Emotions.LIST.map(e => e.icon)).size, 5);
  for (const e of Emotions.LIST) assert.ok(e.id && e.label && e.icon);
  assert.throws(() => { 'use strict'; Emotions.LIST[0].label = 'outro'; }, TypeError);
  assert.equal(Emotions.label('fun'), 'Divertido');
  assert.equal(Emotions.label('disappointed'), 'Decepcionado');
  assert.equal(Emotions.withIcon('awesome'), '😍 Adorei');
  assert.equal(Emotions.label('qualquer-coisa'), 'qualquer-coisa', 'id desconhecido (backup antigo) não quebra');
  assert.equal(Emotions.label(null), '');
  assert.equal(Emotions.isEmotion('sad'), true);
  assert.equal(Emotions.isEmotion('__proto__'), false);
  assert.equal(Emotions.get('nao-existe'), null);
  assert.deepEqual(Emotions.emptyCounts(), { awesome: 0, fun: 0, mindblown: 0, sad: 0, disappointed: 0 });
});

test('modal de anotação e filtros do diário (index.html) usam exatamente a tabela de emoções', () => {
  const modal = [...html.matchAll(/<button type="button" class="emotion-btn" data-emotion="([a-z]+)" aria-pressed="false"><span class="emotion-emoji" aria-hidden="true">([^<]+)<\/span><span class="emotion-label">([^<]+)<\/span><\/button>/g)]
    .map(m => ({ id: m[1], icon: m[2], label: m[3] }));
  assert.deepEqual(modal, Emotions.LIST.map(e => ({ id: e.id, icon: e.icon, label: e.label })), 'botões do modal divergem de emotions.js');

  const filters = [...html.matchAll(/<button type="button" class="emotion-filter-btn type-pill-btn[^"]*" data-emotion="([a-z]+)" aria-pressed="(?:true|false)">([^<]+)<\/button>/g)]
    .map(m => ({ id: m[1], text: m[2] }))
    .filter(f => f.id !== 'all');
  assert.deepEqual(filters, Emotions.LIST.map(e => ({ id: e.id, text: `${e.icon} ${e.label}` })), 'filtros do diário divergem de emotions.js');
});

test('diário e estatísticas não repetem rótulos de emoção (leem a tabela)', () => {
  for (const f of ['diaryView.js', 'statsView.js']) {
    const src = read('js', 'views', f);
    assert.ok(/Emotions\./.test(src), `${f} não usa window.Emotions`);
    for (const old of ['Engraçado', 'Ruim', "'Adorei'", "'Chocado'", "'Triste'"]) assert.ok(!src.includes(old), `${f} ainda tem o rótulo fixo ${old}`);
  }
});

test('emotions.js, markdown.js e mediaDisplay.js carregam antes das views no index.html', () => {
  const at = (s) => html.indexOf(`<script src="js/utils/${s}.js">`);
  for (const s of ['emotions', 'markdown', 'mediaDisplay']) {
    assert.ok(at(s) > at('dom') && at(s) < html.indexOf('js/views/nextUpView.js'), `${s}.js fora de ordem`);
  }
});

// ---------------------------------------------------------------- nada inventado

test('mediaDisplay: sem nota, sem gênero, sem ano e sem duração não viram valores de enfeite', () => {
  assert.equal(MD.ratingBadge(8.46), '★ 8.5');
  for (const none of [null, undefined, '', 0, '0', NaN, 'abc']) assert.equal(MD.ratingBadge(none), 'Sem nota', String(none));
  assert.equal(MD.hasRating(0.1), true);
  assert.equal(MD.genresText(['Drama', 'Crime', 'Ação'], 2), 'Drama, Crime');
  assert.equal(MD.genresText([]), 'Sem gênero');
  assert.equal(MD.genresText(null), 'Sem gênero');
  assert.equal(MD.genresText(['', '  ']), 'Sem gênero');
  assert.equal(MD.yearText('2024-05-01'), '2024');
  assert.equal(MD.yearText(''), '');
  assert.equal(MD.yearText(null), '');
  assert.equal(MD.yearText('TBA'), '');
  assert.equal(MD.runtimeText(45), '45 min');
  assert.equal(MD.runtimeText(undefined), '');
  assert.equal(MD.runtimeText(0), '');
  assert.equal(MD.knownRuntime('x'), 0);
});

test('mediaDisplay: status em inglês das fontes externas é traduzido; o resto passa como veio', () => {
  assert.equal(MD.statusText('Running'), 'Em exibição');
  assert.equal(MD.statusText('Ended'), 'Finalizada');
  assert.equal(MD.statusText('To Be Determined'), 'A definir');
  assert.equal(MD.statusText('Finished Airing'), 'Finalizada');
  assert.equal(MD.statusText('Em Exibição'), 'Em Exibição');
  assert.equal(MD.statusText(''), '');
  assert.equal(MD.statusText(null), '');
});

test('imagem reserva é um arquivo local (nada de Unsplash nem de terceiros no frontend)', () => {
  for (const file of [MD.POSTER_PLACEHOLDER, MD.STILL_PLACEHOLDER]) {
    assert.ok(!/^[a-z]+:|^\/\//i.test(file), `${file} não é local`);
    assert.ok(fs.existsSync(path.join(pub, file)), `${file} não existe em public/`);
    assert.match(fs.readFileSync(path.join(pub, file), 'utf8'), /^<svg\b/);
  }
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|html|css|svg)$/.test(entry.name) && /unsplash/i.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(pub, p));
    }
  };
  walk(pub);
  assert.deepEqual(offenders, [], 'ainda há referência ao Unsplash');
});

test('views não inventam nota 8.0, duração 120/45 nem "Drama" como valor exibido', () => {
  const dir = path.join(pub, 'js', 'views');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/formatRating\(/.test(src), `${f} ainda usa formatRating com fallback`);
    // statsView mantém a estimativa (120/45 min) de propósito, e o index.html avisa isso ao usuário
    assert.ok(!/runtime\s*\|\|\s*(120|45)/.test(src) || f === 'statsView.js', `${f} inventa duração`);
    assert.ok(!/['"]Drama['"]/.test(src), `${f} inventa gênero`);
  }
});

// ---------------------------------------------------------------- rótulos

test('rótulos não vazam implementação nem prometem o que não existe', () => {
  for (const bad of ['Explorar API', 'Pesquisar API', 'TV Show Time Replica', 'TV Time Replica', 'Destaques da API', 'Catálogo da API', 'Local-First', 'persistência atômica', 'Blindagem', 'Auto-Save 350ms']) {
    assert.ok(!html.includes(bad), `index.html ainda tem "${bad}"`);
  }
  const explore = read('js', 'views', 'exploreView.js');
  assert.ok(!/da API/.test(explore), 'exploreView ainda cita "API" para o usuário');
  assert.match(html, /<span class="nav-long">Explorar<\/span>/);
  assert.match(html, />Pesquisar<\/button>/);
  assert.ok(!/id="user-cloud-badge">Sincronizado/.test(html), 'selo de sync não pode ser fixo no HTML');
});

test('estado vazio tem chamada para explorar e "Carregar exemplo" (lista e A Seguir)', () => {
  assert.match(html, /id="btn-watchlist-example"[^>]*data-action="load-example"/);
  assert.match(html, /id="watchlist-empty-title"/);
  const nextUp = read('js', 'views', 'nextUpView.js');
  assert.match(nextUp, /Carregar exemplo/);
  assert.match(nextUp, /data-action="load-example"/);
});

test('o editor tem botão de histórico e painel de versões; o diário renderiza Markdown', () => {
  assert.match(html, /id="btn-note-history"/);
  assert.match(html, /id="note-history-panel"/);
  assert.match(html, /id="note-history-list"/);
  assert.match(read('js', 'views', 'diaryView.js'), /NoteMarkdown\.render\(e\.text\)/);
  // a barra do editor insere exatamente a sintaxe que o renderizador entende
  for (const insert of ['data-insert="**"', 'data-insert="*"', 'data-insert="> "', 'data-insert=">!spoiler!<"']) assert.ok(html.includes(insert), insert);
});
