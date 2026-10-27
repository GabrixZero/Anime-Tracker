#!/usr/bin/env node
// Ferramenta de armazenamento (usa a pasta de dados de SHOWVAULT_DATA_DIR, ou server/data; lê o .env da pasta do projeto):
//   npm run storage:migrate                          importa users.json, libraries/ e o catálogo para o SQLite (com backup; os JSON ficam)
//   npm run storage:migrate -- --from <pasta>        lê os JSON de OUTRA pasta (ex.: server/data do projeto, com o banco indo
//                                                    para %LOCALAPPDATA%\ShowVault\data); nunca sobrescreve o que o banco já tem
//   npm run storage:migrate -- --dry-run             só simula: mostra o que seria importado e não grava nada (combina com --from)
//   npm run storage:migrate -- --force               repete a importação (só acrescenta o que ainda não está no banco)
//   npm run storage:export -- <pasta>                exporta o banco para arquivos JSON numa pasta nova (para voltar a STORAGE=json)
const path = require('path');
const { parseArgs } = require('util');

const { loadEnvFile } = require('../server/config/envFile');

// O .env primeiro (sem sobrescrever o ambiente): é ele que diz onde está a pasta de dados do modo PC.
loadEnvFile(path.join(__dirname, '..', '.env'));
const config = require('../server/config/config');
const { migrateJsonToSqlite, exportSqliteToJson } = require('../server/storage/migrate');

const [command, ...rest] = process.argv.slice(2);

function printPreview(p) {
  console.log('Simulação: nada será gravado.');
  console.log(`  JSON lidos de:   ${p.sourceDir}`);
  console.log(`  Banco (destino): ${p.dbFile}${p.dbExists ? '' : ' (ainda não existe)'}`);
  if (p.skipped) {
    console.log(`  O banco já foi migrado antes (${p.previous}). Com --force ou --from ele acrescenta só o que faltar.`);
    return;
  }
  if (p.files === 0) {
    console.log('  Nenhum JSON de dados encontrado nessa pasta (users.json, libraries/, mediaCatalog.runtime.json).');
    return;
  }
  console.log(`  Seriam importados: ${p.users} conta(s), ${p.libraries} biblioteca(s), catálogo com ${p.catalog} obra(s).`);
  if (p.existingKeys.length) console.log(`  Já existem no banco e NÃO seriam sobrescritos: ${p.existingKeys.join(', ')}`);
  for (const f of p.failed) console.log(`  Ilegível (seria pulado; a cópia ficaria no backup): ${f.key}: ${f.error}`);
  console.log(
    '  Antes de importar, os arquivos são copiados para backup-pre-sqlite-<data>/ dentro da pasta do banco; os JSON originais não são apagados.'
  );
}

try {
  if (command === 'migrate') {
    const { values } = parseArgs({
      args: rest,
      options: { force: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, from: { type: 'string' } },
      strict: true,
      allowPositionals: false
    });
    const result = migrateJsonToSqlite(config.DATA_DIR, { force: values.force, fromDir: values.from, dryRun: values['dry-run'] });
    if (result.dryRun) {
      printPreview(result);
    } else if (result.nothingFound) {
      console.log(
        `Nenhum JSON de dados encontrado em ${result.sourceDir} (users.json, libraries/, mediaCatalog.runtime.json). Nada foi feito.`
      );
      process.exit(1);
    } else if (result.skipped) {
      console.log(`Nada a fazer: o banco já foi migrado (${result.previous}). Use --force para repetir.`);
    } else if (!values.from && result.users + result.libraries + result.catalog + result.existing === 0 && result.failed.length === 0) {
      console.log(
        `Nenhum JSON de dados na pasta do banco (${config.DATA_DIR}). Se seus dados antigos estão em outra pasta (ex.: server/data do projeto), use --from <pasta>.`
      );
    }
    process.exit(result.failed && result.failed.length ? 1 : 0);
  } else if (command === 'export') {
    const out = rest.find(a => !a.startsWith('--'));
    if (!out) throw new Error('Informe a pasta de saída: npm run storage:export -- <pasta>');
    const { count, outDir } = exportSqliteToJson(config.DATA_DIR, path.resolve(out));
    console.log(`${count} documento(s) exportado(s) para ${outDir}`);
  } else {
    console.log('Uso: node scripts/storage.js migrate [--from <pasta>] [--dry-run] [--force] | export <pasta>');
    process.exit(1);
  }
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
}
