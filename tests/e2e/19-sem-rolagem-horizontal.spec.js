// Layout: nenhuma tela pode criar rolagem horizontal na página, do celular (375 px) à tela grande (1920 px).
// Vale para visitante e para quem está com conta (o perfil no cabeçalho deixa a barra mais larga).
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, newUser, signInWithApi, seedLibrary } = require('./support/helpers');

const LARGURAS = [375, 1024, 1280, 1440, 1920];
const TELAS = ['next-up', 'watchlist', 'calendar', 'diary', 'stats', 'explore'];

async function conferirTelas(page, largura, sessao) {
  for (const tela of TELAS) {
    await gotoTab(page, tela);
    const medidas = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    expect(medidas.scrollWidth, `${sessao}, tela ${tela} em ${largura}px`).toBeLessThanOrEqual(medidas.innerWidth);
  }
}

test.describe('sem rolagem horizontal', () => {
  for (const largura of LARGURAS) {
    test(`visitante, largura ${largura}px: nenhuma tela passa da janela`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await openApp(page);
      await conferirTelas(page, largura, 'visitante');
    });

    test(`com conta e lista, largura ${largura}px: nenhuma tela passa da janela`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await signInWithApi(page, newUser(testInfo, 'overflow'));
      await seedLibrary(page);
      await conferirTelas(page, largura, 'com conta');
    });
  }
});
