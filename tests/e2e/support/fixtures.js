// Fixtures dos testes E2E (S12): o `test` de todos os arquivos .spec.js sai daqui.
//
// O que cada teste ganha SEM pedir (fixture "guard", automática):
//   - o navegador nunca fala com a internet: pedidos para fora de 127.0.0.1 são respondidos aqui (fontes -> CSS vazio, imagens -> um
//     SVG minúsculo). Qualquer outra coisa é bloqueada e o teste falha;
//   - ao final, o teste falha se houve erro de console, exceção na página, violação de CSP (`securitypolicyviolation`) ou pedido
//     bloqueado. Testes que PROVOCAM um erro de propósito (senha errada = 401) declaram `guard.allow(/texto/)` antes.
//
// Fixture `device`: abre outro "aparelho" (browserContext novo, com o mesmo guard) para os testes de sincronização.
'use strict';

const { test: base, expect } = require('@playwright/test');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// 2x3 px cinza: serve de capa/miniatura/avatar para toda imagem externa (o app só precisa que a imagem carregue).
const IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3" viewBox="0 0 2 3"><rect width="2" height="3" fill="#555"/></svg>';

class Guard {
  constructor() {
    this.consoleErrors = [];
    this.pageErrors = [];
    this.cspViolations = [];
    this.blockedRequests = [];
    this.externalImages = 0;
    this.allowed = [];
  }

  // Erros esperados DESTE teste (RegExp contra o texto do erro).
  allow(...patterns) {
    this.allowed.push(...patterns);
  }

  isAllowed(text) {
    return this.allowed.some(re => re.test(text));
  }

  problems() {
    const list = [];
    for (const text of this.consoleErrors) if (!this.isAllowed(text)) list.push(`erro de console: ${text}`);
    for (const text of this.pageErrors) if (!this.isAllowed(text)) list.push(`exceção na página: ${text}`);
    for (const v of this.cspViolations)
      list.push(
        `violação de CSP: ${v.directive} bloqueou ${v.blocked} (${v.source || 'sem arquivo'}:${v.line || 0}) ${v.sample || ''}`.trim()
      );
    for (const text of this.blockedRequests) list.push(`pedido externo bloqueado: ${text}`);
    return list;
  }
}

// Liga o guard a um browserContext: rede simulada, captura de erros e de violações de CSP em TODAS as páginas e frames dele.
async function guardContext(context, guard) {
  await context.exposeBinding('__e2eReportCsp', (_source, violation) => {
    guard.cspViolations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      window.__e2eReportCsp({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
        source: e.sourceFile,
        line: e.lineNumber,
        sample: e.sample
      });
    });
  });

  await context.route(
    url => /^https?:$/.test(url.protocol) && !LOCAL_HOSTS.has(url.hostname),
    route => {
      const request = route.request();
      const url = new URL(request.url());
      const type = request.resourceType();
      if (type === 'image') {
        guard.externalImages++;
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMAGE_SVG });
      }
      if (type === 'stylesheet' && url.hostname === 'fonts.googleapis.com') {
        return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '/* fontes do Google desligadas nos testes */' });
      }
      guard.blockedRequests.push(`${request.method()} ${type} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
  );

  const watch = page => {
    page.on('console', msg => {
      if (msg.type() === 'error') guard.consoleErrors.push(`${msg.text()} [${msg.location().url || 'sem origem'}]`);
    });
    page.on('pageerror', err => guard.pageErrors.push(String((err && err.stack) || err)));
  };
  context.pages().forEach(watch);
  context.on('page', watch);
}

const test = base.extend({
  guard: [
    async ({ context }, use, testInfo) => {
      const guard = new Guard();
      await guardContext(context, guard);
      await use(guard);
      const problems = guard.problems();
      if (problems.length) {
        await testInfo.attach('guard-problemas.txt', { body: problems.join('\n'), contentType: 'text/plain' });
        // Se o teste já falhou por outro motivo, o relatório mostra o anexo; não soma um segundo erro.
        if (testInfo.status === testInfo.expectedStatus)
          expect(problems, 'o navegador não pode ter erro de console, de CSP nem rede externa').toEqual([]);
      }
    },
    { auto: true }
  ],

  // const phone = await device(); -> { context, page }: outro aparelho, com localStorage próprio e o mesmo guard do teste.
  device: async ({ browser, guard }, use) => {
    const contexts = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      await guardContext(context, guard);
      const page = await context.newPage();
      return { context, page };
    });
    await Promise.all(contexts.map(c => c.close().catch(() => {})));
  }
});

module.exports = { test, expect, Guard, guardContext, IMAGE_SVG };
