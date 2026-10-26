# S08 · Funções prometidas e falsas

**Status:** em `Documentacao/status/S08.json` (`npm run status -- S08`) · **Gravidade:** média · **Depende de:** S03 (status por obra) · **Branch:** `feature/s08-funcoes-falsas`

## Por que importa
Há textos no README e elementos na interface que prometem algo que não existe, e valores inventados aparecem como se fossem dados reais.

## Problemas encontrados
- **Snapshots de notas:** `state.saveNote` guarda até 5 versões anteriores, mas nenhuma tela as mostra/restaura (README promete "restaure versões anteriores em 1 clique").
- **Markdown/spoiler:** a barra do editor (`detailModalView.js` ~50–69) só insere caracteres; o diário renderiza texto simples (`pre-wrap`, `diaryView.js` ~137). Nada renderiza negrito, itálico, citação ou spoiler.
- **Dados inventados:** sem dados do TVMaze, `vote_average` vira 8.0, gêneros `['Drama']`, status "Em Exibição", pôster/backdrop vira foto do Unsplash (`mediaService.js` ~107–113, ~184–189);
  views mostram 8.0 como fallback (`watchlistView.js`, `exploreView.js`).
- **Demo como se fosse seu:** o primeiro acesso mostra Breaking Bad, Attack on Titan etc. com episódios "assistidos" em 2026 e anotações; as obras do seed têm 1–3 episódios de enfeite
  (Breaking Bad: 3 episódios → 100% após 3 cliques).
- **Textos que vazam implementação ou enganam:** abas/botões "Explorar API"/"Pesquisar API"; subtítulo "TV Show Time Replica · MVC"; "Destaques da API (19)" (é o catálogo inteiro em ordem de inserção);
  selo "Sincronizado" fixo em `index.html` (~94); catálogo "PT-BR" mas obras ingeridas vêm em inglês.
- Rótulos de emoção divergentes: "Engraçado/Divertido", "Decepcionado/Ruim" em `diaryView.js` (~108–114) × `index.html` (~420–424) × `statsView.js`.
- Botão do Google que não é Google de verdade (resolvido na S04).

## Tarefas
- [ ] Decidir com o Gabriel, item a item: **implementar** (histórico de versões da nota; Markdown simples com spoiler) **ou remover** a promessa do README/interface.
- [ ] Tabela única de emoções (id, rótulo, ícone) usada por modal, diário e estatísticas.
- [ ] Remover valores inventados: mostrar "sem nota", "sem gênero", placeholder neutro de imagem (arquivo local, sem Unsplash).
- [ ] Estado inicial: lista vazia com chamada para explorar, ou demo claramente marcado como exemplo e removível em 1 clique; tirar datas/notas falsas.
- [ ] Renomear abas/botões ("Explorar", "Pesquisar"), título "Em alta/Catálogo", subtítulo da marca; selo de sync derivado do `syncService`.
- [ ] Tradução do que for possível (status "Running" → "Em exibição" etc.).
- [ ] Atualizar README para refletir exatamente o que existe.

## Decisões (já resolvidas — não pergunte de novo)
**Resolvidas:** D-19 (implementar histórico de versões da nota e Markdown simples com spoiler), D-22 (estado inicial vazio com “Carregar exemplo”; sem dados inventados).

## Critério de pronto
Nada na interface/README promete o que não existe; nenhum dado inventado é exibido como real; emoções consistentes em todas as telas.

## Fora de escopo
Calendário, importações e novas funcionalidades (ver backlog em `04-roadmap.md`).
