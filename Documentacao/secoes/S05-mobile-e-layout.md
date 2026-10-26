# S05 · Mobile e layout

**Status:** pendente · **Gravidade:** alta · **Depende de:** nada (S10 completa a limpeza de CSS inline) · **Branch:** `feature/s05-mobile-e-layout`

## Por que importa
Em 375×812 só a aba "A Seguir" aparece no menu (as outras ficam escondidas numa rolagem horizontal com barra minúscula) e o cabeçalho ocupa ~180 px. Boa parte do layout é
inline no HTML, então as media queries não conseguem ajustá-lo.

## Problemas encontrados (tour + auditoria)
- `public/css/layout.css` ~329–349: só 2 media queries (1024px e 768px), que mexem apenas em cabeçalho e padding.
- `public/index.html`: ~106 `style="..."` inline; grades de estatísticas com `grid-template-columns: 2fr 1fr 1fr 1fr` (~216) e `1fr 1fr` (~258) → overflow horizontal no celular;
  grade de 5 colunas das emoções (~419); cabeçalho do modal com pôster de 140 px; cartões do diário com imagem de 140 px (`diaryView.js` ~124).
- Navegação: abas em linha única com rolagem; logo + subtítulo "TV SHOW TIME REPLICA · MVC" ocupam 3 linhas.
- Modal de detalhes: título e sinopse sobre o backdrop sem gradiente suficiente → ilegível; o modal também corta o conteúdo em alturas pequenas.
- Sem `prefers-reduced-motion`; animação de entrada (fade) deixa a tela escura por ~1 s ao carregar.
- Textos de metadados em 0,72–0,78 rem.

## Tarefas
- [ ] Mover para classes CSS os estilos inline de grades/cabeçalhos citados e criar breakpoints reais (≤480, ≤768, ≤1024).
- [ ] Navegação móvel: barra de abas fixa na parte inferior (ícone + rótulo) ou menu que mostre todas as 5 abas; cabeçalho compacto (logo, entrar, sync).
- [ ] Estatísticas, diário, lista e explorar em 1–2 colunas no celular, sem rolagem horizontal.
- [ ] Modal de detalhes: gradiente sobre o backdrop, pôster menor/empilhado no celular, rolagem interna, botão de fechar alcançável com o polegar.
- [ ] Modal de anotação e de login/backup utilizáveis com teclado virtual aberto.
- [ ] `@media (prefers-reduced-motion: reduce)` desliga as animações; reduzir a animação inicial.
- [ ] Verificar em 360×740, 375×812, 768×1024 e desktop; nenhuma tela com `document.documentElement.scrollWidth > innerWidth`.

## Como verificar
Navegador do app: `resize_window` preset `mobile` (375×812) e `tablet`; percorrer as 5 abas, abrir modal de detalhes, de anotação e de login; capturar prints antes/depois e
rodar no console `document.documentElement.scrollWidth <= window.innerWidth`. Voltar o viewport para `desktop` ao terminar.

## Decisões pendentes
Nenhuma (se quiser alterar a identidade visual, perguntar ao Gabriel; por padrão manter tema escuro e amarelo atual).

## Critério de pronto
Todas as abas e modais usáveis no celular sem overflow horizontal e com texto legível; desktop continua igual ou melhor.

## Fora de escopo
Acessibilidade de teclado/ARIA (S07); limpeza total de CSS inline e remoção de `onclick` (S10).
