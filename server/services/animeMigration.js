// Migração local das temporadas de anime (extras separados). Obras gravadas antes tratavam filme/OVA/ONA solta como "Temporada N".
// Funções puras, sem disco nem rede, idempotentes: `reclassifyWork` só acrescenta `category` e regrava nomes, nunca mexe em season_number.
const { reclassifyWork } = require('./animeSeasons');

// items -> { items (novos; os intactos são os MESMOS objetos), changed: [{id, name}] }
function migrateAnimeSeasons(items) {
  const changed = [];
  const out = (items || []).map(item => {
    if (!item || item.type !== 'anime') return item;
    const next = reclassifyWork(item);
    if (next === item) return item;
    changed.push({ id: item.id, name: item.name });
    return next;
  });
  return { items: changed.length ? out : items, changed };
}

module.exports = { migrateAnimeSeasons };
