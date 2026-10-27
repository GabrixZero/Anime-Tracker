# 2026-10-27 · Planejamento da rodada 2 (sessão principal)

- **Chrome do Gabriel** conectado ao Claude (extensão) e usado com permissão dele.
- **Ação 1 (CI):** verde no GitHub; o job "Imagem Docker (build e health)" passou, então o Dockerfile funciona de verdade.
- **Ação 2 (Jikan real):** inacessível de todos os pontos (timeout de TCP para `135.181.39.91:443`, DNS ok). Não é problema do app; a busca degrada para catálogo local + TVMaze com aviso. AniList respondeu (Frieren T1–T3, `idMal`, relações) → D-26.
- **Ação 3 (hospedagem):** o Gabriel quer algo **gratuito** para ele e ~10 amigos. Pesquisa: Render grátis dorme após ~15 min e não tem disco persistente; Turso grátis (5 GB, 500M leituras e 10M escritas/mês, segundo guias de 2026); Google Cloud e2-micro cobra IPv4 externo; Oracle Always Free reduziu o ARM em jun/2026 e exige mais operação. Recomendação: Render + Turso (P-10).
- **Ação 4 (chaves):** TMDB: o Gabriel não tem conta (não crio contas por ele; chave fica opcional). Google: tela de consentimento + cliente Web criados com autorização explícita dele (D-27); botão "Continuar com o Google" conferido no app (porta 80 de teste), sem erros de origem/CSP no console. O login de ponta a ponta precisa ser feito pelo próprio Gabriel.
- **Docs:** seções S11–S19, `status/` e `grafo.json` criados; D-24…D-28, P-10 e P-11 registrados.
- **Próximo passo:** Onda A (S12 + S13) por subagentes; S11 depois da confirmação da P-10.
- **P-10 resolvida (D-29):** o Gabriel escolheu rodar no PC dele com Tailscale Funnel. Seção S11 reescrita para esse caminho (sem Render/Turso). S11 disparada em seguida.
