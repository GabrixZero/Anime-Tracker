// S12 · Guardas transversais: (1) o detector de erros funciona, (2) cabeçalhos de segurança/CSP, (3) nada vaza da largura em 375 px,
// (4) o botão do Google só existe com GOOGLE_CLIENT_ID. A guarda de "zero erro de console / zero violação de CSP / zero rede externa"
// vale para TODOS os testes (fixture `guard`); aqui está a prova de que ela enxerga os problemas e os casos que ela não cobre sozinha.
// Roda em desktop e mobile (o teste de largura só no mobile).
'use strict';

const { test, expect } = require('./support/fixtures');
const { freePort, prepareDataDir, removeDataDir, startApp } = require('./support/app-server');
const { openApp, gotoTab, loadExample, tap, horizontalOverflow } = require('./support/helpers');

test.describe('detector de problemas do navegador', () => {
  test('enxerga erro de console, exceção e violação de CSP (a prova de que "zero erros" não é vazio)', async ({ page, guard }) => {
    await openApp(page);
    await page.evaluate(() => {
      console.error('erro proposital do teste');
      const script = document.createElement('script'); // script inline: script-src não tem 'unsafe-inline'
      script.textContent = 'window.__scriptInline = 1';
      document.head.append(script);
      document.body.setAttribute('style', 'color: red'); // style="" inline: style-src também não
      setTimeout(() => {
        throw new Error('exceção proposital do teste');
      }, 0);
    });

    await expect.poll(() => guard.pageErrors.length).toBe(1);
    await expect.poll(() => guard.cspViolations.length).toBeGreaterThanOrEqual(2);
    expect(guard.consoleErrors.join('\n')).toContain('erro proposital do teste');
    expect(guard.pageErrors.join('\n')).toContain('exceção proposital do teste');
    expect(guard.cspViolations.map(v => v.directive)).toEqual(expect.arrayContaining(['script-src-elem', 'style-src-attr']));
    // e o bloqueio é de verdade: o script inline não rodou
    expect(await page.evaluate(() => window.__scriptInline)).toBeUndefined();
    expect(guard.problems().length).toBeGreaterThanOrEqual(4);

    // era de propósito: zera para o guard do fim do teste não reprovar
    guard.consoleErrors.length = 0;
    guard.pageErrors.length = 0;
    guard.cspViolations.length = 0;
    expect(guard.problems()).toEqual([]);
  });

  test('a primeira visita, o catálogo e um login não geram nenhum erro, violação ou pedido externo', async ({ page, guard }) => {
    await openApp(page);
    await loadExample(page);
    await gotoTab(page, 'explore');
    await expect(page.locator('#explore-container .show-card').first()).toBeVisible();
    await gotoTab(page, 'stats');
    await tap(page.locator('#btn-open-backup'));
    await page.keyboard.press('Escape');
    await page.locator('#btn-open-auth').click();
    await page.keyboard.press('Escape');
    expect(guard.problems()).toEqual([]);
    expect(guard.externalImages, 'as capas vêm de sites externos, simulados pelo guard').toBeGreaterThan(0);
  });
});

test.describe('cabeçalhos de segurança', () => {
  test('CSP estrita: sem unsafe-inline nem eval em scripts, sem unsafe-inline em estilos (Google desligado), sem objetos e sem ser enquadrada', async ({
    request
  }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const csp = res.headers()['content-security-policy'];
    expect(csp, 'a página precisa vir com Content-Security-Policy').toBeTruthy();
    const directive = name =>
      csp
        .split(';')
        .map(d => d.trim())
        .find(d => d.startsWith(`${name} `)) || '';

    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('script-src')).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(directive('style-src')).not.toMatch(/unsafe-inline|unsafe-eval/); // o unsafe-inline de estilo só existe com o login Google (testado abaixo)
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-powered-by']).toBeUndefined();
    // o HTML nunca é guardado sem conferir
    expect(res.headers()['cache-control']).toContain('no-cache');
  });
});

test.describe('largura em 375 px', () => {
  test('nenhuma tela nem janela tem rolagem horizontal', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'só faz sentido na largura de celular');
    const widest = async () =>
      page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        return [...document.querySelectorAll('body *')]
          .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > limit + 1 && !el.closest('.type-filter-row--scroll, .season-tabs, [aria-hidden="true"]');
          })
          .slice(0, 5)
          .map(el => `${el.tagName.toLowerCase()}#${el.id}.${String(el.className).replace(/\s+/g, '.')}`);
      });
    const fits = async label => {
      const o = await horizontalOverflow(page);
      expect(o.innerWidth, 'a janela do teste é de celular').toBe(375);
      expect(
        o.scrollWidth,
        `${label}: a página não pode passar da largura (elementos largos: ${(await widest()).join(', ')})`
      ).toBeLessThanOrEqual(o.clientWidth);
    };

    await openApp(page);
    await fits('A Seguir (vazia)');
    await loadExample(page);
    await fits('A Seguir (com exemplo)');
    await gotoTab(page, 'watchlist');
    await fits('Minha Lista');
    await gotoTab(page, 'diary');
    await fits('Diário');
    await gotoTab(page, 'stats');
    await fits('Estatísticas');
    await gotoTab(page, 'explore');
    await expect(page.locator('#explore-container .show-card').first()).toBeVisible();
    await fits('Explorar (catálogo)');
    await page.locator('#explore-search-input').fill('Fronteira');
    await page.locator('#explore-search-input').press('Enter');
    await expect(page.locator('#explore-results-title')).toHaveText(/^Resultados para/);
    await fits('Explorar (busca)');

    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: 'Breaking Bad', exact: true }));
    await expect(page.locator('#modal-show-detail')).toBeVisible();
    await fits('Janela da obra');
    await tap(page.locator('#show-episodes-container .episode-row[data-ep="1"]').getByRole('button', { name: /^Anotar/ }));
    await expect(page.locator('#modal-episode-note')).toBeVisible();
    await fits('Janela da anotação');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await tap(page.locator('#btn-open-backup'));
    await fits('Janela de backup');
    await page.keyboard.press('Escape');
    await page.locator('#btn-open-auth').click();
    await page.locator('#tvtime-tab-register').click();
    await fits('Janela de cadastro');
  });
});

// Login com Google: só confere se o botão APARECE com GOOGLE_CLIENT_ID e SOME sem ele. Nunca fala com accounts.google.com: o script do
// Google é trocado por um falso aqui no teste (o guard bloquearia qualquer pedido de verdade) e o servidor nunca recebe credencial.
const GOOGLE_STUB = `
  window.google = { accounts: { id: {
    initialize(config) { window.__googleConfig = config; },
    renderButton(element, options) {
      window.__googleButtonOptions = options;
      const fake = document.createElement('div');
      fake.id = 'google-botao-simulado';
      fake.setAttribute('role', 'button');
      fake.textContent = 'Continuar com o Google (simulado)';
      element.append(fake);
    }
  } } };
`;
const FAKE_CLIENT_ID = 'cliente-de-teste-e2e.apps.googleusercontent.com';

test.describe('login com Google', () => {
  test('sem GOOGLE_CLIENT_ID o botão não existe e o app nem tenta carregar o script do Google', async ({ page, request }) => {
    const config = await (await request.get('/api/auth/config')).json();
    expect(config.googleClientId).toBeNull();

    const loaded = [];
    page.on('request', r => {
      if (new URL(r.url()).hostname === 'accounts.google.com') loaded.push(r.url());
    });
    await openApp(page);
    await page.locator('#btn-open-auth').click();
    await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
    await expect(page.locator('#google-signin-section')).toBeHidden();
    await expect(page.locator('script[src*="accounts.google.com"]')).toHaveCount(0);
    expect(loaded).toEqual([]);

    // a rota do servidor também está desligada (501), não é só esconder o botão
    const response = await request.post('/api/auth/google', { data: { credential: 'qualquer-coisa' } });
    expect(response.status()).toBe(501);
  });

  test.describe('com GOOGLE_CLIENT_ID (servidor à parte)', () => {
    let server;
    let dataDir;

    // eslint-disable-next-line no-empty-pattern
    test.beforeAll(async ({}, testInfo) => {
      dataDir = prepareDataDir({ withExtraCatalog: false });
      server = await startApp({
        port: await freePort(),
        dataDir,
        env: { GOOGLE_CLIENT_ID: FAKE_CLIENT_ID },
        logFile: testInfo.outputPath('servidor-google.log')
      });
    });

    test.afterAll(async () => {
      if (server) await server.stop();
      removeDataDir(dataDir);
    });

    test('o botão aparece (script do Google simulado) e a CSP libera só o necessário para ele', async ({ page, context }) => {
      await context.route('https://accounts.google.com/gsi/client', route =>
        route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GOOGLE_STUB })
      );

      const home = await page.request.get(`${server.url}/`);
      const csp = home.headers()['content-security-policy'];
      expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
      const style = csp
        .split(';')
        .map(d => d.trim())
        .find(d => d.startsWith('style-src '));
      expect(style, 'o botão do Google injeta estilo: só com o login Google o estilo inline é aceito').toContain("'unsafe-inline'");
      expect(
        csp
          .split(';')
          .map(d => d.trim())
          .find(d => d.startsWith('script-src '))
      ).not.toContain('unsafe-inline');
      const config = await (await page.request.get(`${server.url}/api/auth/config`)).json();
      expect(config.googleClientId).toBe(FAKE_CLIENT_ID);

      await page.goto(server.url);
      await page.locator('#btn-open-auth').click();
      await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
      await expect(page.locator('#google-signin-section')).toBeVisible();
      await expect(page.locator('#google-signin-button #google-botao-simulado')).toBeVisible();
      expect(await page.evaluate(() => window.__googleConfig.client_id)).toBe(FAKE_CLIENT_ID);
      expect(await page.evaluate(() => window.__googleButtonOptions.locale)).toBe('pt-BR');
      // o login por e-mail continua ali, logo abaixo
      await expect(page.locator('#tvtime-auth-form')).toBeVisible();
    });
  });
});
