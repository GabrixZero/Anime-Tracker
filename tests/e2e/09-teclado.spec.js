// S12 · Teclado: o fluxo principal inteiro só com Tab / Shift+Tab / Enter / Espaço / setas / Esc (S07): atalho "Pular para o conteúdo", abas,
// carregar o exemplo, marcar episódio, abrir a obra, janelas que prendem o Tab e devolvem o foco, busca no Explorar. Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, waitForBoot } = require('./support/helpers');

// Aperta Tab (ou Shift+Tab) até o foco chegar num elemento que combina com `selector`; falha com o caminho percorrido se não chegar.
async function tabTo(page, selector, { shift = false, max = 60 } = {}) {
  const path = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    const info = await page.evaluate(sel => {
      const el = document.activeElement;
      if (!el || el === document.body) return { hit: false, label: '<body>' };
      const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/)[0]}` : ''}`;
      return { hit: el.matches(sel), label };
    }, selector);
    path.push(info.label);
    if (info.hit) return;
  }
  throw new Error(`O foco não chegou em "${selector}" em ${max} Tabs. Caminho: ${path.join(' > ')}`);
}

// O foco está dentro do diálogo (e não em algum lugar da página por trás)?
const focusInside = (page, dialogSelector) =>
  page.evaluate(sel => {
    const dialog = document.querySelector(sel);
    return !!dialog && dialog.contains(document.activeElement);
  }, dialogSelector);

test.describe('teclado', () => {
  test('atalho para o conteúdo, abas com setas, exemplo, marcar episódio e abrir a obra', async ({ page }) => {
    await openApp(page);

    // 1º Tab = "Pular para o conteúdo"; Enter leva o foco para a área principal
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await expect(page.locator('.skip-link')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    // "Carregar exemplo" só com Tab + Enter
    await tabTo(page, '#next-up-empty [data-action="load-example"]');
    await page.keyboard.press('Enter');
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
    await expect(page.locator('#next-up-counter-pill')).toHaveText('4 títulos na fila');
    // (o foco depois do "Carregar exemplo" é o BUG do teste fixme abaixo: aqui o Tab simplesmente segue em frente)

    // marcar o 1º item da fila com Enter; o foco continua num botão "Assistido" (o do próximo item, já que este saiu da fila)
    await tabTo(page, '#next-up-container .btn-check-episode');
    await page.keyboard.press('Enter');
    await expect(page.locator('#next-up-counter-pill')).toHaveText('3 títulos na fila');
    await expect(page.locator('#next-up-container .btn-check-episode').first()).toBeFocused();

    // Espaço também ativa botões
    await page.keyboard.press('Space');
    await expect(page.locator('#next-up-counter-pill')).toHaveText('2 títulos na fila');

    // abrir a obra: o foco entra na janela, o Tab fica preso dentro dela e o Esc devolve o foco ao botão de origem
    await tabTo(page, '#next-up-container [data-action="open-detail"]');
    const opener = await page.evaluate(() => document.activeElement.getAttribute('data-focus-key'));
    expect(opener).toMatch(/^nu:\d+:open$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#modal-show-detail')).toBeVisible();
    expect(await focusInside(page, '#modal-show-detail')).toBe(true);
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page, '#modal-show-detail'), `Tab nº ${i + 1}: o foco escapou da janela da obra`).toBe(true);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusInside(page, '#modal-show-detail'), `Shift+Tab nº ${i + 1}: o foco escapou da janela da obra`).toBe(true);
    }
    // a página por trás fica inerte enquanto a janela está aberta
    expect(
      await page.evaluate(
        () => document.querySelector('.app-header').hasAttribute('inert') && document.querySelector('#main-content').hasAttribute('inert')
      )
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-show-detail')).toBeHidden();
    await expect(page.locator(`[data-focus-key="${opener}"]`)).toBeFocused();
    expect(await page.evaluate(() => document.querySelector('#main-content').hasAttribute('inert'))).toBe(false);
  });

  // BUG REAL ENCONTRADO (S12, não corrigido aqui: a S12 não mexe no app; ver o diário): ao apertar Enter em "Carregar exemplo" no estado
  // vazio de "A Seguir", o botão some (a fila ocupa o lugar) e o foco cai no <body> — quem usa teclado ou leitor de tela perde o lugar.
  // O `wrapRender` do a11y.js só guarda o foco que está DENTRO de #next-up-container; o botão estava em #next-up-empty. O "Remover
  // exemplo" já trata isso (appController.removeExample manda o foco para o título da tela); o "Carregar exemplo" não.
  // Quando for corrigido, tire o `fixme` (o teste já descreve o comportamento esperado: o foco fica em algum elemento da tela).
  test.fixme('BUG: depois de "Carregar exemplo" pelo teclado o foco não pode cair no <body>', async ({ page }) => {
    await openApp(page);
    await tabTo(page, '#next-up-empty [data-action="load-example"]');
    await page.keyboard.press('Enter');
    await expect(page.locator('#badge-watchlist')).toHaveText('4');
    expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== document.documentElement)).toBe(
      true
    );
  });

  test('abas: setas, Home/End e Enter trocam de aba; o foco acompanha', async ({ page }) => {
    await openApp(page);
    const tab = id => page.locator(`#tab-btn-${id}`);

    await tab('next-up').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab('watchlist')).toBeFocused();
    await expect(page.locator('#view-watchlist')).not.toHaveClass(/active/); // seta só move o foco; quem ativa é Enter/Espaço
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-watchlist')).toHaveClass(/active/);
    await expect(tab('watchlist')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('watchlist')).toHaveAttribute('tabindex', '0');
    await expect(tab('next-up')).toHaveAttribute('tabindex', '-1'); // só a aba ativa entra na ordem do Tab

    await page.keyboard.press('End');
    await expect(tab('explore')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('#view-explore')).toHaveClass(/active/);
    await page.keyboard.press('Home');
    await expect(tab('next-up')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // dá a volta
    await expect(tab('explore')).toBeFocused();
  });

  test('janelas de entrar e de backup: abrem com Enter, prendem o Tab, fecham com Esc e devolvem o foco', async ({ page }) => {
    await openApp(page);

    await page.locator('#btn-open-auth').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tvtime-auth-modal')).toBeVisible();
    expect(await focusInside(page, '#tvtime-auth-modal')).toBe(true);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page, '#tvtime-auth-modal'), `Tab nº ${i + 1}: o foco escapou da janela de entrar`).toBe(true);
    }
    // abas Entrar/Cadastrar também respondem às setas (e ativam ao mover)
    await page.locator('#tvtime-tab-login').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tvtime-tab-register')).toBeFocused();
    await expect(page.locator('#tvtime-name-field')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#tvtime-auth-modal')).toBeHidden();
    await expect(page.locator('#btn-open-auth')).toBeFocused();

    await page.locator('#btn-open-backup').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#modal-backup')).toBeVisible();
    expect(await focusInside(page, '#modal-backup')).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page, '#modal-backup'), `Tab nº ${i + 1}: o foco escapou da janela de backup`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-backup')).toBeHidden();
    await expect(page.locator('#btn-open-backup')).toBeFocused();
  });

  test('Explorar: buscar com Enter, filtrar por tipo e chegar nos cartões só com o teclado', async ({ page }) => {
    await openApp(page);
    await page.locator('#tab-btn-explore').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-explore')).toHaveClass(/active/);

    await tabTo(page, '#explore-search-input');
    await page.keyboard.type('Fronteira');
    await page.keyboard.press('Enter');
    await expect(page.locator('#explore-results-title')).toHaveText('Resultados para "Fronteira" (2)');

    // Tab até o filtro "Séries" e Enter; os botões de tipo mostram qual está ativo
    await page.locator('#explore-search-input').focus();
    await tabTo(page, '[data-explore-type="tv"]');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-explore-type="tv"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#explore-container .show-card')).toHaveCount(2);

    // o título de cada cartão é um botão que abre a obra (Enter); Esc volta para ele
    await tabTo(page, '#explore-container .show-open-btn');
    await page.keyboard.press('Enter');
    await expect(page.locator('#modal-show-detail')).toBeVisible();
    await expect(page.locator('#modal-show-detail .modal-title')).toHaveText(/^Fronteira /);
    await page.keyboard.press('Escape');
    await expect(page.locator('#explore-container .show-open-btn').first()).toBeFocused();
    await waitForBoot(page);
  });
});
