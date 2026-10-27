#!/usr/bin/env node
// Mostra, em JSON, a configuração que o servidor usaria (lida do .env com as MESMAS regras do servidor).
// Usado pelos scripts do PowerShell (scripts/windows/*.ps1), para não duplicar o interpretador de .env em outra linguagem.
//   node scripts/show-config.js [--env <arquivo>]
// (não use o nome --env-file: o próprio Node intercepta esse argumento em qualquer posição)
// Nunca imprime segredos (só o tamanho do JWT_SECRET) e não cria nenhum arquivo.
const path = require('path');

const { loadEnvFile } = require('../server/config/envFile');
const { parseHost, urlHost, isAllInterfaces } = require('../server/config/network');
const { resolveDataDir, resolveBackupDir } = require('../server/config/paths');

const root = path.join(__dirname, '..');
const flag = process.argv.indexOf('--env');
const envFile = path.resolve(flag > -1 && process.argv[flag + 1] ? process.argv[flag + 1] : path.join(root, '.env'));

const env = { ...process.env };
const { loaded } = loadEnvFile(envFile, env);

const problems = [];
const production = env.NODE_ENV === 'production';
let host = null;
try {
  host = parseHost(env.HOST, { isProduction: production });
} catch (err) {
  problems.push(err.message);
}
const portNumber = Number.parseInt(env.PORT, 10);
const port = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535 ? portNumber : 3000;
if (env.PORT && port !== portNumber) problems.push(`PORT inválida: "${env.PORT}"`);
const storage = (env.STORAGE || 'json').trim().toLowerCase();
const secretLength = (env.JWT_SECRET || '').trim().length;
if (production && secretLength < 32) problems.push('JWT_SECRET ausente ou curto demais (mín. 32 caracteres): rode npm run setup:pc');

// Endereço para conferir /health a partir deste computador (nunca "localhost": evita ::1 quando o app escuta em 127.0.0.1).
const probeHost = host && !isAllInterfaces(host) ? urlHost(host) : '127.0.0.1';

// Só ASCII: o PowerShell 5.1 decodifica a saída do Node com a página de código do Windows e estragaria acentos em caminhos.
const toAscii = text => text.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const info = {
  root,
  envFile,
  envFileExists: loaded,
  production,
  storage,
  port,
  host,
  healthUrl: `http://${probeHost}:${port}/health`,
  dataDir: resolveDataDir(env),
  backupDir: resolveBackupDir(env),
  jwtSecretLength: secretLength,
  nodeVersion: process.version,
  problems
};
console.log(toAscii(JSON.stringify(info)));
