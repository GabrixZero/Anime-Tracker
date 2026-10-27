// S12 · Acessibilidade automática (axe-core): nenhuma violação GRAVE (critical/serious) nas telas e janelas do app, em desktop e mobile.
// O axe não substitui o teste manual com leitor de tela (S07), mas pega regressões óbvias: nome acessível, contraste, rótulos, ARIA.
// As violações "moderate/minor" ficam anexadas ao relatório (não falham o teste).
'use strict';

const { AxeBuilder } = require('@axe-core/playwright');
const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, loadExample, queueCard, tap } = require('./support/helpers');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Resultado do axe resumido: [{ id, impact, ajuda, onde }]
//  - preload: false -> o axe NÃO baixa as folhas de estilo de outros sites (a do Google Fonts) para analisar o contraste; a CSP do app
//    (connect-src 'self') bloqueia esse download e o navegador registraria um erro de console que não é do app.
//  - Spoiler ESCONDIDO (.md-spoiler sem .revealed): o texto é invisível de propósito (cor transparente sobre uma tarja) e o nome acessível
//    é "Spoiler escondido. Pressione para revelar." para o conteúdo NÃO vazar a quem usa leitor de tela. O axe enxerga o texto no DOM e
//    reclama de contraste (1,5:1) e de "label-content-name-mismatch" (nome não contém o texto), mas não há texto visível a comparar.
//    Falsos positivos, descartados só para esse elemento e essas duas regras (D-S12-6). Depois de REVELADO o spoiler é conferido sem
//    exceção (`spoilerEscondido: false`).
const SPOILER_RULES = new Set(['label-content-name-mismatch', 'color-contrast']);

async function scan(page, include, { spoilerEscondido = true } = {}) {
  let builder = new AxeBuilder({ page }).withTags(TAGS).options({ preload: false });
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  return violations
    .map(v => ({
      ...v,
      nodes: spoilerEscondido && SPOILER_RULES.has(v.id) ? v.nodes.filter(n => !n.target.join(' ').includes('.md-spoiler')) : v.nodes
    }))
    .filter(v => v.nodes.length > 0)
    .map(v => ({
      id: v.id,
      impact: v.impact,
      ajuda: v.help,
      onde: v.nodes.slice(0, 4).map(n => `${n.target.join(' ')} :: ${(n.failureSummary || '').split(/\r?\n/).slice(1, 2).join(' ')}`)
    }));
}

test.describe('acessibilidade (axe-core)', () => {
  test('nenhuma violação grave em nenhuma tela nem janela', async ({ page }, testInfo) => {
    const report = {};
    const check = async (label, include) => {
      report[label] = await scan(page, include);
    };

    await openApp(page);
    await check('A Seguir (vazia)');
    await loadExample(page);
    await check('A Seguir (com exemplo)');

    await gotoTab(page, 'watchlist');
    await check('Minha Lista');

    await gotoTab(page, 'diary');
    await check('Diário (vazio)');
    await gotoTab(page, 'stats');
    await check('Estatísticas');
    await gotoTab(page, 'explore');
    await expect(page.locator('#explore-container .show-card').first()).toBeVisible();
    await check('Explorar');

    // janelas (diálogos): obra de série, filme, anotação, backup, entrar/cadastrar
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: 'Breaking Bad', exact: true }));
    await expect(page.locator('#modal-show-detail')).toBeVisible();
    await check('Janela da obra (série)', '#modal-show-detail');
    await tap(page.locator('#show-episodes-container .episode-row[data-ep="1"]').getByRole('button', { name: /^Anotar/ }));
    await expect(page.locator('#modal-episode-note')).toBeVisible();
    await page.locator('#note-textarea').fill('Texto com **negrito** e >!spoiler!<');
    await check('Janela da anotação', '#modal-episode-note');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-show-detail')).toBeHidden();

    await tap(page.getByRole('button', { name: 'Oppenheimer', exact: true }));
    await check('Janela da obra (filme)', '#modal-show-detail');
    await page.keyboard.press('Escape');

    await tap(page.locator('#btn-open-backup'));
    await check('Janela de backup', '#modal-backup');
    await page.keyboard.press('Escape');

    await page.locator('#btn-open-auth').click();
    await check('Janela de entrar', '#tvtime-auth-modal');
    await page.locator('#tvtime-tab-register').click();
    await check('Janela de cadastrar', '#tvtime-auth-modal');
    await page.keyboard.press('Escape');

    // Diário com anotação (spoiler incluído)
    await gotoTab(page, 'next-up');
    await tap(queueCard(page, 'Breaking Bad').getByRole('button', { name: /^Anotar no diário/ }));
    await page.locator('#note-textarea').fill('Anotação com **negrito**, *itálico* e >!um spoiler!<');
    await expect(page.locator('#note-save-status .save-text')).toHaveText(/^Salvo neste aparelho às /);
    await tap(page.locator('#btn-save-note-modal'));
    await gotoTab(page, 'diary');
    await expect(page.locator('#diary-container .diary-entry-card')).toHaveCount(1);
    await check('Diário (com anotação)');
    await tap(page.locator('#diary-container .md-spoiler'));
    await expect(page.locator('#diary-container .md-spoiler')).toHaveAttribute('aria-expanded', 'true');
    report['Diário (spoiler revelado)'] = await scan(page, undefined, { spoilerEscondido: false });

    const grave = [];
    const leves = [];
    for (const [tela, violations] of Object.entries(report)) {
      for (const v of violations) (['critical', 'serious'].includes(v.impact) ? grave : leves).push({ tela, ...v });
    }
    await testInfo.attach('axe-todas-as-violacoes.json', {
      body: JSON.stringify({ grave, leves }, null, 2),
      contentType: 'application/json'
    });
    // E2E_AXE_VERBOSE=1 npm run test:e2e -- tests/e2e/10-acessibilidade.spec.js  ->  mostra no terminal TUDO que o axe achou (inclusive o leve)
    if (process.env.E2E_AXE_VERBOSE) console.log(JSON.stringify({ projeto: testInfo.project.name, grave, leves }, null, 2));
    expect(grave, 'violações graves do axe (critical/serious)').toEqual([]);
  });
});
