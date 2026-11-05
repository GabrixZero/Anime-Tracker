// Landing page: quem não está logado vê a apresentação; quem está logado vai direto ao app. Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { AxeBuilder } = require('@axe-core/playwright');
const { freePort, prepareDataDir, removeDataDir, startApp } = require('./support/app-server');
const { newUser, signInWithApi, waitForBoot, horizontalOverflow, TOKEN_KEY } = require('./support/helpers');

const view = page => page.locator('html').getAttribute('data-view');

test.describe('landing page', () => {
  test('visitante vê a landing (um h1, título próprio) e o app fica escondido', async ({ page }) => {
    await page.goto('/');
    expect(await view(page)).toBe('landing');
    await expect(page).toHaveTitle(/ShowVault/);
    await expect(page.locator('h1:visible')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ShowVault');
    await expect(page.locator('#main-nav')).toBeHidden();
    await expect(page.locator('.lp-header').getByRole('button', { name: 'Entrar' })).toBeVisible();
    await expect(page.locator('footer')).toHaveCount(0);
  });

  test('"Entrar" e "Criar conta" abrem o modal existente', async ({ page }) => {
    await page.goto('/');
    await page.locator('.lp-header').getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
    await expect(page.locator('#tvtime-tab-login')).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tvtime-auth-modal')).toBeHidden();

    await page.locator('.lp-header').getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
    await expect(page.locator('#tvtime-tab-register')).toHaveClass(/active/);
    expect(await view(page)).toBe('landing'); // fechar o modal não leva ao app
  });

  test('"Usar sem conta" entra no app e a escolha fica lembrada', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Usar sem conta' }).click();
    await waitForBoot(page);
    expect(await view(page)).toBe('app');
    await expect(page.locator('#sync-label')).toHaveText('Só neste aparelho');
    await page.reload();
    expect(await view(page)).toBe('app');
    await expect(page.locator('#landing')).toBeHidden();
  });

  test('quem está logado vai direto ao app, sem a landing', async ({ page }, testInfo) => {
    await signInWithApi(page, newUser(testInfo, 'lp'));
    expect(await view(page)).toBe('app');
    await expect(page.locator('#landing')).toBeHidden();
    await page.reload();
    expect(await view(page)).toBe('app');
    await expect(page.locator('#user-logged-profile')).toBeVisible();
  });

  test('criar conta pela landing leva ao app', async ({ page }, testInfo) => {
    const user = newUser(testInfo, 'lpc');
    await page.goto('/');
    await page.locator('.lp-header').getByRole('button', { name: 'Criar conta' }).click();
    await page.locator('#input-tvtime-name').fill(user.name);
    await page.locator('#input-tvtime-email').fill(user.email);
    await page.locator('#input-tvtime-password').fill(user.password);
    await page.locator('#btn-tvtime-auth-submit').click();
    await expect(page.locator('#user-logged-profile')).toBeVisible();
    expect(await view(page)).toBe('app');
    expect(await page.evaluate(key => !!localStorage.getItem(key), TOKEN_KEY)).toBe(true);
  });

  test('mockup: 3 títulos reais com pôster do TMDB (fonte falsa), sem rodapé', async ({ page }) => {
    await page.goto('/');
    for (const title of ['Harry Potter', 'Naruto Shippuden', 'Homem-Aranha: Através do Aranhaverso']) {
      await expect(page.locator('.lp-mock-title', { hasText: title })).toBeVisible();
      const img = page.locator('.lp-mock-img[alt="' + title + '"]');
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute('src', /^https:\/\/image\.tmdb\.org\/t\/p\/w342\//);
      await expect(img).toHaveAttribute('width', '48');
      await expect(img).toHaveAttribute('loading', 'lazy');
    }
    await expect(page.locator('footer')).toHaveCount(0);
  });

  test('Créditos abre pelo modal de entrar, pelo mockup e pelo Minha conta, com as fontes', async ({ page }, testInfo) => {
    const checkPage = async () => {
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Créditos');
      await expect(page.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toBeVisible();
      for (const href of [
        'https://www.themoviedb.org/',
        'https://www.tvmaze.com/',
        'https://anilist.co/',
        'https://github.com/Fribb/anime-lists'
      ]) {
        await expect(page.locator('a[href="' + href + '"]')).toBeVisible();
      }
      const o = await horizontalOverflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .options({ preload: false })
        .analyze();
      expect(result.violations.map(v => v.id)).toEqual([]);
    };
    await page.goto('/');
    await page.locator('.lp-header').getByRole('button', { name: 'Entrar' }).click();
    await page.locator('#tvtime-auth-modal').getByRole('link', { name: 'Créditos' }).click();
    await expect(page).toHaveURL(/creditos\.html$/);
    await checkPage();

    await page.goto('/');
    await page.locator('.lp-mock-credit').getByRole('link').click();
    await expect(page).toHaveURL(/creditos\.html$/);

    await signInWithApi(page, newUser(testInfo, 'cr'));
    await page.locator('#btn-open-account').click();
    await page.locator('#modal-account').getByRole('link', { name: 'Créditos' }).click();
    await expect(page).toHaveURL(/creditos\.html$/);
    await checkPage();
  });

  test('app principal também não tem rodapé de créditos', async ({ page }, testInfo) => {
    await signInWithApi(page, newUser(testInfo, 'nf'));
    await expect(page.locator('footer')).toHaveCount(0);
    await expect(page.locator('#app-credits')).toHaveCount(0);
  });

  for (const largura of [375, 1024, 1280, 1920]) {
    test(`sem rolagem horizontal em ${largura}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.goto('/');
      const o = await horizontalOverflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth);
      await page.goto('/creditos.html');
      const c = await horizontalOverflow(page);
      expect(c.scrollWidth).toBeLessThanOrEqual(c.innerWidth);
    });
  }

  test('axe: nenhuma violação (landing e modal de entrada abertos)', async ({ page }) => {
    await page.goto('/');
    const scan = async () =>
      (
        await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).options({ preload: false }).analyze()
      ).violations.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`);
    expect(await scan()).toEqual([]);
    await page.locator('.lp-header').getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
    expect(await scan()).toEqual([]);
  });
});

test.describe('landing sem chave do TMDB (servidor à parte)', () => {
  let server;
  let dataDir;
  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    dataDir = prepareDataDir({ withExtraCatalog: false });
    server = await startApp({
      port: await freePort(),
      dataDir,
      env: { TMDB_API_KEY: '' },
      logFile: testInfo.outputPath('servidor-sem-chave.log')
    });
  });
  test.afterAll(async () => {
    if (server) await server.stop();
    removeDataDir(dataDir);
  });

  test('só títulos sobre o cartão ilustrado, endpoint responde 200, sem rolagem horizontal', async ({ page }) => {
    const res = await page.request.get(server.url + '/api/landing/featured');
    expect(res.status()).toBe(200);
    expect((await res.json()).data.map(d => d.posterUrl)).toEqual([undefined, undefined, undefined]);
    await page.goto(server.url + '/');
    await expect(page.locator('.lp-mock-title', { hasText: 'Harry Potter' })).toBeVisible();
    await expect(page.locator('.lp-mock-title')).toHaveCount(3);
    await expect(page.locator('.lp-mock-img')).toHaveCount(0);
    const box = await page.locator('.lp-mock-poster').first().boundingBox();
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([48, 72]);
    const o = await horizontalOverflow(page);
    expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth);
  });
});
