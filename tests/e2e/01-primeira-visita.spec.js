// S12 · Primeira visita: lista vazia (sem dados de enfeite) -> "Carregar exemplo" -> "Remover exemplo" (D-22, S08, S13).
// Visitante, sem conta: tudo fica no navegador (localStorage). Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, toast, loadExample, queueCard, listCard } = require('./support/helpers');

const EXAMPLE_TITLES = ['Interestelar (Interstellar)', 'Oppenheimer', 'Breaking Bad', 'Attack on Titan (Shingeki no Kyojin)'];

test.describe('primeira visita', () => {
  test('começa vazia e sem dados de enfeite, em todas as abas', async ({ page }) => {
    await openApp(page);

    await expect(page.locator('#next-up-empty')).toBeVisible();
    await expect(page.locator('#next-up-empty .empty-title')).toHaveText('Sua lista está vazia');
    await expect(page.locator('#next-up-empty').getByRole('button', { name: 'Explorar' })).toBeVisible();
    await expect(page.locator('#next-up-empty').getByRole('button', { name: 'Carregar exemplo' })).toBeVisible();
    for (const badge of ['next-up', 'watchlist', 'diary']) await expect(page.locator(`#badge-${badge}`)).toHaveText('0');
    await expect(page.locator('#sync-label')).toHaveText('Só neste aparelho');
    await expect(page.locator('#btn-open-auth')).toBeVisible();

    await gotoTab(page, 'watchlist');
    await expect(page.locator('#watchlist-empty')).toBeVisible();
    await expect(page.locator('#watchlist-empty-title')).toHaveText('Sua lista está vazia');
    await expect(page.locator('#btn-watchlist-example')).toBeVisible();
    await expect(page.locator('#watchlist-example-bar')).toBeHidden();
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(0);

    await gotoTab(page, 'diary');
    await expect(page.locator('#diary-empty')).toBeVisible();

    await gotoTab(page, 'stats');
    await expect(page.locator('#stat-episodes-count')).toHaveText('0');
    await expect(page.locator('#stat-minutes-subtext')).toHaveText('0 minutos assistidos');
  });

  test('"Carregar exemplo" põe 4 títulos em "Quero ver" e "Remover exemplo" tira todos', async ({ page }) => {
    await openApp(page);
    await loadExample(page);

    // A Seguir: os 4 títulos esperam na fila, sem nada assistido
    await expect(page.locator('#next-up-counter-pill')).toHaveText('4 títulos na fila');
    await expect(page.locator('#badge-next-up')).toHaveText('4');
    for (const name of ['Interestelar', 'Oppenheimer', 'Breaking Bad', 'Attack on Titan'])
      await expect(queueCard(page, name)).toHaveCount(1);
    await expect(queueCard(page, 'Breaking Bad').locator('.next-up-badge')).toHaveText('T1:E1');
    await expect(queueCard(page, 'Oppenheimer').locator('.next-up-badge')).toHaveText('FILME');

    // Minha Lista: 4 cartões "Quero ver" + a faixa que oferece remover o exemplo
    await gotoTab(page, 'watchlist');
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(4);
    await expect(page.locator('#count-all')).toHaveText('4');
    await expect(page.locator('#count-plan')).toHaveText('4');
    for (const title of EXAMPLE_TITLES) {
      await expect(listCard(page, title).locator('select.status-select')).toHaveValue('plan_to_watch');
    }
    await expect(page.locator('#watchlist-example-bar')).toBeVisible();
    await expect(page.locator('#watchlist-example-text')).toContainText('4 títulos do exemplo ainda sem uso');

    // Ele continua lá depois de recarregar a página (localStorage)
    await page.reload();
    await expect(page.locator('#badge-watchlist')).toHaveText('4');

    await gotoTab(page, 'watchlist');
    await page.getByRole('button', { name: 'Remover exemplo' }).click();
    await expect(toast(page, 'Exemplo removido: 4 títulos.')).toBeVisible();
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(0);
    await expect(page.locator('#watchlist-example-bar')).toBeHidden();
    await expect(page.locator('#watchlist-empty-title')).toHaveText('Sua lista está vazia');
    await expect(page.locator('#badge-watchlist')).toHaveText('0');
    // o botão sumiu junto com a faixa: o foco vai para o título da tela (nunca cai no <body>)
    await expect(page.locator('#view-watchlist h2')).toBeFocused();

    await gotoTab(page, 'next-up');
    await expect(page.locator('#next-up-empty .empty-title')).toHaveText('Sua lista está vazia');
  });

  test('"Remover exemplo" não leva embora o que a pessoa já usou', async ({ page }) => {
    await openApp(page);
    await loadExample(page);

    // marca o 1º episódio de Breaking Bad na fila "A Seguir"
    await queueCard(page, 'Breaking Bad')
      .getByRole('button', { name: /^Marcar como assistido: Breaking Bad/ })
      .click();
    await expect(toast(page, 'Marcado como assistido!')).toBeVisible();
    await expect(queueCard(page, 'Breaking Bad').locator('.next-up-badge')).toHaveText('T1:E2');

    await gotoTab(page, 'watchlist');
    await expect(listCard(page, 'Breaking Bad').locator('select.status-select')).toHaveValue('watching');
    await expect(page.locator('#watchlist-example-text')).toContainText('3 títulos do exemplo ainda sem uso');

    await page.getByRole('button', { name: 'Remover exemplo' }).click();
    await expect(toast(page, 'Exemplo removido: 3 títulos. O que você já usou ficou na lista.')).toBeVisible();
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(1);
    await expect(listCard(page, 'Breaking Bad')).toBeVisible();
    await expect(listCard(page, 'Breaking Bad').locator('.show-progress-info')).toContainText('1/3 eps');
    await expect(page.locator('#watchlist-example-bar')).toBeHidden();
  });
});
