// Pastas do ShowVault no computador de quem hospeda (modo PC, D-29). Funções puras: recebem o ambiente e a plataforma, para os
// scripts e os testes poderem simular outro computador (inclusive um Windows rodando num teste do Linux).
//
//   dados ao vivo   %LOCALAPPDATA%\ShowVault\data     (FORA do OneDrive: o OneDrive pode travar/corromper um SQLite em uso)
//   backups         <OneDrive>\Documentos\ShowVault-Backups  (arquivos fechados; a cópia fora da máquina)
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR_NAME = 'ShowVault';
const BACKUP_DIR_NAME = 'ShowVault-Backups';

const pathFor = platform => (platform === 'win32' ? path.win32 : path.posix);

// Pasta de dados que o servidor realmente usa: SHOWVAULT_DATA_DIR ou server/data (mesma regra de config.js).
function resolveDataDir(env = process.env, fallback = path.join(__dirname, '..', 'data')) {
  return env.SHOWVAULT_DATA_DIR ? path.resolve(env.SHOWVAULT_DATA_DIR) : fallback;
}

// Onde o modo PC guarda o banco: %LOCALAPPDATA%\ShowVault\data no Windows (equivalentes nos outros sistemas).
function defaultDataDir({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  const p = pathFor(platform);
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(homedir, 'AppData', 'Local'), APP_DIR_NAME, 'data');
  if (platform === 'darwin') return p.join(homedir, 'Library', 'Application Support', APP_DIR_NAME, 'data');
  return p.join(env.XDG_DATA_HOME || p.join(homedir, '.local', 'share'), APP_DIR_NAME, 'data');
}

// Pasta do OneDrive pessoal, se existir (o Windows define OneDriveConsumer/OneDrive).
function oneDriveRoot(env = process.env) {
  return env.OneDriveConsumer || env.OneDrive || '';
}

// Pasta padrão dos backups: dentro do OneDrive (Documentos) quando há OneDrive; senão, uma pasta na área do usuário.
function defaultBackupDir({ env = process.env, platform = process.platform, homedir = os.homedir(), exists = fs.existsSync } = {}) {
  const p = pathFor(platform);
  if (platform === 'win32') {
    const oneDrive = oneDriveRoot(env);
    if (oneDrive) {
      for (const docs of ['Documentos', 'Documents']) {
        if (exists(p.join(oneDrive, docs))) return p.join(oneDrive, docs, BACKUP_DIR_NAME);
      }
      return p.join(oneDrive, BACKUP_DIR_NAME);
    }
    return p.join(homedir, 'Documents', BACKUP_DIR_NAME);
  }
  return p.join(homedir, BACKUP_DIR_NAME);
}

// A pasta de backups que os scripts usam: SHOWVAULT_BACKUP_DIR; sem ela, a padrão acima.
function resolveBackupDir(env = process.env, options = {}) {
  return env.SHOWVAULT_BACKUP_DIR ? path.resolve(env.SHOWVAULT_BACKUP_DIR) : defaultBackupDir({ env, ...options });
}

// Esse caminho está dentro de uma pasta sincronizada pelo OneDrive? (dados ao vivo não devem estar)
function isInsideOneDrive(target, env = process.env, platform = process.platform) {
  const p = pathFor(platform);
  const norm = value =>
    p
      .resolve(value)
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  const abs = norm(target);
  const roots = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean).map(norm);
  if (roots.some(root => abs === root || abs.startsWith(root + p.sep))) return true;
  return /[\\/]onedrive([\\/ ]|$)/.test(abs);
}

module.exports = {
  APP_DIR_NAME,
  BACKUP_DIR_NAME,
  resolveDataDir,
  defaultDataDir,
  defaultBackupDir,
  resolveBackupDir,
  oneDriveRoot,
  isInsideOneDrive
};
