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
  async getTrending(type = 'all') {
    return this.request(`/media/trending?type=${encodeURIComponent(type)}`);
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

  // --- AUTENTICAÇÃO ---
  async register(name, email, password) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
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
