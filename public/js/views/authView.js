// ================================================================
// SHOWVAULT · VIEW DE AUTENTICAÇÃO ESTILO TV SHOW TIME (MVC)
// ================================================================

class AuthView {
  constructor() {
    this.modal = document.getElementById('tvtime-auth-modal');
    this.mode = 'login'; // 'login' ou 'register'
    this.busy = false;
    this.googleReady = false;
    this.inviteRequired = false; // o servidor exige código de convite no cadastro? (vem de /api/auth/config)
    this.bindEvents();
    this.checkSession();
    this.initGoogle();
  }

  bindEvents() {
    // Abertura / Fechamento
    document.getElementById('btn-open-auth').addEventListener('click', () => this.open());
    document.getElementById('btn-close-tvtime-auth').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', e => {
      if (e.target === this.modal) this.close();
    });

    // Alternador de Tabs
    document.getElementById('tvtime-tab-login').addEventListener('click', () => this.switchMode('login'));
    document.getElementById('tvtime-tab-register').addEventListener('click', () => this.switchMode('register'));

    // Submit de Formulário E-mail / Senha
    document.getElementById('tvtime-auth-form').addEventListener('submit', e => {
      e.preventDefault();
      this.handleSubmit();
    });

    // Some a mensagem de erro assim que a pessoa volta a digitar
    ['input-tvtime-name', 'input-tvtime-email', 'input-tvtime-password', 'input-tvtime-invite'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => this.showError(''));
    });
    document.getElementById('input-tvtime-email').addEventListener('input', () => this.showFieldError('email', ''));
    // Cadastro: mostra o que falta na senha enquanto digita (a regra é a mesma do servidor: passwordRules.js)
    document.getElementById('input-tvtime-password').addEventListener('input', e => {
      const value = e.target.value;
      const live = this.mode === 'register' && value !== '' ? window.checkPasswordRules(value).error : '';
      this.showFieldError('password', live || '');
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => this.handleLogout());

    // Token rejeitado pelo servidor (expirado/inválido)
    // Os dados locais continuam (são desta conta); o selo mostra "Sessão expirada" até um novo login.
    window.addEventListener('showvault:auth-expired', () => {
      window.syncService.stop();
      this.updateHeader(null);
      window.syncService.setStatus('auth');
      if (window.appController) window.appController.showToast('Sua sessão expirou. Entre de novo para voltar a sincronizar.', 'error');
    });
  }

  async checkSession() {
    const token = localStorage.getItem('showvault_auth_token');
    if (!token) {
      this.updateHeader(null);
      return;
    }

    try {
      const res = await window.apiClient.getMe();
      if (res && res.user) {
        this.updateHeader(res.user);
        window.syncService.pullAndMerge(res.user, { resumed: true });
      }
    } catch (err) {
      if (err && err.status === 401) {
        // O servidor recusou o token (expirado, conta excluída, senha trocada): aí sim a sessão acabou.
        localStorage.removeItem('showvault_auth_token');
        if (window.Landing) window.Landing.markVisitor();
        this.updateHeader(null);
        return;
      }
      // Sem rede, servidor fora do ar ou erro 5xx: o token pode estar perfeitamente válido. NÃO apaga; mostra o problema
      // no selo de sincronização e tenta de novo quando a conexão voltar (ou depois de um tempo).
      this.updateHeader(null);
      window.syncService.setStatus(err && !err.status ? 'offline' : 'error');
      this.scheduleSessionRetry();
    }
  }

  // Uma nova tentativa de retomar a sessão: ao voltar a conexão ou após 30 s (no máximo 5 vezes seguidas).
  scheduleSessionRetry() {
    if (this.sessionRetryTimer || (this.sessionRetries || 0) >= 5) return;
    const retry = () => {
      window.removeEventListener('online', retry);
      clearTimeout(this.sessionRetryTimer);
      this.sessionRetryTimer = null;
      this.sessionRetries = (this.sessionRetries || 0) + 1;
      this.checkSession();
    };
    window.addEventListener('online', retry);
    this.sessionRetryTimer = setTimeout(retry, 30000);
  }

  open() {
    this.modal.classList.remove('hidden');
    this.switchMode('login');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  // Mensagem de erro dentro do formulário ('' esconde).
  showError(message) {
    const box = document.getElementById('tvtime-auth-error');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  // Mensagem junto de um campo ('email' ou 'password'; '' limpa) com aria-invalid no input.
  showFieldError(field, message) {
    const box = document.getElementById(`tvtime-${field}-error`);
    const input = document.getElementById(`input-tvtime-${field}`);
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  setBusy(busy) {
    this.busy = busy;
    const btn = document.getElementById('btn-tvtime-auth-submit');
    btn.disabled = busy;
    btn.style.opacity = busy ? '0.7' : '';
  }

  switchMode(mode) {
    this.mode = mode;
    this.showError('');
    this.showFieldError('email', '');
    this.showFieldError('password', '');
    const title = document.getElementById('tvtime-auth-title');
    const submitBtn = document.getElementById('btn-tvtime-auth-submit');
    const nameField = document.getElementById('tvtime-name-field');
    const tabLogin = document.getElementById('tvtime-tab-login');
    const tabRegister = document.getElementById('tvtime-tab-register');
    const passwordInput = document.getElementById('input-tvtime-password');
    const passwordHint = document.getElementById('tvtime-password-hint');
    const forgotNote = document.getElementById('tvtime-forgot-note');
    forgotNote.classList.add('hidden');
    document.getElementById('btn-forgot-password').classList.toggle('hidden', mode === 'register');
    document.getElementById('tvtime-invite-field').classList.toggle('hidden', !(mode === 'register' && this.inviteRequired));

    if (mode === 'register') {
      title.innerHTML = 'Crie sua conta no <span>ShowVault</span>';
      submitBtn.textContent = 'Cadastrar no Cofre';
      nameField.classList.remove('hidden');
      passwordHint.classList.remove('hidden');
      passwordInput.setAttribute('autocomplete', 'new-password');
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
    } else {
      title.innerHTML = 'Bem-vindo ao <span>ShowVault</span>';
      submitBtn.textContent = 'Entrar na Conta';
      nameField.classList.add('hidden');
      passwordHint.classList.add('hidden');
      passwordInput.setAttribute('autocomplete', 'current-password');
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
    }
  }

  // ---------------- Login com Google (só se o servidor tiver GOOGLE_CLIENT_ID) ----------------

  async initGoogle() {
    try {
      const cfg = await window.apiClient.request('/auth/config');
      this.inviteRequired = !!(cfg && cfg.inviteRequired === true);
      document.getElementById('tvtime-invite-field').classList.toggle('hidden', !(this.mode === 'register' && this.inviteRequired));
      if (cfg && typeof cfg.googleClientId === 'string' && cfg.googleClientId) {
        this.loadGoogleScript(cfg.googleClientId);
      }
    } catch {
      // Sem configuração = sem botão do Google (o login por e-mail continua funcionando).
    }
  }

  loadGoogleScript(clientId) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => this.renderGoogleButton(clientId);
    script.onerror = () => {
      /* bloqueado/sem internet: o botão simplesmente não aparece */
    };
    document.head.appendChild(script);
  }

  renderGoogleButton(clientId) {
    const gsi = window.google && window.google.accounts && window.google.accounts.id;
    if (!gsi) return;
    gsi.initialize({
      client_id: clientId,
      callback: response => this.handleGoogleCredential(response && response.credential)
    });
    gsi.renderButton(document.getElementById('google-signin-button'), {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      locale: 'pt-BR',
      width: 280
    });
    this.googleReady = true;
    document.getElementById('google-signin-section').classList.remove('hidden');
  }

  // O navegador só entrega ao servidor a credencial assinada pelo Google; quem valida é o servidor.
  async handleGoogleCredential(credential) {
    if (!credential) return;
    try {
      const res = await window.apiClient.googleAuth({ credential });
      this.finishLogin(res, `Bem-vindo, ${res.user.name}! Conectado via Google.`);
    } catch (err) {
      this.showError(this.friendlyError(err));
    }
  }

  // ---------------- E-mail e senha ----------------

  // Validação no navegador (mesmas regras do servidor, só para responder rápido; o servidor sempre revalida).
  // Devolve { email, password, general } com a mensagem de cada campo ('' = ok).
  validateForm({ name, email, password, inviteCode = '' }) {
    const out = { email: '', password: '', general: '' };
    if (!email) out.email = 'Informe o e-mail.';
    else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      out.email = 'E-mail inválido. Use o formato nome@exemplo.com.';
    if (!password) out.password = 'Informe a senha.';
    else if (this.mode === 'register') out.password = window.checkPasswordRules(password).error || '';
    else if (password.length > 128) out.password = 'A senha pode ter no máximo 128 caracteres.';
    if (this.mode === 'register') {
      if ([...name].length > 60) out.general = 'O nome pode ter no máximo 60 caracteres.';
      else if (/[<>]/.test(name)) out.general = 'O nome não pode conter os caracteres < ou >.';
      else if (this.inviteRequired && !inviteCode) out.general = 'Informe o código de convite.';
    }
    return out;
  }

  friendlyError(err) {
    const message = err && err.message;
    if (!message || /failed to fetch|networkerror|load failed/i.test(message)) {
      return 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.';
    }
    return message;
  }

  finishLogin(res, message) {
    localStorage.setItem('showvault_auth_token', res.token);
    if (window.Landing) window.Landing.showApp(); // login feito pela landing: mostra o app
    this.updateHeader(res.user);
    this.showError('');
    this.close();
    window.syncService.pullAndMerge(res.user);
    window.appController.showToast(message, 'success');
  }

  async handleSubmit() {
    if (this.busy) return;
    const email = document.getElementById('input-tvtime-email').value.trim();
    const password = document.getElementById('input-tvtime-password').value;
    const name = document.getElementById('input-tvtime-name').value.trim();

    const inviteCode = document.getElementById('input-tvtime-invite').value.trim();

    const problem = this.validateForm({ name, email, password, inviteCode });
    this.showFieldError('email', problem.email);
    this.showFieldError('password', problem.password);
    this.showError(problem.general);
    if (problem.email || problem.password || problem.general) {
      // foco no primeiro campo com erro, sem enviar nada ao servidor
      const first = problem.email ? 'input-tvtime-email' : problem.password ? 'input-tvtime-password' : null;
      if (first) document.getElementById(first).focus();
      return;
    }

    this.setBusy(true);
    try {
      const res =
        this.mode === 'register'
          ? await window.apiClient.register(name, email, password, this.inviteRequired ? inviteCode : '')
          : await window.apiClient.login(email, password);
      this.finishLogin(res, res.message);
    } catch (err) {
      this.showError(this.friendlyError(err));
    } finally {
      this.setBusy(false);
    }
  }

  // Sair = enviar o que falta, tirar os dados desta conta do navegador (a próxima pessoa não os vê) e encerrar a sessão.
  // Se o envio falhar (sem rede), uma cópia fica guardada e volta quando a mesma conta entrar de novo.
  async handleLogout() {
    if (
      !confirm(
        'Deseja sair da sua conta? Seus dados ficam guardados na sua conta e voltam quando você entrar de novo; este navegador será limpo.'
      )
    )
      return;

    const { synced } = await window.syncService.logout();
    this.finishLocalLogout();
    window.appController.showToast(
      synced ? 'Sessão encerrada.' : 'Sessão encerrada. Algumas alterações não foram enviadas; elas voltam quando você entrar de novo.',
      synced ? 'info' : 'error'
    );
  }

  // Parte local de sair (os dados já foram limpos pelo syncService/AppState): tira o token, volta o cabeçalho a "visitante" e redesenha.
  finishLocalLogout() {
    localStorage.removeItem('showvault_auth_token');
    if (window.Landing) window.Landing.markVisitor(); // depois de sair, continua no app como visitante (D-LP-1)
    this.updateHeader(null);
    document.getElementById('modal-show-detail').classList.add('hidden');
    window.appController.refreshAll();
  }

  updateHeader(user) {
    const btnOpen = document.getElementById('btn-open-auth');
    const profile = document.getElementById('user-logged-profile');

    if (user) {
      btnOpen.classList.add('hidden');
      profile.classList.remove('hidden');
      document.getElementById('user-display-name').textContent = user.name;
      const avatar = document.getElementById('user-avatar-img');
      avatar.src = window.safeUrl ? window.safeUrl(user.avatar) : user.avatar;
      avatar.alt = `Avatar de ${user.name}`;
      if (window.accountView) window.accountView.syncPhoto(user); // troca pelo upload do usuário, se houver
      window.syncService.setBaseLabel(user.provider === 'google' ? 'Google Nuvem' : 'Nuvem Ativa');
    } else {
      if (window.accountView) window.accountView.clearPhoto();
      btnOpen.classList.remove('hidden');
      profile.classList.add('hidden');
      window.syncService.setBaseLabel('Só neste aparelho');
    }
  }
}

window.authView = new AuthView();
