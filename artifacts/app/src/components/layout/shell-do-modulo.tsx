import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { WifiOff, type LucideIcon } from "lucide-react";

import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { SeletorDeModulo } from "@/components/layout/seletor-de-modulo";
import { isNavRouteActive, type AppModule } from "@/lib/modules";
import type { OpcaoDeModulo } from "@/lib/seletor-de-modulo";
import { cn } from "@/lib/utils";

/**
 * Shell v3 de um módulo (docs/plataforma/plano-de-implantacao.md, parte 2.3;
 * mockups docs/mockups/ModComInicio.dc.html e ModOpInicio.dc.html): barra
 * lateral preta com o logo (leva aos cards), o seletor de módulo, as telas do
 * módulo com o contador de cada uma e a conta no rodapé. No celular, o
 * cabeçalho preto traz o seletor e a conta, e a barra inferior, as telas.
 * Sem legenda: só rótulos, dados e ações.
 */

export type ContadorDoItem = { n: number; alerta?: boolean };

export type ShellDoModuloProps = {
  ambiente: "comercial" | "operacao";
  atual: { label: string; icon: LucideIcon };
  opcoes: readonly OpcaoDeModulo[];
  items: AppModule[];
  contadores?: Readonly<Record<string, ContadorDoItem>>;
  basePath: string;
  online: boolean;
  conta: (compact: boolean) => ReactNode;
  children: ReactNode;
};

function Contador({ contador }: { contador: ContadorDoItem | undefined }) {
  if (!contador || contador.n <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums",
        contador.alerta ? "bg-v3-marca text-v3-marca-foreground" : "bg-v3-header-foreground/15 text-v3-header-foreground",
      )}
    >
      {contador.n}
    </span>
  );
}

export function ShellDoModulo({
  ambiente,
  atual,
  opcoes,
  items,
  contadores,
  basePath,
  online,
  conta,
  children,
}: ShellDoModuloProps) {
  const [location] = useLocation();
  const aberto = items.find((item) => item.routes.some((route) => isNavRouteActive(location, route)));

  return (
    <div
      data-ambiente={ambiente}
      className="v3 flex h-[100dvh] min-h-0 w-full overflow-hidden bg-background font-sans text-foreground"
    >
      <aside
        aria-label={atual.label}
        className="hidden min-h-0 w-62 shrink-0 flex-col bg-v3-header px-3.5 pb-4 pt-6 text-v3-header-foreground md:flex"
      >
        <Link href="/" className="mb-5 block self-start rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80">
          <img src={`${basePath}/dutelog-logo-light.png`} alt="Dutelog Soluções Logísticas" className="h-8 w-auto" />
        </Link>
        <SeletorDeModulo atual={atual} opcoes={opcoes} variante="v3" />
        <nav aria-label={`Telas de ${atual.label}`} className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => {
            const Icone = item.icon;
            const atualItem = aberto?.id === item.id;
            return (
              <Link
                key={item.id}
                href={item.href ?? "/"}
                aria-current={atualItem ? "page" : undefined}
                className={cn(
                  "relative flex h-12 shrink-0 items-center gap-3 rounded-lg px-3.5 text-base font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80",
                  atualItem
                    ? "bg-v3-header-foreground/15 text-v3-header-foreground"
                    : "text-v3-header-foreground/75 hover:bg-v3-header-foreground/10 hover:text-v3-header-foreground",
                )}
              >
                {atualItem ? (
                  <span aria-hidden="true" className="absolute inset-y-3.5 left-0 w-0.75 rounded-full bg-v3-marca" />
                ) : null}
                <Icone className="size-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Contador contador={contadores?.[item.id]} />
              </Link>
            );
          })}
        </nav>
        <div className="mt-3 border-t border-v3-header-foreground/10 pt-3">{conta(false)}</div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 bg-v3-header px-4 md:hidden">
          <SeletorDeModulo atual={atual} opcoes={opcoes} variante="v3-cabecalho" />
          {conta(true)}
        </header>
        {online ? null : (
          <p
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-warning-soft-border bg-warning-soft px-4 py-2 text-sm font-bold text-warning-soft-foreground"
          >
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            Sem conexão
          </p>
        )}
        <main className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[1600px] p-4 md:p-8 lg:px-11 lg:py-9">{children}</div>
        </main>
        <MobileTabBar activeModuleId={aberto?.id ?? null} modules={items} variante="v3" />
      </div>
    </div>
  );
}
