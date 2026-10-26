const path = require('path');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_JWT_SECRET = 'showvault_dev_only_secret_change_me';

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET é obrigatório quando NODE_ENV=production.');
}
if (!process.env.JWT_SECRET) {
  console.warn('[config] JWT_SECRET não definido: usando segredo de desenvolvimento. Defina JWT_SECRET no ambiente.');
}

module.exports = {
  PORT: process.env.PORT || 3000,
  IS_PRODUCTION,
  DATA_DIR: path.join(__dirname, '..', 'data'),
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',
  DEFAULT_LANGUAGE: 'pt-BR',
  JWT_SECRET: process.env.JWT_SECRET || DEV_JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d'
};
