const UserModel = require('../models/UserModel');
const config = require('../config/config');
const googleAuth = require('../services/googleAuth');
const accountService = require('../services/accountService');
const { issueToken } = require('../middleware/auth');
const { sendError } = require('../utils/httpErrors');
const {
  validateRegister,
  validateLogin,
  validateChangePassword,
  validatePasswordConfirmation,
  validateGoogleCredential,
  checkAvatar,
  sendInvalid
} = require('../utils/validators');

// Mensagens deliberadamente genéricas: não dizem se o e-mail existe (evita descobrir quem tem conta).
const MSG_BAD_CREDENTIALS = 'E-mail ou senha incorretos.';
const MSG_REGISTER_FAILED = 'Não foi possível criar a conta com esses dados. Se você já tem cadastro, use a aba "Entrar".';

const defaultAvatar = email => `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`;
const nameFromEmail = email => email.split('@')[0].slice(0, 60);

function authSuccess(res, status, message, user) {
  return res.status(status).json({ message, user: UserModel.toPublic(user), token: issueToken(user) });
}

class AuthController {
  // Público: o frontend decide se mostra o botão do Google (e com qual Client ID, que não é segredo).
  publicConfig(req, res) {
    return res.json({ googleClientId: googleAuth.isConfigured() ? config.GOOGLE_CLIENT_ID : null });
  }

  async register(req, res) {
    const input = validateRegister(req.body);
    if (!input.ok) return sendInvalid(res, input);

    try {
      const { email, password, name, avatar } = input.value;
      const user = await UserModel.create({
        name: name || nameFromEmail(email),
        email,
        password, // vira hash scrypt dentro do UserModel
        avatar: avatar || defaultAvatar(email),
        provider: 'email'
      });
      return authSuccess(res, 201, 'Conta criada com sucesso!', user);
    } catch (err) {
      if (err && err.code === 'EMAIL_TAKEN') {
        return res.status(409).json({ error: MSG_REGISTER_FAILED, code: 'REGISTER_FAILED' });
      }
      return sendError(res, err, 'Erro interno ao criar conta.', 'auth/register');
    }
  }

  async login(req, res) {
    const input = validateLogin(req.body);
    if (!input.ok) return sendInvalid(res, input);

    try {
      const { email, password } = input.value;
      const user = UserModel.findByEmail(email);

      // E-mail inexistente e contas Google (sem senha) gastam o mesmo tempo e dão a mesma resposta que senha errada.
      const valid = user && user.password
        ? await UserModel.verifyPassword(password, user.password)
        : await UserModel.verifyDummy(password);
      if (!valid) {
        return res.status(401).json({ error: MSG_BAD_CREDENTIALS, code: 'BAD_CREDENTIALS' });
      }

      if (UserModel.isLegacyPassword(user.password)) {
        try {
          await UserModel.updatePassword(user.id, password);
        } catch (err) {
          console.error('[auth/login] Não foi possível migrar a senha legada:', err.message); // o login em si segue valendo
        }
      }

      return authSuccess(res, 200, 'Login realizado com sucesso!', user);
    } catch (err) {
      return sendError(res, err, 'Erro interno ao realizar login.', 'auth/login');
    }
  }

  // Login com Google: valida o ID token no servidor. Sem GOOGLE_CLIENT_ID a rota fica desligada (D-16).
  async googleAuth(req, res) {
    if (!googleAuth.isConfigured()) {
      return res.status(501).json({ error: 'Login com Google não está configurado neste servidor.', code: 'GOOGLE_DISABLED' });
    }
    const input = validateGoogleCredential(req.body);
    if (!input.ok) return sendInvalid(res, input);

    let profile;
    try {
      profile = await googleAuth.verifyIdToken(input.value.credential);
    } catch {
      return res.status(401).json({ error: 'Não foi possível validar o login com Google. Tente novamente.', code: 'GOOGLE_INVALID' });
    }
    if (!profile.emailVerified) {
      return res.status(403).json({ error: 'O e-mail dessa conta Google não está verificado.', code: 'GOOGLE_EMAIL_UNVERIFIED' });
    }

    try {
      let user = UserModel.findByGoogleId(profile.sub) || UserModel.findByEmail(profile.email);

      // Nunca "junta" automaticamente com uma conta já existente do mesmo e-mail (cadastro por senha ou conta Google antiga
      // sem vínculo): quem cadastrou o e-mail antes pode não ser o dono dele.
      if (user && user.googleId !== profile.sub) {
        return res.status(409).json({
          error: 'Já existe uma conta ShowVault com este e-mail. Entre com e-mail e senha.',
          code: 'GOOGLE_EMAIL_IN_USE'
        });
      }

      if (!user) {
        const picture = checkAvatar(profile.picture).value || defaultAvatar(profile.email);
        user = await UserModel.create({
          name: (profile.name || nameFromEmail(profile.email)).replace(/[<>]/g, '').trim().slice(0, 60) || nameFromEmail(profile.email),
          email: profile.email,
          avatar: picture,
          provider: 'google',
          googleId: profile.sub
        });
      }
      return authSuccess(res, 200, 'Autenticado via Google com sucesso!', user);
    } catch (err) {
      if (err && err.code === 'EMAIL_TAKEN') {
        return res.status(409).json({ error: 'Já existe uma conta ShowVault com este e-mail. Entre com e-mail e senha.', code: 'GOOGLE_EMAIL_IN_USE' });
      }
      return sendError(res, err, 'Erro ao autenticar com Google.', 'auth/google');
    }
  }

  me(req, res) {
    try {
      const user = UserModel.findById(req.userId);
      if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return res.json({ user: UserModel.toPublic(user) });
    } catch (err) {
      return sendError(res, err, 'Erro ao buscar o usuário.', 'auth/me');
    }
  }

  async changePassword(req, res) {
    const input = validateChangePassword(req.body);
    if (!input.ok) return sendInvalid(res, input);

    try {
      const user = UserModel.findById(req.userId);
      if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      if (!user.password) {
        return res.status(409).json({ error: 'Contas entradas pelo Google não têm senha própria.', code: 'NO_PASSWORD' });
      }
      // 403 (e não 401): o token está certo, só a senha atual informada é que não confere.
      if (!(await UserModel.verifyPassword(input.value.currentPassword, user.password))) {
        return res.status(403).json({ error: 'Senha atual incorreta.', code: 'WRONG_PASSWORD' });
      }

      await UserModel.updatePassword(user.id, input.value.newPassword, { markChanged: true });
      // Tokens antigos (outros aparelhos) deixam de valer; este aparelho recebe um token novo.
      return res.json({ message: 'Senha alterada com sucesso.', token: issueToken(user) });
    } catch (err) {
      return sendError(res, err, 'Erro ao trocar a senha.', 'auth/change-password');
    }
  }

  // Exclui a conta e a biblioteca. Exige a senha (ou, em conta Google, uma credencial Google recém-emitida da mesma pessoa).
  async deleteAccount(req, res) {
    try {
      const user = UserModel.findById(req.userId);
      if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

      if (user.password) {
        const input = validatePasswordConfirmation(req.body);
        if (!input.ok) return sendInvalid(res, input);
        if (!(await UserModel.verifyPassword(input.value.password, user.password))) {
          return res.status(403).json({ error: 'Senha incorreta. A conta não foi excluída.', code: 'WRONG_PASSWORD' });
        }
      } else {
        const input = validateGoogleCredential(req.body);
        if (!input.ok) return sendInvalid(res, input);
        let profile = null;
        if (googleAuth.isConfigured()) {
          try { profile = await googleAuth.verifyIdToken(input.value.credential); } catch { profile = null; }
        }
        if (!profile || !user.googleId || profile.sub !== user.googleId) {
          return res.status(403).json({ error: 'Confirmação do Google inválida. A conta não foi excluída.', code: 'GOOGLE_INVALID' });
        }
      }

      accountService.deleteAccount(user.id);
      return res.json({ message: 'Conta e biblioteca excluídas.' });
    } catch (err) {
      return sendError(res, err, 'Erro ao excluir a conta.', 'auth/delete-account');
    }
  }
}

module.exports = new AuthController();
