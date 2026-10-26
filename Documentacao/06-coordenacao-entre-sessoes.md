# Coordenação entre sessões paralelas

Várias sessões do Claude podem trabalhar ao mesmo tempo (uma por seção). Elas **não se enxergam**; o canal entre elas é o **GitHub** (`origin`).
Por isso o status vive em arquivos do repositório e é lido sempre de `origin`, nunca só da cópia local.

## O quadro de status

```bash
npm run status              # mostra todas as seções e quais podem iniciar
npm run status -- S03       # diz se a S03 pode iniciar (exit 0 = sim, 2 = bloqueada, 3 = já em andamento/concluída)
```

Como o quadro decide:

| Estado | Como é detectado |
|---|---|
| **concluída** | `Documentacao/status/SNN.json` em `origin/main` com `"status": "concluida"` |
| **em andamento** | existe a branch `origin/feature/sNN-...` (a sessão a empurra **logo ao abrir**) |
| **aguardando** | alguma dependência *hard* de `Documentacao/status/grafo.json` ainda não está concluída |
| **pode iniciar** | pendente e sem dependência *hard* faltando |

Dependências *hard* (bloqueiam): S03, S04, S06, S09 → S02 · S08 → S03 · S10 → S01–S08.
Dependências *soft* (só avisam): S02 ← S01 · S07 ← S05 · S09 ← S06 · S10 ← S09.

## Regras para a sessão que está iniciando

1. `git fetch origin` e `npm run status -- SNN`.
2. Se **bloqueada** (exit 2) ou **já em andamento/concluída** (exit 3): **não faça nada no código**. Diga ao Gabriel, em uma frase, quem você está esperando e pare.
   Quando ele disser que a dependência terminou, rode de novo.
3. Se pode iniciar: criar `feature/sNN-<slug>` a partir de `origin/develop`, trocar `Documentacao/status/SNN.json` para `"status": "em-andamento"` com `branch`,
   commitar e **dar push da branch imediatamente** (isso "reserva" a seção para as outras sessões).
4. Veja quais outras seções estão em andamento (`npm run status` lista) e evite os mesmos arquivos; se precisar mexer num arquivo que outra sessão está mexendo, mantenha a mudança mínima.

## Regras para a sessão que está terminando

1. `git fetch origin && git merge origin/develop` **na sua branch** (traz o trabalho das outras sessões). Resolva conflitos:
   - código: entenda os dois lados e mantenha ambos; rode `npm test` e o app de novo;
   - docs de uso comum (`02-decisoes.md`, `04-roadmap.md`): manter as linhas dos dois lados.
2. Preencha `Documentacao/status/SNN.json`: `"status": "concluida"`, `concluidaEm` (data), `notas` (1–2 linhas). O campo `commit` você preenche **depois** do merge no main
   (um commit pequeno de ajuste é aceitável) ou deixa vazio.
3. Escreva a entrada do diário em `Documentacao/diario/AAAA-MM-DD-SNN.md` (um arquivo por sessão → não gera conflito).
4. Faça o push até o `main` conforme o protocolo. **Se o push for rejeitado** porque outra sessão chegou antes: `git fetch`, merge de `origin/develop` de novo, testes, tente outra vez. Nunca force push.
5. Rode `npm run status` e confira que a sua seção aparece como **concluída** e que outras que dependiam dela agora aparecem como "pode iniciar". Diga isso ao Gabriel.

## Para o Gabriel

- Abra os chats da **onda** que estiver liberada (veja `npm run status` ou peça "mostre o status" em qualquer chat).
- Quando um chat terminar, ele diz quais seções foram liberadas. Aí você abre/chama os chats que estavam esperando (ou diz "S02 concluiu, continue" ao chat que parou).
- Um chat nunca consegue "vigiar" outro sozinho: ele só age quando você manda mensagem. O quadro serve para o chat decidir na hora, com dados reais do GitHub.
- Ondas sugeridas: **1** S01+S02 (+ S05 se quiser) · **2** S03+S04 (+ S07) · **3** S06+S08 · **4** S09+S10.
  (S05 e S07 não dependem de nada hard; mexem em layout/views, então só rode junto com sessões de backend, ou aceite resolver conflitos de arquivo.)

## Afinidade de arquivos (onde costuma haver conflito)

| Área | Seções que mexem |
|---|---|
| `public/index.html`, `public/css/*` | S05, S07, S08, S10 |
| `public/js/views/*`, `appController.js` | S01, S03, S05, S07, S08, S10 |
| `public/js/models/state.js`, `syncService.js`, `authView.js` | S02 (remove seed), S03, S04 |
| `server/services/mediaService.js` | S01 (sanitizador), S02, S06, S09 |
| `server/models/UserModel.js`, `authController.js`, `server.js` | S02, S04, S10 |
| `package.json` / `package-lock.json` | S04, S09, S10 (conflitos de lock: refaça com `npm install` após o merge) |

## Uma pasta por sessão (aprendido na S01)

Duas sessões na **mesma pasta** brigam pelo `HEAD`: uma troca de branch por baixo da outra e as mudanças não commitadas se misturam (aconteceu na S01).
Se for rodar sessões em paralelo, cada uma deve trabalhar num **worktree próprio**:

```bash
git worktree add ../showvault-sNN feature/sNN-<slug>     # (crie a branch antes com: git branch feature/sNN-<slug> origin/develop)
```

`node_modules` pode ser ligado ao do projeto principal (junction/symlink) para não reinstalar. Remova o worktree no fim: `git worktree remove ../showvault-sNN`.
