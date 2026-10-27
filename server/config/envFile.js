// Leitura e atualização segura de arquivos .env (modo PC, S11). O .env guarda segredos (JWT_SECRET...) e nunca vai para o Git.
//
// Regras do ensureEnvKeys (usado por `npm run setup:pc`):
//  - uma chave que já tem valor NUNCA é mexida (vale o que a pessoa escreveu);
//  - uma chave que existe mas está vazia (como no .env.example) é preenchida NO LUGAR, mantendo o comentário da linha;
//  - uma chave que não existe vai para o fim do arquivo, num bloco comentado;
//  - comentários, linhas desconhecidas, ordem, quebras de linha (CRLF/LF) e BOM são preservados;
//  - rodar de novo não muda nada (idempotente).
const fs = require('fs');
const util = require('util');

const BOM = '﻿';
const stripBom = text => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// Interpreta o texto como o Node faz com --env-file (aspas, comentários, "export"). Chave repetida: vale a última.
const parseEnvText = text => util.parseEnv(stripBom(text));

// Carrega um .env em `env` SEM sobrescrever o que já existe no ambiente (mesma regra de `node --env-file`).
function loadEnvFile(file, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { loaded: false, keys: [] };
    throw err;
  }
  const keys = [];
  for (const [key, value] of Object.entries(parseEnvText(text))) {
    if (env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}

// Escreve um valor de forma que o parser do Node devolva exatamente o mesmo texto.
// Sem aspas por padrão (caminhos do Windows com "\n" quebrariam entre aspas duplas); aspas simples quando há "#" ou espaços nas pontas.
function formatEnvValue(value) {
  const v = String(value);
  if (/[\r\n]/.test(v)) throw new Error('Valor de .env não pode ter quebra de linha.');
  if (v === '' || !/^\s|\s$|#|^['"`]/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('`')) return `\`${v}\``;
  throw new Error('Valor com aspas simples, crase e "#" ao mesmo tempo não cabe num .env.');
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dateLabel = date => {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// wanted: [{ key, value | () => value, secret? }]. Devolve { text, changed, results: [{ key, action: 'kept'|'filled'|'added', value? }] }.
// `value` nunca aparece nos resultados de chaves secretas.
function ensureEnvKeys(text, wanted, { now = new Date() } = {}) {
  const hadBom = text.charCodeAt(0) === 0xfeff;
  const body = stripBom(text);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body === '' ? [] : body.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // o "\n" final volta no fim
  const effective = util.parseEnv(body);

  const results = [];
  const additions = [];
  for (const item of wanted) {
    const { key, secret = false } = item;
    const current = effective[key];
    if (typeof current === 'string' && current.trim() !== '') {
      results.push({ key, action: 'kept', ...(secret ? {} : { value: current }) });
      continue;
    }
    const value = typeof item.value === 'function' ? item.value() : item.value;
    const formatted = formatEnvValue(value);
    const emptyLine = new RegExp(`^(\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=)\\s*(?:""|''|\`\`)?\\s*(#.*)?$`);
    let index = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (emptyLine.test(lines[i])) {
        index = i;
        break;
      }
    }
    if (index >= 0) {
      const match = emptyLine.exec(lines[index]);
      lines[index] = `${match[1]}${formatted}${match[2] ? ` ${match[2]}` : ''}`;
      results.push({ key, action: 'filled', ...(secret ? {} : { value }) });
    } else {
      additions.push(`${key}=${formatted}`);
      results.push({ key, action: 'added', ...(secret ? {} : { value }) });
    }
  }

  const changed = results.some(r => r.action !== 'kept');
  if (!changed) return { text, changed: false, results };

  let out = lines.join(eol);
  if (additions.length) {
    const block = [`# --- Modo PC (npm run setup:pc em ${dateLabel(now)}) ---`, ...additions].join(eol);
    out = out ? `${out}${eol}${eol}${block}` : block;
  }
  return { text: `${hadBom ? BOM : ''}${out}${eol}`, changed: true, results };
}

module.exports = { parseEnvText, loadEnvFile, formatEnvValue, ensureEnvKeys, stripBom };
