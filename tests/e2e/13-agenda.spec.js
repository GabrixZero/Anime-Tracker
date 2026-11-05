// S15 · Agenda: episódios das obras da lista por dia, filtros de período, marcar como assistido a partir dela, estados vazio e de aviso,
// teclado e largura de celular. A série "Estreias da Semana" (fake-sources/data.js) tem episódios hoje, amanhã, daqui a 3 e a 20 dias,
// sempre relativos a hoje. Nenhum teste usa a internet.
'use strict';

const { test, expect } = require('./support/fixtures');
const { EXPECTED } = require('./fake-sources/data');
const { openApp, gotoTab, toast, queueCard, newUser, signInWithApi, loadExample, horizontalOverflow, tap } = require('./support/helpers');

const { calendar } = EXPECTED;

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
    await expect(page.locator('#calendar-counter-pill')).toHaveText('3 episódios');
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
    await expect(page.locator('#calendar-counter-pill')).toHaveText('4 episódios');
    await expect(item(page, calendar.in20days)).toBeVisible();
    await tap(page.locator('[data-range="next7"]'));
    await expect(page.locator('#calendar-counter-pill')).toHaveText('3 episódios');

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
    await expect(page.locator('#calendar-counter-pill')).toHaveText('0 episódios');

    // obras do exemplo não têm episódios futuros: o período fica vazio, mas com dica
    await gotoTab(page, 'next-up');
    await loadExample(page);
    await gotoTab(page, 'calendar');
    await expect(page.locator('#calendar-empty')).toContainText('Nenhum episódio nesse período');
    await expect(page.locator('#calendar-empty')).toContainText('Tente outro período');
    await expect(page.locator('#calendar-container .calendar-item')).toHaveCount(0);
  });

  test('se a atualização das fontes falhar, mostra um aviso discreto e continua com os dados salvos', async ({ page, guard }, testInfo) => {
    guard.allow(/Failed to load resource/, /\[API Error\]/);
    await addCalendarShow(page, testInfo);
    await page.route('**/api/media/*/refresh', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fonte fora do ar (teste).' }) })
    );
    await gotoTab(page, 'calendar');
    await expect(page.locator('#calendar-notice')).toContainText('Algumas obras não foram atualizadas agora; mostrando os dados salvos.');
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
