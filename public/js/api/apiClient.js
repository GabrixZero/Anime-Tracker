// ================================================================
// SHOWVAULT · CLIENTE DE API REST (MVC FRONTEND)
// ================================================================

class ApiClient {
  constructor() {
    this.baseUrl = '/api';
  }

  getHeaders() {
    const token = localStorage.getItem('showvault_auth_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }

  async request(endpoint, options = {}) {
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: this.getHeaders(),
        ...options
      });
      const data = await res.json();
      if (res.status === 401 && endpoint !== '/auth/login' && localStorage.getItem('showvault_auth_token')) {
        localStorage.removeItem('showvault_auth_token');
        window.dispatchEvent(new CustomEvent('showvault:auth-expired'));
      }
      if (!res.ok) {
        const error = new Error(data.error || 'Erro na requisição à API.');
        error.status = res.status; // o sync diferencia sessão expirada (401), servidor com erro e falta de rede (sem status)
        throw error;
      }
      return data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err.message);
      throw err;
    }
  }

  // --- MÍDIA ---
  // Lista LEVE e paginada do catálogo (S09): { count, total, offset, limit, hasMore, data }.
  async getTrending(type = 'all', { limit, offset } = {}) {
    const extra = (limit ? `&limit=${encodeURIComponent(limit)}` : '') + (offset ? `&offset=${encodeURIComponent(offset)}` : '');
    return this.request(`/media/trending?type=${encodeURIComponent(type)}${extra}`);
  }

  // Detalhe completo (temporadas/episódios) de várias obras do catálogo de uma vez: { count, data, missing }. Máx. 50 ids.
  // `summary: true` (S18) pede só o resumo por obra (sem sinopses), bem menor.
  async getBatch(ids, { summary = false } = {}) {
    return this.request(`/media/batch?ids=${ids.map(id => encodeURIComponent(Number(id))).join(',')}${summary ? '&summary=1' : ''}`);
  }

  async search(query = '', type = 'all') {
    return this.request(`/media/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`);
  }

  async getById(id) {
    return this.request(`/media/${encodeURIComponent(id)}`);
  }

  async ingest(id) {
    return this.request('/media/ingest', {
      method: 'POST',
      body: JSON.stringify({ id: Number(id) })
    });
  }

  // Atualiza uma obra em exibição (S13/S15): o servidor respeita a validade e o limite (sem force). Devolve { refreshed, data }.
  async refreshMedia(id) {
    return this.request(`/media/${encodeURIComponent(Number(id))}/refresh`, { method: 'POST', body: '{}' });
  }

  // --- AUTENTICAÇÃO ---
  async register(name, email, password, inviteCode) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, ...(inviteCode ? { inviteCode } : {}) })
    });
  }

  // Troca a senha; devolve um token novo para este aparelho (os outros caem).
  async changePassword(currentPassword, newPassword) {
    return this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  }

  // Exclui a conta e a biblioteca no servidor. Conta com senha: { password }. Conta Google: { credential }.
  async deleteAccount(confirmation) {
    return this.request('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify(confirmation)
    });
  }

  // "Sair de todos os aparelhos": invalida todos os tokens da conta, inclusive o deste aparelho.
  async logoutAll() {
    return this.request('/auth/logout-all', { method: 'POST', body: '{}' });
  }

  async login(email, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  }

  async googleAuth(profile) {
    return this.request('/auth/google', {
      method: 'POST',
      body: JSON.stringify(profile)
    });
  }

  async getMe() {
    return this.request('/auth/me');
  }

  // --- BIBLIOTECA DO USUÁRIO ---
  async getLibrary() {
    return this.request('/user/library');
  }

  async putLibrary(data) {
    return this.request('/user/library', {
      method: 'PUT',
      // stateVersion: o servidor migra snapshots de clientes antigos (ver utils/migrations.js)
      body: JSON.stringify({ data, stateVersion: window.STATE_VERSION })
    });
  }

  // Apaga a biblioteca da conta no servidor ("Resetar" com nuvem). Devolve { resetAt }.
  async deleteLibrary() {
    return this.request('/user/library', { method: 'DELETE' });
  }
}

window.apiClient = new ApiClient();
