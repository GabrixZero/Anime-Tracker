#!/usr/bin/env node
// Roda o Playwright (testes ponta a ponta, S12) com o navegador guardado DENTRO do projeto, em qualquer sistema.
//
//   npm run test:e2e:install   -> baixa o Chromium do Playwright para node_modules (uma vez por instalação)
//   npm run test:e2e           -> roda os testes (headless)
//   npm run test:e2e:headed    -> roda vendo o navegador
//   npm run test:e2e:ui        -> modo interativo do Playwright (escolher/repetir testes, linha do tempo)
//   npm run test:e2e:report    -> abre o relatório HTML da última execução
//   node scripts/e2e.js test tests/e2e/04-explorar.spec.js --project=desktop   (qualquer argumento do Playwright)
//
// PLAYWRIGHT_BROWSERS_PATH=0 = "baixe e procure os navegadores em node_modules/playwright-core/.local-browsers"
// (nada vai para a pasta do usuário; apagar node_modules apaga o navegador junto). Se a variável já vier definida
// (ex.: no CI, que guarda o navegador em cache fora de node_modules), ela é respeitada.
'use strict';

const { spawn } = require('child_process');
const path = require('path');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

let cli;
try {
  cli = require.resolve('@playwright/test/cli');
} catch {
  console.error('O Playwright não está instalado. Rode "npm install" e depois "npm run test:e2e:install".');
  process.exit(1);
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.join(__dirname, '..')
});

// Ctrl+C no terminal já chega ao Playwright (mesmo grupo de processos): aqui só esperamos ele encerrar e limpar o que abriu.
// Repassar o SIGINT contaria como um "segundo Ctrl+C", que o Playwright trata como encerramento forçado (sem limpeza).
process.on('SIGINT', () => {});
process.on('SIGTERM', () => child.kill('SIGTERM'));

child.on('exit', (code, signal) => process.exit(code === null ? (signal ? 1 : 0) : code));
child.on('error', err => {
  console.error('Não foi possível iniciar o Playwright:', err.message);
  process.exit(1);
});
