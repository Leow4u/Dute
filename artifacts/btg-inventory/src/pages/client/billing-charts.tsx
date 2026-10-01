import { useState } from "react";

import { cn } from "@/lib/utils";

/** "R$ 23,9 mil" para rótulos de gráfico; o valor exato fica no tooltip e na tabela. */
export function moneyShort(value: number) {
  if (Math.abs(value) >= 1000) {
    return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

const exact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Gasto por mês: uma série, um tom. O mês em destaque (a última fatura) leva
 * o tom cheio; os demais, o mesmo tom mais claro. Mês sem fatura não tem
 * barra. Hover mostra o valor exato.
 */
export function MonthlyBars({
  months,
  highlight,
  height = 180,
  print = false,
}: {
  months: Array<{ competencia: string; label: string; total: number | null }>;
  highlight?: string;
  height?: number;
  print?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...months.map((month) => month.total ?? 0));
  const plot = height - 40;
  return (
    <div className="relative" style={{ height }} role="img" aria-label={`Gasto por mês: ${months.map((m) => `${m.label} ${m.total === null ? "sem fatura" : exact.format(m.total)}`).join("; ")}`}>
      <div className="absolute inset-x-0 border-b border-border" style={{ top: plot + 18 }} />
      <div className="absolute inset-0 flex items-end gap-2 px-1 sm:gap-4" style={{ paddingBottom: height - plot - 18 }}>
        {months.map((month) => {
          const value = month.total ?? 0;
          const barHeight = month.total === null ? 0 : Math.max(3, (value / max) * plot);
          const strong = !highlight || month.competencia === highlight;
          return (
            <div
              key={month.competencia}
              className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(month.competencia)}
              onMouseLeave={() => setHover(null)}
            >
              {month.total !== null ? (
                <span className="mb-1 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{moneyShort(value)}</span>
              ) : null}
              <span
                className="block w-full max-w-[56px] rounded-t-[4px]"
                style={{ height: barHeight, background: strong ? "#2a78d6" : "#a9c8ef" }}
              />
              <span
                className={cn(
                  "absolute -bottom-[22px] whitespace-nowrap text-[11.5px]",
                  month.competencia === highlight ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {month.label}
              </span>
              {!print && hover === month.competencia ? (
                <span className="pointer-events-none absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs shadow-sm">
                  <b>{month.label}</b> · {month.total === null ? "sem fatura" : exact.format(value)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
