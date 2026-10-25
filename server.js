const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./server/config/config');

const authRoutes = require('./server/routes/authRoutes');
const mediaRoutes = require('./server/routes/mediaRoutes');

const app = express();

// Middlewares Globais
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log simples de requisições de API
app.use('/api', (req, res, next) => {
  console.log(`[API ${req.method}] ${req.originalUrl}`);
  next();
});

// Rotas da API REST
app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);

// Servidor de Arquivos Estáticos (Frontend MVC)
app.use(express.static(path.join(__dirname, 'public')));

// Fallback SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicialização
app.listen(config.PORT, () => {
  console.log(`========================================================`);
  console.log(`  ShowVault (Anime-Tracker) · Servidor MVC Ativo`);
  console.log(`  Acesse: http://localhost:${config.PORT}`);
  console.log(`  API REST: http://localhost:${config.PORT}/api/media/trending`);
  console.log(`========================================================`);
});
