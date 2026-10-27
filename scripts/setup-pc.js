#!/usr/bin/env node
// Prepara o .env para rodar o ShowVault neste computador (modo PC, S11): npm run setup:pc [-- --dry-run]
// Só completa o que falta; nunca sobrescreve o que já tem valor. Detalhes e opções: server/config/pcSetup.js e --help.
const { runSetup } = require('../server/config/pcSetup');

try {
  process.exitCode = runSetup({ argv: process.argv.slice(2) }).code;
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exitCode = 1;
}
