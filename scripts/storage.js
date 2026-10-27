#!/usr/bin/env node
// Ferramenta de armazenamento (usa a pasta de dados de SHOWVAULT_DATA_DIR, ou server/data):
//   npm run storage:migrate            importa users.json, libraries/ e o catálogo para o SQLite (com backup; os JSON ficam)
//   npm run storage:migrate -- --force repete a importação (só acrescenta o que ainda não está no banco)
//   npm run storage:export -- <pasta>  exporta o banco para arquivos JSON numa pasta nova (para voltar a STORAGE=json)
const path = require('path');
const config = require('../server/config/config');
const { migrateJsonToSqlite, exportSqliteToJson } = require('../server/storage/migrate');

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === 'migrate') {
    const result = migrateJsonToSqlite(config.DATA_DIR, { force: rest.includes('--force') });
    if (result.skipped) console.log(`Nada a fazer: o banco já foi migrado (${result.previous}). Use --force para repetir.`);
    process.exit(result.failed && result.failed.length ? 1 : 0);
  } else if (command === 'export') {
    const out = rest.find(a => !a.startsWith('--'));
    if (!out) throw new Error('Informe a pasta de saída: npm run storage:export -- <pasta>');
    const { count, outDir } = exportSqliteToJson(config.DATA_DIR, path.resolve(out));
    console.log(`${count} documento(s) exportado(s) para ${outDir}`);
  } else {
    console.log('Uso: node scripts/storage.js migrate [--force] | export <pasta>');
    process.exit(1);
  }
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
}
