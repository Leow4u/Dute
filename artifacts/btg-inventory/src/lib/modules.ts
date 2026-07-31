import {
  Activity,
  ArrowRightLeft,
  BarChart3,
  Building2,
  BrainCircuit,
  ClipboardList,
  FileText,
  Home,
  Inbox,
  LayoutDashboard,
  PackagePlus,
  PackageSearch,
  Receipt,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type ProfileRole =
  | "owner"
  | "admin"
  | "interno"
  | "wms"
  | "financeiro"
  | "suporte"
  | "cliente";

export type AppRole = "interno" | "cliente";
export type CurrentAppRole = AppRole;

export const INTERNAL_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "wms",
  "financeiro",
  "suporte",
];

export const ACCESS_ADMIN_ROLES: ProfileRole[] = ["owner", "admin"];
export const WMS_ROLES: ProfileRole[] = ["owner", "admin", "interno", "wms", "suporte"];
export const FINANCE_ROLES: ProfileRole[] = ["owner", "admin", "financeiro"];
export const OPERATIONS_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "wms",
  "suporte",
];
export const SUPPORT_ROLES: ProfileRole[] = ["owner", "admin", "suporte"];

/**
 * Poda da escala real (31/07/2026): o operador wms vive na bancada WMS.
 * Torre de Controle, Triagem de solicitações e Catálogo são superfícies de
 * coordenação — fora do menu (e das rotas) do operador. A consulta física
 * dele é a aba Estoque da própria bancada.
 */
export const TOWER_NAV_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "financeiro",
  "suporte",
];
export const COORDINATION_NAV_ROLES: ProfileRole[] = [
  "owner",
  "admin",
  "interno",
  "suporte",
];

export function normalizeProfileRole(role: unknown): ProfileRole | null {
  return role === "owner" ||
    role === "admin" ||
    role === "interno" ||
    role === "wms" ||
    role === "financeiro" ||
    role === "suporte" ||
    role === "cliente"
    ? role
    : null;
}

export function appRoleForProfile(role: ProfileRole | null | undefined): AppRole | null {
  if (role === "cliente") return "cliente";
  return role ? "interno" : null;
}

export function canAccessModule(
  role: ProfileRole | null | undefined,
  allowedRoles?: ProfileRole[],
) {
  if (!allowedRoles?.length) return Boolean(role);
  return Boolean(role && allowedRoles.includes(role));
}

export type ModuleAudience = "internal" | "client";

export type ModuleRoute = {
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  roles: ProfileRole[];
  appRoles: CurrentAppRole[];
  exact?: boolean;
};

export type AppModule = {
  id: string;
  label: string;
  audience: ModuleAudience;
  href?: string;
  icon: LucideIcon;
  roles: ProfileRole[];
  appRoles: CurrentAppRole[];
  routes: ModuleRoute[];
};

const CLIENT_ROLES: ProfileRole[] = ["cliente"];

function currentAppRolesFor(roles: ProfileRole[]): CurrentAppRole[] {
  return Array.from(
    new Set(
      roles
        .map((role) => appRoleForProfile(role))
        .filter((role): role is CurrentAppRole => Boolean(role)),
    ),
  );
}

function navRoute(config: Omit<ModuleRoute, "appRoles">): ModuleRoute {
  return {
    ...config,
    appRoles: currentAppRolesFor(config.roles),
  };
}

function appModule(
  config: Omit<AppModule, "appRoles" | "href"> & { href?: string },
): AppModule {
  return {
    ...config,
    href: config.href ?? config.routes.find((route) => route.href)?.href,
    appRoles: currentAppRolesFor(config.roles),
  };
}

export const APP_MODULES: AppModule[] = [
  // "Como está a operação agora?" tem um lugar só. Torre de Controle reúne
  // as antigas 3 telas de situação (Dashboard, Agent Dute Operacional,
  // Suporte/Observabilidade) que buscavam os mesmos endpoints e repetiam os
  // mesmos contadores em réguas próprias.
  appModule({
    id: "control-tower",
    label: "Torre de Controle",
    audience: "internal",
    icon: LayoutDashboard,
    roles: TOWER_NAV_ROLES,
    routes: [
      navRoute({
        id: "control-overview",
        label: "Visão geral",
        href: "/dashboard",
        icon: LayoutDashboard,
        roles: TOWER_NAV_ROLES,
        exact: true,
      }),
      navRoute({
        id: "control-reports",
        label: "Relatórios",
        href: "/reports",
        icon: BarChart3,
        roles: TOWER_NAV_ROLES,
      }),
      navRoute({
        id: "ai-agent-panel",
        label: "Agent Dute",
        href: "/agente",
        icon: BrainCircuit,
        roles: TOWER_NAV_ROLES,
      }),
      navRoute({
        id: "ai-agent-knowledge",
        label: "Conhecimento",
        href: "/agente/conhecimento",
        icon: FileText,
        roles: TOWER_NAV_ROLES,
      }),
      navRoute({
        id: "support-observability",
        label: "Observabilidade",
        href: "/suporte",
        icon: Activity,
        roles: SUPPORT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "requests",
    label: "Solicitações",
    audience: "internal",
    icon: Inbox,
    roles: COORDINATION_NAV_ROLES,
    routes: [
      navRoute({
        id: "request-triage",
        label: "Triagem",
        href: "/solicitacoes",
        icon: ClipboardList,
        roles: COORDINATION_NAV_ROLES,
      }),
    ],
  }),
  appModule({
    id: "wms",
    label: "WMS",
    audience: "internal",
    icon: Warehouse,
    roles: WMS_ROLES,
    // As etapas (Recebimento, Putaway, Picking...) são módulos internos da
    // mesma bancada — a tela troca de etapa pelo seletor próprio. Um único
    // item de menu; os deep links /wms/<etapa> seguem válidos via
    // WMS_DEEP_LINK_PATHS.
    routes: [
      navRoute({
        id: "wms-bench",
        label: "WMS",
        href: "/wms",
        icon: Warehouse,
        roles: WMS_ROLES,
      }),
    ],
  }),
  appModule({
    id: "inventory",
    label: "Estoque",
    audience: "internal",
    icon: PackageSearch,
    roles: COORDINATION_NAV_ROLES,
    routes: [
      // Produtos e SKUs eram duas visões do mesmo catálogo; o Mapa do
      // armazém é um pivô da coluna Localização. Viraram abas de /catalogo.
      navRoute({
        id: "inventory-catalog",
        label: "Catálogo",
        href: "/catalogo",
        icon: PackageSearch,
        roles: COORDINATION_NAV_ROLES,
      }),
      navRoute({
        id: "inventory-movements",
        label: "Movimentações",
        href: "/movements",
        icon: ArrowRightLeft,
        roles: COORDINATION_NAV_ROLES,
      }),
      navRoute({
        id: "inventory-orders",
        label: "Pedidos",
        href: "/orders",
        icon: ShoppingCart,
        roles: COORDINATION_NAV_ROLES,
      }),
    ],
  }),
  appModule({
    id: "billing",
    label: "Faturamento",
    audience: "internal",
    icon: Receipt,
    roles: FINANCE_ROLES,
    routes: [
      // A Tabela de preços é a configuração que a competência executa;
      // virou aba de /faturamento.
      navRoute({
        id: "billing-hub",
        label: "Faturamento",
        href: "/faturamento",
        icon: Receipt,
        roles: FINANCE_ROLES,
      }),
    ],
  }),
  appModule({
    id: "documents",
    label: "Documentos",
    audience: "internal",
    icon: FileText,
    roles: INTERNAL_ROLES,
    routes: [
      navRoute({
        id: "documents-library",
        label: "Documentos",
        href: "/documentos",
        icon: FileText,
        roles: INTERNAL_ROLES,
      }),
    ],
  }),
  appModule({
    id: "admin",
    label: "Administração",
    audience: "internal",
    icon: Users,
    roles: ACCESS_ADMIN_ROLES,
    routes: [
      navRoute({
        id: "admin-customers",
        label: "Clientes",
        href: "/clientes",
        icon: Building2,
        roles: ACCESS_ADMIN_ROLES,
      }),
      navRoute({
        id: "admin-users",
        label: "Usuários e acessos",
        href: "/usuarios",
        icon: Users,
        roles: ACCESS_ADMIN_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-home",
    label: "Início",
    audience: "client",
    icon: Home,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-home-overview",
        label: "Visão geral",
        href: "/portal",
        icon: LayoutDashboard,
        roles: CLIENT_ROLES,
        exact: true,
      }),
    ],
  }),
  appModule({
    id: "client-inventory",
    label: "Estoque",
    audience: "client",
    icon: PackageSearch,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-inventory-balances",
        label: "Estoque",
        href: "/portal/estoque",
        icon: PackageSearch,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  // "Avisar chegada" fala a língua do fluxo real: a Cristiane comprou,
  // manda entregar no galpão e avisa; o Rafael recebe e confere.
  appModule({
    id: "client-requests",
    label: "Avisar chegada",
    audience: "client",
    icon: Inbox,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-request-list",
        label: "Avisar chegada",
        href: "/portal/recebimentos",
        icon: PackagePlus,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-orders",
    label: "Pedidos",
    audience: "client",
    icon: Truck,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-orders-deliveries",
        label: "Pedidos",
        href: "/portal/pedidos",
        icon: Truck,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-invoices",
    label: "Faturas",
    audience: "client",
    icon: Receipt,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-invoices-list",
        label: "Faturas",
        href: "/portal/faturas",
        icon: Receipt,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-documents",
    label: "Documentos",
    audience: "client",
    icon: FileText,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-documents-library",
        label: "Documentos",
        href: "/portal/documentos",
        icon: FileText,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-assistant",
    label: "Agent Dute",
    audience: "client",
    icon: BrainCircuit,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-assistant-chat",
        label: "Agent Dute",
        href: "/portal/agente",
        icon: BrainCircuit,
        roles: CLIENT_ROLES,
        exact: true,
      }),
    ],
  }),
];

/**
 * Etapas da bancada WMS que saíram do menu mas continuam roteáveis como
 * deep link (atalhos salvos, links compartilhados entre operadores).
 */
export const WMS_DEEP_LINK_PATHS = [
  "/wms/receber",
  "/wms/pedidos",
  "/wms/contagem",
  "/wms/recebimento",
  "/wms/qualidade",
  "/wms/putaway",
  "/wms/picking",
  "/wms/packing",
  "/wms/expedicao",
  "/wms/devolucoes",
  "/wms/inventario",
  "/wms/excecoes",
  "/warehouse",
] as const;

const WMS_DEEP_LINK_APP_ROLES = Object.fromEntries(
  WMS_DEEP_LINK_PATHS.map((path) => [path, currentAppRolesFor(WMS_ROLES)]),
);

const WMS_DEEP_LINK_PROFILE_ROLES = Object.fromEntries(
  WMS_DEEP_LINK_PATHS.map((path) => [path, WMS_ROLES]),
);

/**
 * Abas das telas fundidas + rotas antigas que agora redirecionam para elas.
 * Precisam de entrada própria porque não constam como rota de menu.
 */
const MERGED_SCREEN_PATHS: Array<{ path: string; roles: ProfileRole[] }> = [
  { path: "/catalogo/saldos", roles: WMS_ROLES },
  { path: "/catalogo/mapa", roles: WMS_ROLES },
  { path: "/products", roles: WMS_ROLES },
  { path: "/skus", roles: WMS_ROLES },
  { path: "/faturamento/tabela", roles: FINANCE_ROLES },
  { path: "/tabela-precos", roles: FINANCE_ROLES },
];

const MERGED_SCREEN_APP_ROLES = Object.fromEntries(
  MERGED_SCREEN_PATHS.map(({ path, roles }) => [path, currentAppRolesFor(roles)]),
);

const MERGED_SCREEN_PROFILE_ROLES = Object.fromEntries(
  MERGED_SCREEN_PATHS.map(({ path, roles }) => [path, roles]),
);

const ROUTE_APP_ROLES = APP_MODULES.reduce<Record<string, CurrentAppRole[]>>(
  (acc, module) => {
    module.routes.forEach((route) => {
      if (route.href) {
        acc[normalizePath(route.href)] = route.appRoles;
      }
    });
    return acc;
  },
  {
    ...WMS_DEEP_LINK_APP_ROLES,
    ...MERGED_SCREEN_APP_ROLES,
    "/wms": currentAppRolesFor(WMS_ROLES),
    "/minhas-faturas": ["cliente"],
    "/configuracoes": ["interno", "cliente"],
  },
);

const ROUTE_PROFILE_ROLES = APP_MODULES.reduce<Record<string, ProfileRole[]>>(
  (acc, module) => {
    module.routes.forEach((route) => {
      if (route.href) {
        acc[normalizePath(route.href)] = route.roles;
      }
    });
    return acc;
  },
  {
    ...WMS_DEEP_LINK_PROFILE_ROLES,
    ...MERGED_SCREEN_PROFILE_ROLES,
    "/wms": WMS_ROLES,
    "/minhas-faturas": ["cliente"],
    "/configuracoes": [...INTERNAL_ROLES, "cliente"],
  },
);

export function normalizePath(path: string): string {
  const [withoutHash] = path.split("#");
  const [withoutQuery] = withoutHash.split("?");
  return withoutQuery || "/";
}

export function getHomePathForAppRole(role: AppRole | null | undefined) {
  return role === "cliente" ? "/portal" : "/dashboard";
}

/**
 * Aterrissagem por papel do perfil: cada pessoa cai na tela onde trabalha,
 * não num dashboard genérico. O operador WMS abre a bancada; o financeiro,
 * a competência do mês.
 */
export function getHomePathForProfile(role: ProfileRole | null | undefined) {
  if (role === "cliente") return "/portal";
  if (role === "wms") return "/wms";
  if (role === "financeiro") return "/faturamento";
  return "/dashboard";
}

export function getRouteAppRoles(path: string): AppRole[] {
  return ROUTE_APP_ROLES[normalizePath(path)] ?? ["interno"];
}

export function getRouteProfileRoles(path: string): ProfileRole[] {
  return ROUTE_PROFILE_ROLES[normalizePath(path)] ?? INTERNAL_ROLES;
}

export function getNavigationForAppRole(
  role: CurrentAppRole | null | undefined,
): AppModule[] {
  const appRole = role ?? "interno";
  return APP_MODULES.filter((module) => module.appRoles.includes(appRole));
}

export function getNavigationForProfileRole(
  role: ProfileRole | null | undefined,
): AppModule[] {
  const appRole = appRoleForProfile(role) ?? "interno";

  return APP_MODULES.filter(
    (module) =>
      module.appRoles.includes(appRole) && canAccessModule(role, module.roles),
  )
    .map((module) => ({
      ...module,
      routes: module.routes.filter((route) => canAccessModule(role, route.roles)),
    }))
    .filter((module) => module.routes.length > 0);
}

export function isModuleEnabled(module: AppModule): boolean {
  return Boolean(module.href);
}

export function isRouteActive(
  currentPath: string,
  href: string,
  exact = false,
): boolean {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);

  if (exact) return current === target;
  return current === target || current.startsWith(`${target}/`);
}

export function getActiveModule(
  modules: AppModule[],
  currentPath: string,
): AppModule {
  return (
    modules.find((module) =>
      module.routes.some(
        (route) =>
          route.href && isRouteActive(currentPath, route.href, route.exact),
      ),
    ) ??
    modules.find(isModuleEnabled) ??
    modules[0]
  );
}
