// Estatísticas: "Suas notas" sempre com a grade completa (mesmo vazia) e "Top gêneros" só com obras que estão em Minha Lista.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, seedLibrary } = require('./support/helpers');

test.describe('estatísticas', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('suas notas vazio mostra as 5 faixas em zero, sem o texto antigo', async ({ page }) => {
    await gotoTab(page, 'stats');
    const rows = page.locator('#stats-rating-chart .stat-bar-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.locator('.stat-bar-count')).toHaveText(['0', '0', '0', '0', '0']);
    await expect(page.locator('#stats-rating-chart')).not.toContainText('ainda não deu nenhuma nota');
    await expect(page.locator('#view-stats')).not.toContainText('Abra uma obra da lista');
  });

  test('top gêneros: lista vazia mostra texto natural; remover a obra tira o gênero dela do ranking', async ({ page }) => {
    await gotoTab(page, 'stats');
    await expect(page.locator('#stats-genres-list')).toContainText('Adicione obras com gênero à sua lista');

    await seedLibrary(page);
    const info = await page.evaluate(() => {
      const s = window.appState;
      const genresOf = id => (s.getMedia(id).genres || []).slice();
      return { bb: genresOf(1396), others: [157336, 872585, 1429].map(genresOf) };
    });
    const onlyBb = info.bb.filter(g => !info.others.some(list => list.includes(g)));
    expect(onlyBb.length).toBeGreaterThan(0); // o fake data tem gênero exclusivo de Breaking Bad

    await gotoTab(page, 'stats');
    const list = page.locator('#stats-genres-list');
    for (const g of info.bb) await expect(list.locator('.stat-bar-label', { hasText: g }).first()).toBeVisible();
    for (const g of onlyBb) await expect(list.locator('.stat-bar-row', { hasText: g }).locator('.stat-bar-count')).toHaveText('1');

    await page.evaluate(() => {
      window.appState.removeShow(1396);
      window.appController.refreshAll();
    });
    await gotoTab(page, 'stats');
    for (const g of onlyBb) await expect(list.locator('.stat-bar-label', { hasText: g })).toHaveCount(0);
  });
});
