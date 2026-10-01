import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Download,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  User as UserIcon,
  WifiOff,
} from "lucide-react";

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
  isRouteActive,
  type AppModule,
  type ModuleRoute,
} from "@/lib/modules";
import { AgentDock } from "@/components/agent/agent-dock";
import { useAppAuth, useAppUser, type AppUser } from "@/lib/auth";
import { usePwaInstall } from "@/lib/pwa-install";
import { roleDescription, roleLabel } from "@/lib/access";
import { rememberReturnPath } from "@/lib/settings-nav";

type AccountMenuProps = {
  basePath: string;
  compact?: boolean;
  signOut: (options?: { redirectUrl?: string }) => Promise<void>;
  user: AppUser | null;
};

function UserAvatar({ user }: { user: AppUser | null }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-sidebar-border bg-sidebar-accent">
      {user?.imageUrl ? (
        <img
          src={user.imageUrl}
          alt="Avatar"
          className="h-full w-full object-cover"
        />
      ) : (
        <UserIcon className="h-4 w-4" />
      )}
    </div>
  );
}

function AccountMenu({
  basePath,
  compact = false,
  signOut,
  user,
}: AccountMenuProps) {
  const { isInstalled } = usePwaInstall();
  const role = user?.publicMetadata.role;
  const name = user?.fullName || "Usuário";
  const email = user?.primaryEmailAddress?.emailAddress || "Sem e-mail";
  const managesAccess = role === "owner" || role === "admin";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-3 rounded-xl text-sm font-medium text-sidebar-foreground/80 outline-none transition-colors duration-200 hover:bg-white/70 hover:text-sidebar-foreground",
          compact ? "h-11 w-11 justify-center" : "w-full px-2 py-2",
        )}
      >
        <UserAvatar user={user} />
        {compact ? (
          <span className="sr-only">Minha conta</span>
        ) : (
          <>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-semibold text-sidebar-foreground">{name}</div>
              <div className="truncate text-xs text-sidebar-foreground/55">{email}</div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? "start" : "end"}
        side={compact ? "right" : "top"}
        className="w-[300px] p-0"
      >
        {/* A conta inteira cabe aqui; a antiga tela de Configuração repetia isto. */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <UserAvatar user={user} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          </div>
        </div>
        <div className="space-y-1.5 border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Perfil</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">
              {roleLabel(role)}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {roleDescription(role)}{" "}
            {managesAccess
              ? "Perfis são definidos em Pessoas e acessos."
              : "Para mudar seu perfil, fale com a administração."}
          </p>
        </div>
        <div className="p-1">
          <DropdownMenuItem asChild>
            <Link href="/configuracoes" className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              Configuração
            </Link>
          </DropdownMenuItem>
          {!isInstalled ? (
            <DropdownMenuItem asChild>
              <Link href="/configuracoes/aplicativo" className="cursor-pointer">
                <Download className="mr-2 h-4 w-4" />
                Instalar no celular
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarAccountFooter(props: AccountMenuProps) {
  if (props.compact) {
    return (
      <div className="flex justify-center">
        <AccountMenu {...props} />
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-sidebar-border/70 bg-white/55 p-1 shadow-[0_8px_24px_rgba(15,23,42,.04)] backdrop-blur-[40px]">
      <AccountMenu {...props} />
    </div>
  );
}

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
  const hasSubroutes = module.routes.filter((route) => route.href).length > 1;
  const triggerClassName = cn(
    "flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-[background-color,color,box-shadow] duration-200",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_8px_24px_rgba(15,23,42,.04)]"
      : "text-sidebar-foreground/60 hover:bg-white/70 hover:text-sidebar-foreground",
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
              route.href && isRouteActive(location, route.href, route.exact),
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
  const hasSubroutes = module.routes.filter((route) => route.href).length > 1;
  const itemClassName = cn(
    "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium outline-none transition-[background-color,color,box-shadow] duration-200",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_8px_24px_rgba(15,23,42,.04)]"
      : "text-sidebar-foreground/70 hover:bg-white/70 hover:text-sidebar-foreground",
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
              route.href && isRouteActive(location, route.href, route.exact),
            );
            const className = cn(
              "flex min-h-9 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-[background-color,color] duration-200",
              routeActive
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/55 hover:bg-white/70 hover:text-sidebar-foreground",
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

function MobileModuleNav({
  activeModuleId,
  location,
  modules,
}: {
  activeModuleId: string | null;
  location: string;
  modules: AppModule[];
}) {
  return (
    <div className="border-b border-border/70 bg-white/72 backdrop-blur-[40px] md:hidden">
      <nav className="flex gap-2 overflow-x-auto px-4 py-2">
        {modules.map((module) => {
          const Icon = module.icon;
          const active = activeModuleId === module.id;
          const enabled = isModuleEnabled(module);
          const hasSubroutes =
            module.routes.filter((route) => route.href).length > 1;
          const itemClassName = cn(
            "flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium outline-none transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          );

          if (!enabled) {
            return (
              <span
                key={module.id}
                className="flex h-10 shrink-0 cursor-not-allowed items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground opacity-45"
              >
                <Icon className="h-4 w-4" />
                {module.label}
              </span>
            );
          }

          if (!hasSubroutes && module.href) {
            return (
              <Link
                key={module.id}
                href={module.href}
                className={itemClassName}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
                {module.label}
              </Link>
            );
          }

          return (
            <DropdownMenu key={module.id}>
              <DropdownMenuTrigger className={itemClassName}>
                <Icon className="h-4 w-4" />
                {module.label}
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[260px]">
                <DropdownMenuLabel>{module.label}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {module.routes.map((route) => (
                  <RouteDropdownItem
                    key={route.id}
                    route={route}
                    active={Boolean(
                      route.href &&
                      isRouteActive(location, route.href, route.exact),
                    )}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </nav>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const { isOnline } = usePwaInstall();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const modules = getNavigationForProfileRole(user?.publicMetadata.role);
  const activeModule = getActiveModule(modules, location);
  // Na tela da conta nenhum item do menu fica aceso.
  const activeId = isAccountPath(location) ? null : activeModule.id;
  const clientSurface =
    location === "/portal" || location.startsWith("/portal/");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("dute.sidebar") === "collapsed";
  });
  // No Agent Dute o menu recolhe sozinho e o chat fica com a tela. Abrir o
  // menu ali vale só até sair da tela; a preferência salva não muda.
  const agentScreen = location === "/portal/agente";
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  useEffect(() => {
    if (!agentScreen) setAgentMenuOpen(false);
  }, [agentScreen]);
  const collapsed = agentScreen ? !agentMenuOpen : sidebarCollapsed;
  function toggleSidebar() {
    if (agentScreen) setAgentMenuOpen((current) => !current);
    else setSidebarCollapsed((current) => !current);
  }
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
    <div className="app-atmosphere flex h-[100dvh] min-h-0 w-full overflow-hidden font-sans text-foreground">
      <aside
        className={cn(
          "hidden min-h-0 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-[40px] transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-20" : "w-[292px]",
        )}
      >
        <div
          className={cn(
            "flex h-20 items-center border-b border-sidebar-border/70 px-3",
            collapsed ? "justify-center" : "justify-between gap-3",
          )}
        >
          <img
            src={`${basePath}/dutelog-logo.png`}
            alt="Dutelog Soluções Logísticas"
            className={cn(
              "h-9 w-auto object-contain transition-[max-width] duration-200",
              collapsed ? "max-w-[56px]" : "max-w-[168px]",
            )}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/60 outline-none transition-colors duration-200 hover:bg-white/70 hover:text-sidebar-foreground",
                  collapsed &&
                    "absolute left-[56px] bg-sidebar/90 shadow-[0_8px_24px_rgba(15,23,42,.04)]",
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
            collapsed ? "flex justify-center" : "px-4",
          )}
        >
          <SidebarAccountFooter
            basePath={basePath}
            compact={collapsed}
            signOut={signOut}
            user={user}
          />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-border/70 bg-white/72 px-4 backdrop-blur-[40px] md:hidden">
          <img
            src={`${basePath}/dutelog-logo.png`}
            alt="Dutelog Soluções Logísticas"
            className="h-8 w-auto max-w-[168px] object-contain"
          />
          <AccountMenu
            basePath={basePath}
            compact
            signOut={signOut}
            user={user}
          />
        </header>
        {!isOnline ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50/95 px-4 py-2 text-center text-xs font-medium text-amber-900"
          >
            <WifiOff className="h-4 w-4 shrink-0" />
            Sem conexão. Consultas podem estar desatualizadas e movimentações
            permanecem bloqueadas até a internet voltar.
          </div>
        ) : null}
        <MobileModuleNav
          activeModuleId={activeId}
          location={location}
          modules={modules}
        />
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
      </main>
      {clientSurface ? null : <AgentDock />}
    </div>
  );
}
