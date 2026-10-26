# Roadmap — seções em ordem de prioridade

Origem: auditoria de 2026-10-26 (revisão de código + tour pelo site). Status: `pendente` · `em andamento` · `concluída`.

| Ordem | Seção | Arquivo | Gravidade | Status |
|---|---|---|---|---|
| 1 | Segurança do frontend (XSS) | [S01](secoes/S01-xss-frontend.md) | Alta | pendente |
| 2 | Dados e catálogo (backend) | [S02](secoes/S02-dados-e-catalogo.md) | Alta | pendente |
| 3 | Biblioteca e sincronização | [S03](secoes/S03-biblioteca-e-sync.md) | Média/Alta | pendente |
| 4 | Contas e autenticação | [S04](secoes/S04-contas-e-auth.md) | Alta | pendente |
| 5 | Mobile e layout | [S05](secoes/S05-mobile-e-layout.md) | Alta | pendente |
| 6 | Animes e busca (Jikan) | [S06](secoes/S06-animes-e-busca.md) | Média | pendente |
| 7 | Acessibilidade | [S07](secoes/S07-acessibilidade.md) | Média | pendente |
| 8 | Funções prometidas e falsas | [S08](secoes/S08-funcoes-falsas.md) | Média | pendente |
| 9 | Performance | [S09](secoes/S09-performance.md) | Baixa/Média | pendente |
| 10 | Qualidade, testes e deploy | [S10](secoes/S10-qualidade-testes-deploy.md) | Média | pendente |

Dependências: S06 depende do esquema de ids decidido na S02. S10 (remover `onclick` inline) habilita CSP e facilita S05/S07.
Cada seção deve deixar testes para o que alterou (não esperar a S10).

## Backlog de funcionalidades novas (depois das 10 seções)

- Calendário semanal de próximos lançamentos (agenda de episódios, como no TV Time).
- Importar histórico do TV Time (CSV) e da MyAnimeList; exportação mais completa.
- Google OAuth real (se não for feito na S04).
- Nota do usuário de 1 a 5 por obra/episódio (se aprovado em P-04).
- PWA / modo offline real (service worker).
- Deploy em produção (Render/Railway/Fly) com variáveis de ambiente e armazenamento persistente.

## Como atualizar

Ao encerrar uma sessão, mude o status da linha correspondente e anote em `05-diario-de-sessoes.md`.
Se uma seção for dividida ou reordenada, registre o motivo em `02-decisoes.md`.
