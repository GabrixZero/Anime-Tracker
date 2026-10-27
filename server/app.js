// Monta o app Express (sem abrir porta), para o servidor real e para os testes de rotas.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const config = require('./config/config');
const { requireActiveUser } = require('./middleware/auth');
const authRoutes = require('./routes/authRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const userRoutes = require('./routes/userRoutes');

// Resolve o segredo JWT já na partida (gera o arquivo local na primeira vez; em produção falha sem JWT_SECRET seguro).
void config.JWT_SECRET;

const app = express();

app.disable('x-powered-by');
if (config.TRUST_PROXY !== false) app.set('trust proxy', config.TRUST_PROXY);

// Cabeçalhos de segurança. Sem CSP por enquanto: o HTML ainda usa onclick inline (a CSP estrita entra na S10).
// COOP "same-origin-allow-popups" é o que o popup do Login com Google exige.
app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: config.IS_PRODUCTION ? undefined : false, // HSTS só em produção (HTTPS)
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

// Compressão gzip/deflate das respostas de texto (JSON da API, HTML, CSS, JS). Imagens/SVG pequenos não precisam. (S09)
app.use(compression());

// CORS: o site e a API são da mesma origem (não precisa de CORS). Só origens listadas em CORS_ORIGINS podem chamar de fora.
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || config.CORS_ORIGINS.includes(origin) ? true : false);
  }
}));

// Verificação de saúde para a hospedagem/Docker (sem login, sem dados do usuário, sem tocar no disco).
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', storage: config.STORAGE, uptimeSec: Math.round(process.uptime()) });
});

// Rotas de autenticação recebem corpo pequeno (16 KB) e ficam ANTES do parser global de 2 MB.
app.use('/api/auth', express.json({ limit: '16kb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Log simples de requisições de API
app.use('/api', (req, res, next) => {
  console.log(`[API ${req.method}] ${req.originalUrl}`);
  next();
});

// Rotas da API REST
app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
// A biblioteca só serve contas que ainda existem (conta excluída / senha trocada derrubam sessões antigas).
app.use('/api/user', requireActiveUser, userRoutes);

// Rotas /api desconhecidas respondem JSON (não o index.html do fallback SPA)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Servidor de Arquivos Estáticos (Frontend MVC)
// Cache (S09): ETag/Last-Modified sempre; HTML sempre conferido (no-cache); CSS/JS/imagens guardados por STATIC_MAX_AGE_SEC.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  lastModified: true,
  maxAge: config.STATIC_MAX_AGE_SEC * 1000,
  setHeaders(res, filePath) {
    if (/\.html?$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// Fallback SPA (com `root`, uma pasta com ponto no caminho, como .claude/worktrees, não é tratada como arquivo oculto)
app.use((req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, '..', 'public') });
});

// Erros não tratados (ex.: JSON malformado ou corpo grande demais)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Erro não tratado:', err);
  res.status(status).json({
    error: status >= 500 ? 'Erro interno do servidor.' : status === 413 ? 'Requisição grande demais.' : 'Requisição inválida.'
  });
});

module.exports = app;
