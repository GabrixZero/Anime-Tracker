// S12 · Backup: exportar o JSON, apagar os dados do aparelho (com confirmação) e restaurar do arquivo; arquivos inválidos não estragam nada.
// Visitante com progresso e uma anotação. Roda em desktop e mobile.
'use strict';

const fs = require('fs');
const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, toast, loadExample, queueCard, listCard, tap } = require('./support/helpers');

const backupModal = page => page.locator('#modal-backup');

async function openBackup(page) {
  await tap(page.locator('#btn-open-backup'));
  await expect(backupModal(page)).toBeVisible();
}

test.describe('backup', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await loadExample(page);
    // progresso: 2 episódios de Breaking Bad + uma anotação no primeiro
    const check = queueCard(page, 'Breaking Bad').getByRole('button', { name: /^Marcar como assistido: Breaking Bad/ });
    await tap(check);
    await tap(check);
    await expect(queueCard(page, 'Breaking Bad').locator('.next-up-badge')).toHaveText('T1:E3');
  });

  test('exporta o JSON, apaga os dados do aparelho e restaura do arquivo', async ({ page }, testInfo) => {
    // uma anotação para ir junto no backup
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: 'Breaking Bad', exact: true }));
    await tap(page.locator('#show-episodes-container .episode-row[data-ep="1"]').getByRole('button', { name: /^Ver ou editar|^Anotar/ }));
    await page.locator('#note-textarea').fill('nota que vai no backup');
    await expect(page.locator('#note-save-status .save-text')).toHaveText(/^Salvo neste aparelho às /);
    await tap(page.locator('#btn-save-note-modal'));
    await page.keyboard.press('Escape'); // fecha o modal da obra
    await expect(page.locator('#modal-show-detail')).toBeHidden();

    // --- exportar ---
    await openBackup(page);
    const downloading = page.waitForEvent('download');
    await tap(page.locator('#btn-download-json-backup'));
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^showvault-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const file = testInfo.outputPath('backup.json');
    await download.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(backup.version).toBe(4);
    expect(typeof backup.stateVersion).toBe('number');
    expect(backup.database.trackedShows).toHaveLength(4);
    expect(Object.keys(backup.database.watchedEpisodes).sort()).toEqual(['1396_s1_e1', '1396_s1_e2']);
    expect(backup.database.episodeNotes['1396_s1_e1'].text).toBe('nota que vai no backup');
    await expect(toast(page, 'Backup JSON exportado!')).toBeVisible();

    // --- apagar os dados do aparelho: "Cancelar" não apaga, "OK" apaga ---
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('exporte um backup');
      return dialog.dismiss();
    });
    await tap(page.locator('#btn-reset-database'));
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
    await openBackup(page); // o botão fechou o modal antes do confirm
    page.once('dialog', dialog => dialog.accept());
    await tap(page.locator('#btn-reset-database'));
    await expect(toast(page, 'Dados deste aparelho apagados.')).toBeVisible();
    await expect(page.locator('#badge-watchlist')).toHaveText('0');
    await expect(page.locator('#badge-diary')).toHaveText('0');
    await gotoTab(page, 'watchlist');
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(0);

    // --- restaurar do arquivo ---
    await openBackup(page);
    await page.locator('#input-import-backup').setInputFiles(file);
    await expect(toast(page, 'Backup restaurado com sucesso!')).toBeVisible();
    await expect(backupModal(page)).toBeHidden();
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
    await expect(page.locator('#badge-diary')).toHaveText('1');
    await expect(listCard(page, 'Breaking Bad').locator('.show-progress-info')).toContainText('2/3 eps');

    await gotoTab(page, 'diary');
    await expect(page.locator('#diary-container .diary-text')).toHaveText('nota que vai no backup');

    // e continua lá depois de recarregar
    await page.reload();
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
  });

  test('arquivo inválido ou malformado é recusado com aviso e não mexe nos dados', async ({ page }) => {
    await openBackup(page);
    const input = page.locator('#input-import-backup');

    await input.setInputFiles({ name: 'lixo.json', mimeType: 'application/json', buffer: Buffer.from('isto nem é JSON') });
    await expect(toast(page, 'Arquivo de backup inválido.')).toBeVisible();

    const wrongShape = { database: { trackedShows: 'texto', watchedEpisodes: {}, episodeNotes: {} } };
    await input.setInputFiles({ name: 'forma-errada.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrongShape)) });
    await expect(toast(page, 'Backup inválido: faltam trackedShows, watchedEpisodes ou episodeNotes.')).toBeVisible();

    const badItem = { database: { trackedShows: [{ showId: 'não é número' }], watchedEpisodes: {}, episodeNotes: {} } };
    await input.setInputFiles({ name: 'item-ruim.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badItem)) });
    await expect(toast(page, 'Backup inválido: item incorreto em trackedShows.')).toBeVisible();

    // chave "__proto__" (tentativa de poluir o objeto): precisa ir como texto, um objeto literal em JS a trataria como protótipo
    const badKey = '{"database":{"trackedShows":[],"watchedEpisodes":{"__proto__":{"watched":true}},"episodeNotes":{}}}';
    await input.setInputFiles({ name: 'chave-ruim.json', mimeType: 'application/json', buffer: Buffer.from(badKey) });
    await expect(toast(page, 'Backup inválido: item incorreto em watchedEpisodes.')).toBeVisible();
    await expect(page.locator('.toast.toast-error')).toHaveCount(4);
    expect(await page.evaluate(() => ({}).watched)).toBeUndefined(); // nada vazou para os objetos do app

    // nada mudou, a janela continua aberta, e o app segue funcionando
    await expect(backupModal(page)).toBeVisible();
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
    await page.keyboard.press('Escape');
    await expect(backupModal(page)).toBeHidden();
    await expect(page.locator('#btn-open-backup')).toBeFocused();
    await gotoTab(page, 'watchlist');
    await expect(listCard(page, 'Breaking Bad').locator('.show-progress-info')).toContainText('2/3 eps');
  });
});
