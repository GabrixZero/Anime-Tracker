// Botões só com ícone e botões de fechar: tamanho mínimo de 24x24 px, nunca cobertos por outra camada, ícone SVG com tamanho por CSS,
// o X fecha o diálogo e a tecla Esc também. Cobre Entrar, Minha conta, detalhe da obra, anotação, backup e importar.
'use strict';

const fs = require('fs');
const { test, expect } = require('./support/fixtures');
const { openApp, gotoTab, seedLibrary, queueCard, listCard, newUser, signInWithApi, tap } = require('./support/helpers');

const MIN = 24;

// Percorre os botões visíveis dentro de `rootSelector` que não têm texto (só ícone ou "×") e devolve os problemas encontrados.
async function auditIconButtons(page, rootSelector) {
  return page.evaluate(
    ({ root, min }) => {
      const problems = [];
      const scope = document.querySelector(root);
      if (!scope) return [`${root}: não encontrado`];
      let checked = 0;
      for (const btn of scope.querySelectorAll('button')) {
        if (!btn.checkVisibility()) continue;
        const text = btn.textContent.replace(/[\s×]/g, '');
        if (text !== '') continue; // tem texto: não é só ícone
        checked += 1;
        const name = btn.id || btn.className || btn.getAttribute('aria-label') || 'button';
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        const r = btn.getBoundingClientRect();
        if (r.width < min || r.height < min) problems.push(`${name}: ${Math.round(r.width)}x${Math.round(r.height)} (< ${min}x${min})`);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === btn || btn.contains(hit))) {
          problems.push(`${name}: coberto por ${hit ? hit.tagName + '.' + hit.className : 'nada'}`);
        }
        for (const svg of btn.querySelectorAll('svg')) {
          const s = svg.getBoundingClientRect();
          if (s.width < 8 || s.width > 64 || s.height < 8 || s.height > 64) {
            problems.push(`${name}: svg ${Math.round(s.width)}x${Math.round(s.height)} sem tamanho por CSS`);
          }
        }
      }
      return problems.length ? problems : checked === 0 ? [`${root}: nenhum botão só-ícone encontrado`] : [];
    },
    { root: rootSelector, min: MIN }
  );
}

// Abre o diálogo, audita, fecha pelo X, reabre e fecha pelo Esc.
async function checkDialog(page, { open, dialog, close }) {
  await open();
  await expect(page.locator(dialog)).toBeVisible();
  expect(await auditIconButtons(page, dialog)).toEqual([]);
  const box = await page.locator(close).boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(MIN);
  expect(box.height).toBeGreaterThanOrEqual(MIN);
  await page.locator(close).click();
  await expect(page.locator(dialog)).toBeHidden();

  await open();
  await expect(page.locator(dialog)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(dialog)).toBeHidden();
}

test.describe('botões de ícone e de fechar', () => {
  test('Entrar: o X recebe o clique, tem tamanho mínimo e Esc fecha', async ({ page }) => {
    await openApp(page);
    await checkDialog(page, {
      open: () => page.locator('#btn-open-auth').click(),
      dialog: '#tvtime-auth-modal',
      close: '#btn-close-tvtime-auth'
    });
    // Cadastrar também (a aba muda o conteúdo, não a camada do X)
    await page.locator('#btn-open-auth').click();
    await page.locator('#tvtime-tab-register').click();
    expect(await auditIconButtons(page, '#tvtime-auth-modal')).toEqual([]);
  });

  test('Minha conta, backup e importar', async ({ page }, testInfo) => {
    await openApp(page);
    await signInWithApi(page, newUser(testInfo, 'icones'));

    await checkDialog(page, {
      open: () => page.locator('#btn-open-account').click(),
      dialog: '#modal-account',
      close: '#btn-close-account'
    });

    const backupOpen = () => tap(page.locator('#btn-open-backup'));
    await checkDialog(page, { open: backupOpen, dialog: '#modal-backup', close: '#btn-close-backup-modal' });

    const file = testInfo.outputPath('mal.xml');
    fs.writeFileSync(
      file,
      '<?xml version="1.0"?><myanimelist><anime><series_animedb_id>90001</series_animedb_id><series_title>Hoshi no Kioku</series_title>' +
        '<series_type>TV</series_type><series_episodes>3</series_episodes><my_watched_episodes>3</my_watched_episodes>' +
        '<my_score>9</my_score><my_status>Completed</my_status></anime></myanimelist>'
    );
    const importOpen = async () => {
      await backupOpen();
      await page.locator('#input-import-mal').setInputFiles(file);
    };
    await checkDialog(page, { open: importOpen, dialog: '#modal-import', close: '#btn-close-import-modal' });
  });

  test('detalhe da obra, anotação e botões de ícone das telas', async ({ page }) => {
    await openApp(page);
    await seedLibrary(page);

    // Fila "A Seguir": ícones de marcar e anotar têm que ser clicáveis
    await gotoTab(page, 'next-up');
    const problems = await auditIconButtons(page, '#next-up-container');
    expect(problems.filter(p => !p.includes('nenhum botão'))).toEqual([]);

    await checkDialog(page, {
      open: async () => {
        await gotoTab(page, 'watchlist');
        await tap(listCard(page, 'Breaking Bad').getByRole('button', { name: 'Breaking Bad', exact: true }));
      },
      dialog: '#modal-show-detail',
      close: '#btn-close-show-modal'
    });

    await checkDialog(page, {
      open: async () => {
        await gotoTab(page, 'next-up');
        await tap(queueCard(page, 'Breaking Bad').getByRole('button', { name: /^Anotar no diário: Breaking Bad/ }));
      },
      dialog: '#modal-episode-note',
      close: '#btn-close-note-modal'
    });
  });
});
