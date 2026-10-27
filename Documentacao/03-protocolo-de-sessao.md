# Protocolo de sessão

Cada sessão do Claude executa **uma seção** do roadmap. Mesmo fluxo sempre. Várias sessões podem rodar **em paralelo**:
leia também [06-coordenacao-entre-sessoes.md](06-coordenacao-entre-sessoes.md).

## 1. Abertura (primeiros minutos)

1. Leitura mínima (D-30): `CLAUDE.md` → `Documentacao/README.md` → bloco "Regras vigentes" de `02-decisoes.md` → arquivo da seção. Os outros documentos só sob demanda.
2. `git fetch origin` e **`npm run status -- SNN`**. Bloqueada ou já pegada por outra sessão → avisar o Gabriel e **parar** (regras em `06`).
3. Se houver mudanças soltas na cópia local, perguntar ao Gabriel antes de mexer.
4. Criar a branch **a partir de `origin/develop`**: `git checkout -b feature/sNN-<slug> origin/develop`.
5. Marcar a seção como em andamento (`Documentacao/status/SNN.json` → `"status": "em-andamento"`, `branch`), commitar e **`git push -u origin feature/sNN-<slug>`** já (reserva a seção).
6. Resumir ao Gabriel, em 5 linhas, o que será feito e quais **decisões pendentes** da seção precisam da resposta dele. Perguntar o que for necessário (com recomendação).
7. Planejar antes de editar (modo de plano), mostrar o plano, e só então implementar.

## 2. Execução

- Mudanças pequenas e verificáveis; commits no estilo do histórico (`feat(...)`, `fix(...)`, `docs:`, `chore:`).
- Cada correção ganha teste automatizado quando possível (`tests/`, `node --test`). Testes **não** podem escrever em `server/data` real (use `fs.mkdtempSync`).
- Verificar (D-30): testes, lint e CI primeiro; navegador só quando a mudança for visual ou de fluxo de tela. Quando subir servidor: porta própria da sessão (`PORT=30NN node server.js`, por exemplo 3001 para S01, 3002 para S02…; sessões paralelas **não** podem usar a mesma porta),
  `curl` na API e a interface no navegador do app (viewport mobile 375×812 quando mexer em layout). Encerrar o servidor de teste no fim e **limpar usuários/arquivos de teste** criados em `server/data`.
- Seguir as regras de segurança de `01-visao-geral-e-arquitetura.md` (nada de segredos/e-mails reais; nada de `users.json`/`libraries/` no git).
- Fora do escopo da seção: **não corrigir de passagem**; anotar em "Descobertas" no diário (ou na seção certa).
- Com sessões paralelas: a cada bloco grande de trabalho, `git fetch` e olhar `npm run status` — se outra sessão chegou ao `main`, faça merge de `origin/develop` na sua branch cedo (conflitos pequenos são mais fáceis).

## 3. Encerramento (obrigatório, nesta ordem)

1. `git fetch origin && git merge origin/develop` na sua branch; resolver conflitos (regras em `06`); `npm test` passando; rodar o fluxo principal no navegador pelo menos uma vez.
2. Atualizar a documentação:
   - arquivo da seção: marcar o checklist, o que foi feito, o que sobrou;
   - **`Documentacao/status/SNN.json`**: `"status": "concluida"`, `concluidaEm`, `notas`;
   - `02-decisoes.md`: decisões novas com id **`D-SNN-n`** (ex.: `D-S02-1`) e pendências resolvidas (marcar a P-nn como resolvida, com data e escolha);
   - `01-visao-geral-e-arquitetura.md`: se a arquitetura/mapa de arquivos mudou;
   - **`Documentacao/diario/AAAA-MM-DD-SNN.md`**: entrada da sessão (modelo abaixo).
3. Commit final na branch da feature.
4. Levar até o `main` **sem force push**:
   ```bash
   git push -u origin feature/sNN-<slug>
   git checkout develop && git pull --ff-only origin develop
   git merge --ff-only feature/sNN-<slug>      # se não for possível: git merge origin/develop na feature, testar, e repetir
   git push origin develop                      # rejeitado? outra sessão chegou antes: fetch, merge, testes, de novo
   git checkout main && git pull --ff-only origin main
   git merge --no-ff develop -m "release: sNN <título curto>"
   git push origin main
   git checkout develop
   ```
5. Confirmar `git status` limpo, e `npm run status`: sua seção **concluída**; anotar quais seções ficaram liberadas. O workflow `auto-pr-develop` pode abrir um PR `develop → main` vazio: é só fechar.
6. Responder ao Gabriel com: o que mudou (linguagem simples), como ver funcionando, o que ficou pendente, **quais seções foram liberadas** e a frase de abertura pronta para elas.

### Modelo de entrada do diário (`Documentacao/diario/AAAA-MM-DD-SNN.md`)

```
# AAAA-MM-DD · SNN · <título> · branch feature/sNN-<slug>
- Feito: ...
- Commits/push: ... (chegou ao main? sim/não)
- Pendente / próximos passos: ...
- Descobertas fora do escopo: ...
- Decisões: D-SNN-n criadas / P-nn resolvidas
- Seções liberadas: ...
```

## 4. Prompt curto para abrir uma sessão (o Gabriel só cola isto, trocando S0X)

```
Leia CLAUDE.md e Documentacao/README.md e execute a sessão S0X conforme Documentacao/secoes/S0X-<slug>.md. Siga o protocolo de sessão (rode o npm run status antes de começar) e termine com push até o main.
```

## 5. Regras de ouro

- Não reabrir decisões tomadas (`02-decisoes.md`) sem fato novo; decisões pendentes → perguntar ao Gabriel.
- Não pular a atualização da documentação nem o `status/SNN.json`: sem eles as outras sessões trabalham cegas.
- Nunca `git push --force` em `main`/`develop`. Nunca `--no-verify`.
- Ações destrutivas (apagar dados reais, reescrever histórico) só com pedido explícito do Gabriel.
