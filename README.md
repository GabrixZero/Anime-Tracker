# ShowVault · Rastreador Pessoal de Séries (TV Time Replica)

> **Engenharia Reversa & Réplica Pessoal Blindada contra perda de dados.**

Este projeto foi construído para resolver definitivamente os problemas históricos do TV Time (bugs de sincronização, anotações perdidas, instabilidade e encerramento de serviços).

---

## ⚡ Como Rodar o Projeto

1. **Opção 1 (Direto pelo Windows):**
   * Dê um duplo-clique no arquivo `iniciar.bat`.
   * Ele abrirá seu navegador padrão automaticamente em `http://localhost:3000`.

2. **Opção 2 (Via Terminal):**
   ```bash
   node server.js
   ```
   * Acesse `http://localhost:3000` no seu navegador.

---

## 🛠️ Recursos Implementados

1. **A Seguir (Next Up):**
   * Detecta automaticamente o próximo episódio a ser assistido de cada série que você acompanha.
   * Marcação com 1 clique.
   * Acesso imediato ao diário de cada episódio.

2. **Diário de Episódios Blindado (Anti-Data-Loss):**
   * **Auto-Save contínuo (Debounce 350ms):** cada letra digitada é gravada instantaneamente no seu disco local (`localStorage` / `IndexedDB`).
   * **Histórico de Snapshots:** se você apagar um texto sem querer, pode restaurar versões anteriores em 1 clique.
   * **Reações estilo TV Time:** 😍 Adorei, 😂 Divertido, 😱 Chocado, 😢 Triste, 😡 Ruim.
   * **Personagem destaque:** registre quem roubou a cena no episódio.
   * **Suporte a Markdown:** negrito, itálico, citações e tags de spoiler (`>!spoiler!<`).

3. **Minhas Séries (Watchlist):**
   * Filtros dinâmicos: *Todas*, *Em Andamento*, *Finalizadas*, *Quero Ver*.
   * Barras de progresso com porcentagem e total de episódios assistidos.

4. **Estatísticas de Tempo de Vida:**
   * Cálculo exato baseado na duração (`runtime`) de cada episódio assistido:
     * **Meses, Dias, Horas e Minutos** de tempo gasto.
     * Gráfico de distribuição de reações/emoções.
     * Top gêneros mais assistidos.

5. **Central de Backup & Exportação:**
   * **Exportar Base Completa (.JSON):** salve tudo no seu computador quando quiser.
   * **Importar / Restaurar (.JSON):** troque de computador ou navegador sem perder nada.
   * **Exportar Diário em Markdown (.MD):** gere um arquivo legível com todas as suas anotações para abrir no Obsidian, Notion ou bloco de notas.

6. **Catálogo & Conexão com TMDB:**
   * Já vem pré-carregado com 6 séries renomadas (*Breaking Bad*, *The Bear*, *Ruptura*, *Stranger Things*, *Arcane*, *The Last of Us*) com episódios, temporadas e sinopses em PT-BR.
   * Suporte nas **Configurações** para adicionar sua chave gratuita da TMDB (`themoviedb.org`) e pesquisar qualquer série do planeta ao vivo.
