// Abre um banco SQLite SÓ PARA LEITURA sem deixar nada para trás (usado por simulações e conferências: --dry-run, restore, backup).
//
// Uma conexão somente-leitura "normal" de um banco em modo WAL cria os arquivos `-wal`/`-shm` ao lado dele e, por ser somente-leitura, não
// consegue apagá-los ao fechar. Sem arquivo `-wal` todo o conteúdo está no arquivo principal, então `immutable=1` lê exatamente isso,
// não cria arquivo nenhum e não trava nada. Se o `-wal` existe (servidor rodando, ou queda de energia), a abertura normal é a correta:
// só ela enxerga o que ainda está no `-wal`, e os arquivos auxiliares já existem.
const fs = require('fs');
const path = require('path');
const url = require('url');

function openReadOnly(file) {
  const { DatabaseSync } = require('node:sqlite');
  const absolute = path.resolve(file);
  if (fs.existsSync(`${absolute}-wal`)) return new DatabaseSync(absolute, { readOnly: true });
  return new DatabaseSync(`${url.pathToFileURL(absolute).href}?immutable=1`, { readOnly: true });
}

module.exports = { openReadOnly };
