// `npm run setup:pc` (S11, D-29): prepara o .env para rodar o ShowVault no próprio computador (Windows) publicado pelo Tailscale Funnel.
//
// Só COMPLETA o .env: nunca sobrescreve uma chave que já tem valor (a pessoa pode ter GOOGLE_CLIENT_ID, TMDB_API_KEY, PORT...).
// O JWT_SECRET é gerado na hora e nunca é impresso. Nada aqui mexe em configurações do sistema; só cria o .env e as pastas de dados e backup.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('util');

const { ensureEnvKeys, parseEnvText } = require('./envFile');
const { MIN_SECRET_LENGTH } = require('./jwtSecret');
const { defaultDataDir, defaultBackupDir, isInsideOneDrive } = require('./paths');
const { parseHost, isLoopbackHost } = require('./network');

const generateJwtSecret = () => crypto.randomBytes(48).toString('hex');

// As chaves do modo PC, na ordem em que entram no .env. `dataDir`/`backupDir` já vêm decididos.
function buildPcEntries({ dataDir, backupDir, randomSecret = generateJwtSecret }) {
  return [
    { key: 'NODE_ENV', value: 'production' },
    { key: 'JWT_SECRET', value: randomSecret, secret: true },
    { key: 'STORAGE', value: 'sqlite' },
    { key: 'SHOWVAULT_DATA_DIR', value: dataDir },
    { key: 'SHOWVAULT_BACKUP_DIR', value: backupDir },
    { key: 'PORT', value: '3000' },
    { key: 'HOST', value: '127.0.0.1' },
    { key: 'TRUST_PROXY', value: '1' }
  ];
}

// Confere o .env já completo e devolve avisos em português (não bloqueiam nada; quem manda é o que a pessoa escreveu).
function reviewEnv(effective, { root, env = process.env, platform = process.platform } = {}) {
  const warnings = [];
  const warn = (key, message) => warnings.push({ key, message });
  const get = key => (effective[key] || '').trim();

  if (get('NODE_ENV') !== 'production') {
    warn('NODE_ENV', `NODE_ENV=${get('NODE_ENV') || '(vazio)'}: no modo PC o certo é production (liga HSTS e exige segredo forte).`);
  }
  if (get('STORAGE') !== 'sqlite') {
    warn('STORAGE', `STORAGE=${get('STORAGE') || 'json (padrão)'}: o modo PC usa sqlite (backups consistentes e um arquivo só).`);
  }
  const secret = get('JWT_SECRET');
  if (secret && secret.length < MIN_SECRET_LENGTH) {
    warn(
      'JWT_SECRET',
      `JWT_SECRET tem menos de ${MIN_SECRET_LENGTH} caracteres: o servidor em produção vai recusar. Apague a linha e rode de novo.`
    );
  }
  try {
    const host = parseHost(get('HOST'), { isProduction: get('NODE_ENV') === 'production' });
    if (host && !isLoopbackHost(host)) {
      warn('HOST', `HOST=${host} deixa o app aberto para a rede local. Para o Funnel use 127.0.0.1 (só este computador).`);
    }
  } catch (err) {
    warn('HOST', err.message);
  }
  const trust = get('TRUST_PROXY').toLowerCase();
  if (trust === 'true') {
    warn('TRUST_PROXY', 'TRUST_PROXY=true confia em qualquer X-Forwarded-For (o IP pode ser forjado). Com o Funnel use 1.');
  } else if (trust === '' || trust === 'false' || trust === '0') {
    warn('TRUST_PROXY', 'TRUST_PROXY desligado: o limite de tentativas veria todos os visitantes como o mesmo IP. Com o Funnel use 1.');
  }
  const port = get('PORT');
  if (port && !(Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535)) {
    warn('PORT', `PORT=${port} não é uma porta válida (1 a 65535).`);
  }
  const dataDir = get('SHOWVAULT_DATA_DIR');
  if (!dataDir) {
    warn('SHOWVAULT_DATA_DIR', 'SHOWVAULT_DATA_DIR vazio: os dados ficariam em server/data, dentro do projeto (que está no OneDrive).');
  } else {
    if (isInsideOneDrive(dataDir, env, platform)) {
      warn(
        'SHOWVAULT_DATA_DIR',
        `SHOWVAULT_DATA_DIR está dentro do OneDrive (${dataDir}): o OneDrive pode corromper o banco em uso. Use uma pasta fora dele.`
      );
    }
    if (root && path.resolve(dataDir) === path.join(root, 'server', 'data')) {
      warn(
        'SHOWVAULT_DATA_DIR',
        'SHOWVAULT_DATA_DIR aponta para server/data, dentro do projeto. O modo PC guarda o banco fora do OneDrive.'
      );
    }
  }
  return warnings;
}

const USAGE = `Uso: npm run setup:pc [-- opções]
  --dry-run            só mostra o que seria feito; não grava nada
  --env <arquivo>      .env a completar (padrão: o .env da pasta do projeto)
  --data-dir <pasta>   pasta do banco (padrão: %LOCALAPPDATA%\\ShowVault\\data)
  --backup-dir <pasta> pasta dos backups (padrão: OneDrive\\Documentos\\ShowVault-Backups)
  --help               esta ajuda`;

const stampLabel = date => {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

// Roda o setup. Tudo que depende do computador (ambiente, plataforma, pasta pessoal, relógio, saída) é injetável para os testes.
function runSetup({
  argv = [],
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  root = path.join(__dirname, '..', '..'),
  exists = fs.existsSync,
  now = new Date(),
  log = console.log,
  randomSecret = generateJwtSecret
} = {}) {
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: {
        'dry-run': { type: 'boolean', default: false },
        env: { type: 'string' },
        'data-dir': { type: 'string' },
        'backup-dir': { type: 'string' },
        help: { type: 'boolean', default: false }
      },
      strict: true,
      allowPositionals: false
    }));
  } catch (err) {
    log(`${err.message}\n\n${USAGE}`);
    return { code: 1 };
  }
  if (args.help) {
    log(USAGE);
    return { code: 0 };
  }

  const envFile = path.resolve(args.env || path.join(root, '.env'));
  const existed = fs.existsSync(envFile);
  const before = existed ? fs.readFileSync(envFile, 'utf8') : '';
  const dataDir = args['data-dir'] ? path.resolve(args['data-dir']) : defaultDataDir({ env, platform, homedir });
  const backupDir = args['backup-dir'] ? path.resolve(args['backup-dir']) : defaultBackupDir({ env, platform, homedir, exists });

  const plan = ensureEnvKeys(before, buildPcEntries({ dataDir, backupDir, randomSecret }), { now });
  const effective = parseEnvText(plan.text);
  const warnings = reviewEnv(effective, { root, env, platform });
  const dry = !!args['dry-run'];

  log('ShowVault · preparar este computador (modo PC)\n');
  log(`Arquivo de configuração: ${envFile}${existed ? '' : '  (será criado)'}${dry ? '  [simulação: nada será gravado]' : ''}`);
  const symbols = { added: '+', filled: '~', kept: '=' };
  const verbs = { added: 'adicionada', filled: 'preenchida (estava vazia)', kept: 'já tinha valor; mantida' };
  for (const r of plan.results) {
    const shown = 'value' in r ? `=${r.value}` : r.action === 'kept' ? ' (valor mantido)' : '=<gerado agora; não é exibido>';
    log(`  ${symbols[r.action]} ${r.key}${shown}   ${verbs[r.action]}`);
  }
  const wantedKeys = new Set(plan.results.map(r => r.key));
  const others = Object.keys(parseEnvText(before)).filter(k => !wantedKeys.has(k));
  if (others.length) log(`  (${others.length} outra(s) chave(s) do seu .env não foram tocadas: ${others.join(', ')})`);

  if (warnings.length) {
    log('\nAtenção:');
    for (const w of warnings) log(`  ! ${w.message}`);
  }

  const outcome = { code: 0, changed: plan.changed, results: plan.results, warnings, envFile, backupFile: null, createdDirs: [] };
  if (dry) {
    log('\nSimulação concluída. Rode sem --dry-run para gravar.');
    return outcome;
  }

  if (plan.changed) {
    if (existed) {
      outcome.backupFile = `${envFile}.bak-${stampLabel(now)}`;
      fs.copyFileSync(envFile, outcome.backupFile);
    }
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    const tmp = `${envFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, plan.text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, envFile);
    log(`\n.env ${existed ? 'atualizado' : 'criado'}.${outcome.backupFile ? ` Cópia do anterior: ${outcome.backupFile}` : ''}`);
  } else {
    log('\nNada a mudar: o .env já está completo para o modo PC.');
  }

  for (const [label, dir] of [
    ['dados', effective.SHOWVAULT_DATA_DIR],
    ['backups', effective.SHOWVAULT_BACKUP_DIR]
  ]) {
    if (!dir) continue;
    if (fs.existsSync(dir)) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      outcome.createdDirs.push(dir);
      log(`Pasta de ${label} criada: ${dir}`);
    } catch (err) {
      log(`  ! Não consegui criar a pasta de ${label} (${dir}): ${err.message}`);
    }
  }

  log(
    '\nPróximo passo: siga o guia Documentacao/deploy-pc-tailscale.md (migrar os dados atuais, ligar com o Windows e publicar pelo Tailscale).'
  );
  return outcome;
}

module.exports = { buildPcEntries, reviewEnv, runSetup, generateJwtSecret, USAGE };
