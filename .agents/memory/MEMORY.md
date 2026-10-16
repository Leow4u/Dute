# Memória de agentes — Dute

**A fonte de verdade sobre como trabalhar neste repositório é o `CLAUDE.md` na
raiz.** A documentação de produto e operação está em `docs/`.

Não há notas de memória ativas. As que existiam aqui (`btg-inventory-stack.md`,
`btg-inventory-data-model.md`, `btg-billing.md`) descreviam o stack anterior —
Clerk, Express, Drizzle, PostgreSQL e Orval — removido na migração para
Firebase/Google Cloud em julho de 2026, e foram apagadas por induzirem a erro.
O conteúdo delas segue recuperável no histórico do git, até o commit `ec2d860`.

Antes de criar uma nota nova aqui, verifique se o lugar dela não é o `CLAUDE.md`
(como trabalhamos) ou `docs/` (produto e operação). Nota de memória só se
justifica para algo que não caiba em nenhum dos dois.

## Atenção

A planilha `attached_assets/Inventário_BTG_Consolidado*.xlsx` foi referência
inicial do projeto e **não deve ser usada** — não derive lógica, preço ou
taxonomia dela. O sistema foi zerado e recarregado no go-live de 30/07/2026 a
partir do inventário de abertura e zerado por completo em 16/10/2026 para um
novo go-live (`docs/novo-go-live-zeragem-total.md`); a fonte de verdade de
estoque é o ledger e as coleções operacionais no Firestore.
