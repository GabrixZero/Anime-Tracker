# ShowVault / Anime-Tracker · Rastreador Pessoal de Séries, Animes e Filmes

> Acompanhe séries, filmes e animes: progresso episódio por episódio, diário de anotações e estatísticas de tempo assistido.

Os dados ficam no seu navegador (e, se você criar uma conta, também numa cópia no servidor para usar em vários aparelhos). O primeiro acesso começa com a lista **vazia**: explore o catálogo, ou use "Carregar exemplo" para ver o app com alguns títulos (sem progresso nem anotações de mentira).

Stack: Node.js + Express (API REST) e HTML/CSS/JavaScript puro no navegador (sem framework e sem etapa de build). Interface em português do Brasil.

---

## Requisitos

* **Node.js 26 ou mais novo** (o projeto usa o módulo `node:sqlite`, embutido no Node; `.nvmrc` indica a versão). Baixe em https://nodejs.org.
* Git, só se for mexer no código.
* Docker é opcional (para publicar; veja "Publicar").

## Instalação e uso rápido

```bash
npm install          # uma vez (baixa as dependências)
npm start            # sobe em http://localhost:3000
```

* **Windows:** dê um duplo-clique em `iniciar.bat`. Ele instala as dependências na primeira vez, lê a porta do `.env` (ou usa 3000), espera o servidor ficar pronto e só então abre o navegador.
* **Outra porta:** `PORT=3055 npm start` (no PowerShell: `$env:PORT=3055; npm start`).
* **Com arquivo `.env`:** copie `.env.example` para `.env`, ajuste e use `npm run start:env` (equivale a `node --env-file=.env server.js`). O `.env` **nunca** vai para o Git.
* **Testes e qualidade:** `npm test` · `npm run lint` · `npm run format:check` · testes com navegador: `npm run test:e2e:install` (uma vez) e `npm run test:e2e` (veja "Qualidade e testes").

---

## Configuração (variáveis de ambiente)

Todas são opcionais em desenvolvimento. O modelo comentado está em `.env.example`.

| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | porta do servidor | `3000` |
| `NODE_ENV` | `production` liga as proteções de produção (HSTS e `JWT_SECRET` obrigatório) | vazio |
| `JWT_SECRET` | segredo que assina os tokens de login. **Obrigatório em produção** (32+ caracteres aleatórios; o servidor não sobe sem ele). Fora de produção, se vazio, o servidor gera um segredo único em `server/data/jwt.secret` (ignorado pelo Git; apagar = todo mundo entra de novo). Gere um com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | gerado |
| `JWT_EXPIRES_IN` | validade do login | `7d` |
| `STORAGE` | onde ficam usuários, bibliotecas e catálogo: `json` (arquivos) ou `sqlite` (um arquivo só) | `json` |
| `SHOWVAULT_DATA_DIR` | pasta dos dados (e do arquivo SQLite). Em hospedagem, aponte para um **volume persistente** | `server/data` |
| `HOST` | endereço em que o servidor escuta (só o endereço, sem porta). Vazio: em **produção** `127.0.0.1` (só o próprio computador; é o que o Tailscale Funnel precisa) e, fora dela, todas as interfaces. Docker/hospedagem: `0.0.0.0` (a imagem já define) | vazio |
| `TRUST_PROXY` | atrás de proxy/hospedagem: quantos proxies confiar (em geral `1`; com o Tailscale Funnel é `1`), para o limite de tentativas enxergar o IP real. Nunca `true` | vazio |
| `SHOWVAULT_BACKUP_DIR` | pasta dos backups do banco (`npm run backup`); vazio = `OneDrive\Documentos\ShowVault-Backups` quando há OneDrive | vazio |
| `CORS_ORIGINS` | outros sites autorizados a chamar a API (lista separada por vírgula); vazio = só o próprio site | vazio |
| `GOOGLE_CLIENT_ID` | liga o login com Google (veja abaixo); sem ele o botão não aparece | vazio |
| `TMDB_API_KEY` | liga a busca de filmes e séries do TMDB em português (chave grátis em themoviedb.org); sem ela o app usa o catálogo local, TVMaze (séries) e AniList/Jikan (animes) | vazio |
| `SEED_DEMO_USER` | `1` cria a conta de demonstração (ignorado em produção) | desligado |
| `AUTH_*` | ajustam os limites de tentativas de login/cadastro (`AUTH_LOGIN_MAX`, `AUTH_REGISTER_MAX`, ...; veja `server/config/config.js`) | veja o código |
| `JIKAN_BASE_URL`, `ANILIST_BASE_URL`, `TVMAZE_BASE_URL`, `TMDB_BASE_URL` | só para testes/desenvolvimento (apontam para uma fonte falsa; os testes E2E usam as quatro) | APIs oficiais |
| `MEDIA_AIRING_TTL_HOURS`, `MEDIA_REFRESH_INTERVAL_MIN` | animes e séries "Em Exibição" buscam episódios novos sozinhos: validade da obra em horas e intervalo da conferência em minutos (0 desliga) | 6 h · 30 min |

### Armazenamento: arquivos JSON ou SQLite

* `STORAGE=json` (padrão): `server/data/users.json`, `server/data/libraries/<usuario>.json` e `server/data/mediaCatalog.runtime.json`. Gravação atômica, com cópia `.bak` da última versão válida. Bom para uso local.
* `STORAGE=sqlite`: tudo isso vira **um único arquivo** `showvault.sqlite` dentro de `SHOWVAULT_DATA_DIR` (modo WAL, via `node:sqlite`, sem dependência nativa). É o modo da imagem Docker. Use **uma instância do servidor por arquivo**.
* **Migração automática:** ao subir com `STORAGE=sqlite` numa pasta que ainda tem os JSON, o servidor importa tudo **uma única vez**, depois de copiar os arquivos para `backup-pre-sqlite-<data>/` dentro da pasta de dados. Os JSON originais **não são apagados**. Dá para rodar à mão: `npm run storage:migrate`.
* **Migrar de outra pasta:** `npm run storage:migrate -- --from <pasta-com-os-JSON> [--dry-run]` lê os JSON de OUTRA pasta (ex.: `server\data` do projeto, com o banco indo para `%LOCALAPPDATA%\ShowVault\data`); `--dry-run` só mostra o que seria importado, sem gravar nada. Nunca sobrescreve o que o banco já tem.
* **Voltar para arquivos:** `npm run storage:export -- <pasta-nova>` grava o conteúdo do banco como JSON (use essa pasta como `SHOWVAULT_DATA_DIR` com `STORAGE=json`).
* **Backup do SQLite:** `npm run backup` faz uma foto consistente do banco (`VACUUM INTO`, pode rodar com o servidor ligado; nunca se copia o arquivo aberto), confere e guarda em `SHOWVAULT_BACKUP_DIR` com rotação (7 diários + 4 semanais). Restaurar: `npm run restore` (lista), `npm run restore -- ultimo --dry-run` (só confere) e `npm run restore -- ultimo` (pede confirmação, guarda uma cópia do banco atual e recusa com o app ligado). No Docker, faça backup do volume.

---

## Rodar no seu PC (Windows) e publicar com o Tailscale Funnel

É o jeito gratuito escolhido para o dono e ~10 amigos (D-29): o app roda no seu PC em modo produção (SQLite, escutando só em `127.0.0.1`), sobe sozinho quando você entra no Windows e o **Tailscale Funnel** publica um link `https://<máquina>.<rede>.ts.net`. Os dados ficam fora do OneDrive e os backups diários dentro dele.

```powershell
npm run setup:pc                      # completa o .env do modo PC (nunca sobrescreve; gera o segredo sem mostrá-lo)
npm run storage:migrate -- --from server\data --dry-run   # simulação; depois sem --dry-run
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\install-autostart.ps1 -StartNow
tailscale funnel --bg 3000            # depois de instalar o Tailscale e ligar o HTTPS no painel
```

Passo a passo completo (Tailscale, energia, backups, restauração, atualização, como desligar tudo e segurança): **[Documentacao/deploy-pc-tailscale.md](Documentacao/deploy-pc-tailscale.md)**. Scripts em `scripts/windows/` (`install-autostart`, `uninstall-autostart`, `start-showvault`, `status`, `update`, `backup-showvault`). Não compartilhe o link antes da seção S14 (cadastro por convite). Depois do `setup:pc`, para ligar à mão use `npm run start:env` (ou o `iniciar.bat`): o `npm start` **não lê o `.env`** e subiria em modo de desenvolvimento, com os dados em `server/data`.

---

## Publicar (Docker)

O projeto vem **preparado**, mas não publicado em nenhuma hospedagem (a escolha é sua). Você precisa de qualquer lugar que rode contêineres e ofereça um **volume persistente** (disco que sobrevive a reinícios).

```bash
docker build -t showvault .
docker run -d --name showvault -p 3000:3000 \
  -v showvault-data:/data \
  -e JWT_SECRET=<segredo longo e aleatorio> \
  -e TRUST_PROXY=1 \
  showvault
```

Ou com o Compose: copie `docker-compose.example.yml` para `docker-compose.yml`, crie um `.env` com `JWT_SECRET=...` e rode `docker compose up -d --build`.

* A imagem usa `NODE_ENV=production`, `HOST=0.0.0.0` (dentro do contêiner o servidor precisa escutar em tudo; fora do Docker, em produção, o padrão é `127.0.0.1`), `STORAGE=sqlite`, dados em `/data` e roda sem root.
* **Verificação de saúde:** `GET /health` responde `{"status":"ok","storage":"sqlite","uptimeSec":...}` sem login (a imagem já traz o `HEALTHCHECK`; hospedagens costumam pedir esse caminho).
* **HTTPS:** a hospedagem normalmente termina o HTTPS; informe `TRUST_PROXY=1`.
* Sem plano gratuito com disco persistente, o SQLite perde os dados a cada reinício: escolha uma hospedagem com volume.
* Passo a passo e checklist de segurança: `Documentacao/01-visao-geral-e-arquitetura.md`.

---

## API REST

Tudo em JSON. Erros vêm como `{ "error": "mensagem em português" }`. Rotas marcadas com **login** exigem `Authorization: Bearer <token>`.

| Método e caminho | Login? | O que faz |
|---|---|---|
| `GET /health` | não | estado do servidor (para hospedagem/Docker) |
| `GET /api/auth/config` | não | `{googleClientId}` (ou `null`) |
| `POST /api/auth/register` | não | cadastro `{email, password, name?, avatar?}` → `{user, token}`; 400 entrada inválida, 409 e-mail já usado, 429 muitas tentativas |
| `POST /api/auth/login` | não | `{email, password}` → `{user, token}`; 401 para qualquer credencial errada |
| `POST /api/auth/google` | não | `{credential}` (ID token do Google); 501 se `GOOGLE_CLIENT_ID` não estiver configurado |
| `GET /api/auth/me` | sim | dados da conta |
| `POST /api/auth/change-password` | sim | `{currentPassword, newPassword}` → novo token (os antigos deixam de valer) |
| `DELETE /api/auth/account` | sim | exclui a conta e a biblioteca (pede a senha) |
| `GET /api/media/trending?type=` | não | catálogo local; `type` = `all`, `tv`, `anime` ou `movie` |
| `GET /api/media/search?q=&type=` | não | busca combinada (local, AniList → Jikan de reserva, TVMaze, TMDB) → `{count, data, warnings}`; 60 por minuto por IP |
| `GET /api/media/:id` | só se for obra nova | detalhes (público se já está no catálogo; ingestão exige login) |
| `POST /api/media/ingest` | sim | `{id}` traz a obra de uma fonte externa para o catálogo (30 por 10 min por usuário) |
| `POST /api/media/:id/refresh` | sim | busca episódios novos de uma obra em exibição (respeita a validade; `?force=1` no máximo a cada 10 min) → `{refreshed, newEpisodes, data}` |
| `GET /api/user/library` | sim | biblioteca da conta |
| `PUT /api/user/library` | sim | `{data, stateVersion}` envia a biblioteca; o servidor **mescla** e devolve o resultado |
| `DELETE /api/user/library` | sim | zera a biblioteca da conta (os outros aparelhos zeram ao sincronizar) |

---

## Estrutura do projeto

```
server.js                 abre a porta (e migra JSON -> SQLite se STORAGE=sqlite)
server/
  app.js                  monta o Express (helmet, CORS, rotas, /health, estáticos)
  config/                 variáveis de ambiente e segredo JWT
  routes/ controllers/    rotas e controladores (auth, media, user)
  middleware/             login (JWT) e limites de tentativas
  models/                 UserModel e LibraryModel (usuários e bibliotecas)
  services/               catálogo e busca (mediaService), AniList, Jikan, TMDB, Google, exclusão de conta
  storage/                adaptador de armazenamento: arquivos JSON ou SQLite, migração
  utils/                  validação, sanitização, ids, cache, jsonStore
  data/                   seed do catálogo (versionado); dados reais ficam fora do Git
public/                   o app no navegador (index.html, css/, js/, img/)
tests/                    testes automáticos rápidos (node --test); tests/e2e/ = testes ponta a ponta com navegador (Playwright)
playwright.config.js      configuração dos testes E2E (desktop e celular)
scripts/                  status das sessões (status.js), armazenamento (storage.js), modo PC (setup-pc.js, backup.js, restore.js), windows/*.ps1 e e2e.js (roda o Playwright)
Documentacao/             memória do projeto: arquitetura, decisões, diário, roadmap
```

Detalhes de cada arquivo: `Documentacao/01-visao-geral-e-arquitetura.md`.

---

## Qualidade e testes

* `npm test` roda todos os testes (`node --test`). Eles usam pastas temporárias e **nunca** tocam em `server/data` real nem acessam a internet.
* `npm run lint` (ESLint) deve terminar sem **erros**; avisos são toleráveis. `npm run lint:fix` corrige o que for automático.
* `npm run format:check` / `npm run format` (Prettier) valem para os arquivos novos da S10; o restante do código será formatado depois que as sessões paralelas terminarem.
* **CI (GitHub Actions)**, `.github/workflows/ci.yml`: a cada push e em todo PR para `main`/`develop` roda `npm ci`, lint, formatação e testes (Node 26), faz o build da imagem Docker com um teste de `/health` e roda os **testes ponta a ponta** (job `e2e`, abaixo).
* Os workflows `auto-pr-*` abrem sozinhos os PRs de `feature/*` para `develop` e de `develop` para `main`.

### Testes ponta a ponta (E2E): o app de verdade num navegador (S12)

Um robô (Playwright + Chromium) abre o ShowVault como uma pessoa abriria e clica, digita e navega pelo teclado, em **desktop (1280×800)** e **celular (375×812)**: primeira visita e "Carregar exemplo"/"Remover exemplo", cadastro e login, marcar episódios, status por obra, anotações com Markdown/spoiler e histórico, Explorar (busca, adicionar, "Mostrar mais"), backup, sair isolando contas e **sincronização entre dois aparelhos**. Além dos fluxos, todo teste falha se o navegador mostrar erro de console, violação da CSP ou tentar usar a internet, e há conferências de largura em 375 px, de teclado, de acessibilidade (axe-core) e do botão do Google.

```bash
npm run test:e2e:install   # UMA vez por instalação: baixa o Chromium (~440 MB) para dentro de node_modules
npm run test:e2e           # roda tudo (≈ 1 minuto), sem janela
npm run test:e2e:headed    # vendo o navegador trabalhar
npm run test:e2e:ui        # modo interativo: escolher/repetir testes, linha do tempo, antes/depois de cada passo
npm run test:e2e:report    # abre o relatório HTML da última execução (playwright-report/)
npm run test:e2e -- --project=mobile                         # só o celular (ou --project=desktop)
npm run test:e2e -- tests/e2e/05-conta.spec.js -g "isola"   # um arquivo / testes pelo nome
```

* **Não precisa de nada ligado:** os testes sobem o próprio servidor na porta **3012** (`E2E_PORT` troca) com uma pasta de dados **temporária** (apagada no fim) e um servidor falso no lugar do TVMaze, AniList, Jikan e TMDB (`TVMAZE_BASE_URL`, `ANILIST_BASE_URL`, `JIKAN_BASE_URL`, `TMDB_BASE_URL`). Não tocam em `server/data`, não usam a internet e não mexem no ShowVault da porta 3000.
* **Outras opções:** `E2E_STORAGE=sqlite` roda no armazenamento de produção; `E2E_WORKERS=1` roda um teste por vez (útil para depurar); `E2E_AXE_VERBOSE=1` mostra tudo que o axe-core achou, inclusive o leve.
* **Quando um teste falha:** o terminal diz qual passo e o que esperava; `test-results/<teste>/` guarda a captura de tela, o `trace.zip` (`npx playwright show-trace <arquivo>`: linha do tempo com a página, a rede e o console em cada passo) e `servidor-e2e.log` (o que o servidor de teste escreveu). Essas pastas não vão para o Git.
* **Onde está cada coisa:** `playwright.config.js` (projetos, tempos) · `tests/e2e/*.spec.js` (os testes, em ordem de história) · `tests/e2e/support/` (subida do servidor, guarda de erros, atalhos) · `tests/e2e/fake-sources/` (as fontes falsas e seus dados fictícios) · `scripts/e2e.js` (guarda o navegador dentro do projeto). Decisões em `Documentacao/02-decisoes.md` (D-S12-1 a D-S12-8).
* **No CI:** o job `e2e` roda tudo duas vezes (arquivos JSON e SQLite), com o Chromium em cache; relatório e `trace.zip` só são guardados (7 dias) quando algo falha.
* `npm test` continua só com os testes rápidos (sem navegador).

## Fluxo de branches

`main` = versão publicada · `develop` = integração · `feature/sNN-...` = uma seção do roadmap por vez. Cada trabalho nasce de `develop`, é enviado com `git push -u origin feature/...` (use `push-github.bat` para enviar a branch atual) e chega a `develop` e depois a `main` por merge, **sem force push**. O protocolo completo está em `Documentacao/03-protocolo-de-sessao.md`.

---

## Configuração e contas

* **Contas:** cadastro e login por e-mail e senha (8 a 128 caracteres, guardada só como hash scrypt). Tentativas erradas de login são limitadas (10 por e-mail/IP em 15 min) e o cadastro também (20 por hora por IP). A API tem rotas para trocar a senha e excluir a conta e a biblioteca, ambas pedindo a senha (ainda sem tela no app).
* **Sincronização:** com a conta logada, sua lista, episódios assistidos e anotações são enviados ao servidor (`libraries/<usuario>.json` ou o banco SQLite; nunca vão para o Git) e mesclados no próximo login. O navegador continua sendo a fonte primária (local-first); remoções se propagam entre aparelhos.
* **Segurança:** o servidor usa `helmet` e CORS restrito; o texto vindo do catálogo/usuário é escapado antes de ir para a tela; o log de requisições mostra só método e endereço (nunca corpo, senha ou token). A **Content-Security-Policy** é estrita: scripts só de arquivos do próprio site (e do Google, se o login Google estiver ligado), sem `onclick`/`style` inline no HTML (a interação usa `data-action`, veja `public/js/utils/actions.js`). Só com `GOOGLE_CLIENT_ID` configurado a política aceita estilos inline, porque o botão do Google os injeta (scripts continuam estritos). A lista do que é liberado fica em `server/config/csp.js`.

### Login com Google (opcional) — passo a passo para criar o Client ID

O app já traz o login com Google pronto (Google Identity Services no navegador + validação do token no servidor). Falta só você criar o "Client ID" gratuito:

1. Acesse https://console.cloud.google.com/ e crie um projeto (ex.: "ShowVault").
2. Menu **APIs e serviços → Tela de permissão OAuth**: escolha "Externo", preencha nome do app e seu e-mail, salve (o modo "Teste" basta; adicione seu e-mail como usuário de teste).
3. Menu **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas** adicione `http://localhost:3000` (e, quando publicar, o endereço do site). Não precisa de "URI de redirecionamento".
5. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e coloque no `.env`: `GOOGLE_CLIENT_ID=...`. O ID do cliente **não é segredo**; nunca é preciso o "segredo do cliente".
6. Reinicie o servidor (`npm run start:env`): o botão "Continuar com Google" aparece no cadastro/login.

Observação: contas Google nunca são fundidas automaticamente com uma conta de e-mail/senha que já use o mesmo e-mail.

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
   * Catálogo inicial com 16 séries, animes e filmes (os de série/anime trazem poucos episódios de amostra), busca no TVMaze, na AniList (animes; a Jikan/MyAnimeList é a reserva) e, com `TMDB_API_KEY`, no TMDB; adicionar uma obra nova à lista exige estar conectado.
   * Animes aparecem agrupados por franquia (uma obra, várias temporadas). A AniList não tem o título de cada episódio: aparece "Episódio N" (a Jikan completa os títulos quando está no ar).
   * Na Minha Lista, **Remover exemplo** tira de uma vez os títulos do "Carregar exemplo" que você ainda não usou.
   * O que a fonte não informa aparece como **"Sem nota"**, **"Sem gênero"** ou uma imagem neutra, nunca como um valor de enfeite.
