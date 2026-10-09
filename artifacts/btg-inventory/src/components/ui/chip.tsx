import * as React from "react";

import { cn } from "@/lib/utils";

type ChipProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  /** Contagem à direita do rótulo ("Baixo · 2"). */
  count?: number | string | null;
};

/** Filtro de lista: um estilo só em todo o app, selecionado em tinta. */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected = false, count, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:bg-surface-hover",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && count !== null ? (
        <span className={cn("text-xs tabular-nums", selected ? "text-background/70" : "text-muted-foreground")}>
          {count}
        </span>
      ) : null}
    </button>
  ),
);
Chip.displayName = "Chip";

export { Chip };
