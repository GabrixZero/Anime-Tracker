const UserModel = require('../models/UserModel');
const config = require('../config/config');
const { issueToken } = require('../middleware/auth');

class AuthController {
  async register(req, res) {
    try {
      const { name, email, password, avatar } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
      }

      const existing = UserModel.findByEmail(email);
      if (existing) {
        return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
      }

      const defaultAvatar = avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`;
      const user = UserModel.create({
        name: name || email.split('@')[0],
        email: email.toLowerCase(),
        password, // Hashed com scrypt no UserModel
        avatar: defaultAvatar,
        provider: 'email'
      });

      const { password: _, ...safeUser } = user;
      return res.status(201).json({
        message: 'Conta criada com sucesso!',
        user: safeUser,
        token: issueToken(user)
      });
    } catch (err) {
      console.error('Erro no cadastro:', err);
      return res.status(500).json({ error: 'Erro interno ao criar conta.' });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
      }

      const user = UserModel.findByEmail(email);
      if (!user || !UserModel.verifyPassword(password, user.password)) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }

      if (UserModel.isLegacyPassword(user.password)) {
        UserModel.updatePassword(user.id, password);
      }

      const { password: _, ...safeUser } = user;
      return res.json({
        message: 'Login realizado com sucesso!',
        user: safeUser,
        token: issueToken(user)
      });
    } catch (err) {
      console.error('Erro no login:', err);
      return res.status(500).json({ error: 'Erro interno ao realizar login.' });
    }
  }

  async googleAuth(req, res) {
    try {
      // Login Google ainda é simulado (confia no e-mail enviado pelo cliente);
      // fica desligado em produção até a validação real do ID token (Roadmap P2).
      if (config.IS_PRODUCTION) {
        return res.status(501).json({ error: 'Login com Google indisponível.' });
      }

      const { email, name, avatar } = req.body;
      const userEmail = (email || 'demo.google@showvault.local').toLowerCase();

      let user = UserModel.findByEmail(userEmail);
      if (user && user.provider !== 'google') {
        return res.status(403).json({ error: 'Este e-mail pertence a uma conta com senha. Entre com e-mail e senha.' });
      }
      if (!user) {
        user = UserModel.create({
          name: name || 'Usuário Google',
          email: userEmail,
          avatar: avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=faces',
          provider: 'google'
        });
      }

      const { password: _, ...safeUser } = user;
      return res.json({
        message: 'Autenticado via Google com sucesso!',
        user: safeUser,
        token: issueToken(user)
      });
    } catch (err) {
      console.error('Erro no Google Auth:', err);
      return res.status(500).json({ error: 'Erro ao autenticar com Google.' });
    }
  }

  async me(req, res) {
    const user = UserModel.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const { password: _, ...safeUser } = user;
    return res.json({ user: safeUser });
  }
}

module.exports = new AuthController();
