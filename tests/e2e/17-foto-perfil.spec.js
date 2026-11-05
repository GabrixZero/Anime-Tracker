// Foto de perfil: escolher o arquivo no seletor, ver a foto em Minha conta e no cabeçalho, e "Remover foto" volta ao avatar padrão.
// O PNG é gerado em memória (nenhuma foto real no repositório).
'use strict';

const zlib = require('zlib');
const { test, expect } = require('./support/fixtures');
const { newUser, signInWithApi } = require('./support/helpers');

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// PNG de 40x20 px, todo azul (retangular de propósito: o app recorta o quadrado central)
function makePng() {
  const w = 40;
  const h = 20;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [30, 100, 220]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

test('foto de perfil: aparece em Minha conta e no cabeçalho, e dá para remover', async ({ page }, testInfo) => {
  await signInWithApi(page, newUser(testInfo, 'foto'));
  await page.locator('#btn-open-account').click();
  await expect(page.locator('#modal-account')).toBeVisible();

  const header = page.locator('#user-avatar-img');
  const big = page.locator('#account-avatar');
  const remove = page.locator('#btn-account-photo-remove');
  await expect(remove).toBeHidden();
  const defaultSrc = await big.getAttribute('src');
  expect(defaultSrc).toBeTruthy();
  expect(defaultSrc.startsWith('blob:')).toBe(false);

  // botão acessível, foto grande e redonda
  const button = page.getByRole('button', { name: 'Alterar foto de perfil' });
  await expect(button).toBeVisible();
  const box = await big.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(90);
  await expect(big).toHaveCSS('border-radius', '50%');

  // arquivo que não é imagem aceita: mensagem em português e nada muda
  await page
    .locator('#account-photo-input')
    .setInputFiles({ name: 'desenho.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(page.locator('#account-photo-msg')).toContainText('Tipo de arquivo não aceito');
  await expect(remove).toBeHidden();

  // PNG de verdade
  await page.locator('#account-photo-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: makePng() });
  await expect(big).toHaveAttribute('src', /^blob:/);
  await expect(header).toHaveAttribute('src', /^blob:/);
  await expect(remove).toBeVisible();
  await expect(page.locator('#account-photo-msg')).toBeHidden();

  // a foto ficou guardada na conta e chega pela API, só com o token
  const token = await page.evaluate(() => localStorage.getItem('showvault_auth_token'));
  expect((await page.request.get('/api/user/avatar')).status()).toBe(401);
  const mine = await page.request.get('/api/user/avatar', { headers: { Authorization: `Bearer ${token}` } });
  expect(mine.status()).toBe(200);
  expect(mine.headers()['content-type']).toMatch(/^image\/(webp|jpeg)$/);

  // remover volta ao avatar padrão
  await remove.click();
  await expect(big).toHaveAttribute('src', defaultSrc);
  await expect(header).toHaveAttribute('src', defaultSrc);
  await expect(remove).toBeHidden();
});
