// S12 · Contas: cadastro, login, sessão que sobrevive ao recarregar, erros neutros, sair e ISOLAMENTO entre contas no mesmo navegador (S03, S04).
// Cada teste cria as próprias contas (e-mail único) no servidor temporário. Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const {
  TOKEN_KEY,
  STATE_KEY,
  openApp,
  gotoTab,
  toast,
  loadExample,
  queueCard,
  listCard,
  newUser,
  registerViaUi,
  loginViaUi,
  logoutViaUi,
  serverLibrary,
  localLibrary,
  tap
} = require('./support/helpers');

const authError = page => page.locator('#tvtime-auth-error');

test.describe('contas', () => {
  test('cadastro com validação, sessão que volta ao recarregar, sair e entrar de novo', async ({ page }, testInfo) => {
    const user = newUser(testInfo, 'conta');
    await openApp(page);

    await page.locator('#btn-open-auth').click();
    await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
    await expect(page.locator('#tvtime-name-field')).toBeHidden(); // "Entrar": só e-mail e senha
    await page.locator('#tvtime-tab-register').click();
    await expect(page.locator('#tvtime-name-field')).toBeVisible();
    await expect(page.locator('#tvtime-password-hint')).toBeVisible();
    await expect(page.locator('#btn-tvtime-auth-submit')).toHaveText('Cadastrar no Cofre');

    // validações do navegador (sem ir ao servidor)
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(authError(page)).toHaveText('Informe o e-mail.');
    await page.locator('#input-tvtime-email').fill('isto-nao-e-um-email');
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(authError(page)).toHaveText('E-mail inválido. Use o formato nome@exemplo.com.');
    await page.locator('#input-tvtime-email').fill(user.email);
    await page.locator('#input-tvtime-password').fill('1234567');
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(authError(page)).toHaveText('A senha precisa ter pelo menos 8 caracteres.');
    await page.locator('#input-tvtime-password').fill(user.password); // digitar de novo limpa o aviso
    await expect(authError(page)).toBeHidden();

    await page.locator('#input-tvtime-name').fill(user.name);
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(page.locator('#tvtime-auth-modal')).toBeHidden();
    await expect(toast(page, 'Conta criada com sucesso!')).toBeVisible();
    await expect(page.locator('#user-logged-profile')).toBeVisible();
    await expect(page.locator('#user-display-name')).toHaveText(user.name);
    await expect(page.locator('#btn-open-auth')).toBeHidden();
    await expect(page.locator('#sync-status')).toHaveAttribute('data-sync-state', 'idle');
    await expect(page.locator('#sync-label')).toHaveText('Nuvem Ativa');
    await expect(page.locator('#user-cloud-badge')).toHaveText('Sincronizado');
    await expect(page.locator('#user-avatar-img')).toHaveAttribute('alt', `Avatar de ${user.name}`);

    // a sessão volta sozinha depois de recarregar a página
    await page.reload();
    await expect(page.locator('#user-display-name')).toHaveText(user.name);
    await expect(page.locator('#sync-label')).toHaveText('Nuvem Ativa');

    // sair (pede confirmação) e entrar de novo na aba "Entrar"
    await logoutViaUi(page);
    await expect(toast(page, 'Sessão encerrada.')).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
    await loginViaUi(page, user);
    await expect(toast(page, 'Login realizado com sucesso!')).toBeVisible();
    await expect(page.locator('#user-display-name')).toHaveText(user.name);
  });

  test('erros são neutros: senha errada e e-mail repetido não dizem se a conta existe', async ({ page, guard }, testInfo) => {
    // 401 e 409 são o comportamento esperado aqui (o app também registra o erro da API no console de propósito)
    guard.allow(/status of 40[19]/, /\[API Error\] \/auth\//);
    const user = newUser(testInfo, 'neutro');
    await openApp(page);
    await registerViaUi(page, user);
    await logoutViaUi(page);

    // senha errada de uma conta que existe e e-mail que não existe dão EXATAMENTE a mesma mensagem
    await page.locator('#btn-open-auth').click();
    await page.locator('#input-tvtime-email').fill(user.email);
    await page.locator('#input-tvtime-password').fill('senha-errada-123');
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(authError(page)).toHaveText('E-mail ou senha incorretos.');
    await page.locator('#input-tvtime-email').fill('ninguem-' + user.email);
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(authError(page)).toHaveText('E-mail ou senha incorretos.');
    await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
    await expect(page.locator('#btn-open-auth')).toBeVisible(); // continua sem sessão

    // cadastrar um e-mail que já existe: mensagem genérica que manda usar "Entrar"
    await page.locator('#tvtime-tab-register').click();
    await page.locator('#input-tvtime-email').fill(user.email);
    await page.locator('#input-tvtime-password').fill(user.password);
    await tap(page.locator('#btn-tvtime-auth-submit'));
    await expect(authError(page)).toHaveText(
      'Não foi possível criar a conta com esses dados. Se você já tem cadastro, use a aba "Entrar".'
    );
    await expect(page.locator('#btn-tvtime-auth-submit')).toBeEnabled(); // o botão destravou

    // Esc fecha a janela e o foco volta para o botão "Entrar"
    await page.keyboard.press('Escape');
    await expect(page.locator('#tvtime-auth-modal')).toBeHidden();
    await expect(page.locator('#btn-open-auth')).toBeFocused();
  });

  test('token inválido no navegador: o app volta a visitante, sem quebrar', async ({ page, guard }) => {
    guard.allow(/status of 401/, /\[API Error\] \/auth\/me/);
    await page.goto('/img/poster-placeholder.svg');
    await page.evaluate(key => localStorage.setItem(key, 'isto.nao.e.um.token'), TOKEN_KEY);
    await openApp(page);
    await expect(page.locator('#btn-open-auth')).toBeVisible();
    await expect(page.locator('#user-logged-profile')).toBeHidden();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), TOKEN_KEY)).toBeNull(); // o token rejeitado é descartado
  });

  test('sair isola as contas: a próxima pessoa não vê nada, e cada conta recupera os próprios dados', async ({ page }, testInfo) => {
    const ana = newUser(testInfo, 'ana');
    const beto = newUser(testInfo, 'beto');
    await openApp(page);

    // Ana cadastra, carrega o exemplo e assiste ao 1º episódio de Breaking Bad
    await registerViaUi(page, ana);
    await gotoTab(page, 'next-up');
    await loadExample(page);
    await tap(queueCard(page, 'Breaking Bad').getByRole('button', { name: /^Marcar como assistido: Breaking Bad/ }));
    await expect(toast(page, 'Marcado como assistido!')).toBeVisible();
    await expect.poll(async () => Object.keys((await serverLibrary(page)).watchedEpisodes)).toEqual(['1396_s1_e1']); // já está na nuvem

    // Ana sai: o navegador fica vazio (nada dela sobra no localStorage) e volta a ser "visitante"
    await logoutViaUi(page);
    await expect(page.locator('#next-up-empty .empty-title')).toHaveText('Sua lista está vazia');
    await expect(page.locator('#badge-watchlist')).toHaveText('0');
    const afterLogout = await localLibrary(page);
    expect(afterLogout.trackedShows).toEqual([]);
    expect(afterLogout.watchedEpisodes).toEqual({});
    expect(await page.evaluate(() => localStorage.getItem('showvault_last_user'))).toBeNull();

    // Beto entra no MESMO navegador: lista vazia, nada da Ana
    await registerViaUi(page, beto);
    await expect(page.locator('#badge-watchlist')).toHaveText('0');
    await gotoTab(page, 'watchlist');
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(0);
    await logoutViaUi(page);

    // Ana volta: tudo dela está lá (veio da nuvem), com o progresso
    await loginViaUi(page, ana);
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
    await gotoTab(page, 'watchlist');
    await expect(listCard(page, 'Breaking Bad').locator('.show-progress-info')).toContainText('1/3 eps');
    await expect(listCard(page, 'Breaking Bad').locator('select.status-select')).toHaveValue('watching');

    // e a lista do Beto continua só dele (vazia)
    await logoutViaUi(page);
    await loginViaUi(page, beto);
    await expect(page.locator('#badge-watchlist')).toHaveText('0');
    // o estado local do navegador pertence ao Beto agora
    const owner = await page.evaluate(() => localStorage.getItem('showvault_last_user'));
    expect(owner).toBeTruthy();
    const local = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    expect(local.trackedShows).toEqual([]);
  });
});
