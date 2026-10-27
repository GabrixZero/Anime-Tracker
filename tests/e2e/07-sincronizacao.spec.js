// S12 · Sincronização entre "aparelhos" (dois browserContext, cada um com o próprio localStorage) e remoção propagada por marcas de exclusão
// (tombstones, D-13/S03). O app é local-first: o servidor guarda a cópia da conta; os aparelhos se encontram no login e ao recarregar.
// Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const {
  openApp,
  gotoTab,
  toast,
  loadExample,
  queueCard,
  listCard,
  newUser,
  loginViaUi,
  signInWithApi,
  serverLibrary,
  waitForCloudIdle,
  tap
} = require('./support/helpers');

const OPPENHEIMER = 872585;
const INTERSTELAR = 157336;
const ATTACK_ON_TITAN = 1429;
const BREAKING_BAD = 1396;

const trackedIds = async page => (await serverLibrary(page)).trackedShows.map(t => t.showId).sort((a, b) => a - b);

// Espera o envio terminar (o app junta alterações por 1,5 s antes de enviar): o servidor passa a ter exatamente estas obras.
const expectServerTracks = async (page, ids) => expect.poll(() => trackedIds(page)).toEqual([...ids].sort((a, b) => a - b));

test.describe('sincronização', () => {
  test('dois aparelhos: login traz tudo, remoção de um chega ao outro (obra a obra e "Remover exemplo")', async ({
    page: phone,
    device
  }, testInfo) => {
    const user = newUser(testInfo, 'sync');

    // ---- Aparelho A (celular): conta nova, exemplo e 1º episódio de Breaking Bad ----
    await signInWithApi(phone, user);
    await loadExample(phone);
    await tap(queueCard(phone, 'Breaking Bad').getByRole('button', { name: /^Marcar como assistido: Breaking Bad/ }));
    await expectServerTracks(phone, [INTERSTELAR, OPPENHEIMER, BREAKING_BAD, ATTACK_ON_TITAN]);
    await expect.poll(async () => Object.keys((await serverLibrary(phone)).watchedEpisodes)).toEqual(['1396_s1_e1']);

    // ---- Aparelho B (computador): outro navegador, entra com a mesma conta e recebe a lista inteira ----
    const { page: laptop } = await device();
    await openApp(laptop);
    await expect(laptop.locator('#badge-watchlist')).toHaveText('0'); // navegador novo: nada aqui ainda
    await loginViaUi(laptop, user);
    await expect(laptop.locator('#badge-watchlist')).toHaveText('4');
    await gotoTab(laptop, 'watchlist');
    await expect(listCard(laptop, 'Breaking Bad').locator('.show-progress-info')).toContainText('1/3 eps');
    await expect(listCard(laptop, 'Breaking Bad').locator('select.status-select')).toHaveValue('watching');

    // ---- B remove UMA obra (pelo modal); a remoção vira marca de exclusão no servidor ----
    await tap(laptop.getByRole('button', { name: 'Oppenheimer', exact: true }));
    await tap(laptop.getByRole('button', { name: 'Remover da Lista' }));
    await expect(toast(laptop, 'Removido da sua lista.')).toBeVisible();
    await laptop.keyboard.press('Escape');
    await expect(laptop.locator('#badge-watchlist')).toHaveText('3');
    await expectServerTracks(laptop, [INTERSTELAR, BREAKING_BAD, ATTACK_ON_TITAN]);
    expect((await serverLibrary(laptop)).tombstones.shows).toHaveProperty(String(OPPENHEIMER));

    // ---- A recarrega (é quando o aparelho se encontra com a nuvem): Oppenheimer sumiu, o resto continua ----
    await phone.reload();
    await waitForCloudIdle(phone);
    await expect(phone.locator('#badge-watchlist')).toHaveText('3');
    await gotoTab(phone, 'watchlist');
    await expect(listCard(phone, 'Oppenheimer')).toHaveCount(0);
    await expect(listCard(phone, 'Interestelar (Interstellar)')).toHaveCount(1);
    await expect(listCard(phone, 'Breaking Bad').locator('.show-progress-info')).toContainText('1/3 eps');

    // ---- A usa "Remover exemplo": só o que está sem uso sai (Interestelar e Attack on Titan; Breaking Bad ficou, já foi usado) ----
    await tap(phone.getByRole('button', { name: 'Remover exemplo' }));
    await expect(toast(phone, 'Exemplo removido: 2 títulos. O que você já usou ficou na lista.')).toBeVisible();
    await expectServerTracks(phone, [BREAKING_BAD]);
    const tombstones = (await serverLibrary(phone)).tombstones.shows;
    for (const id of [OPPENHEIMER, INTERSTELAR, ATTACK_ON_TITAN]) expect(tombstones).toHaveProperty(String(id));

    // ---- B recarrega e vê só Breaking Bad; nada que foi removido ressuscita ----
    await laptop.reload();
    await waitForCloudIdle(laptop);
    await expect(laptop.locator('#badge-watchlist')).toHaveText('1');
    await gotoTab(laptop, 'watchlist');
    await expect(laptop.locator('#watchlist-container .show-card')).toHaveCount(1);
    await expect(listCard(laptop, 'Breaking Bad')).toBeVisible();

    // ---- e o caminho de volta: B marca o episódio 2, A recarrega e enxerga ----
    await gotoTab(laptop, 'next-up');
    await tap(queueCard(laptop, 'Breaking Bad').getByRole('button', { name: /^Marcar como assistido: Breaking Bad/ }));
    await expect.poll(async () => Object.keys((await serverLibrary(laptop)).watchedEpisodes).sort()).toEqual(['1396_s1_e1', '1396_s1_e2']);
    await phone.reload();
    await waitForCloudIdle(phone);
    await gotoTab(phone, 'watchlist');
    await expect(listCard(phone, 'Breaking Bad').locator('.show-progress-info')).toContainText('2/3 eps');
  });

  test('offline: as alterações ficam no aparelho, o selo avisa e tudo segue quando a conexão volta', async ({
    page: phone,
    context,
    device,
    guard
  }, testInfo) => {
    // com a rede desligada o navegador registra a falha do fetch no console (e o app também): é o esperado neste teste
    guard.allow(/ERR_INTERNET_DISCONNECTED/, /\[API Error\] \/user\/library/);
    const user = newUser(testInfo, 'offline');
    await signInWithApi(phone, user);
    await loadExample(phone);
    await expectServerTracks(phone, [INTERSTELAR, OPPENHEIMER, BREAKING_BAD, ATTACK_ON_TITAN]);

    await context.setOffline(true);
    await tap(queueCard(phone, 'Breaking Bad').getByRole('button', { name: /^Marcar como assistido: Breaking Bad/ }));
    await expect(toast(phone, 'Marcado como assistido!')).toBeVisible();
    // o envio falha: o selo do cabeçalho mostra "Offline" e oferece tentar de novo; o progresso fica salvo aqui
    await expect(phone.locator('#sync-status')).toHaveAttribute('data-sync-state', 'offline');
    await expect(phone.locator('#sync-label')).toHaveText('Offline · tentar de novo');
    await expect(queueCard(phone, 'Breaking Bad').locator('.next-up-badge')).toHaveText('T1:E2');

    // conexão de volta + clique no selo = envia o que ficou pendente
    await context.setOffline(false);
    await tap(phone.locator('#sync-status'));
    await expect(phone.locator('#sync-status')).toHaveAttribute('data-sync-state', 'idle');
    await expect(phone.locator('#sync-label')).toHaveText('Nuvem Ativa');
    await expect.poll(async () => Object.keys((await serverLibrary(phone)).watchedEpisodes)).toEqual(['1396_s1_e1']);

    // o outro aparelho recebe
    const { page: laptop } = await device();
    await openApp(laptop);
    await loginViaUi(laptop, user);
    await gotoTab(laptop, 'watchlist');
    await expect(listCard(laptop, 'Breaking Bad').locator('.show-progress-info')).toContainText('1/3 eps');
  });
});
