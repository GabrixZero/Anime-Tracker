// Landing page: quem não está logado vê a apresentação; quem está logado vai direto ao app. Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { AxeBuilder } = require('@axe-core/playwright');
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
    await expect(page.getByRole('link', { name: 'themoviedb.org' })).toBeVisible();
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

  for (const largura of [375, 1024, 1280, 1920]) {
    test(`sem rolagem horizontal em ${largura}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.goto('/');
      const o = await horizontalOverflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth);
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
