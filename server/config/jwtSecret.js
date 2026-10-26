// Segredo de assinatura dos tokens (JWT).
//  - Se JWT_SECRET estiver definido, ele manda (obrigatório e validado em produção).
//  - Fora de produção, sem JWT_SECRET: gera um segredo ÚNICO por instalação e o guarda em <DATA_DIR>/jwt.secret
//    (ignorado pelo git). A partir daí o mesmo arquivo é reaproveitado (idempotente), então os logins sobrevivem a reinícios.
//  - Nunca existe um segredo padrão público: se nem o arquivo puder ser gravado, usa um segredo só de memória.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_FILE_NAME = 'jwt.secret';
const MIN_SECRET_LENGTH = 32;
// Valores que já estiveram em repositório/exemplos públicos: jamais aceitos em produção.
const KNOWN_PUBLIC_SECRETS = new Set([
  'showvault_dev_only_secret_change_me',
  'troque-por-um-segredo-longo-e-aleatorio'
]);

function generateSecret() {
  return crypto.randomBytes(48).toString('hex');
}

// Lê o segredo local; se não existir (ou for curto demais), cria. Devolve { secret, file, created, persisted }.
function loadOrCreateLocalSecret(dataDir) {
  const file = path.join(dataDir, SECRET_FILE_NAME);

  const readExisting = () => {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      return value.length >= MIN_SECRET_LENGTH ? value : null;
    } catch {
      return null;
    }
  };

  const existing = readExisting();
  if (existing) return { secret: existing, file, created: false, persisted: true };

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const secret = generateSecret();
    try {
      // 'wx' falha se outro processo criou o arquivo no meio-tempo (corrida na primeira partida).
      fs.writeFileSync(file, secret + '\n', { flag: 'wx', mode: 0o600 });
      return { secret, file, created: true, persisted: true };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const raced = readExisting();
      if (raced) return { secret: raced, file, created: false, persisted: true };
      // Arquivo existe mas está vazio/curto demais: substitui.
      fs.writeFileSync(file, secret + '\n', { mode: 0o600 });
      return { secret, file, created: true, persisted: true };
    }
  } catch (err) {
    console.warn(`[config] Não foi possível gravar ${file} (${err.message}). Usando segredo temporário: os logins serão perdidos ao reiniciar.`);
    return { secret: generateSecret(), file, created: true, persisted: false };
  }
}

// Decide o segredo conforme o ambiente. Lança Error em produção sem segredo seguro.
function resolveJwtSecret({ env = process.env, dataDir, isProduction }) {
  const fromEnv = (env.JWT_SECRET || '').trim();

  if (fromEnv) {
    if (isProduction && (fromEnv.length < MIN_SECRET_LENGTH || KNOWN_PUBLIC_SECRETS.has(fromEnv))) {
      throw new Error(`JWT_SECRET inseguro: use um valor aleatório com pelo menos ${MIN_SECRET_LENGTH} caracteres (e não o do exemplo).`);
    }
    return { secret: fromEnv, source: 'env' };
  }

  if (isProduction) {
    throw new Error('JWT_SECRET é obrigatório quando NODE_ENV=production.');
  }

  const local = loadOrCreateLocalSecret(dataDir);
  if (local.created && local.persisted) {
    console.log(`[config] JWT_SECRET não definido: gerei um segredo local único em ${local.file} (fora do git).`);
  }
  return { secret: local.secret, source: local.persisted ? 'file' : 'memory' };
}

module.exports = { resolveJwtSecret, loadOrCreateLocalSecret, SECRET_FILE_NAME, MIN_SECRET_LENGTH };
