// Migração de imagens do catálogo de runtime (S18). Obras gravadas antes da S09 guardam como PÔSTER a imagem grande da fonte;
// o cartão só precisa do tamanho médio. Funções puras, idempotentes (rodar de novo não muda nada) e só mexem em `poster_path`
// (o fundo do modal, `backdrop_path`, continua grande).
//  - AniList:  /cover/extraLarge/  -> /cover/large/
//  - MyAnimeList (Jikan): .../123l.jpg -> .../123.jpg
//  - TMDB:     /t/p/original|w780|w1280/ -> /t/p/w500/
//  - TVMaze:   /original_untouched/ -> /medium_portrait/

function shrinkPosterUrl(url) {
  if (typeof url !== 'string' || !url) return url;
  let out = url;
  out = out.replace(/(\/cover\/)extraLarge\//, '$1large/');
  out = out.replace(/(cdn\.myanimelist\.net\/images\/(?:anime|manga)\/\d+\/\d+)l(\.(?:jpg|webp))/i, '$1$2');
  out = out.replace(/(image\.tmdb\.org\/t\/p\/)(?:original|w780|w1280)\//, '$1w500/');
  out = out.replace(/(static\.tvmaze\.com\/uploads\/images\/)original_untouched\//, '$1medium_portrait/');
  return out;
}

// Devolve { items, changed } com a lista nova (objetos alterados são cópias) e o número de obras que mudaram.
function migrateCatalogImages(items) {
  let changed = 0;
  const next = (items || []).map(item => {
    if (!item || typeof item.poster_path !== 'string') return item;
    const poster = shrinkPosterUrl(item.poster_path);
    if (poster === item.poster_path) return item;
    changed++;
    return { ...item, poster_path: poster };
  });
  return { items: next, changed };
}

module.exports = { shrinkPosterUrl, migrateCatalogImages };
