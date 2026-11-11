import type { ReactNode } from "react";

import { customerInitials, customerSituation, customerTone, type CustomerRow, type CustomerTone } from "@/lib/customer-registry";
import { cn } from "@/lib/utils";

/**
 * Peças da galeria e da página do cliente em Configurações › Clientes
 * (docs/mockups/ConfigClientes.dc.html e ConfigCliente.dc.html), na v3.
 */

/** Os tons suaves do cliente (o quadro da sigla); Pessoas usa os mesmos nos avatares. */
export const TOM_DO_QUADRO: Record<CustomerTone, string> = {
  info: "bg-info-soft text-info-soft-foreground",
  teal: "bg-teal-soft text-teal-soft-foreground",
  violet: "bg-violet-soft text-violet-soft-foreground",
  amber: "bg-amber-soft text-amber-soft-foreground",
};

/** O quadro com a sigla do nome, na cor do cliente; o arquivado fica cinza. */
export function QuadroDoCliente({ row, tamanho = "medio" }: { row: Pick<CustomerRow, "code" | "name" | "archived">; tamanho?: "pequeno" | "medio" | "grande" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-extrabold tracking-tight",
        tamanho === "grande" ? "size-16 text-xl" : tamanho === "medio" ? "size-13 text-base" : "size-11 text-sm",
        row.archived ? "bg-muted text-muted-foreground" : TOM_DO_QUADRO[customerTone(row.code)],
      )}
    >
      {customerInitials(row.name)}
    </span>
  );
}

const TOM_DO_SELO = {
  ok: "border-success-soft-border bg-success-soft text-success-soft-foreground",
  warn: "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  amber: "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
  off: "border-border bg-muted text-muted-foreground",
} as const;

export type TomDoSelo = keyof typeof TOM_DO_SELO;

export function Selo({ tom, children }: { tom: TomDoSelo; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border px-2.5 text-xs font-bold", TOM_DO_SELO[tom])}>
      {children}
    </span>
  );
}

/** A situação do cliente: arquivado, pausado, portal ativo ou sem portal. */
export function SeloDaSituacao({ row }: { row: Pick<CustomerRow, "archived" | "paused" | "profile"> }) {
  const situacao = customerSituation(row);
  return <Selo tom={situacao.tone}>{situacao.label}</Selo>;
}

/** Código do sistema (pacote, sigla, SKU) em fonte fixa. */
export function Codigo({ children, destaque = false }: { children: ReactNode; destaque?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 font-mono text-xs font-bold",
        destaque ? "bg-info-soft text-info-soft-foreground" : "bg-muted text-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function Pilula({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full bg-muted px-2.5 text-xs font-bold text-foreground">
      {children}
    </span>
  );
}
