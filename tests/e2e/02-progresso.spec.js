// S12 · Progresso: marcar episódio (A Seguir e modal), temporada inteira, status por obra e filme assistido.
// Visitante com o exemplo carregado (Breaking Bad: 3 episódios; Interestelar: filme de 169 min). Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, toast, loadExample, queueCard, listCard, tap } = require('./support/helpers');

const modal = page => page.locator('#modal-show-detail');
const episodeCheck = (page, n) => page.locator(`#show-episodes-container .episode-row[data-ep="${n}"] .episode-check`);

test.describe('progresso', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await loadExample(page);
  });

  test('A Seguir: marcar o episódio avança a fila e a série termina como "Finalizado"', async ({ page }) => {
    const bb = queueCard(page, 'Breaking Bad');
    const check = () => bb.getByRole('button', { name: /^Marcar como assistido: Breaking Bad/ });

    for (const next of ['T1:E2', 'T1:E3']) {
      await tap(check());
      await expect(toast(page, 'Marcado como assistido!').first()).toBeVisible();
      await expect(bb.locator('.next-up-badge')).toHaveText(next);
    }
    await expect(page.locator('#next-up-counter-pill')).toHaveText('4 títulos na fila');

    // o último episódio tira a série da fila (Finalizado não entra em "A Seguir")
    await tap(check());
    await expect(bb).toHaveCount(0);
    await expect(page.locator('#next-up-counter-pill')).toHaveText('3 títulos na fila');

    await gotoTab(page, 'watchlist');
    const card = listCard(page, 'Breaking Bad');
    await expect(card.locator('select.status-select')).toHaveValue('completed');
    await expect(card.locator('.show-progress-info')).toContainText('3/3 eps (100%)');
    await expect(page.locator('#count-completed')).toHaveText('1');

    await gotoTab(page, 'stats');
    await expect(page.locator('#stat-episodes-count')).toHaveText('3');
    await expect(page.locator('#stat-shows-completed')).toHaveText('1');

    // e tudo isso sobrevive a recarregar a página
    await page.reload();
    await gotoTab(page, 'watchlist');
    await expect(listCard(page, 'Breaking Bad').locator('select.status-select')).toHaveValue('completed');
  });

  test('modal da obra: marcar um episódio, temporada inteira e desmarcar, com o status acompanhando', async ({ page }) => {
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: 'Breaking Bad', exact: true }));
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.modal-title')).toHaveText('Breaking Bad');
    await expect(page.locator('#show-seasons-tabs .season-tab-btn')).toHaveText('Temporada 1 (0/3)');
    await expect(page.locator('#show-episodes-container .episode-row')).toHaveCount(3);
    await expect(page.locator('#detail-status-select')).toHaveValue('plan_to_watch');

    // marcar o episódio 2 pelo modal: a linha, a aba, o resumo e o status mudam na hora
    await tap(episodeCheck(page, 2));
    await expect(episodeCheck(page, 2)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#show-episodes-container .episode-row[data-ep="2"]')).toHaveClass(/watched/);
    await expect(page.locator('#show-seasons-tabs .season-tab-btn')).toHaveText('Temporada 1 (1/3)');
    await expect(page.locator('#season-stats-summary')).toHaveText('Progresso da Temporada: 1/3 assistidos');
    await expect(page.locator('#detail-status-select')).toHaveValue('watching');

    await tap(page.locator('#btn-batch-check-season'));
    await expect(toast(page, 'Temporada inteira marcada como assistida!')).toBeVisible();
    await expect(page.locator('#season-stats-summary')).toHaveText('Progresso da Temporada: 3/3 assistidos');
    await expect(page.locator('#detail-status-select')).toHaveValue('completed');

    await tap(page.locator('#btn-batch-uncheck-season'));
    await expect(page.locator('#season-stats-summary')).toHaveText('Progresso da Temporada: 0/3 assistidos');
    await expect(page.locator('#detail-status-select')).toHaveValue('plan_to_watch');

    // Esc fecha e o foco volta para o botão que abriu o modal
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Breaking Bad', exact: true })).toBeFocused();
  });

  test('status por obra: Pausado e Desisti saem da fila; Assistindo volta', async ({ page }) => {
    await gotoTab(page, 'watchlist');
    const status = listCard(page, 'Breaking Bad').locator('select.status-select');

    await status.selectOption({ label: 'Pausado' });
    await expect(toast(page, 'Status: Pausado.')).toBeVisible();
    await expect(page.locator('#count-paused')).toHaveText('1');
    await expect(page.locator('#count-plan')).toHaveText('3');
    await gotoTab(page, 'next-up');
    await expect(queueCard(page, 'Breaking Bad')).toHaveCount(0);
    await expect(page.locator('#next-up-counter-pill')).toHaveText('3 títulos na fila');

    await gotoTab(page, 'watchlist');
    await tap(page.locator('#watchlist-filters [data-filter="paused"]'));
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(1);
    await expect(listCard(page, 'Breaking Bad')).toBeVisible();

    await status.selectOption({ label: 'Desisti' });
    await expect(toast(page, 'Status: Desisti.')).toBeVisible();
    await expect(page.locator('#count-dropped')).toHaveText('1');
    await expect(page.locator('#watchlist-container .show-card')).toHaveCount(0); // saiu do filtro "Pausados"
    await tap(page.locator('#watchlist-filters [data-filter="dropped"]'));
    await expect(listCard(page, 'Breaking Bad')).toBeVisible();

    await status.selectOption({ label: 'Assistindo' });
    await tap(page.locator('#watchlist-filters [data-filter="watching"]'));
    await expect(listCard(page, 'Breaking Bad')).toBeVisible();
    await gotoTab(page, 'next-up');
    await expect(queueCard(page, 'Breaking Bad')).toHaveCount(1);

    // o mesmo seletor existe no modal e concorda com a lista
    await gotoTab(page, 'watchlist');
    await tap(page.locator('#watchlist-filters [data-filter="all"]'));
    await tap(page.getByRole('button', { name: 'Breaking Bad', exact: true }));
    await expect(page.locator('#detail-status-select')).toHaveValue('watching');
    await page.locator('#detail-status-select').selectOption({ label: 'Finalizado' });
    await page.keyboard.press('Escape');
    await expect(listCard(page, 'Breaking Bad').locator('select.status-select')).toHaveValue('completed');
  });

  test('filme: marcar como assistido finaliza e entra nas estatísticas com a duração', async ({ page }) => {
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: 'Interestelar (Interstellar)', exact: true }));
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('#movie-detail-body h4')).toHaveText('Filme Pendente para Assistir');

    await tap(page.getByRole('button', { name: '✓ Marcar como Assistido' }));
    await expect(page.locator('#movie-detail-body h4')).toHaveText('✓ Filme Assistido no Seu Diário');
    await expect(page.getByRole('button', { name: 'Desmarcar Filme' })).toBeVisible();
    await expect(page.locator('#detail-status-select')).toHaveValue('completed');
    await page.keyboard.press('Escape');

    await expect(listCard(page, 'Interestelar (Interstellar)').locator('.show-progress-info')).toContainText('Filme Assistido (100%)');
    await gotoTab(page, 'next-up'); // as abas ocultas se atualizam ao abrir (S09)
    await expect(queueCard(page, 'Interestelar')).toHaveCount(0);
    await expect(page.locator('#next-up-counter-pill')).toHaveText('3 títulos na fila');

    await gotoTab(page, 'stats');
    await expect(page.locator('#stat-episodes-count')).toHaveText('1');
    await expect(page.locator('#stat-shows-completed')).toHaveText('1');
    await expect(page.locator('#stat-minutes-subtext')).toHaveText('169 minutos assistidos');
    await expect(page.locator('#time-hours')).toHaveText('2');
    await expect(page.locator('#time-minutes')).toHaveText('49');
  });
});
