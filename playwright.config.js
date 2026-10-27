// Playwright (S12, D-25): testes ponta a ponta do ShowVault no Chromium, sem internet.
//
//   npm run test:e2e:install   baixa o Chromium (uma vez; fica dentro de node_modules)
//   npm run test:e2e           roda tudo (desktop 1280x800 e mobile 375x812)
//
// O servidor do app (porta 3012, pasta de dados TEMPORÁRIA) e o servidor falso das fontes externas sobem e descem no global-setup
// (tests/e2e/support/global-setup.js); veja D-S12-2 para o motivo de não usar o `webServer` do Playwright. Os testes nunca tocam em
// server/data nem usam a internet. Quem roda é scripts/e2e.js, que guarda o navegador dentro do projeto (PLAYWRIGHT_BROWSERS_PATH=0).
'use strict';

const { defineConfig } = require('@playwright/test');
const { BASE_URL } = require('./tests/e2e/support/constants');

const CI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  outputDir: './test-results',
  globalSetup: require.resolve('./tests/e2e/support/global-setup.js'),

  timeout: 45_000,
  expect: { timeout: 8_000 },
  // Um arquivo por vez dentro do mesmo trabalhador (os testes de um arquivo contam uma história só); arquivos em paralelo.
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : CI ? 2 : 4,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: BASE_URL,
    // Chromium "inteiro" também no modo sem janela (headless): um só download, sem o headless-shell (veja test:e2e:install).
    channel: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Sem animações: o app respeita prefers-reduced-motion (variables.css, S05). As telas caem direto no estado final (nada de medir
    // contraste/posição no meio de um fade) e o teste não espera transições.
    reducedMotion: 'reduce',
    acceptDownloads: true,
    serviceWorkers: 'block',
    // Artefatos só quando algo falha (D-S12-7).
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },

  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }
  ]
});
