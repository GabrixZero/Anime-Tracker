const config = require('./server/config/config');
const app = require('./server/app');
const LibraryModel = require('./server/models/LibraryModel');

// Migra as bibliotecas salvas em versões antigas do estado (remove só as referências às obras aposentadas; ver D-11).
const migration = LibraryModel.migrateAll();
if (migration.migrated || migration.failed) {
  console.log(`[migração] bibliotecas migradas: ${migration.migrated}, com erro (ignoradas): ${migration.failed}`);
}

// Inicialização
app.listen(config.PORT, () => {
  console.log(`========================================================`);
  console.log(`  ShowVault (Anime-Tracker) · Servidor MVC Ativo`);
  console.log(`  Acesse: http://localhost:${config.PORT}`);
  console.log(`  API REST: http://localhost:${config.PORT}/api/media/trending`);
  console.log(`========================================================`);
});
