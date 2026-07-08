---
name: BTG Inventory data model — stock & cost
description: How product stock/cost are derived and why the source spreadsheet has no unit prices
---

# Product stock & cost are derived, not stored

`products.estoque_btg`, `products.num_skus`, and `products.custo_total` columns exist but are NOT the source of truth. They were never populated by the import (all 0/NULL).

- **Source of truth for stock** is `skus.estoque_atual`, which the movements route updates transactionally. A product's stock = `SUM(skus.estoque_atual)` over SKUs matching `products.cod_cliente`. (Mirrors the spreadsheet's `SUMIFS`.)
- Product read routes (`products.ts` list/`:id`/stats and `dashboard.ts`) therefore **derive** `estoque_btg`, `num_skus`, and `custo_total` at read-time via `LEFT JOIN skus ON skus.cod_cliente = products.cod_cliente` + `GROUP BY products.id`. Return `preco_unit`/`custo_total` cast to `::float8` so JSON serializes numbers (frontend `Intl.NumberFormat` needs numbers, not numeric-as-string).
- At aggregate level, `custo_total = SUM(preco_unit * skus.estoque_atual)` over the flat join = per-product `preco_unit * total_stock` summed. Correct because each SKU row carries its product's `preco_unit`.

**Why derive instead of backfill:** movements change SKU stock continuously; a stored `estoque_btg` would drift. Deriving keeps a single source of truth with no sync bugs (~600 products, join is cheap).

# There are no unit prices

The source spreadsheet (`Inventário_BTG_Consolidado`) column PREÇO UNIT. has a **broken `#REF!` formula** (`INDEX(SKUs!#REF!,...)`) — the price column it referenced was deleted. No price data exists anywhere in the file. So `preco_unit` is NULL for all products and `custo_total`/ad_valorem show 0 until a price is entered (via the product edit form) or a price list is imported.
