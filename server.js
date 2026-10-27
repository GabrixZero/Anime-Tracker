const config = require('./server/config/config');

// Com STORAGE=sqlite, importa os JSON antigos (uma única vez, com backup) ANTES de carregar os modelos:
// o UserModel cria um users.json vazio ao ser carregado e isso esconderia as contas existentes.
if (config.STORAGE === 'sqlite') {
  const { migrateJsonToSqlite } = require('./server/storage/migrate');
  migrateJsonToSqlite(config.DATA_DIR);
}

const app = require('./server/app');
const LibraryModel = require('./server/models/LibraryModel');

// Migra as bibliotecas salvas em versões antigas do estado (remove só as referências às obras aposentadas; ver D-11).
const migration = LibraryModel.migrateAll();
if (migration.migrated || migration.failed) {
  console.log(`[migração] bibliotecas migradas: ${migration.migrated}, com erro (ignoradas): ${migration.failed}`);
}

// Inicialização
const server = app.listen(config.PORT, () => {
  console.log(`========================================================`);
  console.log(`  ShowVault (Anime-Tracker) · Servidor MVC Ativo`);
  console.log(`  Acesse: http://localhost:${config.PORT}`);
  console.log(`  Armazenamento: ${config.STORAGE}${config.IS_PRODUCTION ? ' · produção' : ''}`);
  console.log(`  Saúde: http://localhost:${config.PORT}/health`);
  console.log(`========================================================`);
});

// Encerramento limpo (Docker envia SIGTERM): para de aceitar conexões e fecha o banco.
function shutdown(signal) {
  console.log(`[servidor] ${signal} recebido, encerrando...`);
  server.close(() => {
    require('./server/storage').close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
