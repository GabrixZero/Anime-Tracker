const LibraryModel = require('../models/LibraryModel');

class UserController {
  getLibrary(req, res) {
    try {
      const { updatedAt, ...data } = LibraryModel.get(req.userId);
      return res.json({ data, updatedAt });
    } catch (err) {
      console.error('Erro ao ler biblioteca:', err);
      return res.status(500).json({ error: 'Erro interno ao ler a biblioteca.' });
    }
  }

  putLibrary(req, res) {
    let library;
    try {
      library = LibraryModel.save(req.userId, req.body && req.body.data);
    } catch (err) {
      if (/inválid|limite|obrigat/i.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('Erro ao gravar biblioteca:', err);
      return res.status(500).json({ error: 'Erro interno ao gravar a biblioteca.' });
    }
    return res.json({ updatedAt: library.updatedAt });
  }
}

module.exports = new UserController();
