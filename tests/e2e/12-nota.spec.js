// S17 · Nota pessoal de 0 a 10: dar 6.6 no modal, ver no cartão e nas estatísticas, rejeitar valor inválido e remover.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, toast, seedLibrary, listCard, tap } = require('./support/helpers');

const modal = page => page.locator('#modal-show-detail');

test.describe('nota pessoal', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await seedLibrary(page);
  });

  test('dar nota 6.6 no modal aparece no cartão e nas estatísticas; remover limpa tudo', async ({ page }) => {
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: 'Breaking Bad', exact: true }));
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByText('Nota do catálogo:')).toBeVisible();

    const input = modal(page).getByLabel('Minha nota (0 a 10)', { exact: false }).first();
    const clear = modal(page).getByRole('button', { name: 'Remover nota' });
    await expect(clear).toBeDisabled();

    // valor inválido: avisa e não grava
    await input.fill('2.35');
    await input.press('Enter');
    await expect(toast(page, 'Nota inválida').first()).toBeVisible();
    await expect(input).toHaveValue('');

    await input.fill('6.6');
    await input.press('Enter');
    await expect(toast(page, 'Nota salva: 6.6.').first()).toBeVisible();
    await expect(input).toHaveValue('6.6');
    await expect(clear).toBeEnabled();

    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await expect(listCard(page, 'Breaking Bad').locator('.rating-user-badge')).toHaveText('★ 6.6');

    await gotoTab(page, 'stats');
    await expect(page.locator('#stats-rating-summary')).toContainText('Média: 6.6');
    await expect(page.locator('#stats-rating-top')).toContainText('Breaking Bad');
    await expect(page.locator('#stats-rating-top')).toContainText('★ 6.6');

    // sobrevive a recarregar a página
    await page.reload();
    await gotoTab(page, 'watchlist');
    await expect(listCard(page, 'Breaking Bad').locator('.rating-user-badge')).toHaveText('★ 6.6');

    // remover pelo cartão
    await tap(listCard(page, 'Breaking Bad').getByRole('button', { name: 'Remover nota' }));
    await expect(toast(page, 'Nota removida.').first()).toBeVisible();
    await expect(listCard(page, 'Breaking Bad').locator('.rating-user-badge')).toHaveCount(0);
    await gotoTab(page, 'stats');
    await expect(page.locator('#stats-rating-summary')).toContainText('Média das notas');
    await expect(page.locator('#stats-rating-top')).toContainText('Nenhuma obra avaliada ainda');
  });
});
