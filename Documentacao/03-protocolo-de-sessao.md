# Protocolo de sessão

Cada sessão do Claude executa **uma seção** do roadmap. Mesmo fluxo sempre.

## 1. Abertura (primeiros minutos)

1. Ler `CLAUDE.md` → `Documentacao/README.md` → `02-decisoes.md` → `04-roadmap.md` → arquivo da seção → últimas entradas de `05-diario-de-sessoes.md`.
2. `git status`, `git fetch`, confirmar que está em `develop` e atualizado (`git pull --ff-only`). Se houver mudanças soltas, perguntar ao Gabriel antes de mexer.
3. Criar a branch: `git checkout -b feature/sNN-<slug>` (slug do nome do arquivo da seção).
4. Resumir ao Gabriel, em 5 linhas, o que será feito e quais **decisões pendentes** da seção precisam da resposta dele. Perguntar o que for necessário (com recomendação).
5. Planejar antes de editar (modo de plano), mostrar o plano, e só então implementar.

## 2. Execução

- Mudanças pequenas e verificáveis; commits em português ou inglês no estilo do histórico (`feat(...)`, `fix(...)`, `docs:`, `chore:`).
- Cada correção ganha teste automatizado quando possível (`tests/`, `node --test`). Testes **não** podem escrever em `server/data` real (use `fs.mkdtempSync`).
- Verificar rodando de verdade: subir o servidor em outra porta (`PORT=3055 node server.js`), exercitar a API com `curl` e a interface no navegador do app
  (inclusive em viewport mobile 375×812 quando mexer em layout). Encerrar o servidor de teste no fim e **limpar usuários/arquivos de teste** criados em `server/data`.
- Seguir as regras de segurança de `01-visao-geral-e-arquitetura.md` (nada de segredos/e-mails reais; nada de `users.json`/`libraries/` no git).
- Se descobrir algo fora do escopo da seção, **não corrigir de passagem**: anotar na seção certa (ou em "Descobertas" do diário).

## 3. Encerramento (obrigatório, nesta ordem)

1. `npm test` passando. Rodar o fluxo principal no navegador pelo menos uma vez.
2. Atualizar a documentação:
   - arquivo da seção: marcar checklist, status (`pendente` / `em andamento` / `concluída`), o que foi feito, o que sobrou;
   - `04-roadmap.md`: status da seção;
   - `02-decisoes.md`: novas decisões (D-nn) e resolver pendências (P-nn);
   - `01-visao-geral-e-arquitetura.md`: se a arquitetura/mapa de arquivos mudou;
   - `05-diario-de-sessoes.md`: entrada da sessão (data, branch, commits, resultado, pendências, descobertas).
3. Commit final na branch da feature.
4. Levar até o `main` **sem force push** (peça confirmação do Gabriel apenas se houver conflito ou algo inesperado):
   ```bash
   git push -u origin feature/sNN-<slug>
   git checkout develop && git pull --ff-only origin develop
   git merge --ff-only feature/sNN-<slug>      # se não for possível: git merge --no-ff
   git push origin develop
   git checkout main && git pull --ff-only origin main
   git merge --no-ff develop -m "release: sNN <título curto>"
   git push origin main
   git checkout develop
   ```
5. Confirmar `git status` limpo, branch final `develop`, e que `origin/main` contém o commit. O workflow `auto-pr-develop` pode abrir um PR `develop → main`
   vazio: é só fechar.
6. Responder ao Gabriel com: o que mudou (linguagem simples), como ele pode ver funcionando, o que ficou pendente e **qual é a próxima sessão** com a frase de abertura pronta.

## 4. Prompt curto para abrir uma nova sessão (o Gabriel só cola isto)

```
Leia CLAUDE.md e Documentacao/README.md e execute a sessão S0X conforme Documentacao/secoes/S0X-<slug>.md. Siga o protocolo de sessão e termine com push até o main.
```

## 5. Regras de ouro

- Não reabrir decisões tomadas (`02-decisoes.md`) sem fato novo; decisões pendentes → perguntar ao Gabriel.
- Não pular a atualização da documentação: sem ela, a próxima sessão começa cega.
- Nunca `git push --force` em `main`/`develop`. Nunca `--no-verify`.
- Ações destrutivas (apagar dados reais, reescrever histórico) só com pedido explícito do Gabriel.
