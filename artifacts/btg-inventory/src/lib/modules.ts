import {
  BarChart3,
  BrainCircuit,
  FileText,
  Home,
  Inbox,
  LayoutDashboard,
  PackagePlus,
  PackageSearch,
  Receipt,
  Sparkles,
  Truck,
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
 * Início (antiga Torre de Controle), Triagem de solicitações e Catálogo são
 * superfícies de coordenação — fora do menu (e das rotas) do operador. A
 * consulta física dele é a aba Estoque da própria bancada.
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
  // Menu interno com 5 destinos que falam a língua da operação (29/09/2026).
  // As telas não mudaram de lugar: a régua só agrupa por assunto e esconde o
  // que é de uso raro em "Mais". As permissões por rota continuam as mesmas
  // (ver modules.test.ts) — sair do menu não muda quem acessa a rota.
  appModule({
    id: "home",
    label: "Início",
    audience: "internal",
    icon: Home,
    roles: TOWER_NAV_ROLES,
    routes: [
      navRoute({
        id: "home-overview",
        label: "Início",
        href: "/dashboard",
        icon: Home,
        roles: TOWER_NAV_ROLES,
        exact: true,
      }),
    ],
  }),
  // Agent Dute: a mesma tela de conversa do portal, para toda a equipe,
  // inclusive o WMS (02/10/2026). O painel do agente segue em /agente/painel.
  appModule({
    id: "agent",
    label: "Agent Dute",
    audience: "internal",
    icon: Sparkles,
    roles: INTERNAL_ROLES,
    routes: [
      navRoute({
        id: "agent-chat",
        label: "Agent Dute",
        href: "/agente",
        icon: Sparkles,
        roles: INTERNAL_ROLES,
      }),
    ],
  }),
  // Pedido é um fluxo só: a coordenação aprova, o armazém separa, e a
  // entrega sai no mesmo dia. Uma tela, três grupos (pages/pedidos.tsx).
  appModule({
    id: "orders",
    label: "Pedidos",
    audience: "internal",
    icon: Truck,
    roles: WMS_ROLES,
    routes: [
      navRoute({
        id: "orders-queue",
        label: "Pedidos",
        href: "/pedidos",
        icon: Truck,
        roles: WMS_ROLES,
      }),
    ],
  }),
  // Estoque: uma lista de itens com a ficha de cada um (cadastro, foto,
  // endereços, reservas, histórico) e o recebimento. Catálogo, Mapa e
  // Movimentações viraram partes da ficha e da aba Histórico.
  appModule({
    id: "inventory",
    label: "Estoque",
    audience: "internal",
    icon: PackageSearch,
    roles: WMS_ROLES,
    routes: [
      navRoute({
        id: "inventory-items",
        label: "Itens",
        href: "/estoque",
        icon: PackageSearch,
        roles: WMS_ROLES,
      }),
      navRoute({
        id: "inventory-receive",
        label: "Receber",
        href: "/wms/receber",
        icon: PackagePlus,
        roles: WMS_ROLES,
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
  // Relatórios virou item próprio (01/10/2026): é tela de uso real do
  // fechamento, não "uso raro".
  appModule({
    id: "reports",
    label: "Relatórios",
    audience: "internal",
    icon: BarChart3,
    roles: TOWER_NAV_ROLES,
    routes: [
      navRoute({
        id: "reports-hub",
        label: "Relatórios",
        href: "/reports",
        icon: BarChart3,
        roles: TOWER_NAV_ROLES,
      }),
    ],
  }),
  // O grupo "Mais" acabou: Relatórios virou item próprio e Documentos ficou
  // sozinho.
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
  // "Envios para a Dutelog": a Cristiane comprou, o fornecedor entrega no
  // armazém da Dutelog e ela avisa; o Rafael recebe e confere.
  appModule({
    id: "client-requests",
    label: "Envios para a Dutelog",
    audience: "client",
    icon: Inbox,
    roles: CLIENT_ROLES,
    routes: [
      navRoute({
        id: "client-request-list",
        label: "Envios para a Dutelog",
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
  // Telas antigas de Estoque, fora do menu mas com os mesmos acessos.
  { path: "/catalogo", roles: COORDINATION_NAV_ROLES },
  { path: "/movements", roles: COORDINATION_NAV_ROLES },
  // Triagem detalhada e histórico, abertos a partir da fila de Pedidos.
  { path: "/solicitacoes", roles: COORDINATION_NAV_ROLES },
  { path: "/orders", roles: COORDINATION_NAV_ROLES },
  // Painel do Agent Dute (notificações, riscos, memória), aberto pela tela
  // do agente e pelo Início.
  { path: "/agente/painel", roles: TOWER_NAV_ROLES },
  { path: "/agente/conhecimento", roles: TOWER_NAV_ROLES },
  { path: "/catalogo/saldos", roles: WMS_ROLES },
  { path: "/catalogo/mapa", roles: WMS_ROLES },
  { path: "/products", roles: WMS_ROLES },
  { path: "/skus", roles: WMS_ROLES },
  { path: "/faturamento/tabela", roles: FINANCE_ROLES },
  // Fatura (prévia ou emitida) para imprimir/salvar PDF.
  { path: "/faturamento/fatura", roles: FINANCE_ROLES },
  { path: "/portal/faturas/fatura", roles: CLIENT_ROLES },
  { path: "/tabela-precos", roles: FINANCE_ROLES },
  // Configuração (tela própria, lib/settings-nav.ts). A Administração saiu do
  // menu e virou seção dela; os endereços antigos redirecionam com os mesmos
  // papéis de antes.
  { path: "/configuracoes", roles: [...INTERNAL_ROLES, "cliente"] },
  { path: "/configuracoes/conta", roles: [...INTERNAL_ROLES, "cliente"] },
  { path: "/configuracoes/aplicativo", roles: [...INTERNAL_ROLES, "cliente"] },
  { path: "/configuracoes/pessoas", roles: ACCESS_ADMIN_ROLES },
  { path: "/configuracoes/cliente", roles: ACCESS_ADMIN_ROLES },
  { path: "/configuracoes/sistema", roles: SUPPORT_ROLES },
  { path: "/usuarios", roles: ACCESS_ADMIN_ROLES },
  { path: "/clientes", roles: ACCESS_ADMIN_ROLES },
  { path: "/suporte", roles: SUPPORT_ROLES },
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
 * não num dashboard genérico. O operador WMS abre a fila de Pedidos (separar
 * e entregar); o financeiro, a competência do mês.
 */
export function getHomePathForProfile(role: ProfileRole | null | undefined) {
  if (role === "cliente") return "/portal";
  if (role === "wms") return "/pedidos";
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
    .map((module) => {
      const routes = module.routes.filter((route) =>
        canAccessModule(role, route.roles),
      );
      // Um grupo que o papel reduziu a uma tela só vira o link dessa tela:
      // o operador WMS vê "Documentos", não um "Mais" com um item dentro.
      if (module.routes.length > 1 && routes.length === 1) {
        const [only] = routes;
        return { ...module, label: only.label, icon: only.icon, routes };
      }
      return { ...module, routes };
    })
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

/** Telas fora do menu que pertencem a um item dele. */
const ACTIVE_ALIASES: Record<string, string> = {
  "/solicitacoes": "/pedidos",
  "/orders": "/pedidos",
  "/wms/pedidos": "/pedidos",
  "/wms": "/estoque",
  "/wms/contagem": "/estoque",
  "/catalogo": "/estoque",
  "/catalogo/saldos": "/estoque",
  "/catalogo/mapa": "/estoque",
  "/movements": "/estoque",
};

/** Telas da Configuração: não pertencem a nenhum item do menu. */
export function isAccountPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/configuracoes" || normalized.startsWith("/configuracoes/");
}

export function getActiveModule(
  modules: AppModule[],
  path: string,
): AppModule {
  const normalized = normalizePath(path);
  // Etapas da bancada fora do menu (/wms/qualidade, /wms/putaway...) são
  // parte do Estoque.
  const currentPath =
    ACTIVE_ALIASES[normalized] ??
    (normalized.startsWith("/wms/") ? "/estoque" : path);
  const exactMatch = modules.find((module) =>
    module.routes.some(
      (route) =>
        route.href && isRouteActive(currentPath, route.href, route.exact),
    ),
  );
  if (exactMatch) return exactMatch;

  // Telas fora do menu (ex.: /wms/contagem, /wms/qualidade) destacam o grupo
  // da rota-mãe mais específica.
  let prefixMatch: AppModule | undefined;
  let prefixLength = 0;
  for (const module of modules) {
    for (const route of module.routes) {
      if (
        route.href &&
        route.href.length > prefixLength &&
        isRouteActive(currentPath, route.href)
      ) {
        prefixMatch = module;
        prefixLength = route.href.length;
      }
    }
  }

  return prefixMatch ?? modules.find(isModuleEnabled) ?? modules[0];
}
