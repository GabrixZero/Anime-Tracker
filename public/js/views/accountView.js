// ================================================================
// SHOWVAULT · VIEW "MINHA CONTA" (S14): perfil, trocar senha, sair de todos os aparelhos e excluir conta
// Todo texto vindo do servidor entra por textContent (nunca innerHTML). Os botões de abrir/sair usam data-action (actionHandlers.js).
// ================================================================

class AccountView {
  constructor() {
    this.modal = document.getElementById('modal-account');
    this.busy = false;
    this.user = null;
    this.photoUrl = null; // blob: da foto de perfil atual (revogado ao trocar, remover ou sair)
    this.photoKey = ''; // "<id>:<avatarUpdatedAt>" da foto que photoUrl mostra
    this.photoSeq = 0; // descarta respostas de downloads antigos
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('btn-close-account').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', e => {
      if (e.target === this.modal) this.close();
    });
    document.getElementById('account-password-form').addEventListener('submit', e => {
      e.preventDefault();
      this.handleChangePassword();
    });
    document.getElementById('account-delete-form').addEventListener('submit', e => {
      e.preventDefault();
      this.handleDelete();
    });
    document.getElementById('btn-account-photo').addEventListener('click', () => {
      if (!this.busy) document.getElementById('account-photo-input').click();
    });
    document.getElementById('account-photo-input').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // permite escolher o mesmo arquivo de novo
      if (file) this.handlePhotoFile(file);
    });
    document.getElementById('btn-account-photo-remove').addEventListener('click', () => this.handlePhotoRemove());
    // Mostra o que falta na nova senha enquanto digita (mesma regra do servidor: passwordRules.js)
    document.getElementById('account-new-password').addEventListener('input', e => {
      const value = e.target.value;
      const live = value === '' ? '' : window.checkPasswordRules(value, 'A nova senha').error || '';
      this.showMessage('account-new-password-error', live);
      if (live) e.target.setAttribute('aria-invalid', 'true');
      else e.target.removeAttribute('aria-invalid');
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
    ['account-password-msg', 'account-sessions-msg', 'account-delete-msg', 'account-photo-msg'].forEach(id => this.showMessage(id, ''));
    ['account-current-password', 'account-new-password', 'account-confirm-password', 'account-delete-password'].forEach(id => {
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
    // e-mail longo quebra depois de @ e de pontos (<wbr>), não no meio de uma palavra; textContent mantém o escape
    const emailEl = document.getElementById('account-email');
    emailEl.replaceChildren();
    String(user.email || '')
      .split(/(?=[@.])/)
      .forEach((part, i) => {
        if (i > 0) emailEl.appendChild(document.createElement('wbr'));
        emailEl.appendChild(document.createTextNode(part));
      });
    const created = user.createdAt ? new Date(user.createdAt) : null;
    document.getElementById('account-created').textContent =
      created && !Number.isNaN(created.getTime()) ? created.toLocaleDateString('pt-BR') : '—';
    this.syncPhoto(user);
    document.getElementById('btn-account-photo-remove').classList.toggle('hidden', !user.hasPhoto);

    // Conta Google não tem senha própria: sem troca de senha; a exclusão pede confirmação do Google.
    document.getElementById('account-password-section').classList.toggle('hidden', isGoogle);
    document.getElementById('account-delete-password-field').classList.toggle('hidden', isGoogle);
    document.getElementById('account-delete-google-note').classList.toggle('hidden', !isGoogle);
    document.getElementById('btn-account-delete').disabled = isGoogle;
  }

  // --- foto de perfil ---

  // Mostra no cabeçalho e em Minha conta a foto enviada (se houver) ou o avatar padrão (user.avatar).
  async syncPhoto(user) {
    const seq = ++this.photoSeq;
    const fallback = window.safeUrl ? window.safeUrl(user.avatar) : '';
    const imgs = [document.getElementById('user-avatar-img'), document.getElementById('account-avatar')];
    const show = src => {
      imgs.forEach(img => {
        img.src = src;
      });
    };
    document.getElementById('account-avatar').alt = '';
    if (!user.hasPhoto) {
      this.clearPhoto();
      show(fallback);
      return;
    }
    const key = `${user.id}:${user.avatarUpdatedAt || ''}`;
    if (this.photoUrl && this.photoKey === key) {
      show(this.photoUrl);
      return;
    }
    show(fallback); // enquanto baixa (ou se falhar), o avatar padrão
    try {
      const blob = await window.apiClient.fetchAvatar();
      if (seq !== this.photoSeq || !blob) return;
      const url = URL.createObjectURL(blob);
      if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
      this.photoUrl = url;
      this.photoKey = key;
      show(url);
    } catch {
      /* mantém o avatar padrão */
    }
  }

  // Revoga o blob (sair da conta, foto removida).
  clearPhoto() {
    this.photoSeq += 1;
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
    this.photoUrl = null;
    this.photoKey = '';
  }

  // Só PNG, JPEG e WEBP (nunca SVG). Lê no navegador, recorta o quadrado central e reduz para 256x256 antes de enviar.
  async handlePhotoFile(file) {
    if (this.busy) return;
    const ok = ['image/png', 'image/jpeg', 'image/webp'];
    if (!ok.includes(file.type) || /.svg$/i.test(file.name)) {
      this.showMessage('account-photo-msg', 'Tipo de arquivo não aceito. Use uma foto PNG, JPEG ou WEBP.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.showMessage('account-photo-msg', 'A foto é grande demais. Escolha uma imagem de até 15 MB.');
      return;
    }
    this.showMessage('account-photo-msg', '');
    this.setBusy(['btn-account-photo', 'btn-account-photo-remove'], true);
    try {
      let blob;
      try {
        blob = await this.squarePhoto(file);
      } catch {
        this.showMessage('account-photo-msg', 'Não foi possível ler esse arquivo como imagem. Escolha outra foto.');
        return;
      }
      if (!blob || blob.size > 200 * 1024) {
        this.showMessage('account-photo-msg', 'A foto ficou grande demais. Escolha outra imagem.');
        return;
      }
      const res = await window.apiClient.uploadAvatar(blob);
      this.afterPhotoChange(res.user);
      window.appController.showToast('Foto de perfil atualizada.', 'success');
    } catch (err) {
      const msg =
        err && err.status === 413
          ? 'A foto é grande demais. Escolha uma imagem menor.'
          : err && err.status === 415
            ? 'Tipo de arquivo não aceito. Use uma foto PNG, JPEG ou WEBP.'
            : this.friendlyError(err);
      this.showMessage('account-photo-msg', msg);
    } finally {
      this.setBusy(['btn-account-photo', 'btn-account-photo-remove'], false);
    }
  }

  async squarePhoto(file) {
    const size = 256;
    const bitmap = await createImageBitmap(file);
    try {
      const side = Math.min(bitmap.width, bitmap.height);
      if (!side) throw new Error('imagem vazia');
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const draw = background => {
        ctx.clearRect(0, 0, size, size);
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, size, size);
        }
        ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
      };
      const toBlob = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
      draw(null);
      const webp = await toBlob('image/webp', 0.85);
      if (webp && webp.type === 'image/webp') return webp;
      draw('#ffffff'); // JPEG não tem transparência
      return toBlob('image/jpeg', 0.85);
    } finally {
      bitmap.close();
    }
  }

  async handlePhotoRemove() {
    if (this.busy) return;
    this.showMessage('account-photo-msg', '');
    this.setBusy(['btn-account-photo', 'btn-account-photo-remove'], true);
    try {
      const res = await window.apiClient.deleteAvatar();
      this.afterPhotoChange(res.user);
      window.appController.showToast('Foto removida. Voltamos ao avatar padrão.', 'info');
    } catch (err) {
      this.showMessage('account-photo-msg', this.friendlyError(err));
    } finally {
      this.setBusy(['btn-account-photo', 'btn-account-photo-remove'], false);
    }
  }

  afterPhotoChange(user) {
    if (!user) return;
    this.render(user); // render() também atualiza a foto do cabeçalho (syncPhoto)
  }

  setBusy(buttonIds, busy) {
    this.busy = busy;
    buttonIds.forEach(id => {
      document.getElementById(id).disabled = busy;
    });
  }

  async handleChangePassword() {
    if (this.busy) return;
    const current = document.getElementById('account-current-password').value;
    const next = document.getElementById('account-new-password').value;
    const again = document.getElementById('account-confirm-password').value;

    const rules = window.checkPasswordRules(next, 'A nova senha');
    let problem = '';
    if (!current) problem = 'Informe a senha atual.';
    else if (!rules.ok) problem = rules.error;
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
      ['account-current-password', 'account-new-password', 'account-confirm-password'].forEach(id => {
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
