// S15 · Agenda: episódios das obras da lista por dia, filtros de período, marcar como assistido a partir dela, estados vazio e de aviso,
// teclado e largura de celular. A série "Estreias da Semana" (fake-sources/data.js) tem episódios hoje, amanhã, daqui a 3 e a 20 dias,
// sempre relativos a hoje. Nenhum teste usa a internet.
'use strict';

const { AxeBuilder } = require('@axe-core/playwright');
const { test, expect } = require('./support/fixtures');
const { EXPECTED } = require('./fake-sources/data');
const {
  openApp,
  gotoTab,
  toast,
  queueCard,
  listCard,
  newUser,
  signInWithApi,
  seedLibrary,
  horizontalOverflow,
  tap
} = require('./support/helpers');

const { calendar, agenda90 } = EXPECTED;

const item = (page, title) =>
  page.locator('#calendar-container .calendar-item').filter({ has: page.getByRole('button', { name: title, exact: true }) });

// Entra com uma conta nova e põe "Estreias da Semana" na lista pela aba Explorar.
async function addCalendarShow(page, testInfo) {
  await signInWithApi(page, newUser(testInfo, 'agenda'));
  await gotoTab(page, 'explore');
  await page.locator('#explore-search-input').fill(calendar.query);
  await page.locator('#explore-search-input').press('Enter');
  const card = page
    .locator('#explore-container .show-card')
    .filter({ has: page.getByRole('button', { name: calendar.name, exact: true }) });
  await tap(card.getByRole('button', { name: '+ Adicionar à Lista' }));
  await expect(toast(page, 'Adicionado à sua lista!')).toBeVisible();
}

test.describe('Agenda', () => {
  test('mostra os episódios por dia, filtra o período e marca como assistido (refletindo em A Seguir)', async ({ page }, testInfo) => {
    await addCalendarShow(page, testInfo);

    // ao abrir a aba o app pede a atualização das obras em exibição (POST /media/:id/refresh), uma por vez
    const refreshed = page.waitForRequest(r => r.method() === 'POST' && /\/api\/media\/\d+\/refresh$/.test(r.url()));
    await gotoTab(page, 'calendar');
    await refreshed;

    // 7 dias: hoje, amanhã e daqui a 3 dias (o de daqui a 20 dias fica de fora)
    await tap(page.locator('[data-range="next7"]'));
    await expect(page.locator('[data-range="next7"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-range="week"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#calendar-counter-pill')).toHaveText('3 itens');
    const headings = page.locator('#calendar-container .calendar-day-title');
    await expect(headings).toHaveCount(3);
    await expect(headings.nth(0)).toHaveText(/^Hoje · \d{2}\/\d{2}$/);
    await expect(headings.nth(1)).toHaveText(/^Amanhã · \d{2}\/\d{2}$/);
    await expect(headings.nth(2)).toHaveText(/^[A-Za-zçÇáÁéÉíÍóÓúÚ-]+ · \d{2}\/\d{2}$/);
    await expect(item(page, calendar.today).locator('.calendar-item-code')).toHaveText('T1:E1');
    await expect(item(page, calendar.today).locator('.calendar-item-show')).toHaveText(calendar.name);
    await expect(item(page, calendar.in20days)).toHaveCount(0);

    // 30 dias: entra o episódio distante
    await tap(page.locator('[data-range="next30"]'));
    await expect(page.locator('#calendar-counter-pill')).toHaveText('4 itens');
    await expect(item(page, calendar.in20days)).toBeVisible();
    await tap(page.locator('[data-range="next7"]'));
    await expect(page.locator('#calendar-counter-pill')).toHaveText('3 itens');

    // marcar o episódio de hoje: fica marcado, com o botão de desfazer
    const today = item(page, calendar.today);
    await tap(today.getByRole('button', { name: /^Marcar como assistido/ }));
    await expect(toast(page, 'Marcado como assistido!')).toBeVisible();
    await expect(today).toHaveClass(/calendar-item--watched/);
    await expect(today.getByRole('button', { name: /^Desmarcar como assistido/ })).toBeVisible();
    await expect(today.getByRole('button', { name: /^Desmarcar como assistido/ })).toBeFocused(); // o foco continua no mesmo botão

    // A Seguir já mostra o próximo episódio (T1:E2)
    await gotoTab(page, 'next-up');
    await expect(queueCard(page, calendar.name).locator('.next-up-badge')).toHaveText('T1:E2');

    // desfazer pela Agenda volta o T1:E1 para a fila
    await gotoTab(page, 'calendar');
    await tap(item(page, calendar.today).getByRole('button', { name: /^Desmarcar como assistido/ }));
    await expect(toast(page, 'Desmarcado.')).toBeVisible();
    await expect(item(page, calendar.today)).not.toHaveClass(/calendar-item--watched/);
    await gotoTab(page, 'next-up');
    await expect(queueCard(page, calendar.name).locator('.next-up-badge')).toHaveText('T1:E1');

    // clicar no título abre o detalhe da obra
    await gotoTab(page, 'calendar');
    await tap(item(page, calendar.tomorrow).getByRole('button', { name: calendar.tomorrow, exact: true }));
    await expect(page.locator('#modal-show-detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-show-detail')).toBeHidden();
  });

  test('períodos sem episódio e lista vazia mostram a explicação', async ({ page }) => {
    await openApp(page);
    await gotoTab(page, 'calendar');
    await expect(page.locator('#calendar-empty')).toBeVisible();
    await expect(page.locator('#calendar-empty')).toContainText('Sua lista está vazia');
    await expect(page.locator('#calendar-counter-pill')).toHaveText('0 itens');

    // com todas as obras em Desisti não sobra nada elegível: estado vazio
    await gotoTab(page, 'next-up');
    await seedLibrary(page);
    await page.evaluate(() => {
      window.appState.data.trackedShows.forEach(t => window.appState.setShowStatus(t.showId, 'dropped'));
      window.appController.refreshAll();
    });
    await gotoTab(page, 'calendar');
    await expect(page.locator('#calendar-empty')).toContainText('Nada nesse período');
    await expect(page.locator('#calendar-container .calendar-item')).toHaveCount(0);
  });

  test('se a atualização das fontes falhar, não mostra aviso nenhum e continua com os dados salvos', async ({ page, guard }, testInfo) => {
    guard.allow(/Failed to load resource/, /\[API Error\]/);
    await addCalendarShow(page, testInfo);
    await page.route('**/api/media/*/refresh', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fonte fora do ar (teste).' }) })
    );
    await gotoTab(page, 'calendar');
    await expect(page.locator('#calendar-notice')).toBeHidden(); // sem texto de erro para a pessoa
    await expect(page.locator('#calendar-container')).not.toContainText('não foram atualizadas');
    await tap(page.locator('[data-range="next7"]'));
    await expect(item(page, calendar.today)).toBeVisible(); // a agenda continua com o que já estava salvo
    await expect(page.locator('#calendar-container [role="alert"]')).toHaveCount(0);
  });

  test('teclado: a aba Agenda é alcançada pelas setas, abre com Enter e os filtros funcionam com Enter', async ({ page }) => {
    await openApp(page);
    const tab = id => page.locator(`#tab-btn-${id}`);

    await tab('next-up').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab('watchlist')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tab('calendar')).toBeFocused();
    await expect(page.locator('#view-calendar')).not.toHaveClass(/active/); // seta só move o foco
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-calendar')).toHaveClass(/active/);
    await expect(tab('calendar')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('calendar')).toHaveAttribute('tabindex', '0');
    await expect(tab('next-up')).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('ArrowRight');
    await expect(tab('diary')).toBeFocused(); // a Agenda fica entre Minha Lista e Diário

    // filtro de período só com o teclado
    const days30 = page.locator('[data-range="next30"]');
    await days30.focus();
    await page.keyboard.press('Enter');
    await expect(days30).toHaveAttribute('aria-pressed', 'true');
    await expect(days30).toBeFocused();
  });

  test('celular: as 6 abas cabem na barra de baixo e a Agenda não cria rolagem horizontal', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'só faz sentido na largura de celular');
    await addCalendarShow(page, testInfo);
    await gotoTab(page, 'calendar');
    await tap(page.locator('[data-range="next30"]'));
    await expect(item(page, calendar.in20days)).toBeVisible();

    const o = await horizontalOverflow(page);
    expect(o.innerWidth).toBe(375);
    expect(o.scrollWidth, 'a página não pode passar da largura').toBeLessThanOrEqual(o.clientWidth);

    const boxes = await page.locator('#main-nav .nav-tab').evaluateAll(tabs =>
      tabs.map(t => {
        const r = t.getBoundingClientRect();
        return { left: r.left, right: r.right, label: t.textContent.trim().replace(/\s+/g, ' ') };
      })
    );
    expect(boxes).toHaveLength(6);
    for (const b of boxes) {
      expect(b.left, `aba "${b.label}" fora da tela`).toBeGreaterThanOrEqual(0);
      expect(b.right, `aba "${b.label}" fora da tela`).toBeLessThanOrEqual(375);
    }
    // nenhum rótulo cortado pelas reticências
    const clipped = await page
      .locator('#main-nav .nav-label')
      .evaluateAll(labels => labels.filter(l => l.scrollWidth > l.clientWidth).map(l => l.textContent));
    expect(clipped, 'rótulos cortados na barra inferior').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Janela de 90 dias: o que já foi lançado (até 90 dias atrás), hoje e tudo que vem pela frente; filtro "Todos".
// Obras na lista: Estreia Próxima (filme, +10), Lançamento Recente (filme, -30), Clássico Antigo (filme, -120: fora), Ronda Semanal (série),
// Maré Viva (anime em exibição) e Cinza do Fim (anime encerrado, último episódio há 200 dias: nada aparece).
// ---------------------------------------------------------------------------------------------------------------------------------
const { upcomingMovie, recentMovie, oldMovie, weeklySeries, releasingAnime, endedAnime } = agenda90;
const ALL_SHOWS = [upcomingMovie, recentMovie, oldMovie, weeklySeries, releasingAnime, endedAnime];
// dias (em relação a hoje) que devem ter itens na Agenda: Maré Viva, Ronda Semanal e Lançamento Recente / depois, os próximos
const PAST_OFFSETS = [-63, -56, -49, -42, -35, -30, -28, -21, -14, -7];
const FUTURE_OFFSETS = [7, 10, 14, 21];
const PAST_ITEMS = releasingAnime.pastEpisodes + weeklySeries.pastEpisodes + 1;
const FUTURE_ITEMS = releasingAnime.futureEpisodes + weeklySeries.futureEpisodes + 1;

const byShow = (page, name) =>
  page.locator('#calendar-container .calendar-item').filter({ has: page.locator('.calendar-item-show', { hasText: name }) });

// Põe as obras na lista sem passar pela busca (a busca tem limite de 60 por minuto por IP, dividido com os outros testes): o GET autenticado
// da obra faz a ingestão (fonte falsa) e depois a lista é preenchida como em seedLibrary. O caminho pela busca fica no 1º teste do arquivo.
async function setupAgenda90(page, testInfo) {
  const token = await signInWithApi(page, newUser(testInfo, 'agenda90'));
  const ids = ALL_SHOWS.map(show => show.id);
  for (const id of ids) {
    const res = await page.request.get(`/api/media/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status(), `ingestão da obra ${id}`).toBe(200);
  }
  await page.evaluate(async list => {
    await window.appController.ensureDetails(list);
    list.forEach(id => window.appState.addShow(id));
    window.appController.refreshAll();
  }, ids);
  await expect(page.locator('#badge-watchlist')).toHaveText(String(ids.length));
  await gotoTab(page, 'calendar');
  await tap(page.locator('[data-range="all"]'));
  await expect(page.locator('[data-range="all"]')).toHaveAttribute('aria-pressed', 'true');
}

// "dd/mm" (com /aaaa se não for o ano de hoje), como a Agenda escreve, para hoje + n dias (usa o dia civil do próprio navegador).
const expectedDate = (page, offset) =>
  page.evaluate(n => {
    const today = window.Calendar.dayKey(new Date());
    const [y, m, d] = window.Calendar.addDays(today, n).split('-');
    return `${d}/${m}${y === today.slice(0, 4) ? '' : '/' + y}`;
  }, offset);

const axeSerious = async page => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .options({ preload: false })
    .include('#view-calendar')
    .analyze();
  return violations
    .filter(v => v.impact === 'critical' || v.impact === 'serious')
    .map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' '))}`);
};

test.describe('Agenda · janela de 90 dias', () => {
  test('Todos mostra já lançados, hoje com marcador e próximos, em ordem; Clássico Antigo e Cinza do Fim ficam de fora', async ({
    page
  }, testInfo) => {
    await setupAgenda90(page, testInfo);

    await expect(page.locator('#calendar-counter-pill')).toHaveText(`${PAST_ITEMS + FUTURE_ITEMS} itens`);

    // três blocos, nesta ordem
    const groups = page.locator('#calendar-container > .calendar-phase');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toHaveAttribute('role', 'group');
    await expect(groups.nth(0)).toHaveAttribute('aria-label', 'Já lançados');
    await expect(groups.nth(1)).toHaveAttribute('aria-label', 'Hoje');
    await expect(groups.nth(2)).toHaveAttribute('aria-label', 'Próximos lançamentos');
    await expect(groups.nth(0)).toHaveClass(/calendar-phase--past/);
    await expect(groups.nth(1)).toHaveClass(/calendar-phase--today/);
    await expect(groups.nth(2)).toHaveClass(/calendar-phase--future/);

    // passado: selo "Lançado" em todos; hoje e futuro: nenhum
    await expect(groups.nth(0).locator('.calendar-item')).toHaveCount(PAST_ITEMS);
    await expect(groups.nth(0).locator('.calendar-item--past')).toHaveCount(PAST_ITEMS);
    await expect(groups.nth(0).locator('.calendar-item-released')).toHaveCount(PAST_ITEMS);
    await expect(groups.nth(0).locator('.calendar-item-released').first()).toHaveText('Lançado');
    await expect(groups.nth(1).locator('.calendar-item')).toHaveCount(0);
    await expect(groups.nth(2).locator('.calendar-item')).toHaveCount(FUTURE_ITEMS);
    await expect(groups.nth(2).locator('.calendar-item-released')).toHaveCount(0);

    // marcador de hoje (existe mesmo sem item hoje) e a tela abre rolada em Hoje
    const todayDay = page.locator('#calendar-today');
    await expect(todayDay).toHaveCount(1);
    await expect(todayDay.locator('.calendar-today-mark')).toHaveCount(1);
    await expect(todayDay.locator('.calendar-day-title')).toHaveText(`Hoje · ${await expectedDate(page, 0)}`);
    await expect(todayDay).toBeInViewport();

    // ordem cronológica dos dias: passado, hoje, futuro
    const titles = await page.locator('#calendar-container .calendar-day-title').allTextContents();
    const expected = [];
    for (const off of [...PAST_OFFSETS, 0, ...FUTURE_OFFSETS]) expected.push(await expectedDate(page, off));
    expect(titles.map(t => t.split(' · ')[1])).toEqual(expected);
    expect(titles[PAST_OFFSETS.length]).toMatch(/^Hoje · /);

    // quem aparece e quem não
    await expect(byShow(page, upcomingMovie.name)).toHaveCount(1);
    await expect(byShow(page, upcomingMovie.name).locator('.calendar-item-code')).toHaveText('FILME');
    await expect(byShow(page, recentMovie.name)).toHaveCount(1);
    await expect(byShow(page, recentMovie.name).locator('.calendar-item-released')).toHaveText('Lançado');
    await expect(byShow(page, weeklySeries.name)).toHaveCount(weeklySeries.pastEpisodes + weeklySeries.futureEpisodes);
    await expect(byShow(page, releasingAnime.name)).toHaveCount(releasingAnime.pastEpisodes + releasingAnime.futureEpisodes);
    await expect(byShow(page, oldMovie.name)).toHaveCount(0);
    await expect(byShow(page, endedAnime.name)).toHaveCount(0);

    // sem "sem data prevista" e sem legenda/explicação
    await expect(page.locator('#view-calendar')).not.toContainText(/sem data prevista/i);
    await expect(page.locator('#calendar-container .calendar-undated')).toHaveCount(0);
    await expect(page.locator('#calendar-empty')).toBeHidden();
    await expect(page.locator('#view-calendar')).not.toContainText(/legenda|90 dias|janela|nos últimos/i);

    // filtros curtos não passam do piso: nada de há 30 dias ou mais
    await tap(page.locator('[data-range="week"]'));
    await expect(byShow(page, recentMovie.name)).toHaveCount(0);
    await expect(byShow(page, oldMovie.name)).toHaveCount(0);
    await expect(byShow(page, endedAnime.name)).toHaveCount(0);
    await tap(page.locator('[data-range="next30"]'));
    await expect(page.locator('#calendar-container .calendar-item--past')).toHaveCount(0);
    await expect(byShow(page, upcomingMovie.name)).toHaveCount(1);
    await tap(page.locator('[data-range="all"]'));
    await expect(page.locator('#calendar-counter-pill')).toHaveText(`${PAST_ITEMS + FUTURE_ITEMS} itens`);
  });

  test('marcar como assistido funciona num item já lançado e num futuro; Desisti sai da Agenda', async ({ page }, testInfo) => {
    await setupAgenda90(page, testInfo);
    const total = PAST_ITEMS + FUTURE_ITEMS;

    // item já lançado: o episódio de há 7 dias da Ronda Semanal (T1:E8)
    const pastEp = page
      .locator('#calendar-container .calendar-item--past')
      .filter({ has: page.locator('.calendar-item-show', { hasText: weeklySeries.name }) })
      .last();
    await expect(pastEp.locator('.calendar-item-code')).toHaveText('T1:E8');
    await tap(pastEp.getByRole('button', { name: /^Marcar como assistido/ }));
    // marcar o E8 marca também os 7 anteriores já lançados (Ajustes 2): um aviso só, com "Desfazer"
    await expect(toast(page, `${weeklySeries.pastEpisodes} episódios marcados.`)).toBeVisible();
    await expect(toast(page, `${weeklySeries.pastEpisodes} episódios marcados.`).getByRole('button', { name: 'Desfazer' })).toBeVisible();
    await expect(page.locator('#calendar-container .calendar-item--watched').filter({ hasText: weeklySeries.name })).toHaveCount(
      weeklySeries.pastEpisodes
    );
    await expect(pastEp).toHaveClass(/calendar-item--watched/);
    await expect(pastEp).toHaveClass(/calendar-item--past/);
    await expect(pastEp.locator('.calendar-item-released')).toHaveText('Lançado');
    await expect(pastEp.getByRole('button', { name: /^Desmarcar como assistido/ })).toBeFocused();

    // filme já lançado
    const movie = byShow(page, recentMovie.name);
    await tap(movie.getByRole('button', { name: /^Marcar como assistido/ }));
    await expect(toast(page, 'Marcado como assistido!')).toBeVisible();
    await expect(movie).toHaveClass(/calendar-item--watched/);

    // desfazer o do passado
    await tap(pastEp.getByRole('button', { name: /^Desmarcar como assistido/ }));
    await expect(toast(page, 'Desmarcado.')).toBeVisible();
    await expect(pastEp).not.toHaveClass(/calendar-item--watched/);
    // desmarcar mexe só no E8: os 7 anteriores continuam assistidos
    await expect(page.locator('#calendar-container .calendar-item--watched').filter({ hasText: weeklySeries.name })).toHaveCount(
      weeklySeries.pastEpisodes - 1
    );

    // item futuro (estreia do filme)
    const future = byShow(page, upcomingMovie.name);
    await tap(future.getByRole('button', { name: /^Marcar como assistido/ }));
    await expect(future).toHaveClass(/calendar-item--watched/);
    await expect(page.locator('#calendar-counter-pill')).toHaveText(`${total} itens`); // marcar não tira da Agenda

    // Desisti: a obra some da Agenda (passado e futuro)
    await gotoTab(page, 'watchlist');
    await listCard(page, releasingAnime.name).locator('select.status-select').selectOption({ label: 'Desisti' });
    await expect(toast(page, 'Status: Desisti.')).toBeVisible();
    await gotoTab(page, 'calendar');
    await expect(byShow(page, releasingAnime.name)).toHaveCount(0);
    await expect(page.locator('#calendar-counter-pill')).toHaveText(
      `${total - releasingAnime.pastEpisodes - releasingAnime.futureEpisodes} itens`
    );
    await expect(byShow(page, weeklySeries.name).first()).toBeVisible();
  });

  test('Desisti em todas as obras: Todos mostra o estado vazio, sem blocos', async ({ page }, testInfo) => {
    await setupAgenda90(page, testInfo);
    await page.evaluate(() => {
      window.appState.data.trackedShows.forEach(t => window.appState.setShowStatus(t.showId, 'dropped'));
      window.appController.refreshAll();
    });
    await expect(page.locator('#calendar-counter-pill')).toHaveText('0 itens');
    await expect(page.locator('#calendar-container .calendar-phase')).toHaveCount(0);
    await expect(page.locator('#calendar-empty')).toContainText('Nada nesse período');
  });

  test('acessibilidade: sem violação grave na aba Agenda nos filtros Semana e Todos', async ({ page }, testInfo) => {
    await setupAgenda90(page, testInfo);
    expect(await axeSerious(page), 'Todos').toEqual([]);
    await tap(page.locator('[data-range="week"]'));
    await expect(page.locator('[data-range="week"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await axeSerious(page), 'Semana').toEqual([]);
  });

  test('celular 375x812: Todos não cria rolagem horizontal', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'só faz sentido na largura de celular');
    await setupAgenda90(page, testInfo);
    await expect(page.locator('#calendar-container .calendar-item--past').first()).toBeVisible();
    const o = await horizontalOverflow(page);
    expect(o.innerWidth).toBe(375);
    expect(o.scrollWidth, 'a página não pode passar da largura').toBeLessThanOrEqual(o.clientWidth);
    await page.locator('#calendar-container .calendar-item-released').first().scrollIntoViewIfNeeded();
    const o2 = await horizontalOverflow(page);
    expect(o2.scrollWidth).toBeLessThanOrEqual(o2.clientWidth);
  });
});
