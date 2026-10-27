# Guia: o ShowVault no seu PC, publicado pelo Tailscale (S11)

Este guia é para o **Gabriel**. Ele leva o ShowVault do "abro e uso no meu PC" para "roda sozinho no PC e tem um link na internet", sem pagar nada
(decisão D-29). Cada passo diz **o que você digita** e **o que deve aparecer**. Se algo não bater, vá para "Problemas comuns" no fim.

## Como funciona (em 6 linhas)

```
amigo (celular/PC)  --https-->  link fixo  https://<máquina>.<rede>.ts.net   (o Tailscale Funnel)
                                    |
                      seu PC (ligado e acordado)
                                    |  só por dentro do PC
                          ShowVault em  http://127.0.0.1:3000
                                    |
        dados: %LOCALAPPDATA%\ShowVault\data      backups: OneDrive\Documentos\ShowVault-Backups
```

- O app **só escuta dentro do seu PC** (`127.0.0.1`): ninguém da sua rede Wi-Fi o alcança direto. O único caminho de fora é o Funnel.
- Os **dados ao vivo ficam fora do OneDrive** (o OneDrive pode travar ou estragar um banco em uso). Os **backups ficam dentro do OneDrive** (cópia fora do PC).
- Só funciona com o **PC ligado, acordado e com você logado no Windows**. Se o PC dormir ou desligar, o link para de responder (nada se perde).
- **Não mande o link para ninguém antes da seção S14** (cadastro por convite). Hoje qualquer pessoa que descobrir o endereço poderia criar uma conta. Veja "Quando compartilhar".

## Antes de começar

- [ ] Node.js 26+ e Git instalados (você já usa). Teste: `node --version` mostra `v26...`.
- [ ] A sessão principal avisou que a **S11 chegou ao `main`**.
- [ ] Você tem a conta do Gabriel no ShowVault hoje em `server\data` (modo antigo, arquivos JSON). Vamos copiar tudo para o banco novo **sem apagar nada do antigo**.
- [ ] A pasta do projeto está **sempre disponível neste PC**: no Explorador de Arquivos, clique com o botão direito em `Antigravity Projeto` → *Manter sempre neste dispositivo*
      (senão o OneDrive pode deixar os arquivos "só na nuvem" e o app não conseguir ligar sem internet).
- [ ] Uns 30 minutos. Os comandos abaixo rodam no **PowerShell, dentro da pasta do projeto**: no Explorador de Arquivos abra
      `...\OneDrive\Documentos\Antigravity Projeto`, clique na barra de endereços, digite `powershell` e aperte Enter.

---

## Parte 1 — Preparar o app neste PC

### 1.1 Feche o ShowVault antigo

Se há uma janela preta do `iniciar.bat` (ou do `npm start`) aberta, **feche-a**. Dois ShowVaults não podem usar a mesma porta.

### 1.2 Traga o código novo

```powershell
git checkout main
git pull
npm install
```

(O `git pull` só avança; se reclamar de alterações suas não salvas, pare e chame a sessão principal.)

### 1.3 Gere a configuração do modo PC

```powershell
npm run setup:pc
```

Ele **cria ou completa** o arquivo `.env` (sem apagar nada que você já tem, como o `GOOGLE_CLIENT_ID`), gera um segredo forte para os logins (**ele não aparece na tela**
e nunca vai para o Git) e cria as pastas de dados e de backup. Você deve ver linhas como:

```
  + NODE_ENV=production
  + JWT_SECRET=<gerado agora; não é exibido>
  + STORAGE=sqlite
  + SHOWVAULT_DATA_DIR=C:\Users\<você>\AppData\Local\ShowVault\data
  + SHOWVAULT_BACKUP_DIR=C:\Users\<você>\OneDrive\Documentos\ShowVault-Backups
  + HOST=127.0.0.1
  + TRUST_PROXY=1
```

Se aparecer **"Atenção"** com algo em `!`, leia: ele avisa de coisas como "dados dentro do OneDrive" ou "HOST aberto para a rede". Para só espiar sem gravar: `npm run setup:pc -- --dry-run`.

> O `.env` fica na pasta do projeto (que está no OneDrive) e guarda o segredo dos logins. É a sua conta pessoal do OneDrive, mas **não compartilhe essa pasta com ninguém**.

### 1.4 Copie seus dados antigos para o banco novo

Primeiro uma **simulação** (não grava nada):

```powershell
npm run storage:migrate -- --from server\data --dry-run
```

Deve mostrar algo como `Seriam importados: 1 conta(s), 1 biblioteca(s), catálogo com N obra(s)`. Estando certo, faça de verdade:

```powershell
npm run storage:migrate -- --from server\data
```

- Antes de importar, ele copia os arquivos para `...\ShowVault\data\backup-pre-sqlite-<data>\`.
- Os arquivos antigos de `server\data` **continuam lá, intactos** (é a sua volta para o modo antigo).
- Faça isto **antes** de ligar o app pela primeira vez no modo novo. Se o ShowVault já chegou a rodar no banco novo (e mostrou a lista vazia), pare o app, **mova** (não apague)
  a pasta `%LOCALAPPDATA%\ShowVault\data` para outro lugar e refaça este passo.

### 1.5 Ligue com o Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\install-autostart.ps1 -StartNow
```

Isso cria **duas tarefas no Agendador de Tarefas do Windows** (só do seu usuário; não precisa de administrador e não muda nenhuma configuração do Windows):

| Tarefa | O que faz |
|---|---|
| `ShowVault` | liga o servidor quando você entra no Windows (janela oculta, sem limite de tempo, reinicia se cair) |
| `ShowVault-Backup` | todo dia às 04:00 (ou na primeira chance, se o PC estava desligado) faz o backup do banco |

Quer espiar antes? Acrescente `-DryRun` e ele só mostra o que registraria. No fim aparece `No ar: http://127.0.0.1:3000/health`.

### 1.6 Confira

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\status.ps1
```

Tudo com `[ok]` e "Tudo certo." no fim. Depois abra **http://localhost:3000** no navegador, entre com a sua conta e confira que a sua lista está lá
(você vai precisar **entrar de novo**: o segredo dos logins mudou; a lista que está no navegador é mesclada com a do servidor).
(`[!]` no backup é normal antes do primeiro backup; faça já um: `npm run backup`. Ele mostra o arquivo criado e "integridade ok".)

---

## Parte 2 — Tailscale e o link público

### 2.1 Instalar e entrar

1. Baixe o instalador do Windows em <https://tailscale.com/download/windows>, instale e, no ícone da bandeja, escolha **Log in** (abre o navegador; entre com a conta que preferir).
2. Se o comando `tailscale` não for reconhecido no PowerShell, feche e abra o PowerShell de novo (o instalador coloca o programa no PATH).

### 2.2 No painel do Tailscale (navegador)

Abra <https://login.tailscale.com/admin/machines>:

1. **Dê um nome neutro à máquina**, como `showvault` (menu `...` da máquina → *Edit machine name*). **O nome vira parte do link e fica público** nos registros de certificados
   (Certificate Transparency): evite nomes que digam quem você é ou onde mora.
2. Ainda no menu `...` da máquina: **Disable key expiry** (senão a chave da máquina vence em 180 dias e o link para de funcionar sem aviso).
3. Em <https://login.tailscale.com/admin/dns>: confira que o **MagicDNS** está ligado e, em *HTTPS Certificates*, clique em **Enable HTTPS** (confirme o aviso sobre nomes públicos).
4. Anote o **nome da sua rede** (algo como `tail1234.ts.net`). O link final será `https://<nome da máquina>.<nome da rede>.ts.net`.

### 2.3 Ligar o Funnel

No PowerShell (qualquer pasta):

```powershell
tailscale funnel --bg 3000
```

Na **primeira vez** ele pode mostrar um endereço para aprovar o Funnel na sua conta: abra o endereço no navegador e aprove (se o comando não continuar sozinho, rode-o de novo). Quando funcionar, ele escreve algo como:

```
Available on the internet:
https://showvault.tail1234.ts.net/
|-- / proxy http://127.0.0.1:3000
```

Esse é o seu **link fixo**. O `--bg` faz o Funnel continuar ligado em segundo plano e **voltar sozinho** quando o PC reinicia ou o Tailscale reconecta.

Para ver o que está publicado: `tailscale funnel status`.

### 2.4 Conferir pelo link

1. No navegador do PC: `https://<seu link>/health` → deve aparecer `{"status":"ok","storage":"sqlite","uptimeSec":...}`.
2. **No celular, desligue o Wi-Fi** (use 4G/5G) e abra o mesmo endereço. Se abrir, o caminho de fora está certo.
3. Abra `https://<seu link>/` e entre com a sua conta: a lista sincroniza (o navegador trata esse endereço como um site diferente do `localhost`; por isso é preciso entrar).
4. Rode de novo o `status.ps1`: agora ele também confere o `/health` **pelo link público**.

Se o primeiro acesso demorar (até uns 10 minutos): o certificado e o DNS novos podem levar um tempo para se espalhar. Tente de novo.

### 2.5 O que o Funnel limita

Só as portas 443, 8443 e 10000 podem ser públicas (o app usa a 443 sem você ver), há limite de banda não configurável e só vale com endereço `.ts.net`. Para ~10 amigos
com uma lista de séries isso é mais que suficiente.

---

## Parte 3 — Manter o PC acordado (decisão sua)

Os scripts **não mexem** nas opções de energia. Para o link ficar no ar:

- **Configurações → Sistema → Energia (ou "Energia e bateria")** → em "Tela e suspensão" (ou "Tempos limite de tela, suspensão e hibernação"):
  *Com o computador conectado, colocar em suspensão após* → **Nunca**. A tela pode apagar à vontade; é a suspensão que derruba o link.
- Se preferir pelo teclado (isto muda uma configuração do Windows; só rode se quiser):
  `powercfg /change standby-timeout-ac 0` e `powercfg /change hibernate-timeout-ac 0`.
- **Reinício do Windows (atualizações):** depois de reiniciar, o ShowVault só volta quando você **entrar no Windows** (a tarefa é "ao fazer logon"). O Tailscale, por padrão, também fica
  desconectado até você entrar (a opção *Run unattended*, no menu do ícone → *Preferences*, o faz voltar antes do logon, mas o ShowVault continua esperando o logon). Entrou no Windows, tudo volta sozinho.
  Use as **Horas ativas** do Windows Update para ele não reiniciar à noite.
- Notebook: com a tampa fechada ele dorme, a menos que a ação da tampa (em "Escolher a função dos botões de energia") seja "Não fazer nada".

---

## Parte 4 — Login com Google no link público

O Google só aceita o login em endereços que você cadastrou. **A S11 não mexe no Google Cloud.** Quando o link estiver pronto, peça à **sessão principal** (ela tem o Chrome conectado):

> "Adicione a origem `https://<máquina>.<rede>.ts.net` ao cliente OAuth 'ShowVault (local)' (D-27) e cadastre meus amigos como usuários de teste: [e-mails]."

Duas coisas para ela saber: o Google limita a 100 usuários de teste, e **não foi testado** se ele aceita um endereço `.ts.net` (se recusar, o login por e-mail e senha continua funcionando normalmente).

## Quando compartilhar o link

**Só depois da S14.** Até lá o cadastro é aberto: o nome da máquina aparece nos registros públicos de certificados, então robôs podem achar o endereço e criar contas.

- Enquanto a S14 não chega: ligue o Funnel só para testar e **desligue em seguida** (`tailscale funnel reset`), ou aceite o risco sabendo que ele existe.
- Depois da S14: mande o link e o convite para os amigos.

---

## No dia a dia

| Quero... | Comando (PowerShell, na pasta do projeto) |
|---|---|
| ver se está tudo bem | `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\status.ps1` (acrescente `-Log` para ver as últimas linhas dos logs) |
| ligar o app | `Start-ScheduledTask -TaskName ShowVault` |
| parar o app | `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\stop-showvault.ps1` (para a tarefa **e** o servidor; não remove o início automático) |
| fazer um backup agora | `npm run backup` |
| ver os backups | `npm run restore` (lista) — ou abra a pasta `OneDrive\Documentos\ShowVault-Backups` |
| atualizar o app | `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1` (use `-DryRun` para só ver o que mudaria) |

**Logs:** `%LOCALAPPDATA%\ShowVault\logs` — `showvault.log` (o servidor), `supervisor.log` (ligou, caiu, religou), `backup.log`. Não têm senhas nem corpo de requisição.

### Backups

- Todo dia às 04:00, em `...\OneDrive\Documentos\ShowVault-Backups`, com nomes como `showvault-2026-10-27_040000.sqlite`.
- **Rotação automática:** ficam os 7 dias mais recentes e 1 por semana nas 4 últimas semanas (cerca de 10 arquivos). Nunca apaga nada com outro nome. Backups do **mesmo dia** colapsam no mais novo:
  antes de algo arriscado (apagar contas, mexer no banco), faça `npm run backup` e **copie esse arquivo para outra pasta** se quiser guardá-lo de vez.
- O backup é uma **foto consistente** feita pelo próprio banco, com o app ligado; nunca é uma cópia do arquivo aberto.
- Os backups contêm as contas (senhas em hash) e as listas. Não compartilhe essa pasta.

### Restaurar um backup (se algo der errado)

1. Pare o app: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\stop-showvault.ps1`.
2. Veja os backups: `npm run restore`.
3. Confira o que escolheu sem trocar nada: `npm run restore -- ultimo --dry-run` (mostra contas, listas e obras do backup e do banco atual).
4. Restaure: `npm run restore -- ultimo` (ou o nome de um deles). Ele pede para você digitar `RESTAURAR`, guarda uma cópia do banco que estava em uso
   (`showvault-ANTES-DA-RESTAURACAO-...` na pasta de backups; a rotação nunca apaga essas) e só então troca.
5. Ligue de novo: `Start-ScheduledTask -TaskName ShowVault`.

O comando **se recusa** a restaurar com o app ligado.

### Atualizar o app

O `update.ps1` confere que a pasta está na `main` e sem alterações suas, faz um backup, para o app, `git pull --ff-only`, instala as dependências, religa e espera o `/health`. Se algo falhar, ele para e diz como voltar.
Dica: o app serve os arquivos da pasta do projeto, então se você (ou o Claude) mexer nela com o link no ar, os visitantes enxergam a mudança. Para programar, use outra cópia
(uma worktree/clone) e deixe esta pasta só para rodar, sempre na `main`.

### Se o PC reiniciar ou travar

Entre no Windows. Em até ~1 minuto: tarefa `ShowVault` liga o app, o Tailscale reconecta e o Funnel volta (foi criado com `--bg`). Confira com o `status.ps1`.
Se você precisar ligar à mão: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start-showvault.ps1`.

---

## Desligar tudo

Do mais leve ao mais completo. Nada disto apaga seus dados, backups ou o `.env`.

1. **Tirar da internet** (o app continua no seu PC): `tailscale funnel reset` — confira com `tailscale funnel status` (não deve mostrar endereço).
2. **Parar o app e tirar o início automático:**
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\uninstall-autostart.ps1`
3. **Desconectar o Tailscale:** menu do ícone da bandeja → *Disconnect* (ou desinstale o Tailscale pelo Windows).
4. **Voltar ao modo antigo** (arquivos em `server\data`): apague as linhas `NODE_ENV`, `STORAGE`, `SHOWVAULT_DATA_DIR`, `HOST` e `TRUST_PROXY` do `.env` (o `setup:pc` guardou uma cópia
   `.env.bak-...` do arquivo anterior) e use `iniciar.bat`. Os dados criados depois da migração ficam só no banco; para levá-los de volta: `npm run storage:export -- <pasta nova>`.

---

## Segurança: o que está exposto e o que fazer

- **Exposto:** só o ShowVault (páginas, `/health` e a API), pela porta 443 do link `.ts.net`. O resto do PC, não. O Tailscale não dá acesso à sua rede nem a outros programas.
- **Proteções do app:** senhas com hash scrypt, login por token, limite de tentativas por IP (o app enxerga o **IP real** do visitante: veja abaixo), cabeçalhos de segurança, CSP estrita.
- **O que pode dar errado:** cadastro aberto até a S14; o nome da máquina é público (certificados); se o PC for invadido ou furtado, tudo que está nele fica exposto (use senha/PIN do Windows e BitLocker, se puder);
  quem tem acesso à pasta do projeto no OneDrive tem o `.env` (segredo dos logins).
- **Boas práticas:** mantenha o Windows e o Tailscale atualizados; não use o mesmo e-mail/senha de outros serviços no ShowVault; não instale o app em PC compartilhado; confira o `status.ps1` de vez em quando.
- **Trocar o segredo dos logins** (se achar que vazou): apague a linha `JWT_SECRET=...` do `.env`, rode `npm run setup:pc` (gera outro) e reinicie o app. Todo mundo precisará entrar de novo.

### Como o app enxerga o IP real (por que `TRUST_PROXY=1`)

O Funnel termina o HTTPS **no seu PC** e entrega cada requisição ao app a partir de `127.0.0.1`. O programa do Tailscale que faz isso reescreve os cabeçalhos
`X-Forwarded-For` (IP do visitante), `X-Forwarded-Host` e `X-Forwarded-Proto` e **descarta os que o visitante mandou**. Como há exatamente **um** proxy no caminho, `TRUST_PROXY=1` faz o
limite de tentativas de login contar cada visitante pelo IP dele. Sem isso todo mundo pareceria o mesmo IP (127.0.0.1). Nunca use `TRUST_PROXY=true`: aceitaria qualquer IP forjado.

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `status.ps1` diz "Nada escutando na porta 3000" | `Start-ScheduledTask -TaskName ShowVault`; se não ligar, veja `%LOCALAPPDATA%\ShowVault\logs\supervisor.log` e `showvault.log` |
| "A porta 3000 já está em uso" | tem outro ShowVault aberto (janela do `iniciar.bat`/`npm start`): feche-o |
| O servidor diz "JWT_SECRET é obrigatório" | rode `npm run setup:pc` (o `.env` está sem o segredo) |
| O link abre mas dá erro 502 | o app está parado: `Start-ScheduledTask -TaskName ShowVault` |
| O link não abre de jeito nenhum | PC dormindo/desligado, Tailscale desconectado (ícone da bandeja), ou Funnel desligado (`tailscale funnel status`); confira com o `status.ps1` |
| `tailscale` não é reconhecido | feche e abra o PowerShell; se persistir, rode `& "C:\Program Files\Tailscale\tailscale.exe" funnel status` |
| O comando do Funnel pede aprovação | abra o endereço que ele mostra, aprove, e rode o comando de novo |
| Tudo parou depois de ~6 meses | a chave da máquina venceu: no painel, *Disable key expiry* (passo 2.2) e reconecte |
| `update.ps1` diz que a pasta não está na `main` | `git checkout main` e rode de novo (se tiver trabalho seu pendente, chame a sessão principal) |
| `npm ci` falha por causa do OneDrive | o `update.ps1` já tenta `npm install`; se ainda falhar, pause o OneDrive por alguns minutos e rode de novo |
| A migração diz "Já existiam no banco e NÃO foram sobrescritos: users.json" | o app já tinha rodado no banco novo: siga o aviso do passo 1.4 (mover a pasta de dados e repetir) |
| Mensagem de política de execução ao rodar o `.ps1` | use exatamente os comandos deste guia (`powershell -NoProfile -ExecutionPolicy Bypass -File ...`) |

---

## Links oficiais (conferidos em 2026-10-27)

- Funnel: <https://tailscale.com/kb/1223/funnel> e a referência do comando: <https://tailscale.com/docs/reference/tailscale-cli/funnel>
- Serve (cabeçalhos, backend em `127.0.0.1`): <https://tailscale.com/docs/features/tailscale-serve>
- HTTPS e nomes públicos: <https://tailscale.com/docs/how-to/set-up-https-certificates>
- Windows e "Run unattended" / validade da chave (180 dias): <https://tailscale.com/docs/install/windows> e <https://tailscale.com/kb/1088/run-unattended>
- Código do proxy do Tailscale (cabeçalhos `X-Forwarded-*`): <https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go>
