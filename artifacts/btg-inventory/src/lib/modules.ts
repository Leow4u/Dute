import {
  ArrowDownToLine,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  BrainCircuit,
  ClipboardList,
  FileText,
  Home,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Map as MapIcon,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PackageX,
  Receipt,
  ShoppingCart,
  Tags,
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

export type ModuleIcon =
  | "tower"
  | "requests"
  | "wms"
  | "inventory"
  | "billing"
  | "documents"
  | "agent"
  | "admin"
  | "orders"
  | "warehouse"
  | "reports";

export type ModuleNavItem = {
  href: string;
  label: string;
  description?: string;
  icon: ModuleIcon;
  roles: ProfileRole[];
};

export type ModuleSection = {
  id: string;
  title: string;
  items: ModuleNavItem[];
};

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

export const INTERNAL_MODULES: ModuleSection[] = [
  {
    id: "control",
    title: "Comando",
    items: [
      {
        href: "/dashboard",
        label: "Torre de Controle",
        description: "Riscos, SLAs, IA e operação em tempo real.",
        icon: "tower",
        roles: INTERNAL_ROLES,
      },
      {
        href: "/solicitacoes",
        label: "Solicitações",
        description: "Triagem e aprovação do portal do cliente.",
        icon: "requests",
        roles: OPERATIONS_ROLES,
      },
      {
        href: "/agente",
        label: "Agent Dute",
        description: "Memória, recomendações e rastreabilidade Genkit.",
        icon: "agent",
        roles: INTERNAL_ROLES,
      },
    ],
  },
  {
    id: "wms",
    title: "WMS",
    items: [
      {
        href: "/wms",
        label: "Operação Física",
        description: "Recebimento, qualidade, picking, packing e expedição.",
        icon: "wms",
        roles: WMS_ROLES,
      },
      {
        href: "/warehouse",
        label: "Mapa do Armazém",
        description: "Endereços, ruas e posições físicas.",
        icon: "warehouse",
        roles: WMS_ROLES,
      },
    ],
  },
  {
    id: "inventory",
    title: "Estoque",
    items: [
      {
        href: "/products",
        label: "Produtos",
        description: "Cadastro consolidado e custo por item.",
        icon: "inventory",
        roles: INTERNAL_ROLES,
      },
      {
        href: "/skus",
        label: "SKUs e Saldos",
        description: "Saldo, posição e disponibilidade.",
        icon: "inventory",
        roles: INTERNAL_ROLES,
      },
      {
        href: "/movements",
        label: "Movimentações",
        description: "Livro de estoque e rastreabilidade física.",
        icon: "inventory",
        roles: INTERNAL_ROLES,
      },
      {
        href: "/orders",
        label: "Pedidos",
        description: "Pedidos operacionais ligados ao WMS.",
        icon: "orders",
        roles: OPERATIONS_ROLES,
      },
      {
        href: "/reports",
        label: "Relatórios",
        description: "Exportações e visões analíticas.",
        icon: "reports",
        roles: INTERNAL_ROLES,
      },
    ],
  },
  {
    id: "finance",
    title: "Financeiro",
    items: [
      {
        href: "/faturamento",
        label: "Faturamento",
        description: "Competências, serviços e cobrança.",
        icon: "billing",
        roles: FINANCE_ROLES,
      },
      {
        href: "/tabela-precos",
        label: "Tabela de Preços",
        description: "Regras comerciais de armazenagem e operação.",
        icon: "billing",
        roles: FINANCE_ROLES,
      },
    ],
  },
  {
    id: "admin",
    title: "Administração",
    items: [
      {
        href: "/usuarios",
        label: "Usuários e Acessos",
        description: "Convites, papéis e vínculo com clientes.",
        icon: "admin",
        roles: ACCESS_ADMIN_ROLES,
      },
    ],
  },
];

export const CLIENT_MODULES: ModuleSection[] = [
  {
    id: "client",
    title: "Portal do Cliente",
    items: [
      {
        href: "/portal",
        label: "Início",
        description: "Resumo do contrato e próximos passos.",
        icon: "tower",
        roles: ["cliente"],
      },
      {
        href: "/portal/estoque",
        label: "Estoque",
        description: "SKUs, saldos e itens críticos.",
        icon: "inventory",
        roles: ["cliente"],
      },
      {
        href: "/portal/solicitacoes",
        label: "Solicitações",
        description: "Abertura e acompanhamento.",
        icon: "requests",
        roles: ["cliente"],
      },
      {
        href: "/portal/pedidos",
        label: "Pedidos e Entregas",
        description: "WMS físico, volumes, expedição e entrega.",
        icon: "orders",
        roles: ["cliente"],
      },
      {
        href: "/portal/faturas",
        label: "Faturas",
        description: "Competências e valores.",
        icon: "billing",
        roles: ["cliente"],
      },
      {
        href: "/portal/documentos",
        label: "Documentos",
        description: "Notas, comprovantes e romaneios.",
        icon: "documents",
        roles: ["cliente"],
      },
      {
        href: "/portal/agente",
        label: "Chat Agent Dute",
        description: "Conversa com o agente operacional.",
        icon: "agent",
        roles: ["cliente"],
      },
    ],
  },
];

export function visibleSections(
  sections: ModuleSection[],
  role: ProfileRole | null | undefined,
) {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessModule(role, item.roles)),
    }))
    .filter((section) => section.items.length > 0);
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
  appModule({
    id: "control-tower",
    label: "Torre de Controle",
    audience: "internal",
    icon: LayoutDashboard,
    roles: INTERNAL_ROLES,
    routes: [
      navRoute({
        id: "control-overview",
        label: "Visão geral",
        href: "/dashboard",
        icon: LayoutDashboard,
        roles: INTERNAL_ROLES,
        exact: true,
      }),
      navRoute({
        id: "control-reports",
        label: "Relatórios",
        href: "/reports",
        icon: BarChart3,
        roles: INTERNAL_ROLES,
      }),
    ],
  }),
  appModule({
    id: "requests",
    label: "Solicitações",
    audience: "internal",
    icon: Inbox,
    roles: OPERATIONS_ROLES,
    routes: [
      navRoute({
        id: "request-triage",
        label: "Triagem",
        href: "/solicitacoes",
        icon: ClipboardList,
        roles: OPERATIONS_ROLES,
      }),
    ],
  }),
  appModule({
    id: "wms",
    label: "WMS",
    audience: "internal",
    icon: Warehouse,
    roles: WMS_ROLES,
    routes: [
      navRoute({
        id: "wms-receiving",
        label: "Recebimento",
        href: "/wms/recebimento",
        icon: ArrowDownToLine,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "wms-quality",
        label: "Qualidade",
        href: "/wms/qualidade",
        icon: ClipboardList,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "wms-putaway",
        label: "Putaway",
        href: "/wms/putaway",
        icon: MapIcon,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "wms-picking",
        label: "Picking",
        href: "/wms/picking",
        icon: PackageOpen,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "wms-packing",
        label: "Packing",
        href: "/wms/packing",
        icon: PackageCheck,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "wms-shipping",
        label: "Expedição",
        href: "/wms/expedicao",
        icon: Truck,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "wms-exceptions",
        label: "Exceções",
        href: "/wms/excecoes",
        icon: PackageX,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "wms-map",
        label: "Mapa do armazém",
        href: "/warehouse",
        icon: Boxes,
        roles: WMS_ROLES,
      }),
    ],
  }),
  appModule({
    id: "inventory",
    label: "Estoque",
    audience: "internal",
    icon: PackageSearch,
    roles: WMS_ROLES,
    routes: [
      navRoute({
        id: "inventory-products",
        label: "Produtos",
        href: "/products",
        icon: PackageSearch,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "inventory-skus",
        label: "SKUs e saldos",
        href: "/skus",
        icon: Tags,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "inventory-movements",
        label: "Movimentações",
        href: "/movements",
        icon: ArrowRightLeft,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "inventory-orders",
        label: "Pedidos",
        href: "/orders",
        icon: ShoppingCart,
        roles: OPERATIONS_ROLES,
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
      navRoute({
        id: "billing-periods",
        label: "Faturamento",
        href: "/faturamento",
        icon: Receipt,
        roles: FINANCE_ROLES,
      }),
      navRoute({
        id: "billing-price-list",
        label: "Tabela de preços",
        href: "/tabela-precos",
        icon: ListChecks,
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
        icon: FileText,
        roles: INTERNAL_ROLES,
      }),
    ],
  }),
  appModule({
    id: "ai-agent",
    label: "Agent Dute",
    audience: "internal",
    icon: BrainCircuit,
    roles: INTERNAL_ROLES,
    routes: [
      navRoute({
        id: "ai-agent-panel",
        label: "Operacional",
        href: "/agente",
        icon: BrainCircuit,
        roles: INTERNAL_ROLES,
      }),
      navRoute({
        id: "ai-agent-knowledge",
        label: "Conhecimento",
        href: "/agente/conhecimento",
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
  appModule({
    id: "client-requests",
    label: "Solicitações",
    audience: "client",
    icon: Inbox,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-request-list",
        label: "Solicitações",
        href: "/portal/solicitacoes",
        icon: ClipboardList,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
  appModule({
    id: "client-orders",
    label: "Pedidos/Entregas",
    audience: "client",
    icon: Truck,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-orders-deliveries",
        label: "Pedidos/Entregas",
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
        label: "Chat",
        href: "/portal/agente",
        icon: BrainCircuit,
        roles: CLIENT_ROLES,
        exact: true,
      }),
      navRoute({
        id: "client-assistant-operational",
        label: "Operacional",
        href: "/portal/agente/operacional",
        icon: BarChart3,
        roles: CLIENT_ROLES,
      }),
    ],
  }),
];

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
