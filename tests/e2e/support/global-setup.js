// Antes de todos os testes E2E (S12): servidor falso das fontes + servidor do app na porta 3012 com pasta de dados temporária.
// Depois de todos: encerra os DOIS processos/servidores que abriu e apaga SÓ a pasta temporária que criou.
// (Escolha da S12: global setup em vez do `webServer` do Playwright, porque no Windows o webServer é encerrado à força
//  e não daria para apagar a pasta temporária com o servidor já parado. Ver D-S12-2.)
'use strict';

const fs = require('fs');
const path = require('path');
const { startFakeSources } = require('../fake-sources/server');
const { prepareDataDir, removeDataDir, startApp } = require('./app-server');
const { E2E_PORT } = require('./constants');

module.exports = async function globalSetup(config) {
  const outputDir = (config.projects[0] && config.projects[0].outputDir) || path.join(config.rootDir, 'test-results');
  fs.mkdirSync(outputDir, { recursive: true });
  const logFile = path.join(outputDir, 'servidor-e2e.log');

  const fake = await startFakeSources();
  const dataDir = prepareDataDir();
  let app;
  try {
    app = await startApp({ port: E2E_PORT, dataDir, fakeSourcesUrl: fake.url, logFile });
  } catch (err) {
    await fake.close();
    removeDataDir(dataDir);
    throw err;
  }

  // Os processos dos testes (workers) herdam estas variáveis: o teste do Google sobe um 2º servidor com o mesmo servidor falso.
  process.env.E2E_FAKE_SOURCES_URL = fake.url;
  process.env.E2E_SERVER_LOG = logFile;

  return async function globalTeardown() {
    try {
      await app.stop();
    } finally {
      await fake.close();
      removeDataDir(dataDir);
    }
    const unexpected = fake.unexpectedHosts();
    if (unexpected.length) {
      throw new Error(
        `[e2e] O servidor do app tentou acessar hosts externos sem simulação: ${unexpected.join(', ')}. ` +
          'Os testes E2E não podem usar a internet: acrescente essa fonte ao servidor falso (tests/e2e/fake-sources/).'
      );
    }
  };
};
