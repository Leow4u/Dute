import { useEffect, useRef, type ReactNode } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { Esqueleto } from "@/components/ui/esqueleto";
import { FilterGroup, FilterPanel } from "@/components/ui/filter-panel";
import { PageHeader } from "@/components/ui/page-header";
import { BarraDaLista } from "@/lib/carregando/use-lista-em-troca";
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
  /** A linha de estado da lista, sob o título (a `LinhaDeEstado`; carregamento v2, seção 5.3). */
  estado?: ReactNode;
  children: ReactNode;
};

export function StockPageShell({ eyebrow, title, actions, estado, children }: StockPageShellProps) {
  return (
    <div className="space-y-6">
      {title ? (
        <PageHeader title={title} description={eyebrow} actions={actions} estado={estado} />
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
  /** O resumo da página; lendo, o bloco no lugar dele (a linha fica guardada e nada pula na chegada). */
  resultText?: ReactNode;
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
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{placeholder}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={placeholder}
            className="h-12 rounded-lg border-border bg-card pl-11 text-sm shadow-none"
          />
        </label>
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

/**
 * O cartão da tabela. Com `trocando` (a troca de filtro, busca ou página;
 * carregamento v2, momento 7, caso 4), a barra no topo dele até a lista nova
 * chegar; a lista anterior, a 50% e inert, é a da tela (useListaEmTroca).
 *
 * Com `pagina`, a página nova que chega com o topo do cartão acima da tela
 * (a pessoa tocou em "Próximo" no pé de uma página longa) traz o começo dela
 * à vista, de uma vez: a pessoa lê a página nova do começo, como quando a
 * lista recolhia.
 */
export function StockTableCard({ children, trocando, pagina }: { children: ReactNode; trocando?: boolean; pagina?: number }) {
  const cartao = useRef<HTMLElement>(null);
  const paginaVista = useRef(pagina);
  useEffect(() => {
    if (trocando || pagina === undefined || paginaVista.current === pagina) return;
    paginaVista.current = pagina;
    const elemento = cartao.current;
    if (elemento && elemento.getBoundingClientRect().top < 0) elemento.scrollIntoView({ block: "start" });
  }, [pagina, trocando]);
  return (
    <section ref={cartao} className="relative scroll-mt-4 overflow-hidden rounded-lg border border-border bg-card">
      {trocando !== undefined ? <BarraDaLista ativa={trocando} /> : null}
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
  /**
   * A página nova ainda não chegou (a lista anterior na tela): os botões
   * ficam ocupados, com `aria-disabled` e a trava aqui, sem `disabled`, para
   * o foco ficar em quem a pessoa tocou.
   */
  ocupada?: boolean;
  /** A página não chegou (o aviso está no lugar da lista): sem o "Exibindo 0 de 0", que seria um falso zero. */
  semContagem?: boolean;
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
  ocupada = false,
  semContagem = false,
}: StockTablePaginationProps) {
  const canGoNext = hasMore ?? count >= limit;
  // Na ponta (a primeira ou a última página), o botão fica indisponível com `aria-disabled`, e não `disabled`: o
  // botão que leva à ponta tem o foco quando ela chega, e o `disabled` o mandaria ao body (2.4.3).
  const semAnterior = page === 0 || isLoading;
  const semProximo = !canGoNext || isLoading;
  return (
    <div className="flex flex-col gap-3 border-t border-border/80 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      {semContagem ? (
        <span aria-hidden="true" />
      ) : (
        <p className="text-sm text-muted-foreground">
          Exibindo <span className="font-medium text-foreground">{count}</span> de{" "}
          <span className="font-medium text-foreground">{total}</span> {label}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!ocupada && !semAnterior) onPrevious();
          }}
          aria-disabled={ocupada || semAnterior || undefined}
          data-indisponivel={semAnterior || undefined}
          className="data-[indisponivel]:opacity-50"
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!ocupada && !semProximo) onNext();
          }}
          aria-disabled={ocupada || semProximo || undefined}
          data-indisponivel={semProximo || undefined}
          className="data-[indisponivel]:opacity-50"
        >
          Próximo
        </Button>
      </div>
    </div>
  );
}

/** A largura do bloco de cada coluna da linha-fantasma ("w-28"); "acoes" são os dois botões de 32 px. */
export type ColunaFantasma = string;

/**
 * A linha-fantasma da primeira leitura das tabelas do Catálogo (carregamento
 * v2, parte 13d; momento 2): os blocos na altura da linha real, que entram aos
 * 300 ms com o brilho (o `data-visivel`); fora da árvore de acessibilidade.
 * Quem diz o que lê é a linha de estado sob o título.
 */
export function LinhaFantasmaDaTabela({ visivel, larguras }: { visivel: boolean; larguras: readonly ColunaFantasma[] }) {
  const brilho = visivel ? "carregando-com-brilho" : undefined;
  return (
    <tr aria-hidden="true" data-fantasmas="" data-visivel={visivel ? "" : undefined}>
      {larguras.map((largura, coluna) => (
        <td key={coluna} className={coluna < 2 ? "px-5 py-3" : "px-4 py-2"}>
          {largura === "acoes" ? (
            <span className="flex h-9 items-center justify-center gap-2">
              <Esqueleto forma="bloco" className={cn("size-8", brilho)} />
              <Esqueleto forma="bloco" className={cn("size-8", brilho)} />
            </span>
          ) : (
            <span className="flex h-9 items-center">
              <Esqueleto forma="texto" className={cn(largura, brilho)} />
            </span>
          )}
        </td>
      ))}
    </tr>
  );
}
