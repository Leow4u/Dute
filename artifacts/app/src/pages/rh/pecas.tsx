import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Peças das telas do RH, na v3 (as mesmas das listas do Financeiro). */

export const TOM_VENCIDO = "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
export const TOM_VENCENDO = "border-warning-soft-border bg-warning-soft text-warning-soft-foreground";
export const TOM_OK = "border-success-soft-border bg-success-soft text-success-soft-foreground";
export const TOM_NEUTRO = "border-border bg-muted text-muted-foreground";

export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-bold", className)}>{children}</span>;
}

export function Contador({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground/10 px-2 text-xs font-bold text-foreground">
      {children}
    </span>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-7 text-center text-sm font-bold text-muted-foreground">{children}</p>;
}
