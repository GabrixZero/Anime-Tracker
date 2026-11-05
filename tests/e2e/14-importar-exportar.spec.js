// S16 · Importar da MyAnimeList (XML sintético) com prévia e confirmação, e exportar CSV e XML. Fontes externas simuladas.
'use strict';

const fs = require('fs');
const { test, expect } = require('./support/fixtures');
const { EXPECTED } = require('./fake-sources/data');
const { openApp, gotoTab, toast, newUser, signInWithApi, tap } = require('./support/helpers');

const { anime } = EXPECTED;

// 90001 e 90002 são as duas temporadas de "Star Memories" (3 e 2 episódios): viram UMA obra na lista.
const MAL_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <anime><series_animedb_id>90001</series_animedb_id><series_title>Hoshi no Kioku</series_title><series_type>TV</series_type><series_episodes>3</series_episodes>
    <my_watched_episodes>3</my_watched_episodes><my_score>9</my_score><my_status>Completed</my_status></anime>
  <anime><series_animedb_id>90002</series_animedb_id><series_title>Hoshi no Kioku 2nd Season</series_title><series_type>TV</series_type><series_episodes>2</series_episodes>
    <my_watched_episodes>1</my_watched_episodes><my_score>7</my_score><my_status>Watching</my_status></anime>
</myanimelist>`;

async function openBackup(page) {
  await tap(page.locator('#btn-open-backup'));
  await expect(page.locator('#modal-backup')).toBeVisible();
}

test.describe('importar e exportar', () => {
  test('importa da MAL com prévia, só grava ao confirmar, e exporta CSV e XML', async ({ page }, testInfo) => {
    await openApp(page);
    await signInWithApi(page, newUser(testInfo, 'importar'));

    await openBackup(page);
    const file = testInfo.outputPath('mal.xml');
    fs.writeFileSync(file, MAL_XML);
    await page.locator('#input-import-mal').setInputFiles(file);

    // prévia: nada foi gravado ainda
    const modal = page.locator('#modal-import');
    await expect(modal).toBeVisible();
    await expect(page.locator('#import-summary')).toContainText('Prévia: 1 obra(s) e 4 episódio(s)', { timeout: 30000 });
    await expect(page.locator('#badge-watchlist')).toHaveText('0');

    // cancelar não grava
    await tap(modal.getByRole('button', { name: 'Cancelar' }));
    await expect(modal).toBeHidden();
    await expect(page.locator('#badge-watchlist')).toHaveText('0');

    // de novo, agora confirmando
    await openBackup(page);
    await page.locator('#input-import-mal').setInputFiles(file);
    await expect(page.locator('#import-summary')).toContainText('4 episódio', { timeout: 30000 });
    await tap(modal.getByRole('button', { name: 'Confirmar e adicionar' }));
    await expect(modal.locator('.import-h')).toHaveText('Pronto!');
    await expect(modal).toContainText('Episódios marcados como vistos: 4');
    await tap(modal.getByRole('button', { name: 'Fechar', exact: true }));
    await expect(page.locator('#badge-watchlist')).toHaveText('1');

    await gotoTab(page, 'watchlist');
    await expect(page.getByRole('button', { name: anime.name, exact: true })).toBeVisible();

    // exportar CSV
    await openBackup(page);
    const csvDownload = page.waitForEvent('download');
    await tap(page.locator('#btn-export-csv'));
    const csv = await csvDownload;
    expect(csv.suggestedFilename()).toMatch(/^showvault-lista-\d{4}-\d{2}-\d{2}\.csv$/);
    const csvPath = testInfo.outputPath('lista.csv');
    await csv.saveAs(csvPath);
    const csvText = fs.readFileSync(csvPath, 'utf-8');
    expect(csvText).toContain('id,tipo,titulo');
    expect(csvText).toContain(anime.name);
    expect(csvText).toContain('4,5'); // 4 de 5 episódios

    // exportar XML (formato MAL): uma entrada por temporada
    const xmlDownload = page.waitForEvent('download');
    await tap(page.locator('#btn-export-mal-xml'));
    const xml = await xmlDownload;
    const xmlPath = testInfo.outputPath('mal-export.xml');
    await xml.saveAs(xmlPath);
    const xmlText = fs.readFileSync(xmlPath, 'utf-8');
    expect(xmlText).toContain('<myanimelist>');
    expect(xmlText).toContain('<series_animedb_id>90001</series_animedb_id>');
    expect(xmlText).toContain('<series_animedb_id>90002</series_animedb_id>');
    expect(await toast(page, /exportado/).count()).toBeGreaterThan(0);
  });

  test('arquivo que não é da MAL é recusado sem mexer na lista', async ({ page }, testInfo) => {
    await openApp(page);
    await openBackup(page);
    const file = testInfo.outputPath('ruim.xml');
    fs.writeFileSync(file, '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><myanimelist></myanimelist>');
    await page.locator('#input-import-mal').setInputFiles(file);
    await expect(toast(page, /DOCTYPE/)).toBeVisible();
    await expect(page.locator('#modal-import')).toBeHidden();
  });
});
