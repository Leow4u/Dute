import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { WifiOff } from "lucide-react";

import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { ModulosLink } from "@/components/layout/modulos-link";
import { SidebarBrand } from "@/components/layout/sidebar-brand";
import { isNavRouteActive, type AppModule } from "@/lib/modules";
import { cn } from "@/lib/utils";

/**
 * Shell do Comercial: menu, título e página inicial do módulo, sem os
 * destinos do WMS. As telas (fila, clientes, contratos e as que já existem)
 * entram como itens. "Módulos" só quando a pessoa tem outro módulo.
 */
export function ComercialShell({
  items,
  showModulos,
  basePath,
  online,
  conta,
  children,
}: {
  items: AppModule[];
  showModulos: boolean;
  basePath: string;
  online: boolean;
  conta: (compact: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [location] = useLocation();
  const active = items.find((item) => item.routes.some((route) => isNavRouteActive(location, route)));

  return (
    <div
      data-ambiente="comercial"
      className="app-atmosphere flex h-[100dvh] min-h-0 w-full overflow-hidden font-sans text-foreground"
    >
      <aside className="hidden min-h-0 w-[292px] flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-20 items-center border-b border-sidebar-border/70 px-4">
          <SidebarBrand basePath={basePath} collapsed={false} />
        </div>
        <div className="px-4 pt-4">
          <h2 className="px-3 text-base font-semibold text-sidebar-foreground">Comercial</h2>
        </div>
        <nav aria-label="Comercial" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-3">
          {showModulos ? <ModulosLink variant="sidebar" /> : null}
          {items.map((item) => {
            const route = item.routes[0];
            const current = route ? isNavRouteActive(location, route) : false;
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href ?? "/comercial"}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium outline-none transition-colors duration-200",
                  current
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-card hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border/70 px-4 py-3">{conta(false)}</div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card px-4 md:hidden">
          <img
            src={`${basePath}/dutelog-logo.png`}
            alt="Dutelog Soluções Logísticas"
            className="h-8 w-auto min-w-0 max-w-[140px] shrink object-contain dark:hidden"
          />
          <img
            src={`${basePath}/dutelog-logo-light.png`}
            alt=""
            aria-hidden="true"
            className="hidden h-8 w-auto min-w-0 max-w-[140px] shrink object-contain dark:block"
          />
          <div className="flex min-w-0 items-center gap-2">
            {showModulos ? <ModulosLink variant="header" /> : null}
            {conta(true)}
          </div>
        </header>
        {online ? null : (
          <div
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-warning-soft-border bg-warning-soft/95 px-4 py-2 text-center text-xs font-medium text-warning-soft-foreground"
          >
            <WifiOff className="h-4 w-4 shrink-0" />
            Sem conexão. Consultas podem estar desatualizadas e movimentações permanecem bloqueadas até a internet voltar.
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="mx-auto h-full max-w-[1600px] p-5 md:p-8 lg:p-10">{children}</div>
        </div>
        <MobileTabBar activeModuleId={active?.id ?? null} modules={items} />
      </main>
    </div>
  );
}
