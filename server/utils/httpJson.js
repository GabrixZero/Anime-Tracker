// GET JSON com timeout, limite de tamanho e status HTTP tratado em erros tipados (usado por todas as fontes externas).
// 404 => NOT_FOUND, 429 => RATE_LIMITED (com Retry-After), 401/403 => UPSTREAM (chave recusada), resto fora de 2xx => UPSTREAM.
const http = require('http');
const https = require('https');
const { mediaErrors } = require('./errors');

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

function requestJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http://') ? http : https;
    const req = client.get(url, { headers: { 'User-Agent': 'ShowVault/2.0', Accept: 'application/json', ...headers } }, (res) => {
      const status = res.statusCode || 0;
      if (status === 404) { res.resume(); return reject(mediaErrors.notFound()); }
      if (status === 429) {
        res.resume();
        const retryAfter = Number(res.headers['retry-after']);
        return reject(mediaErrors.rateLimited(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined));
      }
      if (status === 401 || status === 403) {
        res.resume();
        return reject(mediaErrors.upstream('A fonte externa recusou o acesso (verifique a chave configurada no servidor).'));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(mediaErrors.upstream());
      }

      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          return reject(mediaErrors.upstream('Resposta grande demais da fonte externa.'));
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch {
          reject(mediaErrors.upstream('Resposta inválida da fonte externa.'));
        }
      });
      res.on('error', () => reject(mediaErrors.upstream()));
    });
    req.on('error', () => reject(mediaErrors.upstream()));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(mediaErrors.upstream('Tempo esgotado na fonte externa.'));
    });
  });
}

module.exports = { requestJson, MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT_MS };
