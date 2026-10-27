// Valores compartilhados entre a configuração do Playwright, o global-setup e os testes E2E (S12).
'use strict';

// Porta própria da S12 (as sessões usam 30NN; a S13 usa 3013). Pode ser trocada com E2E_PORT=<porta>.
const E2E_PORT = Number(process.env.E2E_PORT) || 3012;

module.exports = {
  E2E_PORT,
  BASE_URL: `http://127.0.0.1:${E2E_PORT}`,
  // Senha só dos testes (contas criadas no servidor temporário, apagadas no fim). Não é senha de ninguém.
  TEST_PASSWORD: 'senha-de-teste-e2e-123'
};
