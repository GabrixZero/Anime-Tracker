// Regra de senha nova (criar conta e trocar senha): 8 a 128 caracteres, ao menos uma letra e um número.
// Uma só função (public/js/utils/passwordRules.js) vale para o navegador e para o servidor. Login NÃO usa esta regra.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// validators.js carrega o UserModel (singleton): aponte os dados para uma pasta temporária (nunca server/data real).
process.env.SHOWVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s20-'));
process.on('exit', () => fs.rmSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true, force: true }));

const { checkPasswordRules } = require('../public/js/utils/passwordRules');
const v = require('../server/utils/validators');

const LENGTH = 'A senha precisa ter pelo menos 8 caracteres.';
const NUMBER = 'Falta pelo menos um número.';
const LETTER = 'Falta pelo menos uma letra.';

test('regra central: casos de borda com mensagem exata', () => {
  const cases = [
    ['abc1234', LENGTH], // 7 caracteres
    ['senhasemnumero', NUMBER], // só letras
    ['1234567890', LETTER], // só números
    ['a1'.repeat(64) + 'b', 'A senha pode ter no máximo 128 caracteres.'], // 129
    ['        ', NUMBER], // só espaços
    ['', 'A senha é obrigatória.']
  ];
  for (const [senha, erro] of cases) {
    const r = checkPasswordRules(senha);
    assert.equal(r.ok, false, JSON.stringify(senha.slice(0, 10)));
    assert.equal(r.error, erro);
  }
  assert.equal(checkPasswordRules(undefined).ok, false);
  assert.equal(checkPasswordRules(12345678).ok, false);
});

test('regra central: senhas válidas (inclui espaços, acentos e 128 caracteres)', () => {
  for (const senha of ['senhaTeste123', 'minha senha 2026', 'çãoÉ12345', 'a1'.repeat(64)]) {
    assert.deepEqual(checkPasswordRules(senha), { ok: true }, senha.slice(0, 12));
  }
});

test('rótulo "A nova senha" nas mensagens de tamanho; letra/número têm texto fixo', () => {
  assert.equal(checkPasswordRules('abc1', 'A nova senha').error, 'A nova senha precisa ter pelo menos 8 caracteres.');
  assert.equal(checkPasswordRules('abcdefgh', 'A nova senha').error, NUMBER);
});

test('servidor: cadastro e troca de senha usam a regra central', () => {
  const base = { email: 'ana@exemplo.com' };
  assert.equal(v.validateRegister({ ...base, password: 'senhaTeste123' }).ok, true);
  assert.equal(v.validateRegister({ ...base, password: 'somenteletras' }).fields.password, NUMBER);
  assert.equal(v.validateRegister({ ...base, password: '123456789' }).fields.password, LETTER);

  const change = (currentPassword, newPassword) => v.validateChangePassword({ currentPassword, newPassword });
  assert.equal(change('qualquer', 'novaSenha456').ok, true);
  assert.equal(change('qualquer', 'abc1').fields.newPassword, 'A nova senha precisa ter pelo menos 8 caracteres.');
  assert.equal(change('qualquer', 'somenteletras').fields.newPassword, NUMBER);
  assert.equal(change('qualquer', '123456789').fields.newPassword, LETTER);
  assert.equal(change('senhaTeste123', 'senhaTeste123').fields.newPassword, 'A nova senha precisa ser diferente da atual.');
});

test('login não recebe a regra: senha antiga fraca continua válida', () => {
  assert.equal(v.validateLogin({ email: 'ana@exemplo.com', password: 'curta' }).ok, true);
  assert.equal(v.validateLogin({ email: 'ana@exemplo.com', password: '12345678' }).ok, true);
  assert.equal(v.validatePasswordConfirmation({ password: 'abc' }).ok, true);
});

test('login com corpo vazio: campos email e password com mensagem', () => {
  const r = v.validateLogin({});
  assert.equal(r.ok, false);
  assert.equal(r.fields.email, 'Informe o e-mail.');
  assert.equal(r.fields.password, 'A senha é obrigatória.');
});
