// Exclusão de conta: apaga o usuário (users.json) e TODOS os arquivos da biblioteca dele
// (libraries/<id>.json, mais .bak, .corrupt-* e .tmp deixados pelo jsonStore).
const storage = require('../storage');
const UserModel = require('../models/UserModel');
const LibraryModel = require('../models/LibraryModel');

// Apaga o documento da biblioteca e as cópias dele (arquivos: .bak/.corrupt-*/.tmp; SQLite: a linha inteira, com a versão anterior).
function deleteLibraryFiles(libraryModel, userId) {
  const main = libraryModel.filePathFor(userId); // valida o formato do id (sem path traversal)
  return storage.removeAll(main);
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
