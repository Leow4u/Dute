# Sistema visual

Decidido na auditoria de UI de 09/10/2026 (PR 1 da fundação). A regra é
curta: superfície sólida com borda fina, um acento, escala de raio pequena,
texto legível de longe. Sem vidro, brilho ou sombra espalhada.

## Onde mora

- **Tokens:** `artifacts/app/src/index.css` (`:root` claro, `.dark`
  escuro, `@theme inline` para o Tailwind).
- **Componentes base:** `artifacts/app/src/components/ui/` —
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

## Celular (abaixo de 768px)

- Navegação pela barra inferior (`MobileTabBar`): até quatro destinos fixos
  (Início, Pedidos, Estoque, Agent Dute, nesta ordem; o papel sem algum deles
  completa com os próximos do menu) e "Mais" com o resto e a Configuração.
  A ordem vem de `getMobileNavigation` em `lib/modules.ts`, com teste.
- Não há botão flutuante: o Agent Dute é item da barra; no desktop, do menu.
- Filtros de lista em painel (`FilterPanel` + `FilterGroup`): chips em linha
  no desktop; no celular, botão "Filtros · <o que está ativo>" que abre um
  sheet com os grupos. `StockToolbar` já faz isso para quem passa chips.
- Tabela com mais de quatro colunas vira lista de cartões no celular
  (Documentos, Histórico); a tabela fica `hidden md:block` e a lista
  `md:hidden`, com as mesmas ações.
- Gráfico de barras: rótulo curto ("10,8") com a unidade no apoio do cartão;
  acima de 8 meses, sem valor em cima da barra e mês alternado a partir do
  último.

## Listas de fila (Pedidos e Receber)

`QueueGroup` + `QueueRow` (`components/ui/queue-list.tsx`): grupos com
título, apoio e contagem; linhas com ícone em tom suave, título, apoio, nota
e ações. A ficha do item abre ao lado no desktop (`useIsDesktop`) e num sheet
no celular. Seções que vivem dentro de um painel estreito usam `@container`
e variantes `@md:`/`@xl:` em vez de `md:`/`xl:`, para seguir a largura do
painel e não a da janela.

## Escuro

- Mesma escala e os mesmos componentes; só os tokens mudam (`.dark` em
  `index.css`). Borda a 21% de luz para botão secundário, campo e card se
  destacarem do fundo; acento azul escuro com texto azul-claro para badge
  padrão, item ativo do menu e destaque de lista.
- Logo: no escuro entra `dutelog-logo-light.png` (a versão vermelha tem o
  "Soluções Logísticas" em preto). As duas imagens ficam na página; o
  `dark:` troca qual aparece.
- Cor fixa (`bg-white`, `text-slate-900`) continua proibida pelo teste de
  tema: é o que quebra o escuro.

## O que vem depois (plano da auditoria)

As sete PRs da auditoria de 09/10/2026 estão em `main`. O relatório completo
está no artefato "Auditoria de UI Dute". Pendências de produto que ficaram
fora: "faltou" na separação com decisão do coordenador (depende de regra de
negócio) e endereço sugerido na guarda (depende do saldo por endereço).
