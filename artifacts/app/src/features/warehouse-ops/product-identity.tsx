import { CheckCircle2, ImageOff, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProductLookupItem } from "./shared";

export function ProductIdentityCard({
  product,
  matchLabel,
  selected = false,
  onSelect,
}: {
  product: ProductLookupItem;
  matchLabel?: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  const details = [
    ["Cód. cliente", product.clientCode],
    ["SKU", product.skuCode],
    ["Tamanho", product.size],
    ["Cor", product.color],
    ["Marca", product.brand],
    ["Código de barras", product.barcode],
  ];
  return (
    <section aria-label="Cadastro encontrado" className="@container rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        <span>{selected ? "Cadastro selecionado" : "Cadastro encontrado"}{matchLabel ? ` ${matchLabel}` : ""}</span>
      </div>
      <div className="flex flex-col gap-4 @sm:flex-row">
        {product.photoUrl ? (
          <img src={product.photoUrl} alt={product.productName} className="size-24 shrink-0 rounded-md border border-border bg-card object-contain" />
        ) : (
          <div className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted text-xs text-muted-foreground">
            <ImageOff className="size-6" aria-hidden="true" />
            Sem foto
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <h3 className="break-words text-base font-semibold text-foreground">{product.productName}</h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 @sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words text-sm text-foreground">{value || "Não informado"}</dd>
              </div>
            ))}
          </dl>
          <Button type="button" variant="outline" disabled={selected} onClick={onSelect}>
            {selected ? "Cadastro selecionado" : "Usar este cadastro"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function NewProductNotice({
  confirmed,
  disabled = false,
  note,
  onToggle,
}: {
  confirmed: boolean;
  disabled?: boolean;
  note: string;
  onToggle: () => void;
}) {
  const Icon = confirmed ? CheckCircle2 : PackageSearch;
  return (
    <div role="status" className="@container rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{confirmed ? "Produto novo confirmado" : "Produto não localizado pelo código informado"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={disabled} onClick={onToggle}>
          {confirmed ? "Rever identificação" : "Cadastrar como novo"}
        </Button>
      </div>
    </div>
  );
}
