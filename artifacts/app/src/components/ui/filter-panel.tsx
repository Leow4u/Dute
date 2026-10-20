import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type FilterPanelProps = {
  /** O que está filtrado agora ("Baixo", "NF · BTG vê"); vazio quando é "Todos". */
  summary?: string;
  children: ReactNode;
  className?: string;
};

/**
 * Filtros de lista: chips em linha no desktop; no celular, um botão
 * "Filtros" que abre um painel com os mesmos chips, em grupos. Os chips são
 * controlados, então o painel e a linha mostram sempre o mesmo estado.
 */
export function FilterPanel({ summary, children, className }: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={cn("hidden md:flex md:flex-wrap md:items-center md:gap-2", className)}>{children}</div>
      <div className="w-full md:hidden">
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filtros
          {summary ? <span className="truncate font-normal text-muted-foreground">· {summary}</span> : null}
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl bg-card">
            <SheetHeader className="text-left">
              <SheetTitle>Filtros</SheetTitle>
              <SheetDescription className="sr-only">Escolha o que mostrar na lista.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-5">{children}</div>
            <Button type="button" className="mt-6 w-full" onClick={() => setOpen(false)}>
              Ver resultados
            </Button>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

type FilterGroupProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

/** Um grupo de chips. O rótulo só aparece no painel do celular. */
export function FilterGroup({ label, children, className }: FilterGroupProps) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      <p className="w-full text-xs font-semibold uppercase tracking-wide text-muted-foreground md:hidden">{label}</p>
      {children}
    </div>
  );
}
