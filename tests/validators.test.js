// Validação centralizada de contas (unidade): nunca lança, sempre devolve ok/erro com mensagem em português.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// O módulo UserModel cria um singleton ao carregar: aponte os dados para uma pasta temporária antes (nunca server/data real).
process.env.SHOWVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-validators-singleton-'));
process.on('exit', () => fs.rmSync(process.env.SHOWVAULT_DATA_DIR, { recursive: true, force: true }));

const v = require('../server/utils/validators');

test('e-mail: normaliza e rejeita formatos inválidos sem lançar', () => {
  assert.equal(v.checkEmail('  Ana@Exemplo.COM ').value, 'ana@exemplo.com');
  for (const bad of [undefined, null, 5, {}, [], '', ' ', 'ana', 'ana@', '@x.com', 'ana@x', 'a..b@x.com', '.a@x.com', 'a@-x.com', 'a b@x.com', 'a@x.com\nb@y.com', `${'a'.repeat(65)}@x.com`]) {
    assert.ok(v.checkEmail(bad).error, `deveria rejeitar ${JSON.stringify(bad)}`);
  }
});

test('cadastro: aceita o caso feliz e limpa os campos', () => {
  const r = v.validateRegister({ email: 'ana@exemplo.com', password: '12345678', name: '  Ana  ', avatar: ' https://x.test/a.png ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { email: 'ana@exemplo.com', password: '12345678', name: 'Ana', avatar: 'https://x.test/a.png' });
  const minimal = v.validateRegister({ email: 'ana@exemplo.com', password: '12345678' });
  assert.deepEqual([minimal.ok, minimal.value.name, minimal.value.avatar], [true, null, null]);
});

test('cadastro: limites de senha (8 a 128) e nome (até 60)', () => {
  const base = { email: 'ana@exemplo.com' };
  assert.equal(v.validateRegister({ ...base, password: 'x'.repeat(7) }).ok, false);
  assert.equal(v.validateRegister({ ...base, password: 'x'.repeat(8) }).ok, true);
  assert.equal(v.validateRegister({ ...base, password: 'x'.repeat(128) }).ok, true);
  assert.equal(v.validateRegister({ ...base, password: 'x'.repeat(129) }).ok, false);
  assert.equal(v.validateRegister({ ...base, password: '12345678', name: 'n'.repeat(60) }).ok, true);
  assert.equal(v.validateRegister({ ...base, password: '12345678', name: 'n'.repeat(61) }).ok, false);
});

test('qualquer corpo que não seja objeto é inválido (sem exceção)', () => {
  for (const body of [undefined, null, 'texto', 5, [], true]) {
    for (const fn of [v.validateRegister, v.validateLogin, v.validateChangePassword, v.validatePasswordConfirmation, v.validateGoogleCredential]) {
      const r = fn(body);
      assert.equal(r.ok, false);
      assert.equal(typeof r.error, 'string');
    }
  }
});

test('login não impõe mínimo de senha (contas antigas), mas limita o tamanho', () => {
  assert.equal(v.validateLogin({ email: 'ana@exemplo.com', password: 'a' }).ok, true);
  assert.equal(v.validateLogin({ email: 'ana@exemplo.com', password: 'a'.repeat(129) }).ok, false);
  assert.equal(v.validateLogin({ email: 'ana@exemplo.com', password: '' }).ok, false);
});

test('UserModel.hashPassword/verifyPassword são assíncronos (scrypt não bloqueia o servidor)', async () => {
  const { UserModel } = require('../server/models/UserModel');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-validators-'));
  try {
    const users = new UserModel(dir, { seedDemo: false });
    const pending = users.hashPassword('segredo-teste-1');
    assert.ok(pending instanceof Promise);
    const stored = await pending;
    const check = users.verifyPassword('segredo-teste-1', stored);
    assert.ok(check instanceof Promise);
    assert.equal(await check, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
