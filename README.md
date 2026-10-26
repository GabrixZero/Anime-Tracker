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

* **Variáveis de ambiente** (veja `.env.example`; para carregar um `.env`: `node --env-file=.env server.js`):
  * `JWT_SECRET` assina os tokens de login. Em desenvolvimento pode ficar vazio: o servidor gera um segredo único na primeira execução e o guarda em `server/data/jwt.secret` (ignorado pelo Git; não apague, ou todo mundo precisará entrar de novo). Com `NODE_ENV=production` ele é **obrigatório** (mínimo 32 caracteres aleatórios) e o servidor não sobe sem ele.
  * `GOOGLE_CLIENT_ID` liga o login com Google (veja abaixo). Sem ele o botão do Google não aparece.
  * `CORS_ORIGINS` (lista separada por vírgula) libera outros sites para chamar a API; vazio = só o próprio site. `TRUST_PROXY` (ex.: `1`) é necessário atrás de proxy/hospedagem para o limite de tentativas enxergar o IP real.
  * `SEED_DEMO_USER=1` cria a conta de demonstração do `users.example.json` (ignorado em produção). Por padrão **ninguém** vem cadastrado.
* **Contas:** cadastro e login por e-mail e senha (senha de 8 a 128 caracteres, guardada só como hash scrypt). Tentativas erradas de login são limitadas (10 por e-mail/IP em 15 min) e o cadastro também (20 por hora por IP). A API tem rotas para trocar a senha (`POST /api/auth/change-password`) e excluir a conta e a biblioteca (`DELETE /api/auth/account`), ambas pedindo a senha.

#### Login com Google (opcional) — passo a passo para criar o Client ID

O app já traz o login com Google pronto (Google Identity Services no navegador + validação do token no servidor). Falta só você criar o "Client ID" gratuito:

1. Acesse https://console.cloud.google.com/ e crie um projeto (ex.: "ShowVault").
2. Menu **APIs e serviços → Tela de permissão OAuth**: escolha "Externo", preencha nome do app e seu e-mail, salve (o modo "Teste" basta; adicione seu e-mail como usuário de teste).
3. Menu **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas** adicione `http://localhost:3000` (e, quando publicar, o endereço do site). Não precisa de "URI de redirecionamento".
5. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e coloque no `.env`: `GOOGLE_CLIENT_ID=...`. O ID do cliente **não é segredo**; nunca é preciso o "segredo do cliente".
6. Reinicie o servidor (`node --env-file=.env server.js`): o botão "Continuar com Google" aparece no cadastro/login.

Observação: contas Google nunca são fundidas automaticamente com uma conta de e-mail/senha que já use o mesmo e-mail.
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
