// Ajustes 2 · Marcar o episódio N como assistido marca também os anteriores já lançados, com aviso único e botão "Desfazer".
// Obra FALSA de 40 episódios (guardada só no navegador do teste; nada vai à internet nem ao catálogo): os episódios 36 a 40 ainda não
// foram lançados e a temporada 0 (especiais) não deve ser tocada. Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, toast, localLibrary, tap } = require('./support/helpers');

const SHOW_ID = 987001;
const SHOW_NAME = 'Maratona dos Anteriores';

const modal = page => page.locator('#modal-show-detail');
// O quadro da obra é só leitura (Ajustes 3): marcar/ler o estado pelo caminho que continua existindo (a lógica do app).
const markEp = (page, n) => page.evaluate(([id, ep]) => window.appController.quickCheck(id, 1, ep), [SHOW_ID, n]);
const isWatched = (page, n) => page.evaluate(([id, ep]) => window.appState.isWatched(id, 1, ep), [SHOW_ID, n]);
const expectWatched = async (page, list, value) => {
  for (const n of list) expect(await isWatched(page, n), `episódio ${n}`).toBe(value);
};
const watchedKeys = async page => {
  const lib = await localLibrary(page);
  return Object.keys(lib.watchedEpisodes).filter(k => lib.watchedEpisodes[k].watched);
};

// Põe a obra falsa no cache do app e na lista (mesmo caminho do botão "Adicionar").
async function addFakeShow(page) {
  await page.evaluate(
    ([id, name]) => {
      const day = offset => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return window.Calendar.dayKey(d);
      };
      const episodes = Array.from({ length: 40 }, (_, i) => ({
        episode_number: i + 1,
        name: `Episódio ${i + 1}`,
        runtime: 24,
        // 1 a 35: já lançados (um por semana para trás); 36 a 40: daqui a alguns dias
        air_date: i + 1 <= 35 ? day(-7 * (36 - (i + 1))) : day(i + 1 - 35),
        overview: '',
        still_path: null
      }));
      const specials = [1, 2].map(n => ({
        episode_number: n,
        name: `Especial ${n}`,
        runtime: 10,
        air_date: day(-400),
        overview: '',
        still_path: null
      }));
      window.appState.cacheMediaDetail({
        id,
        type: 'tv',
        name,
        overview: 'Obra fictícia dos testes.',
        poster_path: null,
        backdrop_path: null,
        genres: [],
        status: 'Returning Series',
        first_air_date: day(-300),
        seasons: [
          { season_number: 0, name: 'Especiais', episodes: specials },
          { season_number: 1, name: 'Temporada 1', episodes }
        ]
      });
      window.appState.addShow(id);
      window.appController.refreshAll();
    },
    [SHOW_ID, SHOW_NAME]
  );
  await expect(page.locator('#badge-watchlist')).toHaveText('1');
}

// Navega só com Tab até o botão "Desfazer" do aviso (prova que dá para alcançá-lo sem mouse, mesmo com o modal aberto).
async function tabToUndo(page) {
  let reached = false;
  for (let i = 0; i < 400 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('toast-action'));
  }
  expect(reached, 'o botão Desfazer é alcançável com Tab').toBe(true);
  await expect(page.locator('.toast-action')).toBeFocused();
}

async function undoWithKeyboard(page) {
  await tabToUndo(page);
  await page.keyboard.press('Enter');
}

test.describe('marcar anteriores', () => {
  test('com o quadro aberto: marcar o ep 30 marca 1 a 30, Desfazer (teclado) volta, desmarcar o 10 mexe só nele e futuros não entram', async ({
    page
  }) => {
    await openApp(page);
    await addFakeShow(page);
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: SHOW_NAME, exact: true }));
    await expect(modal(page)).toBeVisible();
    // lista só de leitura: uma temporada por <details>; a primeira (Especiais) vem aberta, a Temporada 1 abre ao clicar
    await expect(page.locator('#show-episodes-container summary')).toHaveText(['Especiais · 2 episódios', 'Temporada 1 · 40 episódios']);
    await tap(page.locator('#show-episodes-container summary').nth(1));
    await expect(page.locator('#show-episodes-container details').nth(1).locator('.episode-line')).toHaveCount(40);
    await expect(page.locator('#show-episodes-container button')).toHaveCount(0);

    // marcar o 30: 1 a 30 ficam assistidos, aviso único com botão Desfazer
    await markEp(page, 30);
    await expect(toast(page, '30 episódios marcados.')).toHaveCount(1);
    await expect(toast(page, '30 episódios marcados.')).toBeVisible();
    await expect(toast(page, '30 episódios marcados.').getByRole('button', { name: 'Desfazer' })).toBeVisible();
    await expectWatched(page, [1, 2, 15, 29, 30], true);
    await expectWatched(page, [31, 35, 36, 40], false);
    expect(await watchedKeys(page)).toHaveLength(30); // os especiais (temporada 0) não entraram
    await expect(page.locator('#detail-status-select')).toHaveValue('watching');

    // Desfazer pelo teclado (Tab + Enter): volta ao estado anterior
    await undoWithKeyboard(page);
    await expect(toast(page, 'Desfeito.')).toBeVisible();
    await expectWatched(page, [1, 30], false);
    expect(await watchedKeys(page)).toHaveLength(0);

    // marca de novo e desmarca só o 10
    await markEp(page, 30);
    await expect(toast(page, '30 episódios marcados.')).toBeVisible();
    await markEp(page, 10);
    await expect(toast(page, 'Desmarcado.')).toBeVisible();
    await expectWatched(page, [10], false);
    await expectWatched(page, [1, 9, 11, 30], true);

    // clicar num episódio futuro (38) marca ele e os lançados que faltam (10 e 31 a 35), nunca os outros futuros
    await markEp(page, 38);
    await expect(toast(page, '7 episódios marcados.')).toBeVisible();
    await expectWatched(page, [38, 10], true);
    await expectWatched(page, [36, 37, 39, 40], false);
    expect(await watchedKeys(page)).toHaveLength(36);
  });

  test('o botão Desfazer do aviso é legível: fundo transparente, borda, fonte de pelo menos 0,8rem e foco visível', async ({ page }) => {
    await openApp(page);
    await addFakeShow(page);
    await gotoTab(page, 'watchlist');
    await tap(page.getByRole('button', { name: SHOW_NAME, exact: true }));
    await markEp(page, 3);
    await expect(toast(page, '3 episódios marcados.')).toBeVisible();
    const button = page.locator('.toast-action');
    await tabToUndo(page); // foco pelo teclado: aparece o contorno de foco (:focus-visible)
    const style = await button.evaluate(el => {
      const css = getComputedStyle(el);
      return {
        background: css.backgroundColor,
        border: css.borderTopWidth,
        borderStyle: css.borderTopStyle,
        fontPx: parseFloat(css.fontSize),
        rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
        outlineStyle: css.outlineStyle,
        outlineWidth: parseFloat(css.outlineWidth),
        color: css.color
      };
    });
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(style.border)).toBeGreaterThan(0);
    expect(style.borderStyle).toBe('solid');
    expect(style.fontPx / style.rootPx).toBeGreaterThanOrEqual(0.8);
    expect(style.outlineStyle).not.toBe('none');
    expect(style.outlineWidth).toBeGreaterThan(0);
    expect(style.color).toBe('rgb(255, 255, 255)');
  });
});
