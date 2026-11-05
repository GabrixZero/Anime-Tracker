// S15 · Agenda: cálculo de datas (dia civil), períodos, ordenação e a lista de episódios; mais a conferência do HTML/CSP da nova aba.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../public/js/utils/calendar');

const pub = path.join(__dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(pub, ...p), 'utf8');

// ---------------------------------------------------------------- datas

test('parseDay valida de verdade (dias que não existem viram null)', () => {
  assert.deepEqual(C.parseDay('2026-11-04'), { y: 2026, m: 11, d: 4 });
  assert.equal(C.parseDay('2026-02-30'), null);
  assert.equal(C.parseDay('2026-13-01'), null);
  assert.equal(C.parseDay('2026-00-10'), null);
  assert.equal(C.parseDay('2026-4-1'), null);
  assert.equal(C.parseDay('2026-11-04T10:00:00Z'), null);
  assert.equal(C.parseDay(''), null);
  assert.equal(C.parseDay(null), null);
  assert.equal(C.parseDay(20261104), null);
});

test('ano bissexto: 29/02 existe só em ano bissexto', () => {
  assert.ok(C.parseDay('2028-02-29'));
  assert.equal(C.parseDay('2026-02-29'), null);
  assert.equal(C.parseDay('2100-02-29'), null); // 2100 não é bissexto
  assert.ok(C.parseDay('2000-02-29'));
  assert.equal(C.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(C.addDays('2026-02-28', 1), '2026-03-01');
});

test('addDays e diffDays: virada de mês e de ano, valores negativos', () => {
  assert.equal(C.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(C.addDays('2026-11-04', 0), '2026-11-04');
  assert.equal(C.addDays('2026-11-04', 29), '2026-12-03');
  assert.equal(C.addDays('lixo', 1), null);
  assert.equal(C.diffDays('2026-12-31', '2027-01-02'), 2);
  assert.equal(C.diffDays('2026-11-04', '2026-11-01'), -3);
  assert.equal(C.diffDays('2028-02-28', '2028-03-01'), 2);
  assert.equal(C.diffDays('x', '2026-11-01'), null);
});

test('startOfWeek / weekRange: a semana vai de segunda a domingo (virada domingo -> segunda)', () => {
  // 2026-11-04 é quarta-feira
  assert.equal(C.weekday('2026-11-04'), 3);
  assert.equal(C.startOfWeek('2026-11-04'), '2026-11-02');
  assert.equal(C.startOfWeek('2026-11-02'), '2026-11-02'); // segunda
  assert.equal(C.startOfWeek('2026-11-08'), '2026-11-02'); // domingo ainda é da semana anterior
  assert.equal(C.startOfWeek('2026-11-09'), '2026-11-09'); // a segunda seguinte abre outra semana
  assert.deepEqual(C.weekRange('2026-11-08'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(C.weekRange('2026-11-09'), { from: '2026-11-09', to: '2026-11-15' });
  // semana que cruza o ano
  assert.deepEqual(C.weekRange('2027-01-01'), { from: '2026-12-28', to: '2027-01-03' });
  assert.equal(C.weekRange('xx'), null);
});

test('rangeBounds: week, next7, next30 (e all, que não tem fim)', () => {
  assert.deepEqual(C.rangeBounds('2026-11-04', 'all'), { from: '2026-08-06', to: null });
  assert.deepEqual(C.rangeBounds('2026-11-04', 'week'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(C.rangeBounds('2026-11-04', 'next7'), { from: '2026-11-04', to: '2026-11-10' });
  assert.deepEqual(C.rangeBounds('2026-11-04', 'next30'), { from: '2026-11-04', to: '2026-12-03' });
  assert.equal(C.rangeBounds('invalido', 'week'), null);
});

test('dayKey usa o dia civil do fuso LOCAL (rodado em processos com TZ diferente)', () => {
  const run = tz =>
    execFileSync(
      process.execPath,
      [
        '-e',
        "const C = require(process.argv[1]); console.log(C.dayKey(new Date('2026-11-05T02:30:00Z')) + ' ' + C.dayKey(new Date('2026-11-05T23:30:00Z')))",
        path.join(pub, 'js', 'utils', 'calendar.js')
      ],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8' }
    ).trim();
  assert.equal(run('America/Sao_Paulo'), '2026-11-04 2026-11-05'); // UTC-3: 02:30Z ainda é dia 4 à noite
  assert.equal(run('UTC'), '2026-11-05 2026-11-05');
  assert.equal(run('Asia/Tokyo'), '2026-11-05 2026-11-06'); // UTC+9: 23:30Z já é dia 6
  assert.equal(C.dayKey(new Date('lixo')), null);
  assert.equal(C.dayKey('2026-11-05'), null);
});

// ---------------------------------------------------------------- agenda

const HOJE = '2026-11-04'; // quarta-feira

const ep = (season, number, airDate, name = `Ep ${number}`) => ({ season, number, airDate, name });
const show = (id, name, type, eps, extra = {}) => {
  const seasons = [];
  for (const e of eps) {
    let s = seasons.find(x => x.season_number === e.season);
    if (!s) seasons.push((s = { season_number: e.season, episodes: [] }));
    s.episodes.push({ episode_number: e.number, name: e.name, air_date: e.airDate });
  }
  return { id, name, type, status: 'Em Exibição', seasons, ...extra };
};

function make(medias, { watched = [], statuses = {} } = {}) {
  const byId = new Map(medias.map(m => [m.id, m]));
  const tracked = medias.map(m => ({ showId: m.id, status: statuses[m.id] || 'watching' }));
  const watchedSet = new Set(watched);
  const keyOf = (id, s, e) => (s === undefined ? `${id}_movie` : `${id}_s${s}_e${e}`);
  return {
    tracked,
    getMedia: id => byId.get(id) || null,
    isWatched: (id, s, e) => watchedSet.has(keyOf(id, s, e)),
    includeTracked: t => t.status !== 'dropped',
    build(range) {
      return C.buildAgenda(tracked, this.getMedia, this.isWatched, HOJE, { range, includeTracked: this.includeTracked });
    }
  };
}

test('buildAgenda: intervalos week / next7 / next30 (limites inclusivos)', () => {
  const m = show(1, 'Série A', 'tv', [
    ep(1, 1, '2026-11-01'), // domingo anterior: fora de tudo
    ep(1, 2, '2026-11-02'), // segunda: dentro da semana, passado
    ep(1, 3, '2026-11-04'), // hoje
    ep(1, 4, '2026-11-08'), // domingo: último dia da semana
    ep(1, 5, '2026-11-09'), // segunda seguinte
    ep(1, 6, '2026-11-10'), // hoje+6: último do next7
    ep(1, 7, '2026-11-11'), // hoje+7
    ep(1, 8, '2026-12-03'), // hoje+29: último do next30
    ep(1, 9, '2026-12-04') // hoje+30: fora
  ]);
  const a = make([m]);
  assert.deepEqual(
    a.build('week').map(i => i.episodeNumber),
    [2, 3, 4]
  );
  assert.deepEqual(
    a.build('next7').map(i => i.episodeNumber),
    [3, 4, 5, 6]
  );
  assert.deepEqual(
    a.build('next30').map(i => i.episodeNumber),
    [3, 4, 5, 6, 7, 8]
  );
  const first = a.build('week')[1];
  assert.deepEqual(first, {
    showId: 1,
    showName: 'Série A',
    type: 'tv',
    seasonNumber: 1,
    episodeNumber: 3,
    title: 'Ep 3',
    airDate: '2026-11-04',
    watched: false,
    daysFromToday: 0
  });
  assert.equal(a.build('week')[0].daysFromToday, -2);
});

test('buildAgenda: ordena por data, depois nome, temporada e episódio', () => {
  const b = show(2, 'Bravo', 'anime', [ep(2, 1, '2026-11-05'), ep(1, 3, '2026-11-05'), ep(1, 2, '2026-11-05')]);
  const a = show(3, 'Alfa', 'tv', [ep(1, 1, '2026-11-05'), ep(1, 1, '2026-11-04')]);
  const out = make([b, a])
    .build('next7')
    .map(i => `${i.airDate} ${i.showName} T${i.seasonNumber}E${i.episodeNumber}`);
  assert.deepEqual(out, [
    '2026-11-04 Alfa T1E1',
    '2026-11-05 Alfa T1E1',
    '2026-11-05 Bravo T1E2',
    '2026-11-05 Bravo T1E3',
    '2026-11-05 Bravo T2E1'
  ]);
});

test('buildAgenda: episódio sem data (ou com data inválida) é ignorado, nada é inventado', () => {
  const m = show(1, 'Sem Data', 'tv', [ep(1, 1, null), ep(1, 2, ''), ep(1, 3, '2026-02-30'), ep(1, 4, 'amanhã'), ep(1, 5, '2026-11-05')]);
  const out = make([m]).build('next7');
  assert.deepEqual(
    out.map(i => i.episodeNumber),
    [5]
  );
});

test('buildAgenda: aceita air_date com hora (usa só o dia)', () => {
  const m = show(1, 'ISO', 'tv', [ep(1, 1, '2026-11-05T00:00:00.000Z')]);
  assert.equal(make([m]).build('next7')[0].airDate, '2026-11-05');
});

test('buildAgenda: episódio assistido vem marcado', () => {
  const m = show(1, 'Marcada', 'tv', [ep(1, 1, '2026-11-04'), ep(1, 2, '2026-11-05')]);
  const out = make([m], { watched: ['1_s1_e1'] }).build('next7');
  assert.deepEqual(
    out.map(i => i.watched),
    [true, false]
  );
});

test('buildAgenda: todos os status entram, menos Desisti', () => {
  const medias = ['a', 'b', 'c', 'd', 'e'].map((n, i) => show(i + 1, `Obra ${n}`, 'tv', [ep(1, 1, '2026-11-05')]));
  const statuses = { 1: 'watching', 2: 'plan_to_watch', 3: 'completed', 4: 'paused', 5: 'dropped' };
  assert.deepEqual(
    make(medias, { statuses })
      .build('next7')
      .map(i => i.showId),
    [1, 2, 3, 4]
  );
});

test('"Sem data prevista" foi removido: buildUndated não existe e a view não cria esse bloco', () => {
  assert.equal(C.buildUndated, undefined);
  const view = read('js', 'views', 'calendarView.js');
  assert.ok(!/calendar-undated|buildUndated|Sem data prevista/i.test(view));
  assert.ok(!/calendar-undated|Sem data prevista/i.test(read('index.html')));
  for (const css of ['views.css', 'components.css', 'layout.css']) assert.ok(!/calendar-undated/.test(read('css', css)), css);
});

// ---------------------------------------------------------------- janela de 90 dias

const filme = (id, name, date) => ({ id, name, type: 'movie', first_air_date: date });

test('janela: PAST_DAYS = 90 e windowStart é hoje - 90 dias', () => {
  assert.equal(C.PAST_DAYS, 90);
  assert.equal(C.windowStart(HOJE), '2026-08-06');
  assert.equal(C.windowStart(HOJE), C.addDays(HOJE, -90));
  assert.equal(C.windowStart('lixo'), null);
});

test('fronteira inclusiva (episódio): hoje-90 entra e hoje-91 não, em todos os filtros que alcançam o passado', () => {
  const borda = C.addDays(HOJE, -90);
  const fora = C.addDays(HOJE, -91);
  const m = show(1, 'Borda', 'tv', [ep(1, 1, fora), ep(1, 2, borda), ep(1, 3, C.addDays(HOJE, -89))]);
  const a = make([m]);
  assert.deepEqual(
    a.build('all').map(i => i.episodeNumber),
    [2, 3]
  );
  assert.equal(a.build('all')[0].daysFromToday, -90);
  // semana, 7 e 30 dias começam depois do piso, então não alcançam o passado distante
  for (const r of ['week', 'next7', 'next30']) assert.deepEqual(a.build(r), [], r);
});

test('fronteira inclusiva (filme): estreia em hoje-90 entra; hoje-91 e 120 dias atrás não', () => {
  const dentro = filme(1, 'Dentro', C.addDays(HOJE, -90));
  const fora = filme(2, 'Fora', C.addDays(HOJE, -91));
  const antigo = filme(3, 'Antigo', C.addDays(HOJE, -120));
  const recente = filme(4, 'Recente', C.addDays(HOJE, -30));
  const out = make([dentro, fora, antigo, recente]).build('all');
  assert.deepEqual(
    out.map(i => [i.showName, i.daysFromToday, i.title]),
    [
      ['Dentro', -90, 'Filme'],
      ['Recente', -30, 'Filme']
    ]
  );
});

test('filtro Todos: passado, hoje e futuro sem limite (hoje+N)', () => {
  const m = show(1, 'Longa', 'tv', [
    ep(1, 1, C.addDays(HOJE, -90)),
    ep(1, 2, C.addDays(HOJE, -1)),
    ep(1, 3, HOJE),
    ep(1, 4, C.addDays(HOJE, 1)),
    ep(1, 5, C.addDays(HOJE, 30)),
    ep(1, 6, C.addDays(HOJE, 365)),
    ep(1, 7, '2099-12-31')
  ]);
  const a = make([m]);
  assert.deepEqual(
    a.build('all').map(i => i.episodeNumber),
    [1, 2, 3, 4, 5, 6, 7]
  );
  assert.deepEqual(C.rangeBounds(HOJE, 'all'), { from: '2026-08-06', to: null });
  // os outros filtros continuam com teto
  assert.deepEqual(
    a.build('next30').map(i => i.episodeNumber),
    [3, 4]
  );
});

test('rangeBounds: filtros curtos nunca começam antes do piso da janela', () => {
  const floor = C.windowStart(HOJE);
  for (const r of ['week', 'next7', 'next30', 'all']) {
    const b = C.rangeBounds(HOJE, r);
    assert.ok(b.from >= floor, `${r} começa em ${b.from}`);
  }
  assert.deepEqual(C.rangeBounds(HOJE, 'all'), { from: floor, to: null });
  assert.equal(C.rangeBounds('invalido', 'all'), null);
});

test('virada de ano: hoje 2027-01-02 com episódio em 2026-10-04 (= -90) entra; 2026-10-03 (-91) não', () => {
  const hoje = '2027-01-02';
  assert.equal(C.windowStart(hoje), '2026-10-04');
  const m = show(1, 'Virada', 'tv', [ep(1, 1, '2026-10-03'), ep(1, 2, '2026-10-04'), ep(1, 3, '2026-12-31'), ep(1, 4, '2027-01-01')]);
  const out = C.buildAgenda(
    [{ showId: 1 }],
    () => m,
    () => false,
    hoje,
    { range: 'all' }
  );
  assert.deepEqual(
    out.map(i => [i.episodeNumber, i.daysFromToday]),
    [
      [2, -90],
      [3, -2],
      [4, -1]
    ]
  );
  // semana de 2027-01-02 (sábado) começa em 2026-12-28, dentro da janela
  const semana = C.buildAgenda(
    [{ showId: 1 }],
    () => m,
    () => false,
    hoje,
    { range: 'week' }
  );
  assert.deepEqual(
    semana.map(i => i.episodeNumber),
    [3, 4]
  );
});

test('virada de mês e ano bissexto na janela', () => {
  assert.equal(C.windowStart('2026-03-01'), '2025-12-01'); // fev de 28 dias
  assert.equal(C.windowStart('2028-03-01'), '2027-12-02'); // fev de 29 dias: 1 dia a menos de volta
  assert.equal(C.windowStart('2026-12-31'), '2026-10-02');
  const m = show(1, 'Mês', 'tv', [ep(1, 1, '2025-11-30'), ep(1, 2, '2025-12-01'), ep(1, 3, '2026-02-28')]);
  const out = C.buildAgenda(
    [{ showId: 1 }],
    () => m,
    () => false,
    '2026-03-01',
    { range: 'all' }
  );
  assert.deepEqual(
    out.map(i => i.episodeNumber),
    [2, 3]
  );
});

test('datas são dia civil: com hora/UTC só o dia vale, sem deslocamento de fuso', () => {
  const borda = `${C.addDays(HOJE, -90)}T23:59:59.000Z`;
  const fora = `${C.addDays(HOJE, -91)}T23:59:59.000Z`;
  const m = show(1, 'Fuso', 'tv', [ep(1, 1, fora), ep(1, 2, borda)]);
  const out = make([m]).build('all');
  assert.deepEqual(
    out.map(i => [i.episodeNumber, i.airDate]),
    [[2, '2026-08-06']]
  );
  const f = filme(2, 'Filme ISO', `${HOJE}T00:00:00.000Z`);
  assert.equal(make([f]).build('week')[0].airDate, HOJE);
});

test('dayKey de um Date local vira o "hoje" da janela, em qualquer fuso do processo', () => {
  const run = tz =>
    execFileSync(
      process.execPath,
      [
        '-e',
        "const C = require(process.argv[1]); const t = C.dayKey(new Date(2026, 10, 4, 23, 30)); console.log(t + ' ' + C.windowStart(t))",
        path.join(pub, 'js', 'utils', 'calendar.js')
      ],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8' }
    ).trim();
  // 23:30 locais continuam sendo o dia 4 em qualquer fuso
  for (const tz of ['America/Sao_Paulo', 'UTC', 'Asia/Tokyo']) assert.equal(run(tz), '2026-11-04 2026-08-06', tz);
});

test('filme usa a estreia (first_air_date); episódio usa air_date; filme sem data é ignorado', () => {
  const f = {
    ...filme(1, 'Filme', '2026-10-01'),
    seasons: [{ season_number: 1, episodes: [{ episode_number: 1, air_date: '2026-11-04' }] }]
  };
  const semData = filme(2, 'Sem data', null);
  const invalido = filme(3, 'Inválido', '2026-02-30');
  const serie = show(4, 'Série', 'tv', [ep(1, 1, '2026-10-01')]);
  const out = make([f, semData, invalido, serie]).build('all');
  assert.deepEqual(
    out.map(i => [i.showName, i.type, i.airDate, i.seasonNumber, i.title]),
    [
      ['Filme', 'movie', '2026-10-01', null, 'Filme'],
      ['Série', 'tv', '2026-10-01', 1, 'Ep 1']
    ]
  );
});

test('Desisti fica de fora também no passado e em Todos', () => {
  const a = show(1, 'Ativa', 'tv', [ep(1, 1, C.addDays(HOJE, -10))]);
  const d = show(2, 'Desisti', 'tv', [ep(1, 1, C.addDays(HOJE, -10)), ep(1, 2, C.addDays(HOJE, 5))]);
  const fd = filme(3, 'Filme desisti', C.addDays(HOJE, -5));
  const out = make([a, d, fd], { statuses: { 2: 'dropped', 3: 'dropped' } }).build('all');
  assert.deepEqual(
    out.map(i => i.showName),
    ['Ativa']
  );
});

test('obra finalizada antiga (último episódio há mais de 90 dias) não mostra nada, nem em Todos', () => {
  const antiga = show(
    1,
    'Cinza',
    'anime',
    [ep(1, 1, C.addDays(HOJE, -214)), ep(1, 2, C.addDays(HOJE, -207)), ep(1, 3, C.addDays(HOJE, -200))],
    {
      status: 'Finalizado'
    }
  );
  const filmeAntigo = filme(2, 'Clássico', C.addDays(HOJE, -120));
  const a = make([antiga, filmeAntigo], { statuses: { 1: 'completed' } });
  for (const r of ['week', 'next7', 'next30', 'all']) assert.deepEqual(a.build(r), [], r);
});

test('data inválida é ignorada na janela (sem inventar nem quebrar)', () => {
  const m = show(1, 'Datas ruins', 'tv', [
    ep(1, 1, '2026-02-30'),
    ep(1, 2, '31/10/2026'),
    ep(1, 3, undefined),
    ep(1, 4, 20261030),
    ep(1, 5, '2026-10-30')
  ]);
  assert.deepEqual(
    make([m])
      .build('all')
      .map(i => i.episodeNumber),
    [5]
  );
});

test('groupByDay devolve phase: past, today e future (e phaseOf)', () => {
  const m = show(1, 'Fases', 'tv', [
    ep(1, 1, C.addDays(HOJE, -90)),
    ep(1, 2, C.addDays(HOJE, -1)),
    ep(1, 3, HOJE),
    ep(1, 4, C.addDays(HOJE, 1)),
    ep(1, 5, C.addDays(HOJE, 400))
  ]);
  const groups = C.groupByDay(make([m]).build('all'));
  assert.deepEqual(
    groups.map(g => [g.key, g.daysFromToday, g.phase]),
    [
      ['2026-08-06', -90, 'past'],
      ['2026-11-03', -1, 'past'],
      ['2026-11-04', 0, 'today'],
      ['2026-11-05', 1, 'future'],
      ['2027-12-09', 400, 'future']
    ]
  );
  assert.equal(C.phaseOf(-1), 'past');
  assert.equal(C.phaseOf(0), 'today');
  assert.equal(C.phaseOf(1), 'future');
});

test('buildAgenda: obra sem detalhe carregado e tipo desconhecido não quebram', () => {
  const m = show(1, 'Ok', 'tv', [ep(1, 1, '2026-11-05')]);
  const semSeasons = { id: 2, name: 'Sem temporadas', type: 'tv', status: 'Em Exibição' };
  const outroTipo = show(3, 'Outro', 'podcast', [ep(1, 1, '2026-11-05')]);
  const a = make([m, semSeasons, outroTipo]);
  a.tracked.push({ showId: 999, status: 'watching' }); // obra que não está no cache
  assert.deepEqual(
    a.build('next7').map(i => i.showId),
    [1]
  );
  assert.deepEqual(C.buildAgenda(null, a.getMedia, a.isWatched, HOJE, { range: 'week' }), []);
  assert.deepEqual(C.buildAgenda(a.tracked, a.getMedia, a.isWatched, 'invalida', { range: 'week' }), []);
});

test('buildAgenda: filme com estreia futura entra como item "Filme"; filme passado ou sem data, não', () => {
  const futuro = { id: 10, name: 'Estreia', type: 'movie', first_air_date: '2026-11-06' };
  const hoje = { id: 11, name: 'Hoje no cinema', type: 'movie', first_air_date: HOJE };
  const passado = { id: 12, name: 'Antigo', type: 'movie', first_air_date: '2026-11-03' };
  const semData = { id: 13, name: 'Sem data', type: 'movie', first_air_date: null };
  const longe = { id: 14, name: 'Longe', type: 'movie', first_air_date: '2027-05-01' };
  const out = make([futuro, hoje, passado, semData, longe], { watched: ['10_movie'] }).build('next7');
  assert.deepEqual(
    out.map(i => [i.showId, i.title, i.watched, i.seasonNumber, i.daysFromToday]),
    [
      [11, 'Filme', false, null, 0],
      [10, 'Filme', true, null, 2]
    ]
  );
});

test('buildAgenda: cada obra entra uma vez, mesmo repetida na lista', () => {
  const m = show(1, 'Dupla', 'tv', [ep(1, 1, '2026-11-05')]);
  const a = make([m]);
  a.tracked.push({ showId: 1, status: 'watching' });
  assert.equal(a.build('next7').length, 1);
});

test('groupByDay agrupa por dia mantendo a ordem', () => {
  const m = show(1, 'A', 'tv', [ep(1, 1, '2026-11-04'), ep(1, 2, '2026-11-04'), ep(1, 3, '2026-11-06')]);
  const groups = C.groupByDay(make([m]).build('next7'));
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map(g => [g.key, g.y, g.m, g.d, g.weekday, g.daysFromToday, g.items.length]),
    [
      ['2026-11-04', 2026, 11, 4, 3, 0, 2],
      ['2026-11-06', 2026, 11, 6, 5, 2, 1]
    ]
  );
  assert.deepEqual(C.groupByDay([]), []);
});

// ---------------------------------------------------------------- HTML / CSP

test('a aba Agenda existe no HTML, com tabpanel, filtros com aria-pressed e scripts na ordem certa', () => {
  const html = read('index.html');
  assert.ok(/id="tab-btn-calendar"[^>]*role="tab"[^>]*aria-controls="view-calendar"/.test(html));
  assert.ok(/id="view-calendar"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-btn-calendar"/.test(html));
  assert.ok(
    html.indexOf('tab-btn-calendar') > html.indexOf('tab-btn-watchlist') && html.indexOf('tab-btn-calendar') < html.indexOf('tab-btn-diary')
  );
  const section = html.slice(html.indexOf('id="view-calendar"'), html.indexOf('id="view-diary"'));
  const pills = [...section.matchAll(/<button[^>]*data-range="([a-z0-9]+)"[^>]*>/g)];
  assert.deepEqual(
    pills.map(m => m[1]),
    ['week', 'next7', 'next30', 'all']
  );
  assert.ok(/data-range="all"[^>]*>Todos</.test(section));
  for (const [tag] of pills) assert.ok(/type="button"/.test(tag) && /aria-pressed="(true|false)"/.test(tag));
  const idx = f => html.indexOf(`js/${f}`);
  assert.ok(idx('utils/calendar.js') > -1 && idx('utils/calendar.js') < idx('views/nextUpView.js'));
  assert.ok(idx('views/calendarView.js') > idx('views/statsView.js') && idx('views/calendarView.js') < idx('controllers/appController.js'));
});

test('a view da Agenda não usa on*/style inline e escapa o que vem do catálogo', () => {
  const src = read('js', 'views', 'calendarView.js').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(src));
  assert.ok(!/<[a-z][^>]*\sstyle\s*=/i.test(src));
  assert.ok(/escapeHtml\(item\.showName\)/.test(src) && /escapeHtml\(title\)/.test(src));
  assert.ok(/toInt\(item\.showId\)/.test(src));
  assert.ok(/data-action="quick-check"/.test(src) && /data-action="open-detail"/.test(src) && /data-action="retry-details"/.test(src));
});

test('a view da Agenda desenha os blocos Já lançados / Hoje / Próximos lançamentos, o marco de hoje e o selo Lançado', () => {
  const src = read('js', 'views', 'calendarView.js');
  assert.ok(src.includes('calendar-phase--${cls}') && src.includes('role="group" aria-label="${label}"'));
  for (const label of ['Já lançados', 'Hoje', 'Próximos lançamentos']) assert.ok(src.includes(`'${label}'`), label);
  assert.ok(src.includes('id="calendar-today"') && src.includes('calendar-today-mark'));
  assert.ok(src.includes('calendar-item--past') && src.includes('calendar-item-released') && src.includes('>Lançado<'));
  assert.ok(src.includes("'item' : 'itens'"));
});

test('AppController conhece a aba calendar (viewFor, refreshAll e abertura)', () => {
  const src = read('js', 'controllers', 'appController.js');
  assert.ok(/calendar:\s*window\.calendarView/.test(src));
  assert.ok(/\['next-up', 'watchlist', 'diary', 'stats', 'calendar'\]/.test(src));
  assert.ok(/calendarView\.onOpen\(\)/.test(src));
  assert.ok(/refreshMedia\(id\)/.test(read('js', 'api', 'apiClient.js')));
});
