# ShowVault / Anime-Tracker · Rastreador Pessoal de Séries, Animes e Filmes

> **Engenharia Reversa & Réplica Pessoal Estilo TV Show Time (Blindado contra perda de dados).**

Este projeto foi construído para resolver definitivamente os problemas históricos de rastreadores (bugs de sincronização, anotações perdidas, instabilidade e encerramento de serviços).

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

### Configuração e testes

* **Variáveis de ambiente** (veja `.env.example`): `JWT_SECRET` assina os tokens de login. Sem ele o servidor usa um segredo de desenvolvimento (com aviso); com `NODE_ENV=production` ele é obrigatório. Para carregar um `.env`: `node --env-file=.env server.js`.
* **Sincronização:** com a conta logada, sua lista, episódios assistidos e anotações são enviados ao servidor (`server/data/libraries/<usuario>.json`, ignorado pelo Git) e mesclados no próximo login. O navegador continua sendo a fonte primária (local-first).
* **Testes:** `npm test`

---

## 🛠️ Recursos Implementados

1. **A Seguir (Next Up):**
   * Detecta automaticamente o próximo episódio ou filme a ser assistido da sua lista.
   * Marcação com 1 clique de assistido.
   * Acesso imediato ao diário de cada episódio.

2. **Diário de Episódios Blindado (Anti-Data-Loss):**
   * **Auto-Save contínuo (Debounce 350ms):** cada letra digitada é gravada instantaneamente no seu disco local.
   * **Histórico de Snapshots:** restaure versões anteriores em 1 clique.
   * **Reações estilo TV Time:** 😍 Adorei, 😂 Divertido, 😱 Chocado, 😢 Triste, 😡 Ruim.
   * **Personagem destaque:** registre quem roubou a cena no episódio.
   * **Suporte a Markdown:** negrito, itálico, citações e spoiler.

3. **Minhas Séries / Animes / Filmes (Watchlist):**
   * Filtros dinâmicos: *Todos*, *Em Andamento*, *Finalizados*, *Quero Ver*.
   * Barras de progresso com porcentagem e total de episódios assistidos.

4. **Estatísticas de Tempo de Vida:**
   * Cálculo exato baseado na duração (`runtime`) de cada obra assistida:
     * **Meses, Dias, Horas e Minutos** de tempo gasto.
     * Gráfico de distribuição de reações/emoções.
     * Top gêneros mais assistidos.

5. **Central de Backup & Exportação:**
   * **Exportar Base Completa (.JSON):** salve tudo no seu computador quando quiser.
   * **Importar / Restaurar (.JSON):** troque de computador ou navegador sem perder nada.
   * **Exportar Diário em Markdown (.MD):** exporte para Obsidian, Notion ou bloco de notas.

6. **Catálogo & Conexão Externa:**
   * Pré-carregado com catálogo verificado de séries, animes e filmes em PT-BR.
   * Ingestão sob demanda: busca externa em tempo real e auto-gravação local.
