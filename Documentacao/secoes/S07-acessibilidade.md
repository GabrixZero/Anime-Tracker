# S07 · Acessibilidade

**Status:** em `Documentacao/status/S07.json` (`npm run status -- S07`) · **Gravidade:** média · **Depende de:** S05 recomendado (layout estável) · **Branch:** `feature/s07-acessibilidade`

## Por que importa
Hoje quem usa teclado ou leitor de tela não consegue usar o app: não existe nenhum `aria-*`, `role=` ou `tabindex` no projeto.

## Problemas encontrados
- Os 4 modais (`#tvtime-auth-modal`, `#modal-show-detail`, `#modal-episode-note`, `#modal-backup`) não têm `role="dialog"`/`aria-modal`/`aria-labelledby`, não fecham com Esc,
  não prendem nem devolvem o foco; botões de fechar são `&times;` sem rótulo.
- Ações importantes são `div` clicável (não focável): logo, `.show-card` (`watchlistView.js` ~120), pôster/título em `exploreView.js` (~97, ~115), miniaturas/títulos em `nextUpView.js` (~177–193),
  e o **círculo de marcar episódio assistido** em `detailModalView.js` (~232) — a ação principal do app.
- Abas e filtros (`.nav-tab`, `.type-pill-btn`, `.season-tab-btn`) só usam classe CSS "active" (sem `role="tab"`/`aria-selected`); botões de emoção sem `aria-pressed`; contêiner de toasts sem `aria-live`.
- `outline: none` em inputs inline (`index.html` ~179, 280, 430, 445) e em `auth-tvtime.css` ~238; não existe `:focus-visible`.
- Contraste: `--text-muted: #64748b` sobre `#0a0b10` ≈ 4:1 (< 4.5:1 AA), usado em textos de 0,72–0,78 rem.
- Alt do avatar é "Avatar"; botões de ícone dependem só de `title`.

## Tarefas
- [x] Util de diálogo: abrir/fechar com foco inicial, armadilha de foco, Esc, retorno do foco ao gatilho, `inert`/`aria-hidden` no fundo; aplicar aos 4 modais.
- [x] Trocar `div` clicáveis por `<button>`/`<a>` (ou `role="button"` + `tabindex="0"` + Enter/Espaço); checkbox real (ou `role="checkbox"` + `aria-checked`) para marcar episódio.
- [x] Padrão de abas (`role=tablist/tab/tabpanel`, setas do teclado) para navegação principal, filtros e temporadas; `aria-pressed` nas emoções; `aria-live="polite"` nos toasts.
- [x] `:focus-visible` global bem visível; remover `outline: none` sem substituto.
- [x] Ajustar a cor de texto secundário para contraste ≥ 4,5:1 e aumentar texto muito pequeno.
- [x] `aria-label` em todos os botões só de ícone; `alt` descritivo (nome do usuário/obra).
- [x] Respeitar `prefers-reduced-motion` (se não feito na S05).
- [x] Verificação: percorrer tudo só com teclado (Tab/Shift+Tab/Enter/Espaço/Esc); auditoria automática (Lighthouse/axe no navegador do app) sem erros graves.

## Resultado (2026-10-27)
- Util de diálogo `public/js/utils/dialog.js` + `utils/a11y.js` (abas, `aria-pressed`, foco preservado) + `css/a11y.css`; decisões D-S07-1..6; diário em `diario/2026-10-27-S07.md`; testes em `tests/a11y.test.js`.
- Sobra: remover `onclick` inline (S10); duplicatas só-de-mouse `.next-up-thumb-wrap`/`.next-up-show-name`; leitor de tela real não foi testado (só teclado + auditoria por script, pois o axe externo foi bloqueado).

## Decisões (já resolvidas — não pergunte de novo)
Nenhuma.

## Critério de pronto
Todo fluxo principal (adicionar obra, marcar episódio, anotar, trocar de aba, login) funciona só com teclado; modais acessíveis; contraste AA nos textos.

## Fora de escopo
Traduções/i18n; leitor de tela em testes automatizados completos.
