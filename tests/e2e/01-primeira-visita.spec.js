// S12 · Primeira visita: lista vazia (sem dados de enfeite) e biblioteca semeada pelo helper (D-22, S08).
// Visitante, sem conta: tudo fica no navegador (localStorage). Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, seedLibrary, queueCard, listCard } = require('./support/helpers');

const EXAMPLE_TITLES = ['Interestelar (Interstellar)', 'Oppenheimer', 'Breaking Bad', 'Attack on Titan (Shingeki no Kyojin)'];

test.describe('primeira visita', () => {
  test('começa vazia e sem dados de enfeite, em todas as abas', async ({ page }) => {
    await openApp(page);

    await expect(page.locator('#next-up-empty')).toBeVisible();
    await expect(page.locator('#next-up-empty .empty-title')).toHaveText('Sua lista está vazia');
    await expect(page.locator('#next-up-empty').getByRole('button', { name: 'Explorar' })).toBeVisible();
    for (const badge of ['next-up', 'watchlist', 'diary']) await expect(page.locator(`#badge-${badge}`)).toHaveText('0');
    await expect(page.locator('#sync-label')).toHaveText('Só neste aparelho');
    await expect(page.locator('#btn-open-auth')).toBeVisible();

    await gotoTab(page, 'watchlist');
    await expect(page.locator('#watchlist-empty')).toBeVisible();
    await expect(page.locator('#watchlist-empty-title')).toHaveText('Sua lista está vazia');
    await expect(page.locator('#watchlist-empty').getByRole('button', { name: 'Explorar' })).toBeVisible();
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(0);

    await gotoTab(page, 'diary');
    await expect(page.locator('#diary-empty')).toBeVisible();

    await gotoTab(page, 'stats');
    await expect(page.locator('#stat-episodes-count')).toHaveText('0');
    await expect(page.locator('#stat-minutes-subtext')).toHaveText('0 minutos assistidos');
  });

  test('biblioteca semeada: 4 títulos em "Quero ver", na fila de A Seguir e na Minha Lista', async ({ page }) => {
    await openApp(page);
    await seedLibrary(page);

    // A Seguir: os 4 títulos esperam na fila, sem nada assistido
    await expect(page.locator('#next-up-counter-pill')).toHaveText('4 títulos na fila');
    await expect(page.locator('#badge-next-up')).toHaveText('4');
    for (const name of ['Interestelar', 'Oppenheimer', 'Breaking Bad', 'Attack on Titan'])
      await expect(queueCard(page, name)).toHaveCount(1);
    await expect(queueCard(page, 'Breaking Bad').locator('.next-up-badge')).toHaveText('T1:E1');
    await expect(queueCard(page, 'Oppenheimer').locator('.next-up-badge')).toHaveText('FILME');

    // Minha Lista: 4 cartões "Quero ver"
    await gotoTab(page, 'watchlist');
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(4);
    await expect(page.locator('#count-all')).toHaveText('4');
    await expect(page.locator('#count-plan')).toHaveText('4');
    for (const title of EXAMPLE_TITLES) {
      await expect(listCard(page, title).locator('select.status-select')).toHaveValue('plan_to_watch');
    }

    // Continua lá depois de recarregar a página (localStorage)
    await page.reload();
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
  });
});
