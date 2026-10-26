// Segredo JWT (D-15): local e único fora de produção, obrigatório e forte em produção. Nada aqui toca em server/data real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { resolveJwtSecret, loadOrCreateLocalSecret, SECRET_FILE_NAME, MIN_SECRET_LENGTH } = require('../server/config/jwtSecret');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-jwtsecret-'));
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));
let n = 0;
const newDir = () => {
  const dir = path.join(ROOT, `case-${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const quiet = (fn) => {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};

test('sem JWT_SECRET fora de produção: gera um segredo único, grava em jwt.secret e reaproveita (idempotente)', () => {
  const dir = newDir();
  const first = quiet(() => resolveJwtSecret({ env: {}, dataDir: dir, isProduction: false }));
  assert.equal(first.source, 'file');
  assert.ok(first.secret.length >= MIN_SECRET_LENGTH);
  assert.notEqual(first.secret, 'showvault_dev_only_secret_change_me');
  assert.equal(fs.readFileSync(path.join(dir, SECRET_FILE_NAME), 'utf8').trim(), first.secret);

  const second = quiet(() => resolveJwtSecret({ env: {}, dataDir: dir, isProduction: false }));
  assert.equal(second.secret, first.secret, 'mesmo arquivo => mesmo segredo (logins sobrevivem ao reinício)');
  assert.equal(loadOrCreateLocalSecret(dir).created, false);
});

test('instalações diferentes têm segredos diferentes', () => {
  const a = quiet(() => resolveJwtSecret({ env: {}, dataDir: newDir(), isProduction: false }));
  const b = quiet(() => resolveJwtSecret({ env: {}, dataDir: newDir(), isProduction: false }));
  assert.notEqual(a.secret, b.secret);
});

test('arquivo curto/vazio é substituído; arquivo bom nunca é sobrescrito', () => {
  const dir = newDir();
  const file = path.join(dir, SECRET_FILE_NAME);
  fs.writeFileSync(file, 'curto');
  const regenerated = quiet(() => loadOrCreateLocalSecret(dir));
  assert.equal(regenerated.created, true);
  assert.ok(regenerated.secret.length >= MIN_SECRET_LENGTH);
  assert.equal(quiet(() => loadOrCreateLocalSecret(dir)).secret, regenerated.secret);
});

test('JWT_SECRET do ambiente tem prioridade e não cria arquivo', () => {
  const dir = newDir();
  const secret = 'x'.repeat(40);
  const r = resolveJwtSecret({ env: { JWT_SECRET: secret }, dataDir: dir, isProduction: false });
  assert.deepEqual(r, { secret, source: 'env' });
  assert.equal(fs.existsSync(path.join(dir, SECRET_FILE_NAME)), false);
});

test('pasta de dados sem permissão de escrita: segredo só em memória (nunca o padrão público)', () => {
  const blocker = path.join(newDir(), 'arquivo-no-lugar-da-pasta');
  fs.writeFileSync(blocker, 'x');
  const r = quiet(() => resolveJwtSecret({ env: {}, dataDir: path.join(blocker, 'data'), isProduction: false }));
  assert.equal(r.source, 'memory');
  assert.ok(r.secret.length >= MIN_SECRET_LENGTH);
});

test('produção: sem JWT_SECRET falha; segredo curto ou o do exemplo/antigo padrão falha; um bom passa', () => {
  const dir = newDir();
  assert.throws(() => resolveJwtSecret({ env: {}, dataDir: dir, isProduction: true }), /JWT_SECRET é obrigatório/);
  assert.throws(() => resolveJwtSecret({ env: { JWT_SECRET: '   ' }, dataDir: dir, isProduction: true }), /obrigatório/);
  assert.throws(() => resolveJwtSecret({ env: { JWT_SECRET: 'curto' }, dataDir: dir, isProduction: true }), /inseguro/);
  assert.throws(() => resolveJwtSecret({ env: { JWT_SECRET: 'showvault_dev_only_secret_change_me' }, dataDir: dir, isProduction: true }), /inseguro/);
  assert.throws(() => resolveJwtSecret({ env: { JWT_SECRET: 'troque-por-um-segredo-longo-e-aleatorio' }, dataDir: dir, isProduction: true }), /inseguro/);
  assert.equal(resolveJwtSecret({ env: { JWT_SECRET: 'a'.repeat(48) }, dataDir: dir, isProduction: true }).source, 'env');
  assert.equal(fs.existsSync(path.join(dir, SECRET_FILE_NAME)), false, 'produção nunca gera arquivo de segredo');
});

// --- Processo real (config.js de verdade) ---------------------------------------------------------------------------------

const REPO = path.join(__dirname, '..');
const childEnv = (extra) => {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(extra)) if (extra[key] === undefined) delete env[key];
  return env;
};

test('processo real: NODE_ENV=production sem JWT_SECRET não sobe', () => {
  const dir = newDir();
  const r = spawnSync(process.execPath, ['-e', "require('./server/app')"], {
    cwd: REPO,
    env: childEnv({ NODE_ENV: 'production', JWT_SECRET: undefined, SHOWVAULT_DATA_DIR: dir }),
    encoding: 'utf8'
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET/);
});

test('processo real: dois "reinícios" seguidos usam o mesmo segredo local', () => {
  const dir = newDir();
  const run = () => execFileSync(process.execPath, ['-e', "process.stdout.write(require('./server/config/config').JWT_SECRET)"], {
    cwd: REPO,
    env: childEnv({ NODE_ENV: 'development', JWT_SECRET: undefined, SHOWVAULT_DATA_DIR: dir }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim().split('\n').pop();
  const first = run();
  const second = run();
  assert.ok(first.length >= MIN_SECRET_LENGTH);
  assert.equal(first, second);
  assert.ok(fs.existsSync(path.join(dir, SECRET_FILE_NAME)));
});
