// S14 · Contas completas: "Minha conta" (trocar senha, sair de todos os aparelhos, excluir conta), "Perdi a senha" e cadastro por convite.
// O convite roda num servidor à parte (INVITE_CODES só nele), com um código inventado a cada execução: nenhum código real aparece aqui.
'use strict';

const crypto = require('crypto');
const { test, expect } = require('./support/fixtures');
const { freePort, prepareDataDir, removeDataDir, startApp } = require('./support/app-server');
const { TOKEN_KEY, openApp, toast, newUser, loginViaUi, logoutViaUi, signInWithApi, acceptNextDialog, tap } = require('./support/helpers');

const NEW_PASSWORD = 'outra-senha-e2e-456';

const openAccount = async page => {
  await page.locator('#btn-open-account').click();
  await expect(page.locator('#modal-account')).toBeVisible();
};

test.describe('minha conta', () => {
  test('perfil, trocar senha (com avisos) e entrar de novo com a senha nova', async ({ page, guard }, testInfo) => {
    guard.allow(/status of 403/, /\[API Error\] \/auth\/change-password/);
    const user = newUser(testInfo, 'senha');
    await signInWithApi(page, user);
    await openAccount(page);

    await expect(page.locator('#account-name')).toHaveText(user.name);
    await expect(page.locator('#account-email')).toHaveText(user.email);
    await expect(page.locator('#account-provider')).toHaveText('E-mail e senha');

    const message = page.locator('#account-password-msg');
    await page.locator('#account-current-password').fill(user.password);
    await page.locator('#account-new-password').fill(NEW_PASSWORD);
    await page.locator('#account-confirm-password').fill('nao-confere-123');
    await tap(page.locator('#btn-account-password'));
    await expect(message).toHaveText('A confirmação não é igual à nova senha.');

    await page.locator('#account-current-password').fill('senha-atual-errada-1');
    await page.locator('#account-confirm-password').fill(NEW_PASSWORD);
    await tap(page.locator('#btn-account-password'));
    await expect(message).toHaveText('Senha atual incorreta.');

    await page.locator('#account-current-password').fill(user.password);
    await tap(page.locator('#btn-account-password'));
    await expect(toast(page, 'Senha alterada com sucesso.')).toBeVisible();
    await expect(page.locator('#account-current-password')).toHaveValue('');
    // este aparelho recebeu um token novo e continua dentro
    await page.reload();
    await expect(page.locator('#user-logged-profile')).toBeVisible();
    await expect(page.locator('#user-display-name')).toHaveText(user.name);

    await logoutViaUi(page);
    await loginViaUi(page, { ...user, password: NEW_PASSWORD });
  });

  test('sair de todos os aparelhos derruba o outro aparelho e este também', async ({ page, device, guard }, testInfo) => {
    guard.allow(/status of 401/, /\[API Error\] \//);
    const user = newUser(testInfo, 'todos');
    await signInWithApi(page, user);

    const { page: laptop } = await device();
    await openApp(laptop);
    await loginViaUi(laptop, user);

    await openAccount(page);
    acceptNextDialog(page);
    await tap(page.locator('#btn-logout-all'));
    await expect(page.locator('#btn-open-auth')).toBeVisible();
    await expect(page.locator('#modal-account')).toBeHidden();
    await expect(toast(page, 'Você saiu de todos os aparelhos.')).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), TOKEN_KEY)).toBeNull();

    // o outro aparelho: o token guardado agora é recusado pelo servidor e a sessão acaba
    await laptop.reload();
    await expect(laptop.locator('#btn-open-auth')).toBeVisible();
    await expect.poll(() => laptop.evaluate(key => localStorage.getItem(key), TOKEN_KEY)).toBeNull();

    // entrar de novo funciona
    await loginViaUi(page, user);
  });

  test('excluir conta: pede a senha, apaga tudo e o login deixa de funcionar', async ({ page, guard }, testInfo) => {
    guard.allow(/status of 40[13]/, /\[API Error\] \//);
    const user = newUser(testInfo, 'excluir');
    await signInWithApi(page, user);
    await openAccount(page);

    const message = page.locator('#account-delete-msg');
    await tap(page.locator('#btn-account-delete'));
    await expect(message).toHaveText('Digite sua senha para confirmar a exclusão.');
    await page.locator('#account-delete-password').fill('senha-errada-123');
    acceptNextDialog(page);
    await tap(page.locator('#btn-account-delete'));
    await expect(message).toHaveText('Senha incorreta. A conta não foi excluída.');
    await expect(page.locator('#user-logged-profile')).toBeVisible();

    await page.locator('#account-delete-password').fill(user.password);
    acceptNextDialog(page);
    await tap(page.locator('#btn-account-delete'));
    await expect(toast(page, 'Conta e biblioteca excluídas.')).toBeVisible();
    await expect(page.locator('#btn-open-auth')).toBeVisible();
    await expect(page.locator('#modal-account')).toBeHidden();

    await page.locator('#btn-open-auth').click();
    await page.locator('#input-tvtime-email').fill(user.email);
    await page.locator('#input-tvtime-password').fill(user.password);
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(page.locator('#tvtime-auth-error')).toHaveText('E-mail ou senha incorretos.');
  });
});

test.describe('login: "Perdi a senha"', () => {
  test('só mostra o aviso "Em breve" e some no cadastro', async ({ page }) => {
    await openApp(page);
    await page.locator('#btn-open-auth').click();
    await expect(page.locator('#tvtime-forgot-note')).toBeHidden();
    await tap(page.locator('#btn-forgot-password'));
    await expect(page.locator('#tvtime-forgot-note')).toHaveText('Em breve: recuperação por e-mail.');
    await page.locator('#tvtime-tab-register').click();
    await expect(page.locator('#btn-forgot-password')).toBeHidden();
    await expect(page.locator('#tvtime-forgot-note')).toBeHidden();
    // sem convite configurado neste servidor, o campo não existe no cadastro
    await expect(page.locator('#tvtime-invite-field')).toBeHidden();
  });
});

test.describe('cadastro por convite (servidor à parte)', () => {
  const code = `convite-${crypto.randomBytes(9).toString('hex')}`;
  let server;
  let dataDir;

  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    dataDir = prepareDataDir({ withExtraCatalog: false });
    server = await startApp({
      port: await freePort(),
      dataDir,
      env: { INVITE_CODES: code },
      logFile: testInfo.outputPath('servidor-convite.log')
    });
  });

  test.afterAll(async () => {
    if (server) await server.stop();
    removeDataDir(dataDir);
  });

  test('o campo aparece, código errado é recusado com mensagem neutra e cada código vale uma vez', async ({ page, guard }, testInfo) => {
    guard.allow(/status of 403/, /\[API Error\] \/auth\/register/);
    const first = newUser(testInfo, 'conv1');
    const second = newUser(testInfo, 'conv2');
    await openApp(page, server.url);
    await page.locator('#btn-open-auth').click();
    await expect(page.locator('#tvtime-invite-field')).toBeHidden(); // no "Entrar" não há convite
    await page.locator('#tvtime-tab-register').click();
    await expect(page.locator('#tvtime-invite-field')).toBeVisible();

    const error = page.locator('#tvtime-auth-error');
    const invalid = 'Código de convite inválido ou já utilizado. Peça um novo código a quem convidou você.';
    await page.locator('#input-tvtime-email').fill(first.email);
    await page.locator('#input-tvtime-password').fill(first.password);
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(error).toHaveText('Informe o código de convite.');
    await page.locator('#input-tvtime-invite').fill('codigo-que-nao-existe');
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(error).toHaveText(invalid);
    await expect(page.locator('#btn-open-auth')).toBeVisible(); // nada de conta criada

    await page.locator('#input-tvtime-invite').fill(code);
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(page.locator('#tvtime-auth-modal')).toBeHidden();
    await expect(page.locator('#user-logged-profile')).toBeVisible();

    // o mesmo código não serve para uma segunda pessoa
    await logoutViaUi(page);
    await page.locator('#btn-open-auth').click();
    await page.locator('#tvtime-tab-register').click();
    await page.locator('#input-tvtime-email').fill(second.email);
    await page.locator('#input-tvtime-password').fill(second.password);
    await page.locator('#input-tvtime-invite').fill(code);
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(error).toHaveText(invalid);
  });
});
