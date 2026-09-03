# Memória de agentes — Dute

**A fonte de verdade sobre como trabalhar neste repositório é o `CLAUDE.md` na
raiz.** A documentação de produto e operação está em `docs/`.

Os arquivos abaixo são registro histórico e estão marcados como obsoletos. Foram
escritos antes da migração para Firebase/Google Cloud (julho de 2026) e descrevem
um stack que não existe mais — Clerk, Express, Drizzle, PostgreSQL e Orval. Não
tome decisão com base neles.

- [BTG Inventory Stack](btg-inventory-stack.md) — **obsoleto**: stack anterior por completo
- [BTG Inventory data model](btg-inventory-data-model.md) — **obsoleto**: modelo em PostgreSQL e planilha como origem do dado
- [BTG Billing Module](btg-billing.md) — **parcialmente obsoleto**: decisões de produto seguem válidas, implementação não

## Atenção

A planilha `attached_assets/Inventário_BTG_Consolidado*.xlsx` foi referência
inicial do projeto e **não deve ser usada**. O sistema foi zerado e recarregado no
go-live de 30/07/2026 a partir do inventário de abertura.
