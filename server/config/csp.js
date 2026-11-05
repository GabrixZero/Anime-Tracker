// Content-Security-Policy do app (S10, D-S10-10). Sem 'unsafe-inline' em scripts nem em estilos:
// o HTML não tem onclick/onerror/style inline (a interação usa data-action, ver public/js/utils/actions.js).
//
// O que precisa estar liberado:
//  - Fontes do Google (folha de estilo em fonts.googleapis.com, arquivos em fonts.gstatic.com);
//  - Imagens de capa/episódio vindas das fontes do catálogo (TMDB, TVMaze, MyAnimeList...) e avatares: qualquer https
//    (e http, que em produção o `upgrade-insecure-requests` troca por https). Imagem não executa nada; o frontend ainda
//    filtra as URLs (`safeUrl`);
//  - Foto de perfil: a imagem só é entregue a quem tem o token, então o front a baixa com fetch e a mostra por blob: (mesma origem);
//  - Login com Google (opcional): script, iframe do botão, requisições e estilo vêm de accounts.google.com/gsi/.
function buildCspDirectives({ isProduction, googleEnabled = false }) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
    // O botão do Google (GSI) injeta um <style> e atributos style no próprio botão (testado: sem isso ele aparece sem estilo, com o
    // logotipo gigante). Por isso, SÓ quando GOOGLE_CLIENT_ID está configurado, estilos inline são aceitos (scripts continuam estritos).
    // Sem o login Google a política não tem nenhum inline, nem de estilo.
    styleSrc: [
      "'self'",
      'https://fonts.googleapis.com',
      'https://accounts.google.com/gsi/style',
      ...(googleEnabled ? ["'unsafe-inline'"] : [])
    ],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'], // blob: = foto de perfil (buscada com token e exibida via URL.createObjectURL)
    connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
    frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
    workerSrc: ["'self'"], // service worker do modo offline (S18)
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    // Só com HTTPS em produção; em http://localhost isso quebraria as próprias imagens do desenvolvimento.
    ...(isProduction ? { upgradeInsecureRequests: [] } : {})
  };
}

module.exports = { buildCspDirectives };
