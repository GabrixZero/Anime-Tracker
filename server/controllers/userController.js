const LibraryModel = require('../models/LibraryModel');
const UserModel = require('../models/UserModel');
const avatarService = require('../services/avatarService');
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
    // `data` = biblioteca já mesclada com a do servidor (clientes da S03 aplicam; clientes antigos ignoram o campo)
    const { schemaVersion, updatedAt, ...data } = library;
    return res.json({ updatedAt, data });
  }

  // "Resetar + apagar a nuvem": zera a biblioteca da conta (os outros aparelhos zeram ao sincronizar).
  deleteLibrary(req, res) {
    try {
      const library = LibraryModel.clear(req.userId);
      return res.json({ resetAt: library.resetAt, updatedAt: library.updatedAt });
    } catch (err) {
      return sendError(res, err, 'Erro interno ao apagar a biblioteca.', 'user/library:delete');
    }
  }

  // --- foto de perfil (só o dono, autenticado) ---

  getAvatar(req, res) {
    try {
      const user = UserModel.findById(req.userId);
      const photo = user && user.photoExt ? avatarService.read(user.id, user.photoExt) : null;
      if (!photo) return res.status(404).json({ error: 'Você ainda não tem foto de perfil.' });
      res.set({ 'Content-Type': photo.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.send(photo.buffer);
    } catch (err) {
      return sendError(res, err, 'Erro ao ler a foto de perfil.', 'user/avatar:get');
    }
  }

  putAvatar(req, res) {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(415).json({ error: 'Envie a foto como PNG, JPEG ou WEBP.', code: 'AVATAR_TYPE' });
    }
    if (body.length > avatarService.MAX_BYTES) {
      return res.status(413).json({ error: 'A foto é grande demais (máximo de 200 KB).', code: 'AVATAR_TOO_LARGE' });
    }
    try {
      const ext = avatarService.save(req.userId, body);
      if (!ext) return res.status(415).json({ error: 'O arquivo não é uma imagem PNG, JPEG ou WEBP válida.', code: 'AVATAR_TYPE' });
      if (!UserModel.setPhoto(req.userId, ext)) {
        avatarService.remove(req.userId);
        return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      }
      return res.json({ user: UserModel.toPublic(UserModel.findById(req.userId)) });
    } catch (err) {
      return sendError(res, err, 'Erro ao gravar a foto de perfil.', 'user/avatar:put');
    }
  }

  deleteAvatar(req, res) {
    try {
      avatarService.remove(req.userId);
      UserModel.setPhoto(req.userId, null);
      return res.json({ user: UserModel.toPublic(UserModel.findById(req.userId)) });
    } catch (err) {
      return sendError(res, err, 'Erro ao remover a foto de perfil.', 'user/avatar:delete');
    }
  }
}

module.exports = new UserController();
