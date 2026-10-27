// Content-Security-Policy do app (S10, D-S10-10). Sem 'unsafe-inline' em scripts nem em estilos:
// o HTML não tem onclick/onerror/style inline (a interação usa data-action, ver public/js/utils/actions.js).
//
// O que precisa estar liberado:
//  - Fontes do Google (folha de estilo em fonts.googleapis.com, arquivos em fonts.gstatic.com);
//  - Imagens de capa/episódio vindas das fontes do catálogo (TMDB, TVMaze, MyAnimeList...) e avatares: qualquer https
//    (e http, que em produção o `upgrade-insecure-requests` troca por https). Imagem não executa nada; o frontend ainda
//    filtra as URLs (`safeUrl`);
//  - Login com Google (opcional): script, iframe do botão, requisições e estilo vêm de accounts.google.com/gsi/.
function buildCspDirectives({ isProduction }) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
    styleSrc: ["'self'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'https:', 'http:'],
    connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
    frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    // Só com HTTPS em produção; em http://localhost isso quebraria as próprias imagens do desenvolvimento.
    ...(isProduction ? { upgradeInsecureRequests: [] } : {})
  };
}

module.exports = { buildCspDirectives };
