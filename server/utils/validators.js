// Validação centralizada das entradas de autenticação. Cada função devolve
//   { ok: true, value: {...limpo...} }  ou  { ok: false, error: 'primeira mensagem', fields: { campo: 'mensagem' } }
// e nunca lança: entrada inválida vira HTTP 400 com mensagem clara (nunca 500).

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const NAME_MAX = 60;
const EMAIL_MAX = 254;
const AVATAR_MAX = 500;
const CREDENTIAL_MAX = 4096; // ID token do Google (JWT) fica bem abaixo disso

// Formato do <input type="email"> do HTML5 (sem aspas/comentários), exigindo ao menos um ponto no domínio.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_ANGLE_RE = /[\u0000-\u001f\u007f<>]/;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function result(value, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return { ok: true, value };
  return { ok: false, error: fields[keys[0]], fields };
}

const badBody = () => ({ ok: false, error: 'Corpo da requisição inválido. Envie um JSON.', fields: { body: 'Corpo da requisição inválido. Envie um JSON.' } });

// --- campos individuais: devolvem { value } ou { error } ---

function checkEmail(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Informe o e-mail.' };
  const email = raw.trim().toLowerCase();
  const [local] = email.split('@');
  if (email.length > EMAIL_MAX || local.length > 64 || !EMAIL_RE.test(email)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { error: 'E-mail inválido. Use o formato nome@exemplo.com.' };
  }
  return { value: email };
}

function checkNewPassword(raw, label = 'A senha') {
  if (typeof raw !== 'string' || raw === '') return { error: `${label} é obrigatória.` };
  if (raw.length < PASSWORD_MIN) return { error: `${label} precisa ter pelo menos ${PASSWORD_MIN} caracteres.` };
  if (raw.length > PASSWORD_MAX) return { error: `${label} pode ter no máximo ${PASSWORD_MAX} caracteres.` };
  if (raw.trim() === '') return { error: `${label} não pode ser só espaços.` };
  return { value: raw };
}

// Senha já existente (login/confirmações): sem mínimo, para não trancar contas antigas; só limita tipo e tamanho.
function checkExistingPassword(raw, label = 'A senha') {
  if (typeof raw !== 'string' || raw === '') return { error: `${label} é obrigatória.` };
  if (raw.length > PASSWORD_MAX) return { error: `${label} pode ter no máximo ${PASSWORD_MAX} caracteres.` };
  return { value: raw };
}

// Nome opcional: vazio/ausente => null (o controlador usa o início do e-mail).
function checkName(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'string') return { error: 'O nome precisa ser um texto.' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') return { value: null };
  if ([...name].length > NAME_MAX) return { error: `O nome pode ter no máximo ${NAME_MAX} caracteres.` };
  if (CONTROL_OR_ANGLE_RE.test(name)) return { error: 'O nome não pode conter os caracteres < ou >.' };
  return { value: name };
}

// Avatar opcional: só URL http(s). Vazio/ausente => null (o controlador gera um avatar padrão).
function checkAvatar(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') return { error: 'O avatar precisa ser um endereço (URL) http ou https.' };
  const value = raw.trim();
  if (value === '') return { value: null };
  if (value.length > AVATAR_MAX) return { error: `O endereço do avatar pode ter no máximo ${AVATAR_MAX} caracteres.` };
  if (/\s/.test(value)) return { error: 'O avatar precisa ser um endereço (URL) http ou https válido.' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: 'O avatar precisa ser um endereço (URL) http ou https válido.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'O avatar precisa ser um endereço (URL) http ou https.' };
  }
  return { value: url.href };
}

function checkCredential(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Credencial do Google ausente.' };
  if (raw.length > CREDENTIAL_MAX) return { error: 'Credencial do Google inválida.' };
  return { value: raw.trim() };
}

function collect(spec) {
  const value = {};
  const fields = {};
  for (const [key, check] of Object.entries(spec)) {
    const r = check();
    if (r.error) fields[key] = r.error;
    else value[key] = r.value;
  }
  return result(value, fields);
}

function validateRegister(body) {
  if (!isPlainObject(body)) return badBody();
  return collect({
    email: () => checkEmail(body.email),
    password: () => checkNewPassword(body.password),
    name: () => checkName(body.name),
    avatar: () => checkAvatar(body.avatar)
  });
}

function validateLogin(body) {
  if (!isPlainObject(body)) return badBody();
  return collect({
    email: () => checkEmail(body.email),
    password: () => checkExistingPassword(body.password)
  });
}

function validateChangePassword(body) {
  if (!isPlainObject(body)) return badBody();
  const out = collect({
    currentPassword: () => checkExistingPassword(body.currentPassword, 'A senha atual'),
    newPassword: () => checkNewPassword(body.newPassword, 'A nova senha')
  });
  if (out.ok && out.value.currentPassword === out.value.newPassword) {
    return result(null, { newPassword: 'A nova senha precisa ser diferente da atual.' });
  }
  return out;
}

function validatePasswordConfirmation(body) {
  if (!isPlainObject(body)) return badBody();
  return collect({ password: () => checkExistingPassword(body.password, 'A senha') });
}

function validateGoogleCredential(body) {
  if (!isPlainObject(body)) return badBody();
  return collect({ credential: () => checkCredential(body.credential) });
}

// Resposta 400 padrão: { error, fields }
function sendInvalid(res, validation) {
  return res.status(400).json({ error: validation.error, fields: validation.fields, code: 'INVALID_INPUT' });
}

module.exports = {
  PASSWORD_MIN,
  PASSWORD_MAX,
  NAME_MAX,
  validateRegister,
  validateLogin,
  validateChangePassword,
  validatePasswordConfirmation,
  validateGoogleCredential,
  checkEmail,
  checkAvatar,
  sendInvalid
};
