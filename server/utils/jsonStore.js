// Leitura/escrita segura de arquivos JSON de dados (usuários, bibliotecas, catálogo).
//
// Escrita: grava num arquivo temporário e renomeia (atômico); antes de substituir, guarda a última versão VÁLIDA em "<arquivo>.bak".
// Leitura: se o arquivo estiver quebrado, tenta o ".bak"; se também falhar, lança DataCorruptionError.
// NUNCA devolve "vazio" para um arquivo que existe mas não pôde ser lido, e preserva uma cópia "<arquivo>.corrupt-<data>".
// (A pasta de dados pode estar no OneDrive, que às vezes trava o rename por instantes: há tentativas com espera curta.)

const fs = require('fs');
const path = require('path');
const { DataCorruptionError } = require('./errors');

let tmpCounter = 0;
const preservedCorrupt = new Set();

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function parseFile(file) {
  return JSON.parse(stripBom(fs.readFileSync(file, 'utf-8')));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function preserveCorrupt(file) {
  try {
    const key = `${file}:${fs.statSync(file).mtimeMs}`;
    if (preservedCorrupt.has(key)) return;
    preservedCorrupt.add(key);
    fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
  } catch (err) {
    console.error(`[jsonStore] Não foi possível preservar cópia do arquivo corrompido ${path.basename(file)}:`, err.message);
  }
}

// Retorna null se o arquivo não existe (e não há .bak); {data, recovered} se leu; lança DataCorruptionError se ilegível.
function readJson(file) {
  const bak = `${file}.bak`;
  let mainError = null;
  try {
    return { data: parseFile(file), recovered: false };
  } catch (err) {
    if (err.code !== 'ENOENT') mainError = err;
  }

  if (mainError) {
    console.error(`[jsonStore] ${path.basename(file)} está ilegível (${mainError.message}). Tentando a cópia .bak.`);
    preserveCorrupt(file);
  }

  try {
    const data = parseFile(bak);
    if (mainError) console.error(`[jsonStore] ${path.basename(file)} recuperado a partir do .bak.`);
    return { data, recovered: true };
  } catch (err) {
    if (mainError) throw new DataCorruptionError(file, mainError);
    if (err.code === 'ENOENT') return null; // nem o arquivo nem o .bak existem: dado novo
    throw new DataCorruptionError(file, err);
  }
}

function renameWithRetry(from, to) {
  const transient = new Set(['EPERM', 'EBUSY', 'EACCES']);
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (!transient.has(err.code) || attempt >= 5) throw err;
      sleepSync(25 * attempt);
    }
  }
}

// Grava de forma atômica. Se a gravação falhar, o arquivo anterior continua intacto.
function writeJsonAtomic(file, data, { pretty = true } = {}) {
  const json = JSON.stringify(data, null, pretty ? 2 : 0);
  if (json === undefined) throw new Error('Dados não serializáveis.');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  try {
    fs.writeFileSync(tmp, json, 'utf-8');
    // Só vira .bak uma versão atual que ainda seja JSON válido (não promove arquivo corrompido a backup).
    if (fs.existsSync(file)) {
      try {
        parseFile(file);
        fs.copyFileSync(file, `${file}.bak`);
      } catch { /* arquivo atual ilegível: mantém o .bak anterior */ }
    }
    renameWithRetry(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* já não existe */ }
    throw err;
  }
}

module.exports = { readJson, writeJsonAtomic, stripBom };
