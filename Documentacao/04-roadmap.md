# Roadmap — seções em ordem de prioridade

Origem: auditoria de 2026-10-26 (revisão de código + tour pelo site).
**O status (pendente / em andamento / concluída) NÃO fica aqui**: a fonte da verdade é `Documentacao/status/SNN.json` em `origin/main`.
Veja o quadro atual com `npm run status` (regras em [06-coordenacao-entre-sessoes.md](06-coordenacao-entre-sessoes.md)).

| Ordem | Seção | Arquivo | Gravidade |
|---|---|---|---|
| 1 | Segurança do frontend (XSS) | [S01](secoes/S01-xss-frontend.md) | Alta |
| 2 | Dados e catálogo (backend) | [S02](secoes/S02-dados-e-catalogo.md) | Alta |
| 3 | Biblioteca e sincronização | [S03](secoes/S03-biblioteca-e-sync.md) | Média/Alta |
| 4 | Contas e autenticação | [S04](secoes/S04-contas-e-auth.md) | Alta |
| 5 | Mobile e layout | [S05](secoes/S05-mobile-e-layout.md) | Alta |
| 6 | Animes e busca (Jikan) | [S06](secoes/S06-animes-e-busca.md) | Média |
| 7 | Acessibilidade | [S07](secoes/S07-acessibilidade.md) | Média |
| 8 | Funções prometidas e falsas | [S08](secoes/S08-funcoes-falsas.md) | Média |
| 9 | Performance | [S09](secoes/S09-performance.md) | Baixa/Média |
| 10 | Qualidade, testes e deploy | [S10](secoes/S10-qualidade-testes-deploy.md) | Média |

Dependências: S06 depende do esquema de ids decidido na S02. S10 (remover `onclick` inline) habilita CSP e facilita S05/S07.
Cada seção deve deixar testes para o que alterou (não esperar a S10).

## Backlog de funcionalidades novas (depois das 10 seções)

- Calendário semanal de próximos lançamentos (agenda de episódios, como no TV Time).
- Importar histórico do TV Time (CSV) e da MyAnimeList; exportação mais completa.
- Google OAuth real: **pronto na S04**, só falta o Gabriel criar o Client ID (passo a passo no README).
- Telas no app para trocar senha e excluir conta (a API existe desde a S04) e, se for hospedar, verificação de e-mail e recuperação de senha por e-mail.
- Nota do usuário de 1 a 5 por obra/episódio (D-14: adiado).
- PWA / modo offline real (service worker) — D-20: adiado.
- Deploy em produção (Render/Railway/Fly) com variáveis de ambiente e armazenamento persistente.

## Como atualizar

Ao encerrar uma sessão, atualize `Documentacao/status/SNN.json` e crie a entrada em `Documentacao/diario/`.
Se uma seção for dividida ou reordenada, registre o motivo em `02-decisoes.md`.

## Estado em 2026-10-27

As 10 seções (S01–S10) estão **concluídas e no `main`**. O que resta (hospedagem, chaves opcionais, teste da Jikan real, pendências técnicas e o backlog acima)
está listado em [diario/2026-10-27-encerramento-roadmap.md](diario/2026-10-27-encerramento-roadmap.md). Novas rodadas de trabalho devem abrir seções novas (S11…) neste arquivo e em `status/`.

## Rodada 2 — seções S11–S19 (proposta de 2026-10-27)

Status pelo quadro (`npm run status`). Ondas sugeridas: **A** S12 + S13 · **B** S11 + S14 + S17 · **C** S15 + S16 · **D** S18 · **E** S19.

| Ordem | Seção | Arquivo | Depende de |
|---|---|---|---|
| 11 | Deploy gratuito e produção (PC + Tailscale Funnel, D-29) | [S11](secoes/S11-deploy-gratuito.md) | — (link só vai para os amigos depois da S14) |
| 12 | Testes ponta a ponta (E2E) | [S12](secoes/S12-testes-e2e.md) | — |
| 13 | AniList e qualidade do catálogo | [S13](secoes/S13-anilist-e-catalogo.md) | — |
| 14 | Contas completas e convites | [S14](secoes/S14-contas-completas.md) | (S12 recomendado) |
| 15 | Calendário de lançamentos | [S15](secoes/S15-calendario.md) | S13 |
| 16 | Importar e exportar histórico | [S16](secoes/S16-importar-exportar.md) | S13 |
| 17 | Nota do usuário (1 a 5) | [S17](secoes/S17-nota-1-a-5.md) | (S12 recomendado) |
| 18 | Performance 2 e modo offline | [S18](secoes/S18-performance-e-offline.md) | S13 |
| 19 | Acessibilidade real e polimento | [S19](secoes/S19-polimento-final.md) | S11–S18 |
