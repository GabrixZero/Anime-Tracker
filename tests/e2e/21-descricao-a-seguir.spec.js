// Fix · Descrição no cartão do "A Seguir": o resumo leve (S18) traz a sinopse CURTA da obra; sem sinopse na fonte, segue o aviso.
// Obras fictícias do catálogo dos testes (ver app-server.js). Nenhuma requisição à internet. Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, queueCard } = require('./support/helpers');

const LONG_ID = 990201;
const NONE_ID = 990202;

test.describe('descrição no A Seguir', () => {
  test('obra com sinopse longa mostra a sinopse curta; obra sem sinopse mostra o aviso', async ({ page }) => {
    await openApp(page);
    await page.evaluate(
      async ids => {
        ids.forEach(id => window.appState.addShow(id));
        await window.appController.ensureDetails(ids, { summary: true }); // mesmo caminho da abertura do app: só o resumo
        window.appController.refreshAll();
      },
      [LONG_ID, NONE_ID]
    );

    const long = queueCard(page, 'Saga Longa E2E').locator('.next-up-overview');
    await expect(long).toContainText('palavra1 palavra2');
    const text = (await long.textContent()) || '';
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(241);
    expect(text).not.toContain('FIMDATEXTO');
    // continua só o resumo: o detalhe completo não foi baixado
    expect(await page.evaluate(id => window.appState.hasDetail(id), LONG_ID)).toBe(false);

    await expect(queueCard(page, 'Saga Muda E2E').locator('.next-up-overview')).toHaveText('Sem descrição cadastrada.');
  });
});
