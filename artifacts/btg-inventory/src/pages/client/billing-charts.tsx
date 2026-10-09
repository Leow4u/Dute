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

/** "10,8" para o rótulo estreito do celular; a unidade (R$ mil) fica no apoio do cartão. */
function thousands(value: number) {
  return (value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

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
  // Com mais de 8 meses não cabe valor em cima de cada barra no celular, e
  // os rótulos de mês saem alternados a partir do último (o mês em destaque
  // é o mais recente). O valor exato continua no toque.
  const dense = months.length > 8;
  const skipLabel = (index: number) => dense && (months.length - 1 - index) % 2 === 1;
  return (
    <div className="relative" style={{ height }} role="img" aria-label={`Gasto por mês: ${months.map((m) => `${m.label} ${m.total === null ? "sem fatura" : exact.format(m.total)}`).join("; ")}`}>
      <div className="absolute inset-x-0 border-b border-border" style={{ top: plot + 18 }} />
      <div className="absolute inset-0 flex items-end gap-2 px-1 sm:gap-4" style={{ paddingBottom: height - plot - 18 }}>
        {months.map((month, index) => {
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
                <span className={cn("mb-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground", dense && "hidden sm:inline")}>
                  {print ? (
                    moneyShort(value)
                  ) : (
                    <>
                      <span className="sm:hidden">{thousands(value)}</span>
                      <span className="hidden sm:inline">{moneyShort(value)}</span>
                    </>
                  )}
                </span>
              ) : null}
              <span
                className="block w-full max-w-[56px] rounded-t-sm"
                style={{ height: barHeight, background: strong ? "hsl(var(--chart-bar))" : "hsl(var(--chart-bar-soft))" }}
              />
              <span
                className={cn(
                  "absolute -bottom-[22px] whitespace-nowrap text-xs",
                  month.competencia === highlight ? "font-semibold text-foreground" : "text-muted-foreground",
                  skipLabel(index) && "hidden sm:inline",
                )}
              >
                {month.label}
              </span>
              {!print && hover === month.competencia ? (
                <span className="pointer-events-none absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm">
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
