#!/usr/bin/env node
// Backup consistente do banco SQLite (S11, D-29): npm run backup
//   - lê o .env da pasta do projeto (sem sobrescrever variáveis que já existam no ambiente);
//   - faz uma foto do banco com `VACUUM INTO` (nunca copia o arquivo aberto), confere e guarda em SHOWVAULT_BACKUP_DIR
//     (padrão: OneDrive\Documentos\ShowVault-Backups); depois apaga os antigos: 7 diários + 4 semanais;
//   - pode rodar com o servidor ligado. O Agendador do Windows chama este comando todo dia (scripts/windows/install-autostart.ps1).
// Opções: --dir <pasta>  --keep-daily <n>  --keep-weekly <n>  --no-rotate  --help
const path = require('path');
const { parseArgs } = require('util');

const { loadEnvFile } = require('../server/config/envFile');

const USAGE = `Uso: npm run backup [-- opções]
  --dir <pasta>       pasta dos backups (padrão: SHOWVAULT_BACKUP_DIR do .env, senão OneDrive\\Documentos\\ShowVault-Backups)
  --keep-daily <n>    quantos dias recentes guardar (padrão 7)
  --keep-weekly <n>   quantas semanas recentes guardar (padrão 4)
  --no-rotate         não apaga backups antigos
  --help              esta ajuda`;

function main(argv) {
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: {
        dir: { type: 'string' },
        'keep-daily': { type: 'string' },
        'keep-weekly': { type: 'string' },
        'no-rotate': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false }
      },
      strict: true,
      allowPositionals: false
    }));
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  loadEnvFile(path.join(__dirname, '..', '.env'));
  const { resolveDataDir, resolveBackupDir, isInsideOneDrive } = require('../server/config/paths');
  const { createBackup, BackupError } = require('../server/storage/backup');

  const storage = (process.env.STORAGE || 'json').trim().toLowerCase();
  if (storage !== 'sqlite') {
    console.error(
      'O backup é do banco SQLite, e este .env usa STORAGE=json (arquivos). Rode "npm run setup:pc" e "npm run storage:migrate" antes (veja Documentacao/deploy-pc-tailscale.md).'
    );
    return 1;
  }

  const count = (value, fallback, label) => {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${label} precisa ser um número inteiro maior que zero.`);
    return n;
  };

  try {
    const dataDir = resolveDataDir();
    const backupDir = args.dir ? path.resolve(args.dir) : resolveBackupDir();
    const result = createBackup({
      dataDir,
      backupDir,
      keepDaily: count(args['keep-daily'], 7, '--keep-daily'),
      keepWeekly: count(args['keep-weekly'], 4, '--keep-weekly'),
      rotate: !args['no-rotate']
    });
    const mb = (result.size / (1024 * 1024)).toFixed(2).replace('.', ',');
    console.log(`Backup criado: ${result.file}`);
    console.log(
      `  ${mb} MB · ${result.users} conta(s) · ${result.libraries} biblioteca(s) · ${result.catalog} obra(s) no catálogo · integridade ok`
    );
    if (result.rotation) {
      const { kept, removed, failed } = result.rotation;
      console.log(`  Rotação: ${kept} backup(s) guardado(s)${removed.length ? `, ${removed.length} antigo(s) apagado(s)` : ''}.`);
      for (const f of failed) console.warn(`  Aviso: não consegui apagar ${f.name}: ${f.error}`);
    }
    if (!isInsideOneDrive(backupDir)) {
      console.log(
        '  Atenção: esta pasta não está no OneDrive; sem uma cópia fora deste computador, um defeito no disco leva os backups junto.'
      );
    }
    return 0;
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    if (!(err instanceof BackupError) && process.env.SHOWVAULT_DEBUG) console.error(err.stack);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
