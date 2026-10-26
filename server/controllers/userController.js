const LibraryModel = require('../models/LibraryModel');
const { sendError } = require('../utils/httpErrors');

class UserController {
  getLibrary(req, res) {
    try {
      const { updatedAt, schemaVersion, ...data } = LibraryModel.get(req.userId);
      return res.json({ data, updatedAt });
    } catch (err) {
      return sendError(res, err, 'Erro interno ao ler a biblioteca.', 'user/library:get');
    }
  }

  putLibrary(req, res) {
    let library;
    try {
      const body = req.body || {};
      const stateVersion = Number.isInteger(body.stateVersion) ? body.stateVersion : undefined;
      library = LibraryModel.save(req.userId, body.data, { stateVersion });
    } catch (err) {
      if (err instanceof Error && /inválid|limite|obrigat/i.test(err.message) && !err.code) {
        return res.status(400).json({ error: err.message });
      }
      return sendError(res, err, 'Erro interno ao gravar a biblioteca.', 'user/library:put');
    }
    return res.json({ updatedAt: library.updatedAt });
  }
}

module.exports = new UserController();
