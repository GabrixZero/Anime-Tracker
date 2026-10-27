// checkSession (authView.js): só um 401 do servidor encerra a sessão; sem rede ou com erro 5xx o token é mantido (S10).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'authView.js'), 'utf-8')
  .replace('window.authView = new AuthView();', 'this.AuthView = AuthView;');

function setup({ token = 'jwt-de-teste', getMe }) {
  const store = new Map(token ? [['showvault_auth_token', token]] : []);
  const timers = [];
  const listeners = {};
  const calls = { header: [], status: [], pulled: [] };
  const win = {
    apiClient: { getMe },
    syncService: {
      setStatus: s => calls.status.push(s),
      pullAndMerge: (...a) => calls.pulled.push(a)
    },
    addEventListener: (name, fn) => {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    removeEventListener: (name, fn) => {
      listeners[name] = (listeners[name] || []).filter(f => f !== fn);
    }
  };
  const ctx = {
    window: win,
    localStorage: { getItem: k => store.get(k) ?? null, removeItem: k => store.delete(k), setItem: (k, v) => store.set(k, v) },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'authView.js' });
  const view = Object.create(ctx.AuthView.prototype);
  view.updateHeader = u => calls.header.push(u);
  return { view, store, timers, listeners, calls };
}

const httpError = status => Object.assign(new Error('x'), { status });

test('401 do servidor encerra a sessão: apaga o token e mostra visitante', async () => {
  const { view, store, calls, timers } = setup({
    getMe: async () => {
      throw httpError(401);
    }
  });
  await view.checkSession();
  assert.equal(store.has('showvault_auth_token'), false);
  assert.deepEqual(calls.header, [null]);
  assert.equal(timers.length, 0, 'não tenta de novo');
});

test('sem rede (fetch falha): mantém o token, mostra "offline" e tenta de novo ao voltar a conexão', async () => {
  let online = false;
  const { view, store, calls, timers, listeners } = setup({
    getMe: async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return { user: { id: 'usr_1', name: 'Ana' } };
    }
  });
  await view.checkSession();
  assert.equal(store.get('showvault_auth_token'), 'jwt-de-teste', 'token preservado');
  assert.deepEqual(calls.status, ['offline']);
  assert.equal(timers.length, 1);
  assert.equal(listeners.online.length, 1);

  online = true;
  listeners.online[0]();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls.header.at(-1), { id: 'usr_1', name: 'Ana' });
  assert.equal(calls.pulled.length, 1);
  assert.equal(listeners.online.length, 0, 'ouvinte removido depois de usado');
});

test('erro 5xx (servidor com problema): mantém o token e mostra erro de sincronização', async () => {
  for (const status of [500, 503]) {
    const { view, store, calls } = setup({
      getMe: async () => {
        throw httpError(status);
      }
    });
    await view.checkSession();
    assert.equal(store.get('showvault_auth_token'), 'jwt-de-teste', `HTTP ${status}`);
    assert.deepEqual(calls.status, ['error']);
  }
});

test('as tentativas automáticas têm limite (5) e não se acumulam', async () => {
  const { view, timers, listeners } = setup({
    getMe: async () => {
      throw new TypeError('Failed to fetch');
    }
  });
  await view.checkSession();
  await view.checkSession(); // segunda chamada com uma tentativa já agendada: não duplica
  assert.equal(timers.length, 1);
  for (let i = 0; i < 8; i++) {
    const [fn] = timers.splice(0).map(t => t.fn);
    if (!fn) break;
    fn();
    await new Promise(r => setImmediate(r));
  }
  assert.ok(view.sessionRetries <= 5);
  assert.ok((listeners.online || []).length <= 1);
});

test('sem token: visitante, sem chamar a API', async () => {
  let called = false;
  const { view, calls } = setup({
    token: null,
    getMe: async () => {
      called = true;
    }
  });
  await view.checkSession();
  assert.equal(called, false);
  assert.deepEqual(calls.header, [null]);
});
