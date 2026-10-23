import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronRight, LayoutGrid, Settings } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getMobileNavigation,
  isAccountPath,
  isNavRouteActive,
  type AppModule,
} from "@/lib/modules";
import { cn } from "@/lib/utils";

type MobileTabBarProps = {
  activeModuleId: string | null;
  modules: AppModule[];
  /** "v3": barra preta do Comercial e da Operação, com o ícone aberto no vermelho da marca. */
  variante?: "padrao" | "v3";
};

/**
 * Navegação do celular: barra fixa embaixo com até quatro destinos e
 * "Mais" com o resto do menu e a Configuração. Substitui a régua rolável
 * que ficava sob o cabeçalho e o botão flutuante do Agent Dute.
 */
export function MobileTabBar({ activeModuleId, modules, variante = "padrao" }: MobileTabBarProps) {
  const v3 = variante === "v3";
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { bar, more } = getMobileNavigation(modules);
  const moreActive =
    isAccountPath(location) ||
    (activeModuleId !== null && !bar.some((module) => module.id === activeModuleId));

  // Trocar de tela fecha o painel.
  useEffect(() => {
    setMoreOpen(false);
  }, [location]);

  const itemClassName = (active: boolean) =>
    cn(
      "flex h-14 min-w-0 flex-col items-center justify-center gap-1 text-xs font-medium outline-none transition-colors duration-150",
      v3
        ? cn(
            "font-bold focus-visible:bg-v3-header-foreground/10",
            active ? "text-v3-header-foreground [&>svg]:text-v3-marca" : "text-v3-header-foreground/70",
          )
        : cn("focus-visible:bg-surface-hover", active ? "text-primary" : "text-muted-foreground"),
    );

  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        "safe-bottom shrink-0 md:hidden",
        v3 ? "bg-v3-header" : "border-t border-border bg-card",
      )}
    >
      <ul className="flex items-stretch">
        {bar.map((module) => {
          const Icon = module.icon;
          const active = activeModuleId === module.id;
          return (
            <li key={module.id} className="min-w-0 flex-1">
              <Link
                href={module.href ?? "/"}
                className={itemClassName(active)}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="max-w-full truncate px-1">{module.label}</span>
              </Link>
            </li>
          );
        })}
        {more.length ? (
          <li className="min-w-0 flex-1">
            <button
              type="button"
              className={cn(itemClassName(moreActive), "w-full")}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
            >
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
              <span>Mais</span>
            </button>
          </li>
        ) : null}
      </ul>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className={cn("max-h-[85dvh] overflow-y-auto rounded-t-xl bg-card p-0", v3 && "v3")}>
          <SheetHeader className="border-b border-border px-5 py-4 text-left">
            <SheetTitle>Mais</SheetTitle>
            <SheetDescription className="sr-only">Outras telas do sistema.</SheetDescription>
          </SheetHeader>
          <ul className="safe-bottom py-2">
            {more.map(({ module, routes }) =>
              routes.map((route) => {
                const Icon = route.icon;
                const active = Boolean(
                  isNavRouteActive(location, route),
                );
                // "Estoque · Receber": a tela secundária diz de que destino é.
                const label =
                  route.label === module.label ? route.label : `${module.label} · ${route.label}`;
                return (
                  <li key={route.id}>
                    <Link
                      href={route.href ?? "/"}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-12 items-center gap-3 px-5 text-sm font-medium",
                        active ? "bg-accent text-accent-foreground" : "text-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                    </Link>
                  </li>
                );
              }),
            )}
            <li className="mt-2 border-t border-border pt-2">
              <Link
                href="/configuracoes"
                aria-current={isAccountPath(location) ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center gap-3 px-5 text-sm font-medium",
                  isAccountPath(location) ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <Settings className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Configuração</span>
                <ChevronRight className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
