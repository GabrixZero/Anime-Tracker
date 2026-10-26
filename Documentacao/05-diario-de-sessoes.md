# Diário de sessões

Mais recente no topo. Modelo de entrada:

```
## AAAA-MM-DD · <Sessão> · branch <nome>
- Feito: ...
- Commits/push: ... (chegou ao main? sim/não)
- Pendente / próximos passos: ...
- Descobertas fora do escopo: ...
- Decisões: D-nn / P-nn resolvidas
```

---

## 2026-10-26 · Sessão 0 (planejamento) · branch `feature/documentacao`

- **Entregue antes (mesmo dia):** JWT real + middleware, biblioteca por usuário no servidor (`/api/user/library`), `syncService` no frontend,
  10 testes automatizados, hash da conta demo, `.env.example`. Tudo no `main` (commits `3c3c7fc` e merge `aad1472`).
- **Auditoria:** revisão de código (subagente) + tour pelo site rodando (5 abas, busca, modal, mobile 375×812). Resultado: 10 seções em `04-roadmap.md`.
- **Documentação criada:** esta pasta, `CLAUDE.md` na raiz, um arquivo por seção em `secoes/`.
- **Achados confirmados pessoalmente no código:** `detailModalView.js` insere `media.name` sem escape; `mediaService.ingest` aceita resposta de erro do TVMaze como obra
  (guarda fraca `!data || !data.name`).
- **Achados do tour:** busca "Frieren" devolve a mesma obra duplicada (PT/EN) e séries sem relação ("Frieden", "Friheden"); no celular o menu mostra só "A Seguir";
  no modal de detalhes o título e a sinopse ficam ilegíveis sobre a imagem de fundo.
- **Falha minha a corrigir na S03:** logout não limpa o estado local; outro usuário no mesmo navegador mescla a biblioteca do anterior.
- **Próxima sessão:** S01 (XSS no frontend).

## 2026-10-26 · Sessão 0b (refinamento) · branch `feature/refinamento-decisoes`
- Todas as pendências P-01…P-09 foram respondidas pelo Gabriel (D-11…D-21); padrões assumidos em D-22; execução por subagentes em D-23.
- Próximo passo: Onda 1 (S01 + S02) por subagentes em worktrees.
