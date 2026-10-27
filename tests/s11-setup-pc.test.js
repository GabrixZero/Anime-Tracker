// S11: `npm run setup:pc` completa o .env do modo PC SEM sobrescrever nada, gera o JWT_SECRET sem imprimi-lo e é idempotente.
// Tudo em pastas temporárias; o .env e o %LOCALAPPDATA% reais nunca são tocados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ensureEnvKeys, parseEnvText, formatEnvValue, loadEnvFile } = require('../server/config/envFile');
const { buildPcEntries, reviewEnv, runSetup } = require('../server/config/pcSetup');
const { defaultDataDir, defaultBackupDir, isInsideOneDrive, resolveBackupDir, resolveDataDir } = require('../server/config/paths');
const { resolveJwtSecret } = require('../server/config/jwtSecret');

const REPO = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'showvault-s11-setup-'));
const rm = (...dirs) => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
const FIXED_NOW = new Date(2026, 9, 27, 15, 30, 0); // 27/10/2026 15:30 (hora local)
const FAKE_SECRET = 'x'.repeat(64); // segredo de teste, determinístico

const entries = (extra = {}) =>
  buildPcEntries({ dataDir: 'C:\\Dados\\ShowVault\\data', backupDir: 'C:\\Backups\\ShowVault', randomSecret: () => FAKE_SECRET, ...extra });

// ---- valores no .env ----

test('formatEnvValue: o parser do Node devolve exatamente o texto escrito (caminhos do Windows, #, espaços, apóstrofo)', () => {
  const values = [
    'C:\\Users\\Gabri\\AppData\\Local\\ShowVault\\data',
    'C:\\Users\\nick\\x', // "\n" entre aspas duplas viraria quebra de linha: por isso nunca usamos aspas duplas
    "C:\\Users\\O'Brien\\AppData",
    'pasta#com-cerquilha',
    ' espaço no começo',
    'espaço no fim ',
    '1'
  ];
  for (const value of values) {
    const line = `K=${formatEnvValue(value)}`;
    assert.equal(parseEnvText(line).K, value, `ida e volta de ${JSON.stringify(value)} via ${JSON.stringify(line)}`);
  }
  assert.throws(() => formatEnvValue('duas\nlinhas'), /quebra de linha/);
  assert.throws(() => formatEnvValue("a'b`c#d"), /não cabe/);
});

test('loadEnvFile: não sobrescreve o ambiente e ignora arquivo ausente', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'A=do-arquivo\nB=tambem\n');
    const env = { A: 'do-ambiente' };
    const r = loadEnvFile(file, env);
    assert.deepEqual(env, { A: 'do-ambiente', B: 'tambem' });
    assert.deepEqual(r.keys, ['B']);
    assert.deepEqual(loadEnvFile(path.join(dir, 'nao-existe'), {}), { loaded: false, keys: [] });
  } finally {
    rm(dir);
  }
});

// ---- ensureEnvKeys ----

test('ensureEnvKeys: arquivo novo recebe todas as chaves num bloco comentado e rodar de novo não muda nada', () => {
  const first = ensureEnvKeys('', entries(), { now: FIXED_NOW });
  assert.equal(first.changed, true);
  assert.deepEqual(
    first.results.map(r => `${r.key}:${r.action}`),
    [
      'NODE_ENV:added',
      'JWT_SECRET:added',
      'STORAGE:added',
      'SHOWVAULT_DATA_DIR:added',
      'SHOWVAULT_BACKUP_DIR:added',
      'PORT:added',
      'HOST:added',
      'TRUST_PROXY:added'
    ]
  );
  assert.match(first.text, /^# --- Modo PC \(npm run setup:pc em 2026-10-27\) ---\n/);
  const parsed = parseEnvText(first.text);
  assert.equal(parsed.NODE_ENV, 'production');
  assert.equal(parsed.STORAGE, 'sqlite');
  assert.equal(parsed.HOST, '127.0.0.1');
  assert.equal(parsed.TRUST_PROXY, '1');
  assert.equal(parsed.PORT, '3000');
  assert.equal(parsed.SHOWVAULT_DATA_DIR, 'C:\\Dados\\ShowVault\\data');
  assert.equal(parsed.SHOWVAULT_BACKUP_DIR, 'C:\\Backups\\ShowVault');
  assert.equal(parsed.JWT_SECRET, FAKE_SECRET);

  const second = ensureEnvKeys(first.text, entries({ randomSecret: () => 'outro-segredo-que-nao-pode-entrar-0123456789' }), {
    now: FIXED_NOW
  });
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text, 'idempotente: o segundo passo devolve o texto igual');
  assert.ok(second.results.every(r => r.action === 'kept'));
});

test('ensureEnvKeys: nunca sobrescreve valor existente; preenche vazios no lugar; preserva comentários, ordem, CRLF e BOM', () => {
  const original = [
    '\uFEFF# Meu .env (comentário que precisa sobreviver)',
    'GOOGLE_CLIENT_ID=abc123.apps.googleusercontent.com',
    'TMDB_API_KEY=chave-do-gabriel',
    'PORT=3055',
    'JWT_SECRET=   # gere com node -e ...',
    'STORAGE=',
    'HOST=',
    '# TRUST_PROXY=99   (comentada: não conta como existente)',
    'CORS_ORIGINS=',
    ''
  ].join('\r\n');

  const r = ensureEnvKeys(original, entries(), { now: FIXED_NOW });
  const action = key => r.results.find(x => x.key === key).action;
  assert.equal(action('PORT'), 'kept', 'PORT=3055 escolhido pela pessoa continua valendo');
  assert.equal(action('JWT_SECRET'), 'filled');
  assert.equal(action('STORAGE'), 'filled');
  assert.equal(action('HOST'), 'filled');
  assert.equal(action('TRUST_PROXY'), 'added', 'chave só comentada não conta como existente');
  assert.equal(action('NODE_ENV'), 'added');

  const parsed = parseEnvText(r.text);
  assert.equal(parsed.PORT, '3055');
  assert.equal(parsed.GOOGLE_CLIENT_ID, 'abc123.apps.googleusercontent.com');
  assert.equal(parsed.TMDB_API_KEY, 'chave-do-gabriel');
  assert.equal(parsed.CORS_ORIGINS, '', 'chave vazia que não pedimos continua intacta');
  assert.equal(parsed.STORAGE, 'sqlite');
  assert.equal(parsed.HOST, '127.0.0.1');
  assert.equal(parsed.TRUST_PROXY, '1');
  assert.equal(parsed.JWT_SECRET, FAKE_SECRET);

  assert.ok(r.text.startsWith('\uFEFF# Meu .env'), 'BOM e primeira linha preservados');
  assert.ok(r.text.includes('JWT_SECRET=' + FAKE_SECRET + ' # gere com node -e ...'), 'o comentário da linha foi mantido ao preencher');
  assert.ok(r.text.includes('# TRUST_PROXY=99   (comentada: não conta como existente)'));
  assert.equal(r.text.replace(/\r\n/g, '').includes('\n'), false, 'só CRLF: nenhuma quebra de linha solta');
  const lineOf = key => r.text.split('\r\n').findIndex(l => l.startsWith(`${key}=`));
  assert.ok(lineOf('GOOGLE_CLIENT_ID') < lineOf('PORT') && lineOf('PORT') < lineOf('JWT_SECRET'), 'a ordem original não mudou');
});

test('ensureEnvKeys: o segredo não aparece nos resultados e o gerado serve para o servidor em produção', () => {
  const r = ensureEnvKeys('', buildPcEntries({ dataDir: '/d', backupDir: '/b' }), { now: FIXED_NOW });
  const secretResult = r.results.find(x => x.key === 'JWT_SECRET');
  assert.equal(secretResult.action, 'added');
  assert.equal('value' in secretResult, false);
  const secret = parseEnvText(r.text).JWT_SECRET;
  assert.ok(secret.length >= 32);
  assert.equal(JSON.stringify(r.results).includes(secret), false);
  assert.equal(resolveJwtSecret({ env: parseEnvText(r.text), dataDir: '/d', isProduction: true }).source, 'env');

  const again = ensureEnvKeys('', buildPcEntries({ dataDir: '/d', backupDir: '/b' }), { now: FIXED_NOW });
  assert.notEqual(parseEnvText(again.text).JWT_SECRET, secret, 'cada instalação gera o seu segredo');
});

// ---- pastas padrão ----

test('paths: pastas do modo PC no Windows (dados fora do OneDrive, backups dentro) e nos outros sistemas', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Teste\\AppData\\Local', OneDrive: 'C:\\Users\\Teste\\OneDrive' };
  const home = 'C:\\Users\\Teste';
  assert.equal(defaultDataDir({ env, platform: 'win32', homedir: home }), 'C:\\Users\\Teste\\AppData\\Local\\ShowVault\\data');
  assert.equal(defaultDataDir({ env: {}, platform: 'win32', homedir: home }), 'C:\\Users\\Teste\\AppData\\Local\\ShowVault\\data');

  const has =
    (...found) =>
    p =>
      found.includes(p);
  assert.equal(
    defaultBackupDir({ env, platform: 'win32', homedir: home, exists: has('C:\\Users\\Teste\\OneDrive\\Documentos') }),
    'C:\\Users\\Teste\\OneDrive\\Documentos\\ShowVault-Backups'
  );
  assert.equal(
    defaultBackupDir({ env, platform: 'win32', homedir: home, exists: has('C:\\Users\\Teste\\OneDrive\\Documents') }),
    'C:\\Users\\Teste\\OneDrive\\Documents\\ShowVault-Backups'
  );
  assert.equal(defaultBackupDir({ env, platform: 'win32', homedir: home, exists: has() }), 'C:\\Users\\Teste\\OneDrive\\ShowVault-Backups');
  assert.equal(
    defaultBackupDir({ env: {}, platform: 'win32', homedir: home, exists: has() }),
    'C:\\Users\\Teste\\Documents\\ShowVault-Backups'
  );

  assert.equal(defaultDataDir({ env: {}, platform: 'linux', homedir: '/home/t' }), '/home/t/.local/share/ShowVault/data');
  assert.equal(defaultDataDir({ env: { XDG_DATA_HOME: '/x' }, platform: 'linux', homedir: '/home/t' }), '/x/ShowVault/data');
  assert.equal(defaultDataDir({ env: {}, platform: 'darwin', homedir: '/Users/t' }), '/Users/t/Library/Application Support/ShowVault/data');
  assert.equal(defaultBackupDir({ env: {}, platform: 'linux', homedir: '/home/t' }), '/home/t/ShowVault-Backups');

  // SHOWVAULT_BACKUP_DIR / SHOWVAULT_DATA_DIR mandam quando existem
  assert.equal(resolveBackupDir({ SHOWVAULT_BACKUP_DIR: __dirname }), __dirname);
  assert.equal(resolveDataDir({ SHOWVAULT_DATA_DIR: __dirname }), __dirname);
  assert.ok(resolveDataDir({}).endsWith(path.join('server', 'data')));
});

test('isInsideOneDrive reconhece a pasta do OneDrive (com ou sem a variável de ambiente)', () => {
  const env = { OneDrive: 'C:\\Users\\Teste\\OneDrive' };
  assert.equal(isInsideOneDrive('C:\\Users\\Teste\\OneDrive\\Documentos\\Antigravity Projeto\\server\\data', env, 'win32'), true);
  assert.equal(isInsideOneDrive('c:\\users\\teste\\onedrive', env, 'win32'), true, 'sem diferenciar maiúsculas');
  assert.equal(isInsideOneDrive('C:\\Users\\Teste\\AppData\\Local\\ShowVault\\data', env, 'win32'), false);
  assert.equal(isInsideOneDrive('D:\\OneDrive - Empresa\\x', {}, 'win32'), true, 'pelo nome, mesmo sem a variável');
  assert.equal(isInsideOneDrive('C:\\Users\\Teste\\OneDriveFake\\x', env, 'win32'), false, 'só a pasta inteira, não um prefixo parecido');
});

// ---- avisos ----

test('reviewEnv: .env do modo PC não tem avisos; .env de desenvolvimento avisa o que importa', () => {
  const env = { OneDrive: 'C:\\Users\\Teste\\OneDrive' };
  const pc = {
    NODE_ENV: 'production',
    JWT_SECRET: FAKE_SECRET,
    STORAGE: 'sqlite',
    SHOWVAULT_DATA_DIR: 'C:\\Users\\Teste\\AppData\\Local\\ShowVault\\data',
    PORT: '3000',
    HOST: '127.0.0.1',
    TRUST_PROXY: '1'
  };
  assert.deepEqual(reviewEnv(pc, { env, platform: 'win32' }), []);

  const root = path.join('C:', 'proj');
  const dev = { NODE_ENV: 'development', STORAGE: 'json', HOST: '0.0.0.0', TRUST_PROXY: 'true', JWT_SECRET: 'curto', PORT: 'abc' };
  const keys = reviewEnv(dev, { root, env, platform: process.platform }).map(w => w.key);
  assert.deepEqual(keys.sort(), ['HOST', 'JWT_SECRET', 'NODE_ENV', 'PORT', 'SHOWVAULT_DATA_DIR', 'STORAGE', 'TRUST_PROXY'].sort());

  const inside = reviewEnv({ ...pc, SHOWVAULT_DATA_DIR: 'C:\\Users\\Teste\\OneDrive\\Documentos\\dados' }, { env, platform: 'win32' });
  assert.match(inside[0].message, /dentro do OneDrive/);
  const inProject = reviewEnv(
    { ...pc, SHOWVAULT_DATA_DIR: path.join(root, 'server', 'data') },
    { root, env: {}, platform: process.platform }
  );
  assert.match(inProject[0].message, /server\/data|server\\data/);
  assert.equal(reviewEnv({ ...pc, TRUST_PROXY: '' }, { env, platform: 'win32' })[0].key, 'TRUST_PROXY');
});

// ---- o comando inteiro ----

function runIn(dir, argv, extra = {}) {
  const lines = [];
  const outcome = runSetup({
    argv: ['--env', path.join(dir, '.env'), '--data-dir', path.join(dir, 'dados'), '--backup-dir', path.join(dir, 'backups'), ...argv],
    root: dir,
    now: FIXED_NOW,
    log: line => lines.push(line),
    ...extra
  });
  return { ...outcome, output: lines.join('\n') };
}

test('setup:pc --dry-run mostra o plano e não grava nada (nem .env, nem pastas)', () => {
  const dir = tmp();
  try {
    const r = runIn(dir, ['--dry-run']);
    assert.equal(r.code, 0);
    assert.match(r.output, /simulação/);
    assert.match(r.output, /\+ NODE_ENV=production/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    rm(dir);
  }
});

test('setup:pc cria o .env e as pastas, não imprime o segredo e a segunda execução não muda nada', () => {
  const dir = tmp();
  try {
    const first = runIn(dir, []);
    assert.equal(first.code, 0);
    assert.equal(first.changed, true);
    const text = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    const secret = parseEnvText(text).JWT_SECRET;
    assert.ok(secret.length >= 32);
    assert.equal(first.output.includes(secret), false, 'o JWT_SECRET não pode aparecer na saída');
    assert.match(first.output, /JWT_SECRET=<gerado agora; não é exibido>/);
    assert.ok(fs.statSync(path.join(dir, 'dados')).isDirectory());
    assert.ok(fs.statSync(path.join(dir, 'backups')).isDirectory());
    assert.equal(first.backupFile, null, 'não havia .env anterior para copiar');

    const second = runIn(dir, []);
    assert.equal(second.changed, false);
    assert.match(second.output, /Nada a mudar/);
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), text);
    assert.deepEqual(
      fs.readdirSync(dir).filter(n => n.startsWith('.env.')),
      [],
      'sem cópias nem temporários sobrando'
    );
  } finally {
    rm(dir);
  }
});

test('setup:pc num .env existente: guarda uma cópia, preserva as chaves da pessoa e avisa o que destoa', () => {
  const dir = tmp();
  try {
    const original = 'GOOGLE_CLIENT_ID=abc.apps.googleusercontent.com\nPORT=3055\nSTORAGE=json\nJWT_SECRET=\n';
    fs.writeFileSync(path.join(dir, '.env'), original);
    const r = runIn(dir, []);
    assert.equal(r.code, 0);
    assert.ok(r.backupFile && fs.readFileSync(r.backupFile, 'utf8') === original, 'cópia fiel do .env anterior');
    assert.match(path.basename(r.backupFile), /^\.env\.bak-20261027-153000$/);
    const parsed = parseEnvText(fs.readFileSync(path.join(dir, '.env'), 'utf8'));
    assert.equal(parsed.PORT, '3055');
    assert.equal(parsed.STORAGE, 'json', 'o valor da pessoa vale, mesmo destoando do recomendado');
    assert.equal(parsed.GOOGLE_CLIENT_ID, 'abc.apps.googleusercontent.com');
    assert.ok(parsed.JWT_SECRET.length >= 32);
    assert.match(r.output, /STORAGE=json \(padrão\)|STORAGE=json:/);
    assert.match(r.output, /1 outra\(s\) chave\(s\)|outra\(s\) chave\(s\) do seu \.env não foram tocadas: GOOGLE_CLIENT_ID/);
    assert.equal(r.output.includes(parsed.JWT_SECRET), false);
  } finally {
    rm(dir);
  }
});

test('setup:pc: ajuda e opção desconhecida', () => {
  const help = runSetup({ argv: ['--help'], log: () => {} });
  assert.equal(help.code, 0);
  const lines = [];
  const bad = runSetup({ argv: ['--nada'], log: l => lines.push(l) });
  assert.equal(bad.code, 1);
  assert.match(lines.join('\n'), /Uso: npm run setup:pc/);
});

test('o .env gerado pelo comando é aceito pela configuração real do servidor (produção, 127.0.0.1, TRUST_PROXY=1, sqlite)', () => {
  const dir = tmp();
  try {
    const cli = spawnSync(
      process.execPath,
      [
        'scripts/setup-pc.js',
        '--env',
        path.join(dir, '.env'),
        '--data-dir',
        path.join(dir, 'dados'),
        '--backup-dir',
        path.join(dir, 'backups')
      ],
      { cwd: REPO, encoding: 'utf8' }
    );
    assert.equal(cli.status, 0, cli.stderr);

    const env = { ...process.env };
    for (const k of ['HOST', 'PORT', 'NODE_ENV', 'STORAGE', 'TRUST_PROXY', 'JWT_SECRET', 'SHOWVAULT_DATA_DIR']) delete env[k];
    const code =
      "const c = require('./server/config/config'); console.log(JSON.stringify({ prod: c.IS_PRODUCTION, host: c.HOST, trust: c.TRUST_PROXY, storage: c.STORAGE, port: c.PORT, dir: c.DATA_DIR, secret: c.JWT_SECRET_SOURCE }))";
    const loaded = spawnSync(process.execPath, [`--env-file=${path.join(dir, '.env')}`, '-e', code], { cwd: REPO, env, encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.deepEqual(JSON.parse(loaded.stdout.trim().split('\n').pop()), {
      prod: true,
      host: '127.0.0.1',
      trust: 1,
      storage: 'sqlite',
      port: '3000',
      dir: path.join(dir, 'dados'),
      secret: 'env'
    });

    // scripts/show-config.js (usado pelo PowerShell) lê o mesmo arquivo e não vaza o segredo
    const shown = spawnSync(process.execPath, ['scripts/show-config.js', '--env', path.join(dir, '.env')], {
      cwd: REPO,
      env,
      encoding: 'utf8'
    });
    assert.equal(shown.status, 0, shown.stderr);
    const info = JSON.parse(shown.stdout);
    assert.equal(info.healthUrl, 'http://127.0.0.1:3000/health');
    assert.equal(info.storage, 'sqlite');
    assert.equal(info.dataDir, path.join(dir, 'dados'));
    assert.equal(info.backupDir, path.join(dir, 'backups'));
    assert.deepEqual(info.problems, []);
    assert.ok(info.jwtSecretLength >= 32);
    assert.equal(shown.stdout.includes(parseEnvText(fs.readFileSync(path.join(dir, '.env'), 'utf8')).JWT_SECRET), false);
  } finally {
    rm(dir);
  }
});

test('show-config.js aponta problemas de um .env incompleto em produção', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'NODE_ENV=production\nHOST=127.0.0.1:3000\nPORT=99999\n');
    const env = { ...process.env };
    for (const k of ['HOST', 'PORT', 'NODE_ENV', 'JWT_SECRET']) delete env[k];
    const shown = spawnSync(process.execPath, ['scripts/show-config.js', '--env', path.join(dir, '.env')], {
      cwd: REPO,
      env,
      encoding: 'utf8'
    });
    assert.equal(shown.status, 0, shown.stderr);
    const info = JSON.parse(shown.stdout);
    assert.equal(info.port, 3000);
    assert.equal(info.problems.length, 3);
    assert.ok(info.problems.some(p => /HOST inválido/.test(p)));
    assert.ok(info.problems.some(p => /PORT inválida/.test(p)));
    assert.ok(info.problems.some(p => /JWT_SECRET/.test(p)));
  } finally {
    rm(dir);
  }
});
