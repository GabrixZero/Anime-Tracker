// Ajudantes dos testes E2E (S12): abrir o app, trocar de aba, criar conta, conferir o que o servidor guardou...
// Tudo usa os mesmos seletores que uma pessoa "vê" (ids e textos da tela); nada de atalhos pelo código do app.
'use strict';

const crypto = require('crypto');
const { expect } = require('@playwright/test');
const { TEST_PASSWORD } = require('./constants');

const TOKEN_KEY = 'showvault_auth_token';
const STATE_KEY = 'showvault_state_mvc_v1';

// ---------------------------------------------------------------------------------------------------------------------------------
// Abrir e navegar
// ---------------------------------------------------------------------------------------------------------------------------------

// A fila "A Seguir" foi desenhada ao menos uma vez (inclusive depois de carregar os episódios das obras da lista).
async function waitForBoot(page) {
  await expect(page.locator('#next-up-counter-pill')).toHaveText(/^\d+ títulos? na fila$|^Não carregou$/);
}

async function openApp(page, path = '/') {
  await page.goto(path);
  await waitForBoot(page);
}

// Sessão com conta: o cabeçalho mostra o perfil e o selo termina de sincronizar ("Sincronizado"/nuvem em dia).
async function waitForCloudIdle(page) {
  await expect(page.locator('#user-logged-profile')).toBeVisible();
  await expect(page.locator('#sync-status')).toHaveAttribute('data-sync-state', 'idle');
}

async function gotoTab(page, id) {
  await page.locator(`#tab-btn-${id}`).click();
  await expect(page.locator(`#view-${id}`)).toHaveClass(/active/);
}

// Clique "de gente": limpa os avisos (toasts) e rola o elemento para o MEIO da janela antes de clicar. No celular o aviso (4,5 s) fica
// por cima do conteúdo e recebe o toque no lugar do botão: o Playwright repetia o clique a cada 500 ms até o aviso sumir (testes de 1 s
// viravam 6 s). O texto do aviso já foi conferido antes; aqui só tiramos ele da frente. (Observação para a S19: `pointer-events: none`.)
async function tap(locator) {
  await locator.page().evaluate(() => document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()));
  await locator.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await locator.click();
}

const toast = (page, text) => page.locator('.toast', { hasText: text });

// confirm()/prompt() do app: aceita o próximo diálogo (o Playwright recusa sozinho se ninguém ouvir).
function acceptNextDialog(page, { text } = {}) {
  page.once('dialog', dialog => dialog.accept(text));
}

// Cartões da aba "Minha Lista" / "A Seguir" / Explorar pelo nome da obra.
const listCard = (page, name) =>
  page.locator('#watchlist-container .show-card').filter({ has: page.getByRole('button', { name, exact: true }) });
const queueCard = (page, name) =>
  page.locator('#next-up-container .next-up-card').filter({ has: page.locator('.next-up-show-name', { hasText: name }) });
const exploreCard = (page, name) =>
  page.locator('#explore-container .show-card').filter({ has: page.getByRole('button', { name, exact: true }) });

// ---------------------------------------------------------------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------------------------------------------------------------

// Conta só deste teste: e-mail único (domínio reservado .test), nome legível e a senha dos testes.
function newUser(testInfo, label = 'u') {
  const unique = `${testInfo.parallelIndex}-${crypto.randomBytes(4).toString('hex')}`;
  return { name: `Teste ${label} ${unique.slice(-6)}`, email: `e2e-${label}-${unique}@exemplo.test`, password: TEST_PASSWORD };
}

// Cadastro pela tela (como uma pessoa faria).
async function registerViaUi(page, user) {
  await page.locator('#btn-open-auth').click();
  await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
  await page.locator('#tvtime-tab-register').click();
  await page.locator('#input-tvtime-name').fill(user.name);
  await page.locator('#input-tvtime-email').fill(user.email);
  await page.locator('#input-tvtime-password').fill(user.password);
  await page.locator('#btn-tvtime-auth-submit').click();
  await expect(page.locator('#tvtime-auth-modal')).toBeHidden();
  await waitForCloudIdle(page);
}

// Login pela tela.
async function loginViaUi(page, user) {
  await page.locator('#btn-open-auth').click();
  await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
  await page.locator('#input-tvtime-email').fill(user.email);
  await page.locator('#input-tvtime-password').fill(user.password);
  await page.locator('#btn-tvtime-auth-submit').click();
  await expect(page.locator('#tvtime-auth-modal')).toBeHidden();
  await waitForCloudIdle(page);
}

async function logoutViaUi(page) {
  acceptNextDialog(page);
  await page.locator('#btn-logout').click();
  await expect(page.locator('#btn-open-auth')).toBeVisible();
  await expect(page.locator('#sync-label')).toHaveText('Só neste aparelho');
}

// Atalho para os testes que não são sobre contas: cria a conta pela API e entra no app já com a sessão aberta.
async function signInWithApi(page, user) {
  const response = await page.request.post('/api/auth/register', { data: { name: user.name, email: user.email, password: user.password } });
  expect(response.status(), 'cadastro pela API').toBe(201);
  const { token } = await response.json();
  // Um arquivo estático da mesma origem serve para gravar o localStorage antes de o app carregar (sem abrir o app duas vezes).
  await page.goto('/img/poster-placeholder.svg');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [TOKEN_KEY, token]);
  await openApp(page);
  await waitForCloudIdle(page);
  return token;
}

// O que o SERVIDOR guarda da biblioteca desta sessão (para esperar o envio, ver a remoção com marca de exclusão...).
async function serverLibrary(page) {
  return page.evaluate(async key => {
    const response = await fetch('/api/user/library', { headers: { Authorization: `Bearer ${localStorage.getItem(key)}` } });
    const body = await response.json();
    return body.data;
  }, TOKEN_KEY);
}

// O que o NAVEGADOR guarda (estado local do app).
async function localLibrary(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), STATE_KEY);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Atalhos de tela
// ---------------------------------------------------------------------------------------------------------------------------------

// "Carregar exemplo" no estado vazio de A Seguir: 4 obras (Interestelar, Oppenheimer, Breaking Bad, Attack on Titan) como "Quero ver".
async function loadExample(page) {
  await page.locator('#next-up-empty').getByRole('button', { name: 'Carregar exemplo' }).click();
  await expect(toast(page, 'Exemplo carregado: 4 títulos')).toBeVisible();
  await expect(page.locator('#badge-watchlist')).toHaveText('4');
}

// A página não tem rolagem horizontal (nada vaza além da largura da janela).
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth
    };
  });
}

module.exports = {
  TOKEN_KEY,
  STATE_KEY,
  waitForBoot,
  openApp,
  waitForCloudIdle,
  gotoTab,
  tap,
  toast,
  acceptNextDialog,
  listCard,
  queueCard,
  exploreCard,
  newUser,
  registerViaUi,
  loginViaUi,
  logoutViaUi,
  signInWithApi,
  serverLibrary,
  localLibrary,
  loadExample,
  horizontalOverflow
};
