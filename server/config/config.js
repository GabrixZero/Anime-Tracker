const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_DIR: path.join(__dirname, '..', 'data'),
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',
  DEFAULT_LANGUAGE: 'pt-BR',
  JWT_SECRET: process.env.JWT_SECRET || 'showvault_tvtime_secret_key_2026'
};
