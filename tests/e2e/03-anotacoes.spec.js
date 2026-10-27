// S12 · Anotações: Markdown simples com spoiler (S08, D-19), salvamento automático, diário, histórico de versões e exportação.
// Visitante com o exemplo carregado. Roda em desktop e mobile.
'use strict';

const fs = require('fs');
const { test, expect } = require('./support/fixtures');
const { openApp, waitForBoot, gotoTab, toast, loadExample, queueCard, tap } = require('./support/helpers');

const noteModal = page => page.locator('#modal-episode-note');
const textarea = page => page.locator('#note-textarea');

// Abre a anotação do próximo episódio de Breaking Bad pelo ícone da fila "A Seguir".
async function openBreakingBadNote(page) {
  await gotoTab(page, 'next-up');
  await tap(queueCard(page, 'Breaking Bad').getByRole('button', { name: /^Anotar no diário: Breaking Bad/ }));
  await expect(noteModal(page)).toBeVisible();
}

// O texto digitado foi gravado: o selo do modal troca "Salvando..." por "Salvo neste aparelho às HH:MM:SS".
async function expectSaved(page) {
  await expect(page.locator('#note-save-status .save-text')).toHaveText(/^Salvo neste aparelho às /);
}

const MARKDOWN = [
  '**negrito** e *itálico*',
  '> uma citação do episódio',
  '>!o segredo da trama!<',
  '<b>HTML solto</b> não vira negrito'
].join('\n');

test.describe('anotações', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await loadExample(page);
  });

  test('escreve com Markdown e spoiler, salva sozinha e aparece no Diário e nas Estatísticas', async ({ page }) => {
    await openBreakingBadNote(page);
    await expect(page.locator('#note-ep-code')).toHaveText('S01E01');
    await expect(page.locator('#note-ep-title')).toHaveText('Piloto');
    await expect(page.locator('#note-show-title')).toHaveText('Breaking Bad');
    await expect(page.locator('#btn-note-history')).toBeHidden(); // sem versões anteriores ainda

    await tap(page.locator('#note-emotion-selector [data-emotion="awesome"]'));
    await page.locator('#note-character-input').fill('Walter White');
    await textarea(page).fill(MARKDOWN);
    await expectSaved(page);
    await expect(page.locator('#note-word-count')).toContainText('palavras');
    await expect(page.locator('#note-last-saved')).toContainText('Última edição:');

    await tap(page.locator('#btn-save-note-modal'));
    await expect(noteModal(page)).toBeHidden();
    await expect(toast(page, 'Anotação registrada com sucesso no seu cofre!')).toBeVisible();

    await gotoTab(page, 'diary');
    await expect(page.locator('#badge-diary')).toHaveText('1');
    const entry = page.locator('#diary-container .diary-entry-card');
    await expect(entry).toHaveCount(1);
    await expect(entry.locator('.diary-code')).toHaveText('Breaking Bad · T1:E1');
    await expect(entry.locator('.diary-emotion')).toHaveText('😍 Adorei');
    await expect(entry.locator('.diary-highlight')).toHaveText('Destaque: Walter White');
    await expect(entry.locator('.diary-title')).toHaveText('Piloto');

    // Markdown: negrito, itálico, citação; HTML solto fica como TEXTO (nunca vira tag)
    const text = entry.locator('.diary-text');
    await expect(text.locator('strong')).toHaveText('negrito');
    await expect(text.locator('em')).toHaveText('itálico');
    await expect(text.locator('blockquote.md-quote')).toHaveText('uma citação do episódio');
    await expect(text).toContainText('<b>HTML solto</b> não vira negrito');
    await expect(text.locator('b')).toHaveCount(0);

    // Spoiler: escondido até clicar (ou Enter), e dá para esconder de novo
    const spoiler = text.locator('.md-spoiler');
    await expect(spoiler).toHaveAttribute('aria-expanded', 'false');
    await expect(spoiler).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
    await tap(spoiler);
    await expect(spoiler).toHaveAttribute('aria-expanded', 'true');
    await expect(spoiler).toHaveClass(/revealed/);
    await expect(spoiler).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
    await spoiler.press('Enter');
    await expect(spoiler).toHaveAttribute('aria-expanded', 'false');

    // Estatísticas contam a anotação e a reação
    await gotoTab(page, 'stats');
    await expect(page.locator('#stat-notes-count')).toHaveText('1');
    await expect(page.locator('#stats-emotions-chart .stat-bar-row').first().locator('.stat-bar-count')).toHaveText('1');

    // Sobrevive a recarregar; "Editar" no Diário reabre a mesma anotação, com tudo preenchido
    await page.reload();
    await gotoTab(page, 'diary');
    await tap(page.getByRole('button', { name: /^Editar anotação: Breaking Bad/ }));
    await expect(noteModal(page)).toBeVisible();
    await expect(textarea(page)).toHaveValue(MARKDOWN);
    await expect(page.locator('#note-character-input')).toHaveValue('Walter White');
    await expect(page.locator('#note-emotion-selector [data-emotion="awesome"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('histórico de versões: só vira versão depois de 10 min parada; restaurar guarda o texto atual', async ({ page }) => {
    // O relógio do navegador anda normalmente; "10 minutos depois" é um salto (como fechar e reabrir a tampa do notebook).
    await page.clock.install({ time: new Date() });
    await page.reload();
    await waitForBoot(page);
    await expect(page.locator('#badge-watchlist')).toHaveText('4');

    await openBreakingBadNote(page);
    await textarea(page).fill('Primeira versão da anotação.');
    await expectSaved(page);
    await tap(page.locator('#btn-save-note-modal'));
    await expect(noteModal(page)).toBeHidden();

    await page.clock.fastForward('11:00');

    await openBreakingBadNote(page);
    await expect(textarea(page)).toHaveValue('Primeira versão da anotação.');
    await textarea(page).fill('Segunda versão, bem diferente.');
    await expectSaved(page);
    await expect(page.locator('#btn-note-history')).toHaveText('Histórico (1)');

    // editar de novo logo em seguida (< 10 min) continua na mesma sessão de edição: não cria outra versão
    await textarea(page).fill('Segunda versão, bem diferente, com um retoque.');
    await expectSaved(page);
    await expect(page.locator('#btn-note-history')).toHaveText('Histórico (1)');

    await tap(page.locator('#btn-note-history'));
    await expect(page.locator('#note-history-panel')).toBeVisible();
    await expect(page.locator('#btn-note-history')).toHaveAttribute('aria-expanded', 'true');
    const versions = page.locator('#note-history-list .note-history-item');
    await expect(versions).toHaveCount(1);
    await expect(versions.first()).toContainText('Primeira versão da anotação.');

    await tap(versions.first().getByRole('button', { name: /^Restaurar a versão/ }));
    await expect(toast(page, 'Versão restaurada. O texto anterior ficou no histórico.')).toBeVisible();
    await expect(textarea(page)).toHaveValue('Primeira versão da anotação.');
    // o texto que estava valendo virou a versão do histórico (nada se perde)
    await expect(page.locator('#btn-note-history')).toHaveText('Histórico (1)');
    await expect(versions.first()).toContainText('Segunda versão, bem diferente, com um retoque.');

    await tap(page.locator('#btn-save-note-modal'));
    await gotoTab(page, 'diary');
    await expect(page.locator('#diary-container .diary-text')).toHaveText('Primeira versão da anotação.');
  });

  test('Diário: busca, filtro por reação e exportação em Markdown', async ({ page }) => {
    await openBreakingBadNote(page);
    await tap(page.locator('#note-emotion-selector [data-emotion="mindblown"]'));
    await page.locator('#note-character-input').fill('Jesse Pinkman');
    await textarea(page).fill('Que **piloto** inesquecível.');
    await expectSaved(page);
    await tap(page.locator('#btn-save-note-modal'));

    await gotoTab(page, 'diary');
    const entries = page.locator('#diary-container .diary-entry-card');
    await expect(entries).toHaveCount(1);

    // busca por texto, por obra e por personagem; sem resultado = tela vazia
    for (const query of ['inesquecível', 'breaking', 'pinkman']) {
      await page.locator('#diary-search-input').fill(query);
      await expect(entries).toHaveCount(1);
    }
    await page.locator('#diary-search-input').fill('nada disso existe');
    await expect(entries).toHaveCount(0);
    await expect(page.locator('#diary-empty')).toBeVisible();
    await page.locator('#diary-search-input').fill('');
    await expect(entries).toHaveCount(1);

    // filtro por reação
    await tap(page.locator('#emotion-filters [data-emotion="sad"]'));
    await expect(entries).toHaveCount(0);
    await tap(page.locator('#emotion-filters [data-emotion="mindblown"]'));
    await expect(entries).toHaveCount(1);
    await expect(page.locator('#emotion-filters [data-emotion="mindblown"]')).toHaveAttribute('aria-pressed', 'true');

    // exportar o diário (.md)
    const download = page.waitForEvent('download');
    await tap(page.locator('#btn-export-notes-md'));
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^diario-showvault-\d{4}-\d{2}-\d{2}\.md$/);
    const markdown = fs.readFileSync(await file.path(), 'utf-8');
    expect(markdown).toContain('# Meu Diário de Obras · ShowVault');
    expect(markdown).toContain('## Breaking Bad — s1:e1');
    expect(markdown).toContain('**Destaque:** Jesse Pinkman');
    expect(markdown).toContain('Que **piloto** inesquecível.');
    await expect(toast(page, 'Diário exportado em Markdown!')).toBeVisible();
  });

  test('anotação de filme: abre pelo modal da obra e entra no Diário como "Filme"', async ({ page }) => {
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: 'Oppenheimer', exact: true }));
    await tap(page.getByRole('button', { name: 'Anotar no Diário' }));
    await expect(noteModal(page)).toBeVisible();
    await expect(page.locator('#note-ep-code')).toHaveText('FILME');
    await expect(page.locator('#note-ep-title')).toHaveText('Oppenheimer');
    await expect(page.locator('#note-show-title')).toHaveText('Duração: 180 min');
    await textarea(page).fill('Uma obra-prima. >!Spoiler do final!<');
    await expectSaved(page);

    // Esc fecha só a anotação (a de cima) e o foco volta ao botão que a abriu; o modal da obra segue aberto por baixo
    await page.keyboard.press('Escape');
    await expect(noteModal(page)).toBeHidden();
    await expect(page.locator('#modal-show-detail')).toBeVisible();
    await expect(page.locator('[data-focus-key="detail:movie-note"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-show-detail')).toBeHidden();

    await gotoTab(page, 'diary');
    await expect(page.locator('#diary-container .diary-code')).toHaveText('Oppenheimer · Filme');
    await expect(page.locator('#diary-container .diary-title')).toHaveText('Filme');
    await expect(page.locator('#diary-container .md-spoiler')).toHaveText('Spoiler do final');
  });
});
