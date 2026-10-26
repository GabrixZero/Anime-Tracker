// Converte erros do backend em respostas JSON em português (sem vazar detalhes internos).
const { MediaError, DataCorruptionError } = require('./errors');

function sendError(res, err, fallbackMessage, logLabel) {
  if (err instanceof MediaError) {
    if (err.retryAfterSec) res.set('Retry-After', String(err.retryAfterSec));
    return res.status(err.httpStatus).json({ error: err.message, code: err.code });
  }
  if (err instanceof DataCorruptionError || (err && err.code === 'DATA_CORRUPT')) {
    console.error(`[${logLabel || 'dados'}] ${err.message}`);
    return res.status(503).json({ error: 'Os dados do servidor estão temporariamente indisponíveis. Avise o administrador.', code: 'DATA_CORRUPT' });
  }
  console.error(`[${logLabel || 'erro'}]`, err);
  return res.status(500).json({ error: fallbackMessage });
}

module.exports = { sendError };
