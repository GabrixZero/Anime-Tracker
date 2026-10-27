# ShowVault / Anime-Tracker · Rastreador Pessoal de Séries, Animes e Filmes

> Acompanhe séries, filmes e animes: progresso episódio por episódio, diário de anotações e estatísticas de tempo assistido.

Os dados ficam no seu navegador (e, se você criar uma conta, também numa cópia no servidor para usar em vários aparelhos). O primeiro acesso começa com a lista **vazia**: explore o catálogo, ou use "Carregar exemplo" para ver o app com alguns títulos (sem progresso nem anotações de mentira).

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

2. **Diário de Episódios e Filmes:**
   * **Salvamento automático:** o texto é gravado neste aparelho (e enviado à conta, se você estiver conectado) logo depois que você para de digitar (~0,35 s).
   * **Histórico de versões:** o botão **Histórico (n)** do editor lista até 5 versões anteriores do texto, da mais nova para a mais antiga. **Restaurar** troca o texto em 1 clique e guarda o texto que estava valendo como uma versão nova (nada se perde; só a mais antiga sai quando passa de 5). Uma versão nova é criada quando você volta a editar uma anotação que ficou parada por 10 minutos ou mais (digitar seguido não enche o histórico). O histórico guarda o **texto**; reação e personagem não entram nas versões.
   * **Markdown simples:** `**negrito**`, `*itálico*`, `***os dois***`, `> citação` (linha começando com `> `) e `>!spoiler!<` (escondido no diário até você clicar ou apertar Enter/Espaço). A barra do editor insere essas marcas. Não existe HTML, link nem imagem: qualquer `<tag>` que você escreva aparece como texto.
   * **Reações:** 😍 Adorei, 😂 Divertido, 😱 Chocado, 😢 Triste, 😡 Decepcionado (os mesmos nomes no editor, no diário e nas estatísticas).
   * **Personagem ou destaque:** campo livre para registrar quem roubou a cena.

3. **Minha Lista:**
   * Status por obra: *Assistindo*, *Quero ver*, *Pausado*, *Finalizado* e *Desisti* (muda sozinho ao marcar episódios).
   * Filtros por status e por tipo (séries, animes, filmes); barra de progresso com o total de episódios assistidos.

4. **Estatísticas:**
   * Tempo assistido em meses, dias, horas e minutos: é uma **estimativa** (soma a duração informada de cada episódio/filme; quando a fonte não informa, conta 45 min por episódio e 120 min por filme).
   * Distribuição de reações, top gêneros e obras finalizadas.

5. **Backup e dados:**
   * **Baixar `.json`** com toda a sua biblioteca e **restaurar** em outro navegador ou computador.
   * **Exportar o diário em Markdown (`.md`)** para guardar fora do app (as marcas de spoiler saem como `>!texto!<`).
   * **Resetar** apaga os dados deste aparelho (e, se você confirmar, a cópia da conta).

6. **Catálogo e busca:**
   * Catálogo inicial com 16 séries, animes e filmes (os de série/anime trazem poucos episódios de amostra) e busca no TVMaze para ampliar; adicionar uma obra nova à lista exige estar conectado.
   * O que a fonte não informa aparece como **"Sem nota"**, **"Sem gênero"** ou uma imagem neutra, nunca como um valor de enfeite.
