const config = require('./server/config/config');
const { describeListen, urlHost } = require('./server/config/network');

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

// Não conseguiu abrir a porta (S11): mensagem em português e saída com código 1 (o Agendador do Windows e o Docker tentam de novo).
function failToListen(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`[servidor] A porta ${config.PORT} já está em uso (talvez outro ShowVault aberto). Feche o outro ou troque PORT no .env.`);
  } else if (err.code === 'EADDRNOTAVAIL') {
    console.error(`[servidor] O endereço HOST=${config.HOST} não existe neste computador. Use 127.0.0.1 (só este PC) ou 0.0.0.0 (todas as interfaces).`);
  } else {
    console.error('[servidor] Não foi possível abrir a porta:', err.message);
  }
  try {
    require('./server/storage').close();
  } catch {
    /* nada aberto */
  }
  process.exit(1);
}

// Inicialização. HOST vazio = todas as interfaces (desenvolvimento); em produção o padrão é 127.0.0.1 (D-29, Tailscale Funnel).
const listenArgs = config.HOST ? [config.PORT, config.HOST] : [config.PORT];
const server = app.listen(...listenArgs, err => {
  // O Express 5 chama este retorno também quando a porta não abre (ocupada, endereço inexistente...).
  if (err) return failToListen(err);
  const where = urlHost(config.HOST);
  console.log(`========================================================`);
  console.log(`  ShowVault (Anime-Tracker) · Servidor MVC Ativo`);
  console.log(`  Acesse: http://${where}:${config.PORT}`);
  console.log(`  Escutando: ${describeListen(config.HOST, config.PORT)}`);
  console.log(`  Armazenamento: ${config.STORAGE}${config.IS_PRODUCTION ? ' · produção' : ''}`);
  console.log(`  Saúde: http://${where}:${config.PORT}/health`);
  console.log(`========================================================`);
  if (config.TRUST_PROXY === true) {
    console.warn('[segurança] TRUST_PROXY=true confia em qualquer X-Forwarded-For: qualquer visitante forja o IP e burla o limite de tentativas. Use um número (1).');
  }

  // S13: de tempos em tempos busca episódios novos das obras em exibição (e atualiza as marcadas pela migração do catálogo antigo).
  // MEDIA_REFRESH_INTERVAL_MIN=0 desliga. Os testes não passam por aqui.
  if (config.REFRESH_INTERVAL_MIN > 0) {
    require('./server/services/mediaService').startRefreshLoop({ intervalMs: config.REFRESH_INTERVAL_MIN * 60 * 1000 });
  }
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
