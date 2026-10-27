// Rede do servidor (S11, D-29): em qual endereço ele escuta (HOST) e em quantos proxies ele confia (TRUST_PROXY).
//
// Modo PC (Windows + Tailscale Funnel): o Funnel termina o HTTPS no próprio computador e entrega cada requisição ao app em
// 127.0.0.1, então o app escuta SÓ em 127.0.0.1 e confia em exatamente 1 proxy (o do Tailscale). Isso fica "em produção"
// por padrão; Docker/hospedagem definem HOST=0.0.0.0 (a imagem já define).
const net = require('net');

const LOOPBACK_V4 = '127.0.0.1';

// HOST: endereço em que o servidor escuta.
//  - vazio em produção      -> 127.0.0.1 (só este computador);
//  - vazio fora de produção -> null (todas as interfaces, como sempre foi no desenvolvimento);
//  - 0.0.0.0 ou ::          -> todas as interfaces (Docker/hospedagem);
//  - qualquer IP ou nome de máquina válido, sem porta e sem "http://".
function parseHost(value, { isProduction = false } = {}) {
  let raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return isProduction ? LOOPBACK_V4 : null;
  if (/^\[.*\]$/.test(raw)) raw = raw.slice(1, -1); // [::1] -> ::1
  if (net.isIP(raw)) return raw;
  if (/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(raw)) return raw; // nome de máquina, ex.: localhost
  throw new Error(
    `HOST inválido: "${String(value).trim()}". Use um endereço IP (127.0.0.1, 0.0.0.0, ::1...) ou um nome como localhost, sem porta (a porta é a variável PORT).`
  );
}

const isAllInterfaces = host => !host || host === '0.0.0.0' || host === '::';
const isLoopbackHost = host => host === 'localhost' || host === '::1' || /^127\./.test(host || '');

// Como mostrar o endereço numa URL de log: localhost quando escuta em tudo; IPv6 entre colchetes.
function urlHost(host) {
  if (isAllInterfaces(host)) return 'localhost';
  return host.includes(':') ? `[${host}]` : host;
}

function describeListen(host, port) {
  if (isAllInterfaces(host)) return `todas as interfaces, porta ${port}`;
  const where = `${host.includes(':') ? `[${host}]` : host}:${port}`;
  return isLoopbackHost(host) ? `${where} (só este computador)` : where;
}

// TRUST_PROXY: quantos proxies confiar para descobrir o IP real do visitante (X-Forwarded-For).
//  - vazio/false: não confia (o IP é o da conexão);
//  - número (ex.: 1): confia nos N últimos saltos. Com o Tailscale Funnel o certo é 1: o proxy do próprio tailscaled reescreve
//    X-Forwarded-For/-Proto/-Host a cada requisição (descarta o que o visitante mandou) e conecta de 127.0.0.1;
//  - true: confia em qualquer cabeçalho (qualquer visitante forja o IP e burla o limite de tentativas): evite;
//  - texto (loopback, uniquelocal, uma lista de redes): repassado ao Express.
function parseTrustProxy(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

module.exports = { parseHost, parseTrustProxy, isAllInterfaces, isLoopbackHost, urlHost, describeListen, LOOPBACK_V4 };
