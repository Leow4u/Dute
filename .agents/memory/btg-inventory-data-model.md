---
name: BTG Inventory data model — stock & cost (OBSOLETO)
description: OBSOLETO — baseado na planilha de referência e no schema PostgreSQL, ambos fora de uso
---

> **⚠️ OBSOLETO — NÃO USE.**
>
> Este documento descreve o modelo de dados em PostgreSQL/Drizzle e trata a
> planilha `Inventário_BTG_Consolidado` como origem do modelo. Ambos estão fora
> de uso.
>
> **A planilha foi referência inicial do projeto e não deve ser usada** — não
> derive lógica, preço ou taxonomia dela. O sistema foi zerado e recarregado no
> go-live de 30/07/2026 a partir do inventário de abertura; a fonte de verdade de
> estoque é o ledger e as coleções operacionais no Firestore.
>
> Fonte de verdade atual: `CLAUDE.md` e `docs/`. Mantido apenas como registro
> histórico.

# Product stock & cost are derived, not stored

`products.estoque_btg`, `products.num_skus`, and `products.custo_total` columns exist but are NOT the source of truth. They were never populated by the import (all 0/NULL).

- **Source of truth for stock** is `skus.estoque_atual`, which the movements route updates transactionally. A product's stock = `SUM(skus.estoque_atual)` over SKUs matching `products.cod_cliente`. (Mirrors the spreadsheet's `SUMIFS`.)
- Product read routes (`products.ts` list/`:id`/stats and `dashboard.ts`) therefore **derive** `estoque_btg`, `num_skus`, and `custo_total` at read-time via `LEFT JOIN skus ON skus.cod_cliente = products.cod_cliente` + `GROUP BY products.id`. Return `preco_unit`/`custo_total` cast to `::float8` so JSON serializes numbers (frontend `Intl.NumberFormat` needs numbers, not numeric-as-string).
- At aggregate level, `custo_total = SUM(preco_unit * skus.estoque_atual)` over the flat join = per-product `preco_unit * total_stock` summed. Correct because each SKU row carries its product's `preco_unit`.

**Why derive instead of backfill:** movements change SKU stock continuously; a stored `estoque_btg` would drift. Deriving keeps a single source of truth with no sync bugs (~600 products, join is cheap).

# There are no unit prices

The source spreadsheet (`Inventário_BTG_Consolidado`) column PREÇO UNIT. has a **broken `#REF!` formula** (`INDEX(SKUs!#REF!,...)`) — the price column it referenced was deleted. No price data exists anywhere in the file. So `preco_unit` is NULL for all products and `custo_total`/ad_valorem show 0 until a price is entered (via the product edit form) or a price list is imported.
