// ================================================================
// SHOWVAULT · VIEW DE AUTENTICAÇÃO ESTILO TV SHOW TIME (MVC)
// ================================================================

class AuthView {
  constructor() {
    this.modal = document.getElementById('tvtime-auth-modal');
    this.mode = 'login'; // 'login' ou 'register'
    this.bindEvents();
    this.checkSession();
  }

  bindEvents() {
    // Abertura / Fechamento
    document.getElementById('btn-open-auth').addEventListener('click', () => this.open());
    document.getElementById('btn-close-tvtime-auth').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    // Alternador de Tabs
    document.getElementById('tvtime-tab-login').addEventListener('click', () => this.switchMode('login'));
    document.getElementById('tvtime-tab-register').addEventListener('click', () => this.switchMode('register'));

    // Google Sign-In
    document.getElementById('btn-google-sign-in').addEventListener('click', () => this.handleGoogle());

    // Submit de Formulário E-mail / Senha
    document.getElementById('tvtime-auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => this.handleLogout());
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
      }
    } catch {
      localStorage.removeItem('showvault_auth_token');
      this.updateHeader(null);
    }
  }

  open() {
    this.modal.classList.remove('hidden');
    this.switchMode('login');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  switchMode(mode) {
    this.mode = mode;
    const title = document.getElementById('tvtime-auth-title');
    const submitBtn = document.getElementById('btn-tvtime-auth-submit');
    const nameField = document.getElementById('tvtime-name-field');
    const tabLogin = document.getElementById('tvtime-tab-login');
    const tabRegister = document.getElementById('tvtime-tab-register');
    const footerLink = document.getElementById('tvtime-switch-link');

    if (mode === 'register') {
      title.innerHTML = 'Crie sua conta no <span>ShowVault</span>';
      submitBtn.textContent = 'Cadastrar no Cofre';
      nameField.classList.remove('hidden');
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      footerLink.innerHTML = `Já tem conta? <a href="#" onclick="event.preventDefault(); window.authView.switchMode('login')">Entrar agora</a>`;
    } else {
      title.innerHTML = 'Bem-vindo ao <span>ShowVault</span>';
      submitBtn.textContent = 'Entrar na Conta';
      nameField.classList.add('hidden');
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      footerLink.innerHTML = `Não tem conta? <a href="#" onclick="event.preventDefault(); window.authView.switchMode('register')">Cadastre-se grátis</a>`;
    }
  }

  async handleGoogle() {
    try {
      const profile = {
        name: "Gabriel (Google)",
        email: "gabriel.tvtime@gmail.com",
        avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=faces"
      };

      const res = await window.apiClient.googleAuth(profile);
      localStorage.setItem('showvault_auth_token', res.token);
      this.updateHeader(res.user);
      this.close();
      window.appController.showToast(`Bem-vindo, ${res.user.name}! Conectado via Google.`, 'success');
    } catch (err) {
      window.appController.showToast(err.message, 'error');
    }
  }

  async handleSubmit() {
    const email = document.getElementById('input-tvtime-email').value.trim();
    const password = document.getElementById('input-tvtime-password').value;
    const name = document.getElementById('input-tvtime-name').value.trim();

    try {
      let res;
      if (this.mode === 'register') {
        res = await window.apiClient.register(name, email, password);
      } else {
        res = await window.apiClient.login(email, password);
      }

      localStorage.setItem('showvault_auth_token', res.token);
      this.updateHeader(res.user);
      this.close();
      window.appController.showToast(res.message, 'success');
    } catch (err) {
      window.appController.showToast(err.message, 'error');
    }
  }

  handleLogout() {
    if (confirm('Deseja sair da sua conta? Seus dados continuam gravados com segurança local no seu navegador.')) {
      localStorage.removeItem('showvault_auth_token');
      this.updateHeader(null);
      window.appController.showToast('Sessão encerrada.', 'info');
    }
  }

  updateHeader(user) {
    const btnOpen = document.getElementById('btn-open-auth');
    const profile = document.getElementById('user-logged-profile');
    const syncLabel = document.getElementById('sync-label');

    if (user) {
      btnOpen.classList.add('hidden');
      profile.classList.remove('hidden');
      document.getElementById('user-display-name').textContent = user.name;
      document.getElementById('user-avatar-img').src = user.avatar;
      syncLabel.textContent = user.provider === 'google' ? 'Google Nuvem' : 'Nuvem Ativa';
    } else {
      btnOpen.classList.remove('hidden');
      profile.classList.add('hidden');
      syncLabel.textContent = 'Local-First';
    }
  }
}

window.authView = new AuthView();
