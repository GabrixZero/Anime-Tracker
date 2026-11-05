// ================================================================
// SHOWVAULT · VIEW "MINHA CONTA" (S14): perfil, trocar senha, sair de todos os aparelhos e excluir conta
// Todo texto vindo do servidor entra por textContent (nunca innerHTML). Os botões de abrir/sair usam data-action (actionHandlers.js).
// ================================================================

class AccountView {
  constructor() {
    this.modal = document.getElementById('modal-account');
    this.busy = false;
    this.user = null;
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('btn-close-account').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
    document.getElementById('account-password-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleChangePassword();
    });
    document.getElementById('account-delete-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleDelete();
    });
    // Some o aviso assim que a pessoa volta a digitar
    [
      ['account-current-password', 'account-password-msg'],
      ['account-new-password', 'account-password-msg'],
      ['account-confirm-password', 'account-password-msg'],
      ['account-delete-password', 'account-delete-msg']
    ].forEach(([inputId, msgId]) => {
      document.getElementById(inputId).addEventListener('input', () => this.showMessage(msgId, ''));
    });
  }

  showMessage(id, message) {
    const box = document.getElementById(id);
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  friendlyError(err) {
    return window.authView ? window.authView.friendlyError(err) : (err && err.message) || 'Algo deu errado.';
  }

  async open() {
    this.modal.classList.remove('hidden');
    ['account-password-msg', 'account-sessions-msg', 'account-delete-msg'].forEach(id => this.showMessage(id, ''));
    ['account-current-password', 'account-new-password', 'account-confirm-password', 'account-delete-password'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    try {
      const res = await window.apiClient.getMe();
      if (res && res.user) this.render(res.user);
    } catch (err) {
      // 401 já derruba a sessão em apiClient; aqui só avisa e mostra o que o aviso permitir.
      this.showMessage('account-sessions-msg', this.friendlyError(err));
    }
  }

  close() {
    this.modal.classList.add('hidden');
  }

  render(user) {
    this.user = user;
    const isGoogle = user.provider === 'google';
    document.getElementById('account-name').textContent = user.name || '';
    document.getElementById('account-email').textContent = user.email || '';
    document.getElementById('account-provider').textContent = isGoogle ? 'Google' : 'E-mail e senha';
    const created = user.createdAt ? new Date(user.createdAt) : null;
    document.getElementById('account-created').textContent = created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString('pt-BR')
      : '—';
    const avatar = document.getElementById('account-avatar');
    avatar.src = window.safeUrl ? window.safeUrl(user.avatar) : '';
    avatar.alt = `Avatar de ${user.name || 'usuário'}`;

    // Conta Google não tem senha própria: sem troca de senha; a exclusão pede confirmação do Google.
    document.getElementById('account-password-section').classList.toggle('hidden', isGoogle);
    document.getElementById('account-delete-password-field').classList.toggle('hidden', isGoogle);
    document.getElementById('account-delete-google-note').classList.toggle('hidden', !isGoogle);
    document.getElementById('btn-account-delete').disabled = isGoogle;
  }

  setBusy(buttonIds, busy) {
    this.busy = busy;
    buttonIds.forEach((id) => { document.getElementById(id).disabled = busy; });
  }

  async handleChangePassword() {
    if (this.busy) return;
    const current = document.getElementById('account-current-password').value;
    const next = document.getElementById('account-new-password').value;
    const again = document.getElementById('account-confirm-password').value;

    let problem = '';
    if (!current) problem = 'Informe a senha atual.';
    else if (next.length < 8) problem = 'A nova senha precisa ter pelo menos 8 caracteres.';
    else if (next.length > 128) problem = 'A nova senha pode ter no máximo 128 caracteres.';
    else if (next !== again) problem = 'A confirmação não é igual à nova senha.';
    else if (next === current) problem = 'A nova senha precisa ser diferente da atual.';
    if (problem) {
      this.showMessage('account-password-msg', problem);
      return;
    }

    this.showMessage('account-password-msg', '');
    this.setBusy(['btn-account-password'], true);
    try {
      const res = await window.apiClient.changePassword(current, next);
      // Os outros aparelhos caem; este recebe um token novo.
      if (res && res.token) localStorage.setItem('showvault_auth_token', res.token);
      ['account-current-password', 'account-new-password', 'account-confirm-password'].forEach((id) => {
        document.getElementById(id).value = '';
      });
      window.appController.showToast('Senha alterada com sucesso. Os outros aparelhos precisarão entrar de novo.', 'success');
    } catch (err) {
      this.showMessage('account-password-msg', this.friendlyError(err));
    } finally {
      this.setBusy(['btn-account-password'], false);
    }
  }

  // Encerra a sessão aqui e em todos os outros aparelhos.
  async handleLogoutAll() {
    if (this.busy) return;
    if (!confirm('Sair de todos os aparelhos? Você precisará entrar de novo em cada um, inclusive neste.')) return;

    this.showMessage('account-sessions-msg', '');
    this.setBusy(['btn-logout-all'], true);
    try {
      const sync = window.syncService;
      const state = window.appState;
      const ownerId = state.getOwner() || sync.userId;
      const synced = await sync.flush(); // envia o que falta ANTES de o token deixar de valer
      await window.apiClient.logoutAll();
      if (!synced) state.archiveFor(ownerId); // sem rede para enviar: guarda uma cópia que volta no próximo login desta conta
      sync.stop();
      state.clearForLogout();
      this.close();
      window.authView.finishLocalLogout();
      window.appController.showToast(
        synced
          ? 'Você saiu de todos os aparelhos.'
          : 'Você saiu de todos os aparelhos. Algumas alterações não foram enviadas; elas voltam quando você entrar de novo.',
        synced ? 'info' : 'error'
      );
    } catch (err) {
      this.showMessage('account-sessions-msg', this.friendlyError(err));
    } finally {
      this.setBusy(['btn-logout-all'], false);
    }
  }

  async handleDelete() {
    if (this.busy || !this.user || this.user.provider === 'google') return;
    const password = document.getElementById('account-delete-password').value;
    if (!password) {
      this.showMessage('account-delete-msg', 'Digite sua senha para confirmar a exclusão.');
      return;
    }
    if (!confirm('Excluir a conta e toda a biblioteca? Isso é definitivo e não pode ser desfeito.')) return;

    this.showMessage('account-delete-msg', '');
    this.setBusy(['btn-account-delete'], true);
    try {
      await window.apiClient.deleteAccount({ password });
      // A conta não existe mais: nada a enviar nem arquivar. Limpa os dados deste navegador e volta a visitante.
      window.syncService.stop();
      window.appState.clearForLogout();
      this.close();
      window.authView.finishLocalLogout();
      window.appController.showToast('Conta e biblioteca excluídas.', 'info');
    } catch (err) {
      this.showMessage('account-delete-msg', this.friendlyError(err));
    } finally {
      this.setBusy(['btn-account-delete'], false);
    }
  }
}

window.accountView = new AccountView();
