// S18 · App instalável e modo offline: manifesto, service worker, consulta sem internet e mensagem de aviso.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, loadExample } = require('./support/helpers');

// o resto da suíte bloqueia service workers (playwright.config.js); este arquivo precisa deles
test.use({ serviceWorkers: 'allow' });

test.describe('modo offline', () => {
  test('registra o service worker e a lista continua aparecendo sem internet', async ({ page, context, guard }) => {
    await openApp(page);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await loadExample(page);
    // espera o service worker assumir o controle da página
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect(page.locator('#badge-watchlist')).toHaveText('4');

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#badge-watchlist')).toHaveText('4'); // a lista mora no aparelho; o app abre do cache
    await expect(page.locator('body')).toHaveClass(/is-offline/);
    await context.setOffline(false);
    guard.consoleErrors.length = 0; // sem internet o navegador registra falhas de rede esperadas (consulta de login e fontes)
  });
});
