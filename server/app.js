// Monta o app Express (sem abrir porta), para o servidor real e para os testes de rotas.
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// Middlewares Globais
app.use(cors());
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
app.use('/api/user', userRoutes);

// Rotas /api desconhecidas respondem JSON (não o index.html do fallback SPA)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Servidor de Arquivos Estáticos (Frontend MVC)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Erros não tratados (ex.: JSON malformado ou corpo grande demais)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Erro não tratado:', err);
  res.status(status).json({ error: status >= 500 ? 'Erro interno do servidor.' : 'Requisição inválida.' });
});

module.exports = app;
