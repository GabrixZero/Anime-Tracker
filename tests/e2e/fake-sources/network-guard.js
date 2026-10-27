// Guarda de rede do SERVIDOR nos testes E2E (S12). Carregado com `node --require` apenas no processo do app que os testes
// sobem (nunca no app de verdade; nenhum arquivo do app é alterado).
//
// Qualquer pedido http/https/fetch para fora de 127.0.0.1/localhost é reescrito para o servidor falso das fontes:
//   https://api.tvmaze.com/search/shows?q=x  ->  http://127.0.0.1:<porta>/externo/api.tvmaze.com/search/shows?q=x
// Motivo: o app ainda não tem variável de URL para o TVMaze (só JIKAN_BASE_URL existe). Quando houver (TVMAZE_BASE_URL etc.),
// basta apontá-la para o servidor falso. Hosts que o servidor falso não conhece respondem 503 e falham a execução no fim.
//
// Também encerra o servidor se o processo que o abriu (Playwright) morrer, para nunca sobrar servidor órfão.
'use strict';

const http = require('http');
const https = require('https');

const FAKE = process.env.E2E_FAKE_SOURCES_URL;
if (!FAKE) throw new Error('[e2e-guard] E2E_FAKE_SOURCES_URL não definido: este arquivo só serve para o servidor dos testes E2E.');
const fakeBase = new URL(FAKE);

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const isLoopback = hostname => LOOPBACK.has(String(hostname || '').toLowerCase());
const toFake = original => new URL(`/externo/${original.host}${original.pathname}${original.search}`, fakeBase);

const original = {
  httpRequest: http.request,
  httpsRequest: https.request,
  fetch: globalThis.fetch
};

// Mesmas assinaturas do Node: request(url[, options][, callback]) ou request(options[, callback]).
function parseArgs(args) {
  const [a, b, c] = args;
  if (typeof a === 'string' || a instanceof URL) {
    return typeof b === 'function' ? { url: new URL(a), options: {}, callback: b } : { url: new URL(a), options: b || {}, callback: c };
  }
  return { url: null, options: a || {}, callback: b };
}

function externalUrl({ url, options }, protocol) {
  if (url) return isLoopback(url.hostname) ? null : url;
  const host = options.hostname || (options.host ? String(options.host).replace(/:\d+$/, '') : '');
  if (!host || isLoopback(host)) return null;
  const port = options.port ? `:${options.port}` : '';
  return new URL(`${options.protocol || protocol}//${host}${port}${options.path || '/'}`);
}

function guard(protocol, passThrough) {
  return function guardedRequest(...args) {
    const parsed = parseArgs(args);
    const outside = externalUrl(parsed, protocol);
    if (!outside) return passThrough.apply(this, args);
    // Para fora: vai para o servidor falso (sempre http local). Opções de TLS/agente do pedido original não se aplicam.
    const { host, hostname, port, path, protocol: _p, agent, ...rest } = parsed.options;
    rest.headers = { ...(rest.headers || {}), 'x-e2e-original-url': outside.href };
    return original.httpRequest(toFake(outside), rest, parsed.callback);
  };
}

http.request = guard('http:', original.httpRequest);
https.request = guard('https:', original.httpsRequest);
// http.get/https.get do Node chamam a função interna (não a propriedade), por isso são trocados também.
http.get = function get(...args) {
  const req = http.request(...args);
  req.end();
  return req;
};
https.get = function get(...args) {
  const req = https.request(...args);
  req.end();
  return req;
};

if (typeof original.fetch === 'function') {
  globalThis.fetch = function guardedFetch(input, init) {
    let target;
    try {
      target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    } catch {
      return original.fetch(input, init);
    }
    if (isLoopback(target.hostname) || !/^https?:$/.test(target.protocol)) return original.fetch(input, init);
    const rewritten = toFake(target).href;
    if (typeof input === 'string' || input instanceof URL) return original.fetch(rewritten, init);
    return original.fetch(new Request(rewritten, input), init);
  };
}

// Sem o processo pai (Playwright encerrado à força), o servidor de teste também sai.
const parentPid = process.ppid;
setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    process.exit(0);
  }
}, 2000).unref();
