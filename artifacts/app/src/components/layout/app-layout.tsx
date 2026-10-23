import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getActiveModule,
  getNavigationForProfileRole,
  isAccountPath,
  isModuleEnabled,
  isModuleGroup,
  isNavRouteActive,
  type AppModule,
  type ModuleRoute,
} from "@/lib/modules";
import { AccountMenu, SidebarAccountFooter } from "@/components/layout/account-menu";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { SidebarBrand } from "@/components/layout/sidebar-brand";
import { SinoDoPortal } from "@/components/portal/sino";
import WmsLayout from "@/components/layout/wms-layout";
import { useAtalhoDoAgente } from "@/hooks/use-atalho-do-agente";
import { isAgentScreen } from "@/lib/agent-chat";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { OPERACAO_LIBERADO } from "@/lib/liberacao";
import { useOperationProfile } from "@/lib/operation-profile";
import { usePwaInstall } from "@/lib/pwa-install";
import { rememberReturnPath } from "@/lib/settings-nav";

function RouteDropdownItem({
  active,
  route,
}: {
  active: boolean;
  route: ModuleRoute;
}) {
  const Icon = route.icon;

  if (!route.href) {
    return (
      <DropdownMenuItem disabled className="gap-2">
        <Icon className="h-4 w-4" />
        {route.label}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem asChild>
      <Link
        href={route.href}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-sm",
          active && "bg-accent text-accent-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        <span>{route.label}</span>
      </Link>
    </DropdownMenuItem>
  );
}

function CollapsedModuleItem({
  active,
  location,
  module,
}: {
  active: boolean;
  location: string;
  module: AppModule;
}) {
  const Icon = module.icon;
  const enabled = isModuleEnabled(module);
  const hasSubroutes = isModuleGroup(module);
  const triggerClassName = cn(
    "flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-[background-color,color,box-shadow] duration-200",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/60 hover:bg-card hover:text-sidebar-foreground",
    !enabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
  );

  if (!enabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={triggerClassName} aria-disabled="true">
            <Icon className="h-5 w-5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{module.label}</TooltipContent>
      </Tooltip>
    );
  }

  if (!hasSubroutes && module.href) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={module.href}
            className={triggerClassName}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-5 w-5" />
            <span className="sr-only">{module.label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{module.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger className={triggerClassName}>
            <Icon className="h-5 w-5" />
            <span className="sr-only">{module.label}</span>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{module.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-[260px]">
        <DropdownMenuLabel>{module.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {module.routes.map((route) => (
          <RouteDropdownItem
            key={route.id}
            route={route}
            active={Boolean(
              isNavRouteActive(location, route),
            )}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExpandedModuleItem({
  active,
  isOpen,
  location,
  module,
  onToggle,
}: {
  active: boolean;
  isOpen: boolean;
  location: string;
  module: AppModule;
  onToggle: (moduleId: string) => void;
}) {
  const Icon = module.icon;
  const enabled = isModuleEnabled(module);
  const hasSubroutes = isModuleGroup(module);
  const itemClassName = cn(
    "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium outline-none transition-[background-color,color,box-shadow] duration-200",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/70 hover:bg-card hover:text-sidebar-foreground",
    !enabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
  );

  if (!enabled) {
    return (
      <button
        type="button"
        className={itemClassName}
        aria-disabled="true"
        disabled
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{module.label}</span>
      </button>
    );
  }

  if (!hasSubroutes && module.href) {
    return (
      <Link
        href={module.href}
        className={itemClassName}
        aria-current={active ? "page" : undefined}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{module.label}</span>
      </Link>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        className={itemClassName}
        aria-expanded={isOpen}
        onClick={() => onToggle(module.id)}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{module.label}</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
        )}
      </button>
      {isOpen ? (
        <div className="ml-4 space-y-1 border-l border-sidebar-border/80 pl-3">
          {module.routes.map((route) => {
            const RouteIcon = route.icon;
            const routeActive = Boolean(
              isNavRouteActive(location, route),
            );
            const className = cn(
              "flex min-h-9 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-[background-color,color] duration-200",
              routeActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/55 hover:bg-card hover:text-sidebar-foreground",
              !route.href &&
                "cursor-not-allowed opacity-40 hover:bg-transparent",
            );

            if (!route.href) {
              return (
                <span key={route.id} className={className} aria-disabled="true">
                  <RouteIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{route.label}</span>
                </span>
              );
            }

            return (
              <Link
                key={route.id}
                href={route.href}
                className={className}
                aria-current={routeActive ? "page" : undefined}
              >
                <RouteIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{route.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * O layout das rotas do WMS e do portal: a equipe entra no shell v3 da
 * Armazenagem (parte 4.7a); o cliente segue no layout do portal, abaixo,
 * até o portal passar para a v3.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  if (role && role !== "cliente") return <WmsLayout>{children}</WmsLayout>;
  return <LayoutDoPortal>{children}</LayoutDoPortal>;
}

function LayoutDoPortal({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const { isOnline } = usePwaInstall();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  // No portal, o modelo de operação do cliente decide quais módulos existem.
  const operation = useOperationProfile();
  const modules = getNavigationForProfileRole(user?.publicMetadata.role, operation.profile);
  const activeModule = getActiveModule(modules, location);
  // Na tela da conta nenhum item do menu fica aceso.
  const activeId = isAccountPath(location) ? null : activeModule.id;
  const clientSurface =
    location === "/portal" || location.startsWith("/portal/");
  const profileRole = user?.publicMetadata.role;
  // O sino dos avisos (parte 4.6c): só o cliente, onde a rotina dos avisos roda.
  const showSino = profileRole === "cliente" && OPERACAO_LIBERADO;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("dute.sidebar") === "collapsed";
  });
  // No Agent Dute o menu recolhe sozinho e o chat fica com a tela. Abrir o
  // menu ali vale só até sair da tela; a preferência salva não muda.
  const agentScreen = isAgentScreen(location);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  useEffect(() => {
    if (!agentScreen) setAgentMenuOpen(false);
  }, [agentScreen]);
  const collapsed = agentScreen ? !agentMenuOpen : sidebarCollapsed;
  function toggleSidebar() {
    if (agentScreen) setAgentMenuOpen((current) => !current);
    else setSidebarCollapsed((current) => !current);
  }
  useAtalhoDoAgente(profileRole);
  const [openModuleIds, setOpenModuleIds] = useState<Set<string>>(
    () => new Set([activeModule.id]),
  );

  // O "Voltar" da Configuração devolve a pessoa para esta tela.
  useEffect(() => {
    rememberReturnPath(`${location}${window.location.search}`);
  }, [location]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "dute.sidebar",
      sidebarCollapsed ? "collapsed" : "expanded",
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (collapsed) return;
    setOpenModuleIds((current) => {
      if (current.has(activeModule.id)) return current;
      const next = new Set(current);
      next.add(activeModule.id);
      return next;
    });
  }, [activeModule.id, collapsed]);

  function toggleModule(moduleId: string) {
    setOpenModuleIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }

  return (
    <div data-ambiente="wms" className="app-atmosphere flex h-[100dvh] min-h-0 w-full overflow-hidden font-sans text-foreground">
      <aside
        className={cn(
          "hidden min-h-0 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-20" : "w-[292px]",
        )}
      >
        <div
          className={cn(
            "flex h-20 items-center border-b border-sidebar-border/70 px-3",
            collapsed ? "justify-center" : "justify-between gap-3",
          )}
        >
          <SidebarBrand basePath={basePath} collapsed={collapsed} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/60 outline-none transition-colors duration-200 hover:bg-card hover:text-sidebar-foreground",
                  collapsed &&
                    "absolute left-[56px] bg-sidebar",
                )}
                onClick={toggleSidebar}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {collapsed ? "Expandir menu" : "Recolher menu"}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expandir menu" : "Recolher menu"}
            </TooltipContent>
          </Tooltip>
        </div>

        <nav
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-5",
            collapsed ? "items-center px-3" : "px-4",
          )}
        >
          {modules.map((module) =>
            collapsed ? (
              <CollapsedModuleItem
                key={module.id}
                module={module}
                location={location}
                active={activeId === module.id}
              />
            ) : (
              <ExpandedModuleItem
                key={module.id}
                module={module}
                location={location}
                active={activeId === module.id}
                isOpen={openModuleIds.has(module.id)}
                onToggle={toggleModule}
              />
            ),
          )}
        </nav>

        <div
          className={cn(
            "border-t border-sidebar-border/70 p-3",
            collapsed ? "flex flex-col items-center gap-2" : "flex items-center gap-2 px-4",
          )}
        >
          {showSino && collapsed ? <SinoDoPortal /> : null}
          <div className={cn("min-w-0", !collapsed && "flex-1")}>
            <SidebarAccountFooter
              basePath={basePath}
              compact={collapsed}
              signOut={signOut}
              user={user}
            />
          </div>
          {showSino && !collapsed ? <SinoDoPortal /> : null}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card px-4 md:hidden">
          <img
            src={`${basePath}/dutelog-logo.png`}
            alt="Dutelog Soluções Logísticas"
            className="h-8 w-auto min-w-0 max-w-[168px] shrink object-contain dark:hidden"
          />
          <img
            src={`${basePath}/dutelog-logo-light.png`}
            alt=""
            aria-hidden="true"
            className="hidden h-8 w-auto min-w-0 max-w-[168px] shrink object-contain dark:block"
          />
          <div className="flex min-w-0 items-center gap-2">
            {showSino ? <SinoDoPortal lado="bottom" /> : null}
            <AccountMenu basePath={basePath} compact cabecalho signOut={signOut} user={user} />
          </div>
        </header>
        {!isOnline ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-warning-soft-border bg-warning-soft/95 px-4 py-2 text-center text-xs font-medium text-warning-soft-foreground"
          >
            <WifiOff className="h-4 w-4 shrink-0" />
            Sem conexão. Consultas podem estar desatualizadas e movimentações
            permanecem bloqueadas até a internet voltar.
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div
            className={cn(
              "mx-auto h-full",
              clientSurface
                ? "max-w-none p-0"
                : "max-w-[1600px] p-5 md:p-8 lg:p-10",
            )}
          >
            {children}
          </div>
        </div>
        <MobileTabBar activeModuleId={activeId} modules={modules} />
      </main>
    </div>
  );
}
