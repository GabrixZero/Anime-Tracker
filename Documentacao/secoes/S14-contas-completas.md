# S14 · Contas completas e convites

**Status:** em `Documentacao/status/S14.json` (`npm run status -- S14`) · **Prioridade:** 4 · **Depende de:** nada (S12 recomendado) · **Branch:** `feature/s14-contas-completas`

## Por que importa
A API de trocar senha e excluir conta existe (S04), mas não há telas. O app é para o Gabriel e ~10 amigos: é melhor que estranhos não consigam se cadastrar.

## Tarefas
- [ ] Tela "Minha conta" (perfil, trocar senha, excluir conta com confirmação por senha; conta Google: confirmação pelo Google) usando `POST /api/auth/change-password` e `DELETE /api/auth/account`.
- [ ] **Cadastro por convite**: `INVITE_CODE` (ou lista de códigos) no `.env`; sem código válido, cadastro recusado com mensagem clara. Desligado quando a variável não existe (uso local).
- [ ] Encerrar sessão no servidor: "sair de todos os aparelhos" (reaproveitar o carimbo de `requireActiveUser` da S04).
- [ ] Recuperação de senha **sem e-mail** (P-11, padrão): script do dono `npm run user:reset-password -- <email>` que gera senha temporária e obriga troca no próximo login. Se a P-11 mudar para e-mail, usar um provedor (ex.: Resend) com chave no `.env`.
- [ ] Testes HTTP + E2E (se a S12 já estiver no `develop`).

## Decisões
- **P-11 (pendente, padrão "sem e-mail"):** serviço de e-mail para recuperação de senha.
- Já resolvidas: D-15, D-16, D-S04-n (validação, rate limit, Google, conta demo).

## Critério de pronto
Usuário troca senha e exclui conta pela interface; cadastro exige convite quando configurado; "sair de todos os aparelhos" invalida tokens antigos; dono consegue redefinir a senha de um amigo; testes verdes.

## Fora de escopo
Verificação de e-mail obrigatória; papéis/admin além do script do dono.
