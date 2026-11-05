// ================================================================
// SHOWVAULT · REGRA DE SENHA NOVA (criar conta e trocar senha)
// Uma só regra para o navegador e o servidor (server/utils/validators.js): 8 a 128 caracteres, ao menos uma letra e um número.
// Login NÃO usa esta regra (contas antigas com senha fraca continuam entrando). Também roda em Node.
// ================================================================

(function (root) {
  const PASSWORD_MIN = 8;
  const PASSWORD_MAX = 128;

  // Devolve { ok: true } ou { ok: false, error: 'mensagem em português' }. Nunca lança.
  function checkPasswordRules(raw, label = 'A senha') {
    if (typeof raw !== 'string' || raw === '') return { ok: false, error: `${label} é obrigatória.` };
    if (raw.length < PASSWORD_MIN) return { ok: false, error: `${label} precisa ter pelo menos ${PASSWORD_MIN} caracteres.` };
    if (raw.length > PASSWORD_MAX) return { ok: false, error: `${label} pode ter no máximo ${PASSWORD_MAX} caracteres.` };
    if (!/[0-9]/.test(raw)) return { ok: false, error: 'Falta pelo menos um número.' };
    if (!/\p{L}/u.test(raw)) return { ok: false, error: 'Falta pelo menos uma letra.' };
    return { ok: true };
  }

  const api = { PASSWORD_MIN, PASSWORD_MAX, checkPasswordRules };
  Object.assign(root, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
