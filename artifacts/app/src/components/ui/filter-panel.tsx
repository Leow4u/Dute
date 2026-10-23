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
        <FilterSheetPanel open={open} onOpenChange={setOpen}>
          {children}
        </FilterSheetPanel>
      </div>
    </>
  );
}

type FilterSheetProps = {
  /** Quantas escolhas do painel fogem do padrão; aparece sobre o botão. */
  count: number;
  /** Com ele, o painel ganha "Limpar" ao lado de "Ver resultados". */
  onClear?: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * Celular, ao lado da busca: só o ícone, com a contagem do que está ativo, e
 * o mesmo painel de grupos do FilterPanel. Serve à barra presa que precisa
 * caber numa linha (Estoque do portal).
 */
export function FilterSheet({ count, onClear, children, className }: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn("relative h-11 w-11 shrink-0", count > 0 && "border-primary/25 bg-primary/10 text-primary", className)}
        aria-label={count > 0 ? `Filtros, ${count} ${count === 1 ? "ativo" : "ativos"}` : "Filtros"}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden="true" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-primary px-1 text-xs font-semibold leading-none text-primary-foreground"
          >
            {count}
          </span>
        ) : null}
      </Button>
      <FilterSheetPanel open={open} onOpenChange={setOpen} onClear={onClear}>
        {children}
      </FilterSheetPanel>
    </>
  );
}

function FilterSheetPanel({
  open,
  onOpenChange,
  onClear,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClear?: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl bg-card">
        <SheetHeader className="text-left">
          <SheetTitle>Filtros</SheetTitle>
          <SheetDescription className="sr-only">Escolha o que mostrar na lista.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-5">{children}</div>
        <div className="mt-6 flex gap-2">
          {onClear ? (
            <Button type="button" variant="outline" onClick={onClear}>
              Limpar
            </Button>
          ) : null}
          <Button type="button" className="flex-1" onClick={() => onOpenChange(false)}>
            Ver resultados
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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
