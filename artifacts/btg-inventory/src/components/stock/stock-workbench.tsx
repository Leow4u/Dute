import type { ReactNode } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { FilterGroup, FilterPanel } from "@/components/ui/filter-panel";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

const numberFormatter = new Intl.NumberFormat("pt-BR");
const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatStockNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return numberFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatStockMoney(value: unknown) {
  const numeric = Number(value ?? 0);
  return moneyFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

type StockPageShellProps = {
  /** Mantido por compatibilidade; o cabeçalho do sistema não usa ícone. */
  icon?: ReactNode;
  eyebrow?: string;
  /** Sem título a tela é uma aba de outra (Estoque › Histórico): só as ações. */
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function StockPageShell({ eyebrow, title, actions, children }: StockPageShellProps) {
  return (
    <div className="space-y-6">
      {title ? (
        <PageHeader title={title} description={eyebrow} actions={actions} />
      ) : actions ? (
        <div className="flex flex-wrap items-center justify-end gap-3">{actions}</div>
      ) : null}
      {children}
    </div>
  );
}

type StockMetricCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "blue" | "amber" | "rose";
};

export function StockMetricCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: StockMetricCardProps) {
  const toneClass = {
    default: "bg-card text-muted-foreground",
    blue: "bg-primary/10 text-primary",
    amber: "bg-warning-soft text-warning-soft-foreground",
    rose: "bg-destructive-soft text-destructive-soft-foreground",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground/70">{label}</p>
          <div className="mt-4 text-3xl font-semibold tracking-normal text-foreground">
            {value}
          </div>
        </div>
        {icon ? (
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-lg border border-border",
              toneClass,
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
      {hint ? (
        <p className="mt-3 text-sm leading-6 text-foreground/65">{hint}</p>
      ) : null}
    </div>
  );
}

export function StockMetricsGrid({ children }: { children: ReactNode }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {children}
    </section>
  );
}

type StockToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  resultText?: string;
  /** O que está filtrado ("Entrada"); vazio quando é "Todos". */
  filterSummary?: string;
  /** Rótulo do grupo de chips no painel do celular. */
  filterLabel?: string;
  children?: ReactNode;
};

export function StockToolbar({
  search,
  onSearchChange,
  placeholder,
  resultText,
  filterSummary,
  filterLabel = "Mostrar",
  children,
}: StockToolbarProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={placeholder}
            className="h-12 rounded-lg border-border bg-card pl-11 text-sm shadow-none"
          />
        </div>
        {children ? (
          <FilterPanel summary={filterSummary}>
            <FilterGroup label={filterLabel}>{children}</FilterGroup>
          </FilterPanel>
        ) : null}
      </div>
      {resultText ? (
        <p className="mt-4 text-sm text-muted-foreground">{resultText}</p>
      ) : null}
    </section>
  );
}

type StockFilterChipProps = {
  active?: boolean;
  children: ReactNode;
  count?: ReactNode;
  onClick?: () => void;
};

export function StockFilterChip({
  active,
  children,
  count,
  onClick,
}: StockFilterChipProps) {
  return (
    <Chip
      selected={active}
      onClick={onClick}
      count={typeof count === "number" || typeof count === "string" ? count : undefined}
    >
      {children}
    </Chip>
  );
}

export function StockTableCard({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      {children}
    </section>
  );
}

type StockTablePaginationProps = {
  page: number;
  isLoading: boolean;
  count: number;
  total: number;
  limit: number;
  onPrevious: () => void;
  onNext: () => void;
  label: string;
  /** Preferir o has_more do servidor: `count` já vem pós-filtro em memória. */
  hasMore?: boolean;
};

export function StockTablePagination({
  page,
  isLoading,
  count,
  total,
  limit,
  onPrevious,
  onNext,
  label,
  hasMore,
}: StockTablePaginationProps) {
  const canGoNext = hasMore ?? count >= limit;
  return (
    <div className="flex flex-col gap-3 border-t border-border/80 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Exibindo <span className="font-medium text-foreground">{count}</span> de{" "}
        <span className="font-medium text-foreground">{total}</span> {label}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={page === 0 || isLoading}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!canGoNext || isLoading}
        >
          Próximo
        </Button>
      </div>
    </div>
  );
}
