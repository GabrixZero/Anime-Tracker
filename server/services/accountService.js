// Exclusão de conta: apaga o usuário (users.json) e TODOS os arquivos da biblioteca dele
// (libraries/<id>.json, mais .bak, .corrupt-* e .tmp deixados pelo jsonStore).
const fs = require('fs');
const path = require('path');
const UserModel = require('../models/UserModel');
const LibraryModel = require('../models/LibraryModel');

function deleteLibraryFiles(libraryModel, userId) {
  const main = libraryModel.filePathFor(userId); // valida o formato do id (sem path traversal)
  const dir = path.dirname(main);
  const base = path.basename(main);
  let removed = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed; // pasta ainda não existe
  }
  for (const name of names) {
    if (name === base || name.startsWith(`${base}.`)) {
      fs.rmSync(path.join(dir, name), { force: true });
      removed++;
    }
  }
  return removed;
}

// Ordem: primeiro a conta, depois a biblioteca. Se a segunda etapa falhar, a conta já saiu e sobra só um arquivo órfão
// (registrado no log), nunca o contrário (conta viva sem os dados).
function deleteAccount(userId, { userModel = UserModel, libraryModel = LibraryModel } = {}) {
  const existed = userModel.delete(userId);
  let libraryFilesRemoved = 0;
  try {
    libraryFilesRemoved = deleteLibraryFiles(libraryModel, userId);
  } catch (err) {
    console.error(`[accountService] Conta ${userId} removida, mas a biblioteca não pôde ser apagada: ${err.message}`);
  }
  return { existed, libraryFilesRemoved };
}

module.exports = { deleteAccount, deleteLibraryFiles };
