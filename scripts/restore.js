#!/usr/bin/env node
// Restaura um backup do banco SQLite (S11, D-29): npm run restore -- <arquivo | nome | ultimo>
//   npm run restore                        lista os backups disponíveis (do mais novo ao mais antigo)
//   npm run restore -- ultimo --dry-run    só confere o backup e mostra o que mudaria; não troca nada
//   npm run restore -- ultimo              pede confirmação (digitar RESTAURAR), guarda uma cópia do banco atual e troca
// Com o ShowVault RODANDO o comando recusa: pare o app primeiro (guia: Documentacao/deploy-pc-tailscale.md).
// Opções: --dir <pasta de backups>  --yes (sem pergunta; para scripts)  --dry-run  --help
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseArgs } = require('util');

const { loadEnvFile } = require('../server/config/envFile');

const USAGE = `Uso: npm run restore -- <arquivo | nome-do-backup | ultimo> [opções]
  (sem argumento) lista os backups disponíveis
  --dir <pasta>   pasta dos backups (padrão: SHOWVAULT_BACKUP_DIR do .env)
  --dry-run       só confere o backup e mostra o resumo; não troca nada
  --yes           não pergunta (para automação; sem isto é preciso digitar RESTAURAR)
  --help          esta ajuda`;

const mb = bytes => `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
const when = date =>
  date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const summary = info => `${info.users} conta(s) · ${info.libraries} biblioteca(s) · ${info.catalog} obra(s) no catálogo · ${mb(info.size)}`;

async function serverIsRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    })
  );
}

async function main(argv) {
  let args;
  let positionals;
  try {
    ({ values: args, positionals } = parseArgs({
      args: argv,
      options: {
        dir: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false }
      },
      strict: true,
      allowPositionals: true
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
  const { resolveDataDir, resolveBackupDir } = require('../server/config/paths');
  const { DB_FILE_NAME } = require('../server/storage');
  const { BackupError, listBackups, inspectDatabase, restoreBackup, resolveBackupArgument } = require('../server/storage/backup');

  if ((process.env.STORAGE || 'json').trim().toLowerCase() !== 'sqlite') {
    console.warn('Aviso: este .env não usa STORAGE=sqlite; o app só lê o banco restaurado com STORAGE=sqlite (rode npm run setup:pc).');
  }
  const dataDir = resolveDataDir();
  const backupDir = args.dir ? path.resolve(args.dir) : resolveBackupDir();
  const port = Number.parseInt(process.env.PORT, 10) || 3000;

  if (positionals.length === 0) {
    const list = listBackups(backupDir);
    console.log(`Pasta de backups: ${backupDir}`);
    if (list.length === 0) {
      console.log('Nenhum backup encontrado ainda. Crie um com: npm run backup');
      return 1;
    }
    console.log('Backups disponíveis (do mais novo ao mais antigo):');
    for (const entry of list) console.log(`  ${entry.name}   ${when(entry.date)}   ${mb(entry.size)}`);
    console.log('\nPara restaurar: npm run restore -- ultimo     (ou o nome de um deles; use --dry-run para só conferir)');
    return 0;
  }

  const backupFile = resolveBackupArgument(positionals[0], backupDir);
  if (!backupFile) {
    console.error(`Não encontrei o backup "${positionals[0]}" (procurei em ${backupDir}). Rode "npm run restore" para ver a lista.`);
    return 1;
  }

  try {
    const chosen = inspectDatabase(backupFile);
    console.log(`Backup escolhido: ${backupFile}`);
    if (!chosen.ok) {
      console.error(`Este arquivo NÃO é um backup utilizável: ${chosen.error}.`);
      return 1;
    }
    console.log(`  ${summary(chosen)} · integridade ok`);

    const currentFile = path.join(dataDir, DB_FILE_NAME);
    const current = fs.existsSync(currentFile) ? inspectDatabase(currentFile) : null;
    console.log(`Banco atual: ${currentFile}`);
    console.log(
      current
        ? `  ${current.ok ? summary(current) : `ilegível (${current.error}); uma cópia dos arquivos originais será guardada`}`
        : '  (ainda não existe)'
    );

    if (args['dry-run']) {
      console.log('\nConferência concluída (--dry-run): nada foi trocado.');
      return 0;
    }

    if (await serverIsRunning(port)) {
      console.error(`\nO ShowVault está rodando (respondeu em http://127.0.0.1:${port}/health). Pare-o antes de restaurar:`);
      console.error('  Stop-ScheduledTask -TaskName ShowVault        (e feche a janela do iniciar.bat, se usar)');
      return 1;
    }

    console.log(`\nATENÇÃO: o banco atual será SUBSTITUÍDO pelo backup. Antes disso uma cópia do banco atual é guardada em ${backupDir}.`);
    if (!args.yes) {
      if (!process.stdin.isTTY) {
        console.error('Sem terminal interativo para confirmar. Rode num terminal, ou acrescente --yes.');
        return 1;
      }
      const answer = await ask('Digite RESTAURAR (em maiúsculas) para continuar, ou só Enter para cancelar: ');
      if (answer.trim() !== 'RESTAURAR') {
        console.log('Cancelado. Nada foi alterado.');
        return 1;
      }
    }

    const result = restoreBackup({ dataDir, backupFile, safetyDir: backupDir });
    if (result.safety) {
      console.log(
        result.safety.method === 'copia-consistente'
          ? `Cópia do banco que estava em uso: ${result.safety.file}`
          : `O banco antigo estava ilegível; os arquivos originais foram guardados em: ${result.safety.file}`
      );
    }
    console.log(`Restaurado: ${summary(result.restored)}`);
    console.log('\nPronto. Ligue o ShowVault de novo:  Start-ScheduledTask -TaskName ShowVault   (ou o iniciar.bat).');
    return 0;
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    if (!(err instanceof BackupError) && process.env.SHOWVAULT_DEBUG) console.error(err.stack);
    return 1;
  }
}

main(process.argv.slice(2)).then(code => {
  process.exitCode = code;
});
