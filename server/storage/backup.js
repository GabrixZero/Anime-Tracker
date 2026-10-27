// Backup e restauração do banco SQLite (S11, D-29: o app roda no PC do dono, o banco fica fora do OneDrive e os backups dentro dele).
//
// Regras de segurança:
//  - NUNCA se copia o arquivo aberto: o backup é `VACUUM INTO`, uma foto consistente feita pelo próprio SQLite (vale com o servidor
//    rodando e escrevendo; o modo WAL deixa leitores e escritor trabalharem juntos);
//  - a foto nasce numa pasta local (<dados>/backup-work), é conferida (`PRAGMA integrity_check` + tabela `documents`) e só então é
//    copiada para a pasta de backups como `.part` e renomeada (o OneDrive nunca vê um arquivo `.sqlite` pela metade);
//  - a rotação só roda depois de um backup novo e válido, e só apaga arquivos com o nome exato `showvault-AAAA-MM-DD_HHMMSS.sqlite`;
//  - restaurar guarda antes uma cópia do banco atual, confere o arquivo escolhido, apaga os `-wal`/`-shm` velhos (senão o SQLite os
//    aplicaria sobre o banco restaurado) e recusa se o banco estiver em uso.
const fs = require('fs');
const path = require('path');

const { DB_FILE_NAME } = require('./index');
const { openReadOnly } = require('./readOnly');

class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

const BACKUP_FILE_RE = /^showvault-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.sqlite$/;
const WORK_DIR_NAME = 'backup-work';
const STALE_MS = 60 * 60 * 1000; // sobras de uma execução interrompida com mais de 1 h podem ser apagadas

const pad = n => String(n).padStart(2, '0');

// Nomes em hora LOCAL (é a hora que o dono vê): showvault-2026-10-27_040000.sqlite
function backupFileName(date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `showvault-${day}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.sqlite`;
}

// Data (hora local) escrita no nome do backup, ou null se o nome não é de um backup nosso.
function parseBackupName(name) {
  const m = BACKUP_FILE_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  const valid = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h;
  return valid ? date : null;
}

// ---- utilidades ----

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// O OneDrive e o antivírus às vezes seguram um arquivo por instantes: tenta de novo antes de desistir.
function withRetry(fn, { tries = 5, delayMs = 250 } = {}) {
  const transient = new Set(['EPERM', 'EBUSY', 'EACCES', 'EMFILE']);
  for (let attempt = 1; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (!transient.has(err.code) || attempt >= tries) throw err;
      sleepSync(delayMs * attempt);
    }
  }
}

const sqlString = value => `'${String(value).replace(/'/g, "''")}'`;

let DatabaseSync = null;
function openDatabase(file, options = {}) {
  if (!DatabaseSync) {
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch (err) {
      throw new BackupError('NO_SQLITE', `O backup exige Node 26 ou mais novo (módulo node:sqlite indisponível em ${process.version}).`);
    }
  }
  return new DatabaseSync(file, options);
}

// Traduz as mensagens do SQLite para algo que o dono entenda.
function friendlySqliteError(err) {
  const message = String((err && err.message) || err);
  if (/not a database/i.test(message)) return 'o arquivo não é um banco SQLite';
  if (/malformed/i.test(message)) return 'o banco está corrompido (database disk image is malformed)';
  if (/locked|busy/i.test(message)) return 'o banco está em uso por outro programa; tente de novo em instantes';
  if (/unable to open/i.test(message)) return 'não foi possível abrir o arquivo';
  return message;
}

function removeQuietly(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* sobra inofensiva; a limpeza de arquivos velhos pega depois */
  }
}

// Apaga sobras de execuções interrompidas (arquivos `.work` na pasta de trabalho, `.part` na pasta de backups).
function cleanStale(dir, suffix, now = Date.now()) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names.filter(n => n.endsWith(suffix))) {
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > STALE_MS) removeQuietly(file);
    } catch {
      /* sumiu no meio do caminho */
    }
  }
}

// ---- conferência de um banco ----

// Abre o arquivo SOMENTE para leitura e diz se é um banco do ShowVault inteiro. Nunca lança: o problema vem em `error`.
function inspectDatabase(file) {
  const info = { file, size: 0, ok: false, integrity: null, documents: null, users: null, libraries: null, catalog: null, error: null };
  let db = null;
  try {
    info.size = fs.statSync(file).size;
    db = openReadOnly(file); // sem criar -wal/-shm ao lado do arquivo conferido
    db.exec('PRAGMA busy_timeout = 5000');
    const integrity = db
      .prepare('PRAGMA integrity_check')
      .all()
      .map(row => Object.values(row)[0]);
    info.integrity = integrity.join('; ');
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      info.error = `a conferência de integridade falhou: ${info.integrity}`;
      return info;
    }
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(row => row.name);
    if (!tables.includes('documents')) {
      info.error = 'não parece um banco do ShowVault (falta a tabela "documents")';
      return info;
    }
    const readDoc = key => {
      const row = db.prepare('SELECT data FROM documents WHERE key = ?').get(key);
      try {
        return row ? JSON.parse(row.data) : null;
      } catch {
        return null;
      }
    };
    info.documents = db.prepare('SELECT count(*) AS n FROM documents').get().n;
    const users = readDoc('users.json');
    info.users = Array.isArray(users) ? users.length : 0;
    info.libraries = db.prepare("SELECT count(*) AS n FROM documents WHERE key LIKE 'libraries/%'").get().n;
    const catalog = readDoc('mediaCatalog.runtime.json');
    info.catalog = Array.isArray(catalog) ? catalog.length : 0;
    info.ok = true;
  } catch (err) {
    info.error = err instanceof BackupError ? err.message : friendlySqliteError(err);
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* já fechado */
      }
    }
  }
  return info;
}

// ---- foto consistente ----

// `VACUUM INTO` numa pasta local de trabalho + conferência. Devolve { work, info }; em caso de falha apaga a sobra e lança BackupError.
function snapshotDatabase(dbFile, workDir, label) {
  fs.mkdirSync(workDir, { recursive: true });
  cleanStale(workDir, '.work');
  const work = path.join(workDir, `${label}.${process.pid}.work`);
  removeQuietly(work);
  let db = null;
  try {
    db = openDatabase(dbFile);
    db.exec('PRAGMA busy_timeout = 10000');
    db.exec(`VACUUM INTO ${sqlString(work)}`);
  } catch (err) {
    removeQuietly(work);
    if (err instanceof BackupError) throw err;
    throw new BackupError('SNAPSHOT_FAILED', `Não consegui fazer a cópia do banco ${dbFile}: ${friendlySqliteError(err)}.`);
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* já fechado */
      }
    }
  }
  const info = inspectDatabase(work);
  if (!info.ok) {
    removeQuietly(work);
    throw new BackupError('SNAPSHOT_INVALID', `A cópia feita do banco não passou na conferência (${info.error}). Nada foi guardado.`);
  }
  return { work, info };
}

// Copia o arquivo pronto para o destino sem que ele apareça pela metade: `<destino>.part` -> renomeia.
function publishFile(source, target) {
  const part = `${target}.part`;
  try {
    withRetry(() => fs.copyFileSync(source, part));
    withRetry(() => fs.renameSync(part, target));
  } catch (err) {
    removeQuietly(part);
    throw new BackupError('PUBLISH_FAILED', `Não consegui gravar o backup em ${target}: ${err.message}`);
  }
}

// ---- rotação ----

const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Semana que começa na segunda-feira; a chave é a data dessa segunda.
function weekKey(d) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(monday);
}

function listBackups(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const found = [];
  for (const name of names) {
    const date = parseBackupName(name);
    if (!date) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) found.push({ name, file, date, size: stat.size });
    } catch {
      /* sumiu no meio do caminho */
    }
  }
  return found.sort((a, b) => b.date - a.date || (a.name < b.name ? 1 : -1));
}

// Quais backups ficam: o mais novo de cada um dos `daily` dias mais recentes COM backup, e o mais novo de cada uma das `weekly`
// semanas mais recentes COM backup. (Contar "dias com backup" em vez de dias do calendário evita apagar tudo se o PC ficou desligado.)
function planRotation(entries, { daily = 7, weekly = 4, protect = [] } = {}) {
  const sorted = [...entries].sort((a, b) => b.date - a.date);
  const keep = new Set(protect);
  const days = new Set();
  const weeks = new Set();
  for (const entry of sorted) {
    const dk = dayKey(entry.date);
    const wk = weekKey(entry.date);
    if (!days.has(dk) && days.size < daily) {
      days.add(dk);
      keep.add(entry.name);
    }
    if (!weeks.has(wk) && weeks.size < weekly) {
      weeks.add(wk);
      keep.add(entry.name);
    }
  }
  return { keep, remove: sorted.filter(entry => !keep.has(entry.name)) };
}

function rotateBackups(dir, { daily = 7, weekly = 4, protect = [] } = {}) {
  const entries = listBackups(dir);
  const plan = planRotation(entries, { daily, weekly, protect });
  const removed = [];
  const failed = [];
  for (const entry of plan.remove) {
    try {
      withRetry(() => fs.unlinkSync(entry.file));
      removed.push(entry.name);
    } catch (err) {
      failed.push({ name: entry.name, error: err.message });
    }
  }
  return { kept: entries.length - removed.length - failed.length, removed, failed };
}

// ---- backup ----

function createBackup({ dataDir, backupDir, now = new Date(), keepDaily = 7, keepWeekly = 4, rotate = true } = {}) {
  const dbFile = path.join(path.resolve(dataDir), DB_FILE_NAME);
  if (!fs.existsSync(dbFile)) {
    throw new BackupError(
      'NO_DATABASE',
      `Banco não encontrado em ${dbFile}. O ShowVault já rodou com STORAGE=sqlite nesta pasta de dados?`
    );
  }
  const target = path.resolve(backupDir);
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    throw new BackupError('BACKUP_DIR', `Não consegui abrir a pasta de backups ${target}: ${err.message}`);
  }
  cleanStale(target, '.part');

  const name = backupFileName(now);
  const { work, info } = snapshotDatabase(dbFile, path.join(path.resolve(dataDir), WORK_DIR_NAME), name);
  const file = path.join(target, name);
  try {
    publishFile(work, file);
  } finally {
    removeQuietly(work);
  }
  const rotation = rotate ? rotateBackups(target, { daily: keepDaily, weekly: keepWeekly, protect: [name] }) : null;
  return {
    file,
    name,
    size: fs.statSync(file).size,
    documents: info.documents,
    users: info.users,
    libraries: info.libraries,
    catalog: info.catalog,
    rotation
  };
}

// ---- restauração ----

const stampOf = date => backupFileName(date).slice('showvault-'.length, -'.sqlite'.length);

// Guarda o banco atual antes de ser substituído. Se ele estiver ilegível (talvez seja o motivo da restauração), guarda os arquivos como estão.
function saveSafetyCopy({ dbFile, safetyDir, workDir, now }) {
  fs.mkdirSync(safetyDir, { recursive: true });
  const label = `showvault-ANTES-DA-RESTAURACAO-${stampOf(now)}`;
  try {
    const { work } = snapshotDatabase(dbFile, workDir, label);
    const file = path.join(safetyDir, `${label}.sqlite`);
    try {
      publishFile(work, file);
    } finally {
      removeQuietly(work);
    }
    return { file, method: 'copia-consistente' };
  } catch (err) {
    const folder = path.join(safetyDir, `${label}-arquivos-originais`);
    fs.mkdirSync(folder, { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbFile + suffix)) fs.copyFileSync(dbFile + suffix, path.join(folder, path.basename(dbFile) + suffix));
    }
    return { file: folder, method: 'arquivos-originais', reason: err.message };
  }
}

// Troca o banco pelo backup. Quem chama (o comando `npm run restore`) já confirmou com a pessoa e já conferiu que o servidor está parado.
function restoreBackup({ dataDir, backupFile, safetyDir, now = new Date() } = {}) {
  const dataPath = path.resolve(dataDir);
  const dbFile = path.join(dataPath, DB_FILE_NAME);
  const source = inspectDatabase(path.resolve(backupFile));
  if (!source.ok) throw new BackupError('INVALID_BACKUP', `O arquivo ${backupFile} não é um backup válido do ShowVault: ${source.error}.`);

  fs.mkdirSync(dataPath, { recursive: true });
  const safety = fs.existsSync(dbFile)
    ? saveSafetyCopy({
        dbFile,
        safetyDir: path.resolve(safetyDir || path.join(dataPath, 'antes-da-restauracao')),
        workDir: path.join(dataPath, WORK_DIR_NAME),
        now
      })
    : null;

  const staging = `${dbFile}.restaurando`;
  let touched = false; // true depois de apagar algo do banco antigo: a partir daí a cópia de segurança passa a ser necessária
  try {
    fs.copyFileSync(path.resolve(backupFile), staging);
    const copy = inspectDatabase(staging);
    if (!copy.ok)
      throw new BackupError('INVALID_BACKUP', `A cópia preparada não passou na conferência (${copy.error}). O banco atual não foi tocado.`);
    // Os arquivos -wal/-shm do banco antigo NÃO podem sobrar: o SQLite os aplicaria sobre o banco restaurado.
    // Com o servidor aberto o Windows recusa apagar/trocar o arquivo: é a segunda trava (a primeira é a conferência de /health).
    for (const suffix of ['-wal', '-shm']) {
      if (!fs.existsSync(dbFile + suffix)) continue;
      fs.rmSync(dbFile + suffix);
      touched = true;
    }
    withRetry(() => fs.renameSync(staging, dbFile), { tries: 3, delayMs: 200 });
  } catch (err) {
    removeQuietly(staging);
    if (safety && !touched) fs.rmSync(safety.file, { recursive: true, force: true }); // nada mudou: a cópia de segurança não faz falta
    if (err instanceof BackupError) throw err;
    if (['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
      throw new BackupError(
        'DATABASE_IN_USE',
        `O banco está em uso (o ShowVault ainda está rodando?). Pare o ShowVault e tente de novo. ${touched && safety ? `Cópia do banco atual em ${safety.file}.` : 'Nada foi trocado.'}`
      );
    }
    throw err;
  }
  return { safety, source, restored: inspectDatabase(dbFile) };
}

// Resolve o que a pessoa digitou: caminho de arquivo, nome dentro da pasta de backups, ou "ultimo".
function resolveBackupArgument(arg, backupDir) {
  const wanted = String(arg || '').trim();
  if (!wanted) return null;
  if (/^(ultimo|último|latest)$/i.test(wanted)) {
    const newest = listBackups(backupDir)[0];
    return newest ? newest.file : null;
  }
  for (const candidate of [path.resolve(wanted), path.join(backupDir, wanted)]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

module.exports = {
  BackupError,
  BACKUP_FILE_RE,
  backupFileName,
  parseBackupName,
  inspectDatabase,
  listBackups,
  planRotation,
  rotateBackups,
  createBackup,
  restoreBackup,
  resolveBackupArgument
};
