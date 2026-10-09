# Sistema visual

Decidido na auditoria de UI de 09/10/2026 (PR 1 da fundação). A regra é
curta: superfície sólida com borda fina, um acento, escala de raio pequena,
texto legível de longe. Sem vidro, brilho ou sombra espalhada.

## Onde mora

- **Tokens:** `artifacts/btg-inventory/src/index.css` (`:root` claro, `.dark`
  escuro, `@theme inline` para o Tailwind).
- **Componentes base:** `artifacts/btg-inventory/src/components/ui/` —
  `button`, `input`, `textarea`, `select`, `badge`, `card`, `dialog`, `tabs`,
  `chip`, `page-header`.
- **Trava:** `src/lib/theme-colors.test.ts` falha com cor fixa que quebra o
  escuro e com valor fora da escala (`rounded-[…]`, `backdrop-blur`,
  `bg-card/NN`, `shadow-[…]`, `text-[…px]`).

## Escala

| O quê | Valor | Classe |
| --- | --- | --- |
| Raio miúdo (kbd, item de menu) | 4px | `rounded-sm` |
| Botão, campo, chip, badge | 6px | `rounded-md` |
| Card, linha de lista, painel | 10px | `rounded-lg` |
| Diálogo, sheet | 14px | `rounded-xl` |
| Avatar, ponto de status | cheio | `rounded-full` |
| Texto corpo, tabela, botão | 14px | `text-sm` |
| Secundário, meta de linha | 13px | `text-[13px]` não; use `text-sm` com `text-muted-foreground` |
| Mínimo (legenda, cabeçalho de tabela) | 12px | `text-xs` |
| Título de página | 24px | `text-2xl` via `PageHeader` |

Sombra só em overlay (`shadow-lg` em diálogo e menu) e no painel flutuante
(`shadow-md`). Card não tem sombra: tem borda.

## Cor

- `primary` é o único acento: botão primário sólido, link, item ativo.
- `destructive` só para bloqueio e crítico. Saída de estoque não é erro.
- `warning-soft` atenção, `success-soft` concluído, `info-soft` em andamento,
  `muted` para tipo e categoria.
- `agent-*` é a identidade do Agent Dute (violeta).

## Botões

`Button` tem um primário por tela (`default`), `secondary`/`outline` com
borda, `ghost` e `destructive` com borda. Tamanhos `sm` 36, padrão 40, `lg`
44. Não crie `<button>` com classes próprias para o que o `Button` já faz.

## O que vem depois (plano da auditoria)

PR 2 cabeçalho/abas/chips em todas as telas; PR 3 celular com barra inferior;
PR 4 Receber reconstruído; PR 5 Estoque histórico e contagem; PR 6 portal;
PR 7 escuro. O relatório completo está no artefato "Auditoria de UI Dute".
