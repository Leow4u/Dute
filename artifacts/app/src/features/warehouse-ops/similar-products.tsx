/** Parecidos com foto antes de cadastrar produto novo (lib/product-match.ts). */

import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProductLookupItem } from "@/features/warehouse-ops/shared";

/**
 * Quem está com a peça na mão compara a foto e escolhe o cadastro existente
 * em vez de criar outro SKU para o mesmo produto.
 */
export function SimilarProductList({
  products,
  onPick,
  pickLabel = "É este",
}: {
  products: ProductLookupItem[];
  onPick?: (product: ProductLookupItem) => void;
  pickLabel?: string;
}) {
  if (!products.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        Parecidos no catálogo: confira a foto antes de cadastrar outro.
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {products.map((product) => {
          const details = [product.size, product.color].filter(Boolean).join(" · ");
          return (
            <li
              key={product.id}
              className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-2 text-foreground"
            >
              {product.photoUrl ? (
                <img
                  src={product.photoUrl}
                  alt={`Foto de ${product.productName}`}
                  loading="lazy"
                  className="size-14 shrink-0 rounded-md bg-muted object-cover"
                />
              ) : (
                <div
                  className="flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted text-muted-foreground"
                  title="Sem foto"
                >
                  <Camera className="size-4" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{product.productName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[product.clientCode, product.skuCode].filter(Boolean).join(" · ")}
                </div>
                {details ? (
                  <div className="truncate text-xs text-muted-foreground">{details}</div>
                ) : null}
              </div>
              {onPick ? (
                <Button type="button" size="sm" variant="outline" onClick={() => onPick(product)}>
                  {pickLabel}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
