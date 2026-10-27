// Armazenamento em arquivos JSON (padrão). Camada fina sobre o jsonStore, com as operações extras que o adaptador precisa
// (carimbo de mudança, listagem e remoção), todas no mesmo formato do backend SQLite.

const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic } = require('../utils/jsonStore');

// Muda sempre que o arquivo muda (data de modificação + tamanho).
function stamp(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

// Nomes dos arquivos de uma pasta que casam com a expressão (pasta inexistente = lista vazia).
function listNames(dir, regex) {
  try {
    return fs.readdirSync(dir).filter(name => regex.test(name));
  } catch {
    return [];
  }
}

// Remove o arquivo e o que o jsonStore deixa ao lado (<arquivo>.bak, .corrupt-*, .tmp). Devolve quantos arquivos saíram.
function removeAll(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  let removed = 0;
  for (const name of listNames(dir, /./)) {
    if (name === base || name.startsWith(`${base}.`)) {
      fs.rmSync(path.join(dir, name), { force: true });
      removed++;
    }
  }
  return removed;
}

module.exports = { name: 'json', readJson, writeJsonAtomic, stamp, listNames, removeAll, close() {} };
